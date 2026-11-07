// Smoke test: seed a temp db, edit one plan, check history, list.
import { rm } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { openDb, compactToPlan } from './db.js'
import { readFile } from 'node:fs/promises'

const dir = './data/_test'
await rm(dir, { recursive: true, force: true })
const seed = JSON.parse(await readFile(new URL('../shared/seed/children.json', import.meta.url), 'utf-8'))

const db = await openDb(dir)
for (const c of seed.children) await db.putPlan(compactToPlan(c))

const all = await db.listPlans()
assert.equal(all.length, seed.children.length)

const p = await db.getPlan('FOBE-CHILD-0001')
p.allergies = { value: 'Kiwi', source: 'Mum, review meeting', status: 'filled' }
await new Promise(r => setTimeout(r, 5))
await db.putPlan(p)

const hist = await db.history('FOBE-CHILD-0001')
assert.equal(hist.length, 2)
assert.equal(hist[0].allergies.value, 'None known')
assert.equal((await db.getPlan('FOBE-CHILD-0001')).allergies.value, 'Kiwi')

await db.close()
await rm(dir, { recursive: true, force: true })
console.log('db test passed: list, get, edit, history all OK')
