// WORK PHONE demo: pairs with the office, sends recordings / note photos, keeps a read-only backup.
// Usage: node demo-phone.js <PAIRING-KEY> [file ...] [--backup] [--dir data/phone] [--bootstrap host:port]
//   (the pairing key is remembered, so later runs can omit it)
// Commands: type or drag-drop a file path to send it | plans | write | quit
import readline from 'node:readline'
import path from 'node:path'
import { startPeer, sendFile, replicaDb } from './index.js'

const args = parseArgs(process.argv.slice(2))
const dir = args.dir || './data/phone'
const pairingKey = args._.find(a => /^[a-z0-9]{4}-?[a-z0-9]{4}-?[a-z0-9]{4}-?[a-z0-9]{4}$/i.test(a)) || null
const filesToSend = args._.filter(a => a !== pairingKey)

const peer = await startPeer({ role: 'phone', pairingKey, dir, bootstrap: args.bootstrap })
console.log('\n=== FOBE WORK PHONE ===')
console.log(`Pairing key: ${peer.pairingKey}`)
console.log(`DHT:         ${args.bootstrap || process.env.FOBE_BOOTSTRAP || 'public Holepunch DHT'}`)
console.log('Looking for the office PC... (type "help")\n')

peer.onPeer(p => console.log(`>> peer connected: ${p.name}`))
peer.onPeerLeft(p => console.log(`>> peer disconnected: ${p.name} (new files will queue)`))

for (const f of filesToSend) send(f)

let backup = null
if (args.backup) {
  if (peer.officeDbKey) openBackup(peer.officeDbKey)
  else peer._events.once('office-db-key', openBackup)
}

async function send (file) {
  file = file.replace(/^&\s*/, '').replace(/^["']|["']$/g, '') // PowerShell drag-drop adds quotes / "& "
  try {
    const done = sendFile(peer, file, {
      onQueued: q => console.log(`   ${q.name} ${q.officeOnline ? 'sending...' : 'queued: office offline, will send when connected'}`)
    })
    const r = await done
    console.log(`>> delivered ${path.basename(file)} -> office inbox as ${r.name}`)
  } catch (err) { console.log('!! ' + err.message) }
}

async function openBackup (key) {
  if (backup) return
  backup = await replicaDb(path.join(dir, 'backup'), key, { bootstrap: args.bootstrap })
  console.log(`>> read-only backup of office care plans at ${path.join(dir, 'backup')}`)
  const seen = new Map()
  const show = async (initial) => {
    for (const p of await backup.listPlans()) {
      const prev = seen.get(p.child_id)
      if (initial || !prev) console.log(`   ${p.child_id}  ${p.first_name.value} ${p.surname.value} (saved ${p.saved_at})`)
      else if (prev.saved_at !== p.saved_at) {
        const changed = Object.keys(p).filter(k => k !== 'saved_at' && JSON.stringify(p[k]) !== JSON.stringify(prev[k]))
        console.log(`>> backup updated live: ${p.first_name.value} ${p.surname.value} changed ${changed.join(', ') || '(no field change)'}`)
        for (const k of changed) if (p[k]?.value !== undefined) console.log(`     ${k}: ${JSON.stringify(prev[k]?.value)} -> ${JSON.stringify(p[k].value)}`)
      }
      seen.set(p.child_id, p)
    }
  }
  const local = (await backup.listPlans()).length
  if (local) { console.log(`   (local copy has ${local} plans, works offline)`); await show(true) }
  await backup.synced()
  if (!local) await show(true)
  let t = null
  backup.onChange(() => { clearTimeout(t); t = setTimeout(() => show(false).catch(() => {}), 300) })
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
rl.on('line', async (line) => {
  const cmd = line.trim()
  try {
    if (!cmd) return
    if (cmd === 'plans') {
      if (!backup) return console.log('  no backup yet (start with --backup)')
      for (const p of await backup.listPlans()) console.log(`  ${p.child_id}  ${p.first_name.value} ${p.surname.value}  allergies: ${p.allergies.value}  (saved ${p.saved_at})`)
    } else if (cmd === 'write') {
      if (!backup) return console.log('  no backup yet (start with --backup)')
      const [p] = await backup.listPlans()
      await backup.putPlan({ ...p, allergies: { value: 'HACKED', source: null, status: 'filled' } })
    } else if (cmd === 'quit' || cmd === 'exit') {
      await shutdown()
    } else if (cmd === 'help') {
      console.log('  type/drag a file path to send it | plans | write (shows writes are refused) | quit')
    } else {
      send(cmd)
    }
  } catch (err) { console.log('!! refused: ' + err.message) }
})

process.on('SIGINT', shutdown)
async function shutdown () {
  rl.close()
  if (backup) await backup.close()
  await peer.close()
  process.exit(0)
}

function parseArgs (a) {
  const out = { _: [] }
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--backup') out.backup = true
    else if (a[i].startsWith('--')) out[a[i].slice(2)] = a[++i]
    else out._.push(a[i])
  }
  return out
}
