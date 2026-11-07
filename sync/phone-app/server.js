// WORK PHONE web app: http://localhost:3001 (local only, no CDNs, no cloud).
// Wraps the phone side of ../index.js: pairing, outbox (sendFile queue), read-only backup.
// Usage: npm run phone   [--dir data/phone] [--port 3001] [--bootstrap host:port]
import express from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startPeer, sendFile, replicaDb, reviewDue, DATA_DIR } from '../index.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d }
const PORT = Number(opt('port', process.env.PORT || 3001))
const dir = path.resolve(opt('dir', path.join(DATA_DIR, 'phone')))
const bootstrap = opt('bootstrap', null)
const capturesDir = path.join(dir, 'captures')
const outboxFile = path.join(dir, 'outbox.json')
const metaFile = path.join(dir, 'backup-meta.json')
fs.mkdirSync(capturesDir, { recursive: true })

let peer = null
let officeName = null
let backup = null
let backupOpening = null
let items = readJson(outboxFile) || [] // newest first
// Visit drafts: files added during a visit stay on the phone until "Finish visit" sends them.
const draftsDir = path.join(dir, 'drafts')
const draftsFile = path.join(dir, 'drafts.json')
let drafts = readJson(draftsFile) || []
const saveDrafts = () => writeJson(draftsFile, drafts)
const meta = readJson(metaFile) || { lastSynced: null }

// ---------- peer + backup ----------

async function connect (pairingKey) {
  if (peer) {
    await closeBackup(true)
    await peer.close()
    peer = null
    fs.rmSync(path.join(dir, 'office-db-key.txt'), { force: true }) // new office = new DB key
  }
  peer = await startPeer({ role: 'phone', pairingKey, dir, bootstrap, name: 'Work phone' })
  peer.onPeer(p => { officeName = p.name; console.log('office connected:', p.name) })
  peer.onPeerLeft(() => console.log('office disconnected (files will queue)'))
  peer._events.on('delivered', d => markDelivered(d.drivePath, d.name))
  peer._events.on('office-db-key', k => openBackup(k))
  peer._events.on('error', err => console.log('peer error:', err.message))
  if (peer.officeDbKey) openBackup(peer.officeDbKey)
  console.log('paired with key', peer.pairingKey)
}

let backupKey = null
function openBackup (key) {
  if (backupKey === key) return backupOpening
  backupKey = key
  const previous = backupOpening || Promise.resolve()
  backupOpening = (async () => {
    await previous
    await closeBackup()
    backup = await replicaDb(path.join(dir, 'backup'), key, { bootstrap })
    backup.onChange(touchSynced)
    backup.synced().then(() => { if (backup?.peers) touchSynced() })
  })().catch(err => console.log('backup error:', err.message))
  return backupOpening
}

async function closeBackup (forget = false) {
  if (forget) { await backupOpening; backupKey = null }
  const b = backup
  backup = null
  if (b) await b.close().catch(() => {})
}

function touchSynced () {
  meta.lastSynced = new Date().toISOString()
  writeJson(metaFile, meta)
}

// While the office is reachable, confirm we're up to date every 15 s ("Last synced hh:mm").
setInterval(async () => {
  const b = backup
  if (!b || !b.peers) return
  const ok = await Promise.race([b.core.update({ wait: true }).then(() => true), sleep(5000).then(() => false)]).catch(() => false)
  if (ok && backup === b) touchSynced()
}, 15000).unref()

// ---------- outbox ----------

function statusOf (item) {
  if (item.deliveredAt) return 'delivered'
  return peer && peer.connected ? 'sending' : 'queued'
}

function markDelivered (drivePath, savedAs) {
  const item = items.find(i => i.drivePath === drivePath)
  if (!item || item.deliveredAt) return
  item.deliveredAt = new Date().toISOString()
  item.savedAs = savedAs
  writeJson(outboxFile, items)
  console.log('delivered', item.name)
}

async function queueFile (filePath, kind, { id, child = null, visitId = null } = {}) {
  const item = {
    id,
    name: path.basename(filePath),
    kind,
    child,
    visitId,
    size: fs.statSync(filePath).size,
    createdAt: new Date().toISOString(),
    drivePath: null,
    deliveredAt: null
  }
  items.unshift(item)
  sendFile(peer, filePath, { onQueued: q => { item.drivePath = q.drivePath; writeJson(outboxFile, items) } })
    .then(r => markDelivered(item.drivePath, r.name))
    .catch(err => { item.error = err.message; writeJson(outboxFile, items) })
  // wait until it's in the outbox drive (safe on disk), not until the office has it
  for (let i = 0; !item.drivePath && !item.error && i < 600; i++) await sleep(50)
  if (item.error) throw new Error(item.error)
  return item
}

// ---------- HTTP ----------

const app = express()
app.use(express.static(path.join(HERE, 'public')))
// FOBE logo: local only, never committed (same files the office UI uses). Text fallback in the page if absent.
app.get('/brand/logo', (req, res) => {
  const root = path.join(HERE, '..', '..')
  const file = [...['fobe-logo.png', 'fobe-logo.webp', 'fobe-logo.jpeg', 'fobe-logo.jpg'].map(f => path.join(root, 'ui', 'private', f)), path.join(root, 'FOBE logo.png')]
    .find(f => fs.existsSync(f))
  if (!file) return res.status(404).end()
  const head = fs.readFileSync(file).subarray(0, 12)
  const type = head.toString('latin1', 8, 12) === 'WEBP' ? 'image/webp' : head[0] === 0xff ? 'image/jpeg' : 'image/png'
  res.type(type).sendFile(file)
})
app.use(express.json({ limit: '1mb' }))

app.get('/api/status', (req, res) => {
  res.json({
    paired: !!peer,
    pairingKey: peer?.pairingKey || null,
    connected: !!(peer && peer.connected),
    officeName,
    queued: items.filter(i => !i.deliveredAt).length
  })
})

app.post('/api/pair', async (req, res) => {
  try {
    await connect(String(req.body?.key || ''))
    res.json({ ok: true, pairingKey: peer.pairingKey })
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

// raw body upload: POST /api/files?name=Ayaan-Malik_recording_2026-11-07_1.wav&kind=recording&child=Ayaan%20Malik&visit=<id>
app.post('/api/files', express.raw({ type: () => true, limit: '500mb' }), async (req, res) => {
  try {
    if (!peer) return res.status(409).json({ error: 'Pair with the office PC first' })
    if (!req.body?.length) return res.status(400).json({ error: 'Empty file' })
    const name = safeName(String(req.query.name || 'file.bin'))
    const kind = ['recording', 'audio', 'photo', 'notes'].includes(req.query.kind) ? req.query.kind : 'file'
    const child = req.query.child ? String(req.query.child).slice(0, 80) : null
    const visitId = req.query.visit ? String(req.query.visit).slice(0, 40) : null
    // each upload in its own folder, so the exact chosen name reaches the office (no "(2)")
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
    const folder = path.join(capturesDir, id)
    fs.mkdirSync(folder, { recursive: true })
    const filePath = path.join(folder, name)
    fs.writeFileSync(filePath, req.body)
    const item = await queueFile(filePath, kind, { id, child, visitId })
    res.json({ ...publicItem(item) })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.get('/api/outbox', (req, res) => res.json(items.map(publicItem)))

// ----- visit drafts -----
const KINDS = ['recording', 'audio', 'photo', 'notes']
const draftPath = (d) => path.join(draftsDir, d.id, d.name)
const nameTaken = (visitId, name, exceptId) => drafts.some(d => d.visitId === visitId && d.id !== exceptId && d.name.toLowerCase() === name.toLowerCase())

// POST /api/drafts?name=Ayaan-Malik_notes_2026-11-07_1.txt&kind=notes&child=Ayaan%20Malik&visit=<id>  (raw body)
app.post('/api/drafts', express.raw({ type: () => true, limit: '500mb' }), (req, res) => {
  try {
    if (!req.body?.length) return res.status(400).json({ error: 'Empty file' })
    const visitId = String(req.query.visit || '').slice(0, 40)
    if (!visitId) return res.status(400).json({ error: 'Start a visit first' })
    const name = safeName(String(req.query.name || 'file.bin'))
    if (nameTaken(visitId, name)) return res.status(409).json({ error: `"${name}" is already in this visit. Choose another name.` })
    const d = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      visitId,
      name,
      kind: KINDS.includes(req.query.kind) ? req.query.kind : 'file',
      child: req.query.child ? String(req.query.child).slice(0, 80) : null,
      size: req.body.length,
      createdAt: new Date().toISOString()
    }
    fs.mkdirSync(path.join(draftsDir, d.id), { recursive: true })
    fs.writeFileSync(draftPath(d), req.body)
    drafts.push(d)
    saveDrafts()
    res.json(d)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.get('/api/drafts', (req, res) => res.json(drafts.filter(d => !req.query.visit || d.visitId === req.query.visit)))

app.get('/api/drafts/:id/file', (req, res) => {
  const d = drafts.find(x => x.id === req.params.id)
  if (!d) return res.status(404).end()
  res.sendFile(draftPath(d))
})

app.patch('/api/drafts/:id', (req, res) => {
  const d = drafts.find(x => x.id === req.params.id)
  if (!d) return res.status(404).json({ error: 'Not found' })
  const name = safeName(String(req.body?.name || ''))
  if (name === 'file') return res.status(400).json({ error: 'Enter a file name' })
  if (nameTaken(d.visitId, name, d.id)) return res.status(409).json({ error: `"${name}" is already in this visit` })
  fs.renameSync(draftPath(d), path.join(draftsDir, d.id, name))
  d.name = name
  if (req.body?.child) d.child = String(req.body.child).slice(0, 80)
  saveDrafts()
  res.json(d)
})

app.delete('/api/drafts/:id', (req, res) => {
  const d = drafts.find(x => x.id === req.params.id)
  if (d) fs.rmSync(path.join(draftsDir, d.id), { recursive: true, force: true })
  drafts = drafts.filter(x => x.id !== req.params.id)
  saveDrafts()
  res.json({ ok: true })
})

// Finish visit: move every draft into the outbox (sent now, or queued until the office is online).
app.post('/api/visits/:visit/finish', async (req, res) => {
  try {
    const list = drafts.filter(d => d.visitId === req.params.visit)
    if (list.length && !peer) return res.status(409).json({ error: 'Pair with the office PC first (Connection tab)' })
    const sent = []
    for (const d of list) {
      const folder = path.join(capturesDir, d.id)
      fs.mkdirSync(folder, { recursive: true })
      const filePath = path.join(folder, d.name)
      fs.renameSync(draftPath(d), filePath)
      fs.rmSync(path.join(draftsDir, d.id), { recursive: true, force: true })
      drafts = drafts.filter(x => x.id !== d.id)
      saveDrafts()
      sent.push(publicItem(await queueFile(filePath, d.kind, { id: d.id, child: d.child, visitId: d.visitId })))
    }
    res.json({ sent })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.get('/api/backup', async (req, res) => {
  const base = { lastSynced: meta.lastSynced, online: !!backup?.peers }
  try {
    if (!backup) return res.json({ ...base, state: peer ? 'waiting' : 'unpaired', plans: [] })
    const readable = await backup.canRead()
    if (readable === null) return res.json({ ...base, state: 'waiting', plans: [] })
    if (readable === false) return res.json({ ...base, state: 'encrypted', blocks: backup.blocks(), plans: [] })
    const plans = (await backup.listPlans()).map(p => {
      const last = p.last_updated?.value || null
      return {
        child_id: p.child_id,
        name: [p.first_name?.value, p.surname?.value].filter(Boolean).join(' ') || p.child_id,
        last_updated: last,
        review_due: last ? reviewDue(last) : null
      }
    }).sort((a, b) => (a.review_due || '9').localeCompare(b.review_due || '9'))
    res.json({ ...base, state: 'ok', plans })
  } catch (err) {
    res.status(500).json({ ...base, state: 'error', error: err.message, plans: [] })
  }
})

const publicItem = (i) => ({ id: i.id, name: i.name, kind: i.kind, child: i.child || null, visitId: i.visitId || null, size: i.size, createdAt: i.createdAt, deliveredAt: i.deliveredAt, status: i.error ? 'error' : statusOf(i), error: i.error || null })

// ---------- start ----------

const savedKey = readText(path.join(dir, 'pairing-key.txt'))
if (savedKey) {
  await connect(savedKey).catch(err => {
    if (/lock/i.test(err.message)) {
      console.log(`\n${dir} is in use by another process (is demo-phone.js running?). Stop it first, or use --dir.`)
      process.exit(1)
    }
    console.log('could not resume pairing:', err.message)
  })
}

const server = app.listen(PORT, '127.0.0.1', () => {
  console.log(`\n=== FOBE WORK PHONE app ===\nOpen http://localhost:${PORT}\nData: ${dir}\n${savedKey ? 'Resumed pairing ' + savedKey : 'Not paired yet: enter the key from the office PC'}\n`)
})

async function shutdown () {
  server.close()
  await closeBackup()
  if (peer) await peer.close().catch(() => {})
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

// ---------- helpers ----------

function sleep (ms) { return new Promise(resolve => setTimeout(resolve, ms)) }
function readText (f) { try { return fs.readFileSync(f, 'utf-8').trim() || null } catch { return null } }
function readJson (f) { try { return JSON.parse(fs.readFileSync(f, 'utf-8')) } catch { return null } }
function writeJson (f, v) { fs.writeFileSync(f, JSON.stringify(v, null, 2)) }
function safeName (n) {
  const clean = path.basename(n).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim().slice(0, 120)
  return clean && !/^\.+$/.test(clean) ? clean : 'file'
}
