// Work phone -> office PC over Holepunch (../sync). Starts the office peer and lists the inbox.
import fs from 'node:fs'
import path from 'node:path'

const KIND = {
  audio: ['.wav', '.mp3', '.m4a', '.ogg', '.webm', '.aac', '.flac', '.opus'],
  photo: ['.jpg', '.jpeg', '.png', '.heic', '.webp'],
  text: ['.txt', '.md']
}
const kindOf = (name) => Object.keys(KIND).find((k) => KIND[k].includes(path.extname(name).toLowerCase())) || 'other'

export async function mountInbox (app, { sync, db, gate, wrap, dataDir }) {
  const state = { p2p: false, pairingKey: null, peers: new Map(), error: null }
  const from = new Map() // file name -> sender name
  const usedFile = path.join(dataDir, 'inbox-used.json')
  const used = (() => { try { return JSON.parse(fs.readFileSync(usedFile, 'utf8')) } catch { return {} } })()
  const inboxDir = process.env.FOBE_INBOX_DIR || sync.INBOX_DIR || null
  let peer = null

  if (process.env.FOBE_P2P === '0') state.error = 'Peer-to-peer is switched off (FOBE_P2P=0)'
  else if (typeof sync.startPeer !== 'function') state.error = 'Peer-to-peer is not available (run npm install in /sync)'
  else {
    try {
      peer = await sync.startPeer({ db, role: 'office', inboxDir })
      state.p2p = true
      state.pairingKey = peer.pairingKey
      peer.onPeer((p) => { state.peers.set(p.name, { name: p.name, since: new Date().toISOString() }); console.log(`[p2p] connected: ${p.name}`) })
      peer.onPeerLeft?.((p) => { state.peers.delete(p.name); console.log(`[p2p] left: ${p.name}`) })
      sync.onFileReceived((f) => { from.set(f.name, f.from); console.log(`[p2p] received ${f.name} from ${f.from}`) })
      console.log(`[p2p] office peer started. Pairing key: ${peer.pairingKey}`)
    } catch (e) {
      state.error = e.message
      console.warn('[p2p] could not start:', e.message)
    }
  }

  function listFiles () {
    if (!inboxDir || !fs.existsSync(inboxDir)) return []
    return fs.readdirSync(inboxDir)
      .filter((n) => !n.startsWith('.') && !n.endsWith('.part'))
      .map((name) => {
        const st = fs.statSync(path.join(inboxDir, name))
        return { name, kind: kindOf(name), size: st.size, receivedAt: st.mtime.toISOString(), from: from.get(name) || 'Work phone', usedFor: used[name] || null }
      })
      .filter((f) => f.kind !== 'other')
      .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
  }

  app.get('/api/inbox', gate, (req, res) => {
    res.json({
      p2p: state.p2p,
      error: state.error,
      pairingKey: state.pairingKey,
      peers: [...state.peers.values()],
      files: listFiles()
    })
  })

  // Typed notes sent from the phone (.txt): read them into the visit form.
  app.get('/api/inbox/text/:name', gate, (req, res) => {
    const full = resolve(req.params.name)
    if (!full || kindOf(full) !== 'text') return res.status(404).json({ error: 'No such note' })
    res.json({ text: fs.readFileSync(full, 'utf8').slice(0, 20000) })
  })

  app.post('/api/inbox/used', gate, (req, res) => {
    for (const name of [].concat(req.body?.names || [])) used[path.basename(name)] = req.body.childId || true
    fs.writeFileSync(usedFile, JSON.stringify(used, null, 2))
    res.json({ ok: true })
  })

  function resolve (name) {
    if (!inboxDir || !name) return null
    const full = path.join(inboxDir, path.basename(String(name)))
    return fs.existsSync(full) ? full : null
  }

  return { inboxDir, resolve, close: async () => { await peer?.close().catch(() => {}) } }
}
