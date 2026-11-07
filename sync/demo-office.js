// OFFICE PC demo: owns the care-plan DB, shows the pairing key, receives files into data/inbox/.
// Usage: node demo-office.js [--dir data/office-pc] [--bootstrap host:port]
// Commands: list | edit <child_id> <field> <value...> | files | key | quit
import readline from 'node:readline'
import fs from 'node:fs'
import { openDb, startPeer, onFileReceived, INBOX_DIR, ageFromDob, reviewDue } from './index.js'

const args = parseArgs(process.argv.slice(2))
const dir = args.dir || './data/office-pc'
const db = await openDb(dir)
if (!db.writable) throw new Error(`${dir} is a read-only replica, not the office DB`)
const plans = await db.listPlans()
if (!plans.length) console.log(`(no care plans in ${dir} yet: run "npm run seed" first)`)

const peer = await startPeer({ db, role: 'office', bootstrap: args.bootstrap })
console.log('\n=== FOBE OFFICE PC ===')
console.log(`Care plans: ${plans.length} in ${dir}`)
console.log(`Inbox:      ${INBOX_DIR}`)
console.log(`DHT:        ${args.bootstrap || process.env.FOBE_BOOTSTRAP || 'public Holepunch DHT'}`)
console.log('\n  PAIRING KEY:  ' + peer.pairingKey + '\n')
console.log('On the work phone run:  node demo-phone.js ' + peer.pairingKey + ' --backup')
console.log('Waiting for the phone... (type "help")\n')

peer.onPeer(p => console.log(`>> peer connected: ${p.name}`))
peer.onPeerLeft(p => console.log(`>> peer disconnected: ${p.name}`))
peer._events.on('error', err => console.log('!! ' + err.message))
onFileReceived(f => console.log(`>> received ${f.name} (${kb(f.size)}) from ${f.from}\n   saved to ${f.path}`))

const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
rl.on('line', async (line) => {
  const [cmd, ...rest] = line.trim().split(/\s+/)
  try {
    if (!cmd) return
    if (cmd === 'list') {
      for (const p of await db.listPlans()) {
        console.log(`  ${p.child_id}  ${p.first_name.value} ${p.surname.value}, age ${ageFromDob(p.dob.value)}, review due ${reviewDue(p.last_updated.value)}, saved ${p.saved_at}`)
      }
    } else if (cmd === 'edit') {
      const [childId, field, ...words] = rest
      const p = await db.getPlan(childId)
      if (!p || !field || !words.length) return console.log('usage: edit FOBE-CHILD-0002 allergies Peanuts   (or attributes.dietary ...)')
      setPath(p, field, { value: words.join(' '), source: 'Edited on office PC (demo)', status: 'filled' })
      const saved = await db.putPlan(p)
      console.log(`  saved ${childId} ${field} = "${words.join(' ')}" at ${saved.saved_at}`)
    } else if (cmd === 'files') {
      for (const f of fs.readdirSync(INBOX_DIR).filter(f => !f.startsWith('.'))) console.log('  ' + f)
    } else if (cmd === 'key') {
      console.log(`  pairing key: ${peer.pairingKey}\n  db key:      ${db.key}\n  phones connected: ${peer.connected}`)
    } else if (cmd === 'quit' || cmd === 'exit') {
      await shutdown()
    } else {
      console.log('  commands: list | edit <child_id> <field> <value...> | files | key | quit')
    }
  } catch (err) { console.log('!! ' + err.message) }
})

process.on('SIGINT', shutdown)
async function shutdown () {
  rl.close()
  await peer.close()
  await db.close()
  process.exit(0)
}

function setPath (obj, dotted, val) {
  const parts = dotted.split('.')
  let o = obj
  for (const k of parts.slice(0, -1)) o = o[k] = o[k] || {}
  o[parts.at(-1)] = val
}
function kb (n) { return n > 1e6 ? (n / 1e6).toFixed(1) + ' MB' : Math.ceil(n / 1024) + ' KB' }
function parseArgs (a) {
  const out = { _: [] }
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith('--')) { const k = a[i].slice(2); out[k] = (a[i + 1] && !a[i + 1].startsWith('--')) ? a[++i] : true } else out._.push(a[i])
  }
  return out
}
