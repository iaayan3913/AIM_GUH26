// FOBE sync module: local care-plan DB + peer-to-peer (Holepunch only, no servers, no cloud).
//
//   startPeer({ db, role: 'office' | 'phone', pairingKey? }) -> { pairingKey, onPeer(cb), close(), ... }
//   sendFile(peer, filePath)       phone -> office (visit recording / photo of notes)
//   onFileReceived(cb)             office gets { name, path, from, size, receivedAt }
//   replicaDb(dir, officeDbKey)    read-only, live-updating backup of the office's care plans
//
// How it works
//   - Pairing key: 80 random bits shown as xxxx-xxxx-xxxx-xxxx. Swarm topic = hash(key).
//     Every connection proves knowledge of the key (hash of key + Noise handshake hash),
//     so only paired devices get the office DB key or can drop files into the inbox.
//   - Files: the phone writes them into its own Hyperdrive ("outbox"). The office replicates
//     that drive and copies new files to sync/data/inbox/. Files added while offline are
//     delivered automatically on the next connection.
//   - Backup: Hyperbee replica of the office core (single writer = office PC). Writes refused.
//   - LAN fallback: set FOBE_BOOTSTRAP=host:port (see bootstrap.js) or pass { bootstrap }.

import Hyperswarm from 'hyperswarm'
import Corestore from 'corestore'
import Hyperdrive from 'hyperdrive'
import Protomux from 'protomux'
import c from 'compact-encoding'
import crypto from 'hypercore-crypto'
import b4a from 'b4a'
import z32 from 'z32'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { pipeline } from 'node:stream/promises'
import { createHash } from 'node:crypto'
import { openDb, keyFromPassphrase } from './db.js'

export * from './db.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const DATA_DIR = path.join(HERE, 'data')
export const INBOX_DIR = path.join(DATA_DIR, 'inbox')
const PROTOCOL = 'fobe/pair/v1'

// ---------- pairing key ----------

export function newPairingKey () {
  return z32.encode(crypto.randomBytes(10)).match(/.{4}/g).join('-')
}

function parsePairingKey (str) {
  const clean = String(str || '').trim().toLowerCase()
    .replace(/[^a-z0-9]/g, '').replace(/0/g, 'o').replace(/l/g, '1')
  let buf = null
  try { buf = z32.decode(clean) } catch {}
  if (!buf || buf.length !== 10) throw new Error(`Invalid pairing key "${str}" (expected 16 characters like abcd-efgh-ijkl-mnop)`)
  return buf
}

const formatKey = (buf) => z32.encode(buf).match(/.{4}/g).join('-')
const topicFor = (key) => crypto.hash([b4a.from('fobe-pairing-topic'), key])
const proofFor = (role, key, handshakeHash) => crypto.hash([b4a.from('fobe-proof-' + role), key, handshakeHash])
const hex = (b) => b4a.toString(b, 'hex')

// ---------- swarm options (LAN bootstrap fallback) ----------

export function swarmOptions (opts = {}) {
  let bootstrap = opts.bootstrap || process.env.FOBE_BOOTSTRAP || null
  if (typeof bootstrap === 'string') bootstrap = bootstrap.split(',').map(s => s.trim()).filter(Boolean)
  return bootstrap ? { bootstrap } : {}
}

// ---------- files received (module level, as in CONTRACT.md) ----------

const files = new EventEmitter()
export function onFileReceived (cb) {
  files.on('file', cb)
  return () => files.off('file', cb)
}

// ---------- startPeer ----------

export async function startPeer ({ db = null, role, pairingKey = null, dir = null, inboxDir = INBOX_DIR, name = null, bootstrap = null, encryptionKey = keyFromPassphrase(process.env.FOBE_DB_PASSPHRASE) } = {}) {
  if (role !== 'office' && role !== 'phone') throw new Error("role must be 'office' or 'phone'")
  if (role === 'office' && !db?.writable) throw new Error('office needs its own writable db (openDb)')

  dir = dir || path.join(DATA_DIR, role === 'office' ? 'office-peer' : 'phone')
  await fsp.mkdir(dir, { recursive: true })
  const keyFile = path.join(dir, 'pairing-key.txt')

  // Office: reuse the saved key so the phone only pairs once. Phone: key is required the first time.
  if (!pairingKey && fs.existsSync(keyFile)) pairingKey = fs.readFileSync(keyFile, 'utf-8').trim()
  if (!pairingKey && role === 'office') pairingKey = newPairingKey()
  if (!pairingKey) throw new Error('phone needs the pairing key shown on the office PC')
  const keyBuf = parsePairingKey(pairingKey)
  pairingKey = formatKey(keyBuf)
  fs.writeFileSync(keyFile, pairingKey + '\n')

  const events = new EventEmitter()
  const myName = name || `${os.hostname()} (${role})`
  const swarm = new Hyperswarm(swarmOptions({ bootstrap }))
  const authed = new Set() // { conn, send, name }

  // Phone owns its outbox drive in its own corestore. Office uses the db's corestore.
  const ownStore = role === 'phone' ? new Corestore(path.join(dir, 'outbox')) : null
  const store = ownStore || db.store
  const outbox = role === 'phone' ? new Hyperdrive(store.namespace('fobe-outbox'), { encryptionKey }) : null
  if (outbox) await outbox.ready()

  const peer = {
    role,
    pairingKey,
    swarm,
    officeDbKey: role === 'office' ? db.key : readIfExists(path.join(dir, 'office-db-key.txt')),
    get connected () { return authed.size },
    onPeer (cb) { events.on('peer', cb); return () => events.off('peer', cb) },
    onPeerLeft (cb) { events.on('peer-left', cb); return () => events.off('peer-left', cb) },
    onFile (cb) { events.on('file', cb); return () => events.off('file', cb) },
    async close () {
      await swarm.destroy()
      for (const r of remotes.values()) await r.drive.close().catch(() => {})
      if (outbox) await outbox.close()
      if (ownStore) await ownStore.close()
    },
    _events: events,
    _outbox: outbox,
    _authed: authed,
    _pending: new Map() // drive path -> resolve()
  }

  // office: phone drives we pull files from
  const remotes = new Map() // driveKey hex -> { drive, name, queue }
  const receivedFile = path.join(inboxDir, '.received.json')
  const received = role === 'office' ? (readJson(receivedFile) || {}) : null
  if (role === 'office') await fsp.mkdir(inboxDir, { recursive: true })

  swarm.on('connection', (conn) => {
    store.replicate(conn) // care plans (office -> backups) and outbox drives (phone -> office)
    conn.on('error', () => {})

    const mux = Protomux.from(conn)
    const remoteRole = role === 'office' ? 'phone' : 'office'
    let session = null
    const channel = mux.createChannel({
      protocol: PROTOCOL,
      handshake: c.json,
      onopen (hs) {
        const expected = proofFor(remoteRole, keyBuf, conn.handshakeHash)
        if (!hs || hs.role !== remoteRole || hs.proof !== hex(expected)) {
          conn.destroy(new Error('pairing proof rejected'))
          return
        }
        session = { conn, name: hs.name, send: (m) => msg.send(m) }
        authed.add(session)
        if (role === 'office') session.send({ type: 'hello', dbKey: db.key, name: myName })
        else session.send({ type: 'hello', driveKey: hex(outbox.key), name: myName })
        events.emit('peer', { name: hs.name, role: remoteRole, remoteKey: hex(conn.remotePublicKey) })
      },
      onclose () {
        if (!session) return
        authed.delete(session)
        events.emit('peer-left', { name: session.name })
      }
    })
    if (!channel) return // replica-only peers (backup devices) never open this channel; that's fine
    const msg = channel.addMessage({ encoding: c.json, onmessage: (m) => onMessage(m).catch(err => events.emit('error', err)) })
    channel.open({ role, name: myName, proof: hex(proofFor(role, keyBuf, conn.handshakeHash)) })

    async function onMessage (m) {
      if (!session || !m) return
      if (role === 'phone') {
        if (m.type === 'hello' && m.dbKey) {
          peer.officeDbKey = m.dbKey
          fs.writeFileSync(path.join(dir, 'office-db-key.txt'), m.dbKey + '\n')
          events.emit('office-db-key', m.dbKey)
        } else if (m.type === 'ack') {
          const done = peer._pending.get(m.path)
          peer._pending.delete(m.path)
          if (done) done({ name: m.savedAs, drivePath: m.path })
          events.emit('delivered', { name: m.savedAs, drivePath: m.path })
        }
        return
      }
      // office
      if (m.type === 'hello' && /^[0-9a-f]{64}$/.test(m.driveKey || '')) {
        let r = remotes.get(m.driveKey)
        if (!r) {
          const drive = new Hyperdrive(store, b4a.from(m.driveKey, 'hex'), { encryptionKey })
          await drive.ready()
          r = { drive, name: m.name, queue: Promise.resolve() }
          remotes.set(m.driveKey, r)
        }
        r.name = m.name
        session.remote = r
        enqueue(r, session, 0)
      } else if (m.type === 'file' && session.remote) {
        enqueue(session.remote, session, m.version || 0)
      }
    }
  })

  function enqueue (r, session, minVersion) {
    r.queue = r.queue.then(() => pullFiles(r, session, minVersion)).catch(err => events.emit('error', err))
  }

  async function pullFiles (r, session, minVersion) {
    const { drive } = r
    await drive.update({ wait: true })
    for (let i = 0; drive.version < minVersion && i < 50; i++) {
      await drive.update({ wait: true })
      if (drive.version < minVersion) await new Promise(resolve => setTimeout(resolve, 100))
    }
    for await (const entry of drive.list('/files', { recursive: true })) {
      if (!entry.value.blob) continue
      const id = hex(drive.key) + entry.key
      let saved = received[id]
      if (!saved || !fs.existsSync(saved)) {
        const original = safeName(entry.value.metadata?.name || path.basename(entry.key).replace(/^\d+-/, ''))
        await fsp.mkdir(inboxDir, { recursive: true })
        const tmp = path.join(inboxDir, `.${Date.now()}-${original}.part`)
        await pipeline(drive.createReadStream(entry.key), fs.createWriteStream(tmp))
        // Same name AND same bytes already in the inbox (e.g. demo-visit.wav sent again in a
        // rehearsal): reuse it instead of making "name (2).ext", so the AI cache (keyed by
        // file name) still hits. Touch it so it shows as just received.
        const existing = path.join(inboxDir, original)
        if (await sameFile(existing, tmp)) {
          await fsp.rm(tmp, { force: true })
          const now = new Date()
          await fsp.utimes(existing, now, now)
          saved = existing
        } else {
          saved = uniquePath(inboxDir, original)
          await fsp.rename(tmp, saved)
        }
        received[id] = saved
        fs.writeFileSync(receivedFile, JSON.stringify(received, null, 2))
        const info = { name: path.basename(saved), path: saved, from: r.name, size: entry.value.blob.byteLength, receivedAt: new Date().toISOString() }
        events.emit('file', info)
        files.emit('file', info)
      }
      if (authed.has(session)) session.send({ type: 'ack', path: entry.key, savedAs: path.basename(saved) })
    }
  }

  if (role === 'office') {
    swarm.join(topicFor(keyBuf), { server: true, client: false }) // paired phones
    swarm.join(db.core.discoveryKey, { server: true, client: false }) // read-only backups (need the db key)
  } else {
    const discovery = swarm.join(topicFor(keyBuf), { server: false, client: true })
    keepLookingWhile(swarm, discovery, () => authed.size === 0)
  }
  return peer
}

// ---------- sendFile ----------

// Puts the file in the phone's outbox drive and resolves once the office has saved it.
// If the office is offline it stays queued and is delivered on the next connection.
export async function sendFile (peer, filePath, { onQueued } = {}) {
  if (!peer?._outbox) throw new Error('sendFile needs a peer started with role "phone"')
  const name = safeName(path.basename(filePath))
  const stat = await fsp.stat(filePath)
  if (!stat.isFile()) throw new Error(`${filePath} is not a file`)
  const drivePath = `/files/${Date.now()}-${name}`
  await pipeline(fs.createReadStream(filePath), peer._outbox.createWriteStream(drivePath, { metadata: { name, size: stat.size } }))
  const version = peer._outbox.version
  const delivered = new Promise(resolve => peer._pending.set(drivePath, resolve))
  for (const s of peer._authed) s.send({ type: 'file', path: drivePath, version })
  if (onQueued) onQueued({ name, drivePath, officeOnline: peer._authed.size > 0 })
  return delivered
}

// ---------- replicaDb ----------

// Read-only backup of the office's care plans. Same API as openDb (getPlan, listPlans, history),
// plus onChange(cb) and synced(). putPlan throws: only the office PC writes care plans.
export async function replicaDb (dir, officeDbKey, { bootstrap = null, ...dbOpts } = {}) {
  const keyFile = path.join(dir, 'office-db-key.txt')
  if (!officeDbKey) officeDbKey = readIfExists(keyFile)
  if (!/^[0-9a-f]{64}$/i.test(officeDbKey || '')) throw new Error('replicaDb needs the office DB key (64 hex chars)')

  const db = await openDb(dir, { ...dbOpts, key: officeDbKey })
  if (db.writable) { await db.close(); throw new Error('That is the office database itself, not a replica') }
  fs.writeFileSync(keyFile, officeDbKey.toLowerCase() + '\n')

  const swarm = new Hyperswarm(swarmOptions({ bootstrap }))
  swarm.on('connection', (conn) => { conn.on('error', () => {}); db.store.replicate(conn) })
  const discovery = swarm.join(db.core.discoveryKey, { server: false, client: true })
  keepLookingWhile(swarm, discovery, () => swarm.connections.size === 0)
  db.core.download({ start: 0, end: -1 }) // keep a full local copy so the backup works offline

  const closeDb = db.close
  return {
    ...db,
    swarm,
    writable: false,
    async putPlan () {
      throw new Error('Read-only backup: care plans can only be edited and signed off on the office PC')
    },
    onChange (cb) {
      const fn = () => cb()
      db.core.on('append', fn)
      return () => db.core.off('append', fn)
    },
    // resolves when we've heard from the office (or after timeoutMs, using the local copy)
    async synced (timeoutMs = 10000) {
      const wait = (async () => { await swarm.flush(); await db.core.update({ wait: true }) })()
      await Promise.race([wait, new Promise(resolve => setTimeout(resolve, timeoutMs))])
      return db.core.length
    },
    get peers () { return swarm.connections.size },
    // false = encrypted backup and this device has no (or the wrong) FOBE_DB_PASSPHRASE: it stores
    // and serves the ciphertext but can't show plans. null = nothing downloaded yet.
    async canRead () {
      if (db.core.length === 0 || !(await db.core.has(0))) return null
      const header = await db.bee.getHeader({ wait: false }).catch(() => null)
      return header?.protocol === 'hyperbee'
    },
    blocks () { return db.core.contiguousLength },
    async close () { await swarm.destroy(); await closeDb() }
  }
}

// ---------- helpers ----------

// Hyperswarm only re-queries the DHT every ~10 min. While we have no office connection
// (office not announced yet, restarted, or Wi-Fi was off) look again every few seconds.
function keepLookingWhile (swarm, discovery, cond, ms = 5000) {
  const timer = setInterval(() => {
    if (swarm.destroyed) return clearInterval(timer)
    if (cond()) discovery.refresh({ server: false, client: true }).catch(() => {})
  }, ms)
  timer.unref()
}

async function sameFile (a, b) {
  try {
    const [sa, sb] = await Promise.all([fsp.stat(a), fsp.stat(b)])
    if (!sa.isFile() || sa.size !== sb.size) return false
    const digest = async (f) => {
      const h = createHash('sha256')
      await pipeline(fs.createReadStream(f), h)
      return h.digest('hex')
    }
    return (await digest(a)) === (await digest(b))
  } catch {
    return false
  }
}

function readIfExists (file) {
  try { return fs.readFileSync(file, 'utf-8').trim() || null } catch { return null }
}

function readJson (file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')) } catch { return null }
}

function safeName (n) {
  return String(n).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 120) || 'file'
}

function uniquePath (folder, name) {
  const ext = path.extname(name)
  const base = name.slice(0, name.length - ext.length)
  let p = path.join(folder, name)
  for (let i = 2; fs.existsSync(p); i++) p = path.join(folder, `${base} (${i})${ext}`)
  return p
}
