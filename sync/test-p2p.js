// End-to-end P2P test on ONE machine with a private local DHT (no internet needed).
// Covers B1 pairing, B2 file transfer (incl. queued-while-offline), B3 read-only live replica.
import { rm, mkdir, writeFile, readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import createTestnet from 'hyperdht/testnet.js'
import { openDb, compactToPlan, startPeer, sendFile, onFileReceived, replicaDb } from './index.js'

const root = './data/_p2p'
await rm(root, { recursive: true, force: true })
await mkdir(root, { recursive: true })
const testnet = await createTestnet(3)
const bootstrap = testnet.bootstrap
const step = (s) => console.log('  ok ' + s)
const timeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout: ' + what)), ms))])

// office with seed data
const seed = JSON.parse(await readFile(new URL('../shared/seed/children.json', import.meta.url), 'utf-8'))
const db = await openDb(path.join(root, 'office-pc'))
for (const ch of seed.children) await db.putPlan(compactToPlan(ch))
const office = await startPeer({ db, role: 'office', dir: path.join(root, 'office-peer'), inboxDir: path.join(root, 'inbox'), bootstrap })
assert.match(office.pairingKey, /^[a-z0-9]{4}(-[a-z0-9]{4}){3}$/)

// phone queues a file BEFORE it is connected
const wav = path.join(root, 'demo-visit.wav')
const jpg = path.join(root, 'notes-photo.jpg')
await writeFile(wav, randomBytes(3 * 1024 * 1024))
await writeFile(jpg, randomBytes(200 * 1024))
const got = []
onFileReceived(f => got.push(f))

const phone = await startPeer({ role: 'phone', pairingKey: office.pairingKey.toUpperCase(), dir: path.join(root, 'phone'), bootstrap })
const connected = Promise.all([new Promise(r => office.onPeer(r)), new Promise(r => phone.onPeer(r))])
const queued = sendFile(phone, wav)
await timeout(connected, 20000, 'pairing')
step('B1 pairing: both sides connected and verified the pairing key')

await timeout(queued, 20000, 'queued wav')
await timeout(sendFile(phone, jpg), 20000, 'jpg')
assert.equal(got.length, 2)
assert.deepEqual(await readFile(got[0].path), await readFile(wav))
assert.deepEqual(await readFile(got[1].path), await readFile(jpg))
step(`B2 files: ${got.map(f => f.name).join(', ')} saved in inbox (from "${got[0].from}")`)

// replica
assert.equal(phone.officeDbKey, db.key)
const backup = await replicaDb(path.join(root, 'backup'), phone.officeDbKey, { bootstrap })
await backup.synced()
const waitPlans = async (n) => { while ((await backup.listPlans()).length < n) await new Promise(r => setTimeout(r, 100)) }
await timeout(waitPlans(5), 20000, 'replica sync')
step('B3 replica has all 5 plans')

const changed = new Promise(r => backup.onChange(r))
const p = await db.getPlan('FOBE-CHILD-0002')
p.allergies = { value: 'Peanuts', source: 'Dad, phone call', status: 'filled' }
await db.putPlan(p)
await timeout(changed, 20000, 'live update')
const waitVal = async () => { while ((await backup.getPlan('FOBE-CHILD-0002')).allergies.value !== 'Peanuts') await new Promise(r => setTimeout(r, 100)) }
await timeout(waitVal(), 20000, 'live value')
assert.equal((await backup.history('FOBE-CHILD-0002')).length, 2)
step('B3 office edit appeared live on the replica (with history)')

await assert.rejects(backup.putPlan(p), /Read-only/)
await assert.rejects(backup.bee.put('x', 'y'))
step('B3 writes to the replica are refused')

if (process.env.FOBE_DB_PASSPHRASE) {
  // blind backup: a device WITHOUT the passphrase still replicates and stores the ciphertext
  const blind = await replicaDb(path.join(root, 'blind'), db.key, { bootstrap, encryptionKey: null })
  await blind.synced()
  while (blind.blocks() < db.core.length) await new Promise(r => setTimeout(r, 100))
  assert.equal(await blind.canRead(), false)
  await blind.close()
  await backup.close(); await phone.close(); await office.close(); await db.close()
  const { readdir } = await import('node:fs/promises')
  for (const sub of ['office-pc', 'backup', 'blind', 'phone']) {
    for (const f of await readdir(path.join(root, sub), { recursive: true, withFileTypes: true })) {
      if (!f.isFile()) continue
      const buf = await readFile(path.join(f.parentPath, f.name))
      for (const word of ['Maryam', 'FOBE-CHILD', 'Epilepsy', 'plan/', 'demo-visit']) assert.ok(!buf.includes(word), `plaintext "${word}" in ${sub}/${f.name}`)
    }
  }
  step('B5 no plaintext in office DB, backup, blind backup or phone outbox; blind backup holds ciphertext only')
} else {
  await backup.close(); await phone.close(); await office.close(); await db.close()
}
await testnet.destroy()
await rm(root, { recursive: true, force: true })
console.log('p2p test passed: pairing, file transfer, read-only live replica' + (process.env.FOBE_DB_PASSPHRASE ? ', encryption at rest' : ''))
process.exit(0)
