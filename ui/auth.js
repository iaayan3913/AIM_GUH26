// YubiKey (WebAuthn) login and plan sign-off. rpID 'localhost', fully offline.
// Credentials are kept in ui/data/credentials.json (gitignored).
import fs from 'node:fs'
import path from 'node:path'
import {
  generateRegistrationOptions, verifyRegistrationResponse,
  generateAuthenticationOptions, verifyAuthenticationResponse
} from '@simplewebauthn/server'

const RP_ID = 'localhost'
const RP_NAME = 'FOBE Care Plans'
const SIGNOFF_TTL_MS = 2 * 60 * 1000

export function mountAuth (app, { dataDir, port, db, wrap }) {
  const file = path.join(dataDir, 'credentials.json')
  const origin = [`http://localhost:${port}`]
  const noAuth = process.env.FOBE_NO_AUTH === '1'
  if (noAuth) console.warn('[auth] FOBE_NO_AUTH=1: YubiKey login is OFF (test mode only)')

  const load = () => { try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return { credentials: [] } } }
  const store = (d) => fs.writeFileSync(file, JSON.stringify(d, null, 2))
  const toCred = (c) => ({ id: c.id, publicKey: new Uint8Array(Buffer.from(c.publicKey, 'base64url')), counter: c.counter, transports: c.transports })
  const allow = (creds) => creds.map((c) => ({ id: c.id, transports: c.transports }))

  const requireAuth = (req, res, next) => {
    if (req.session.user || noAuth) return next()
    res.status(401).json({ error: 'Please sign in with your YubiKey first' })
  }

  app.get('/api/auth/status', (req, res) => {
    res.json({ registered: load().credentials.length > 0, user: req.session.user || (noAuth ? { name: 'Test mode (no YubiKey)' } : null), noAuth })
  })

  // Register a key. The very first key can be added by anyone at this PC; after that, only a signed-in worker can add keys.
  app.post('/api/auth/register/options', wrap(async (req, res) => {
    const d = load()
    if (d.credentials.length && !req.session.user) return res.status(403).json({ error: 'Sign in with an existing key before adding another one' })
    const name = String(req.body?.name || req.session.user?.name || '').trim().slice(0, 60)
    if (!name) return res.status(400).json({ error: 'Please enter your name' })
    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID: RP_ID,
      userName: name,
      userDisplayName: name,
      attestationType: 'none',
      excludeCredentials: allow(d.credentials),
      authenticatorSelection: { authenticatorAttachment: 'cross-platform', residentKey: 'discouraged', userVerification: 'discouraged' },
      preferredAuthenticatorType: 'securityKey'
    })
    req.session.reg = { challenge: options.challenge, name }
    res.json(options)
  }))

  app.post('/api/auth/register/verify', wrap(async (req, res) => {
    const reg = req.session.reg
    if (!reg) return res.status(400).json({ error: 'Registration expired, please try again' })
    delete req.session.reg
    const v = await verifyRegistrationResponse({
      response: req.body, expectedChallenge: reg.challenge, expectedOrigin: origin, expectedRPID: RP_ID, requireUserVerification: false
    })
    if (!v.verified) return res.status(400).json({ error: 'The key could not be verified' })
    const { credential } = v.registrationInfo
    const d = load()
    d.credentials.push({
      id: credential.id,
      publicKey: Buffer.from(credential.publicKey).toString('base64url'),
      counter: credential.counter,
      transports: credential.transports || req.body?.response?.transports || ['usb'],
      name: reg.name,
      created: new Date().toISOString()
    })
    store(d)
    req.session.user = { name: reg.name, credId: credential.id }
    res.json({ ok: true, user: req.session.user })
  }))

  // Shared: check a tap against a stored credential.
  async function verifyTap (req, response, expectedChallenge, onlyCredId) {
    const d = load()
    const c = d.credentials.find((x) => x.id === response?.id)
    if (!c) throw httpError(400, 'This key is not registered on this PC')
    if (onlyCredId && c.id !== onlyCredId && c.name !== req.session.user?.name) throw httpError(403, 'Use your own YubiKey to sign off')
    const v = await verifyAuthenticationResponse({
      response, expectedChallenge, expectedOrigin: origin, expectedRPID: RP_ID, credential: toCred(c), requireUserVerification: false
    })
    if (!v.verified) throw httpError(400, 'The key tap could not be verified')
    c.counter = v.authenticationInfo.newCounter
    c.lastUsed = new Date().toISOString()
    store(d)
    return c
  }

  app.post('/api/auth/login/options', wrap(async (req, res) => {
    const d = load()
    if (!d.credentials.length) return res.status(400).json({ error: 'No YubiKey registered yet' })
    const options = await generateAuthenticationOptions({ rpID: RP_ID, allowCredentials: allow(d.credentials), userVerification: 'discouraged' })
    req.session.login = { challenge: options.challenge }
    res.json(options)
  }))

  app.post('/api/auth/login/verify', wrap(async (req, res) => {
    const login = req.session.login
    if (!login) return res.status(400).json({ error: 'Sign-in expired, please try again' })
    delete req.session.login
    const c = await verifyTap(req, req.body, login.challenge)
    await new Promise((resolve, reject) => req.session.regenerate((e) => (e ? reject(e) : resolve())))
    req.session.user = { name: c.name, credId: c.id }
    res.json({ ok: true, user: req.session.user })
  }))

  app.post('/api/auth/logout', (req, res) => {
    req.session.destroy(() => res.json({ ok: true }))
  })

  // ---- Sign-off: needs a FRESH tap, bound to this child and to the signed-in worker ----
  app.post('/api/plans/:id/signoff/options', requireAuth, wrap(async (req, res) => {
    const plan = await db.getPlan(req.params.id)
    if (!plan) return res.status(404).json({ error: 'No care plan for that child' })
    if (noAuth && !req.session.user) return res.json({ noAuth: true })
    const mine = load().credentials.filter((c) => c.name === req.session.user.name)
    const options = await generateAuthenticationOptions({ rpID: RP_ID, allowCredentials: allow(mine), userVerification: 'discouraged' })
    req.session.signoff = { challenge: options.challenge, childId: req.params.id, at: Date.now() }
    res.json(options)
  }))

  app.post('/api/plans/:id/signoff', requireAuth, wrap(async (req, res) => {
    let name
    if (noAuth && !req.session.user) {
      name = 'Family worker (TEST MODE – no YubiKey)'
    } else {
      const s = req.session.signoff
      delete req.session.signoff
      if (!s || s.childId !== req.params.id || Date.now() - s.at > SIGNOFF_TTL_MS) {
        return res.status(400).json({ error: 'Sign-off expired, please tap your key again' })
      }
      const c = await verifyTap(req, req.body, s.challenge, req.session.user.credId)
      name = c.name
    }
    const plan = await db.getPlan(req.params.id)
    if (!plan) return res.status(404).json({ error: 'No care plan for that child' })
    const now = new Date()
    const saved = await db.putPlan({
      ...plan,
      last_updated: { value: now.toISOString().slice(0, 10), source: `Signed off by ${name}`, status: 'filled' },
      approved_by: name,
      approved_at: now.toISOString()
    })
    res.json({ ok: true, approved_by: saved.approved_by, approved_at: saved.approved_at })
  }))

  return requireAuth
}

function httpError (status, message) {
  const e = new Error(message)
  e.status = status
  return e
}
