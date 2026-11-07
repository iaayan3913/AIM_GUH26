// Fills the local database with the fake demo children.
// Usage: node seed.js [storageDir]   (default ./data/office-pc)
import { readFile } from 'node:fs/promises'
import { openDb, compactToPlan, ageFromDob, reviewDue } from './db.js'

const dir = process.argv[2] || './data/office-pc'
const seed = JSON.parse(await readFile(new URL('../shared/seed/children.json', import.meta.url), 'utf-8'))

const db = await openDb(dir)
if (!db.writable) throw new Error('This database is a read-only replica, seed the office PC instead')

for (const c of seed.children) {
  await db.putPlan(compactToPlan(c))
  console.log(`seeded ${c.child_id} ${c.first_name} (age ${ageFromDob(c.dob)}, review due ${reviewDue(c.last_updated)})`)
}
console.log(`\n${seed.children.length} care plans in ${dir}`)
console.log(`Database key (share with read-only peers): ${db.key}`)
await db.close()
