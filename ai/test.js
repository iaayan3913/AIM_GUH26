// node test.js transcribe <audio>               [--use-cache]
// node test.js plan <audio|transcript.json|.txt> [notes.txt|notes.jpg] [--use-cache]
// node test.js ocr <image>                       [--use-cache]
// node test.js lanyard <plan.json> [optIn,...]
import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import * as ai from './index.js'

const [cmd, a, b] = process.argv.slice(2).filter((x) => !x.startsWith('--'))
const progress = (stage, pct) => process.stderr.write(`  [${pct}%] ${stage}\n`)
const isAudio = (f) => /\.(wav|mp3|m4a|ogg|flac)$/i.test(f)
const isImage = (f) => /\.(jpe?g|png|webp)$/i.test(f)
const timed = async (label, p) => { const t = Date.now(); const r = await p; console.error(`⏱  ${label}: ${((Date.now() - t) / 1000).toFixed(1)} s`); return r }

function summary (plan) {
  const rows = []
  const walk = (o, path) => {
    for (const [k, v] of Object.entries(o)) {
      if (v && typeof v === 'object' && 'status' in v) rows.push([path + k, v.status, JSON.stringify(v.value), v.source])
      else if (v && typeof v === 'object' && !Array.isArray(v)) walk(v, path + k + '.')
    }
  }
  walk(plan, '')
  for (const [k, s, v, src] of rows) console.log(`${s.padEnd(12)} ${k.padEnd(34)} ${v}\n${' '.repeat(13)}↳ ${src}`)
}

if (cmd === 'transcribe') {
  const r = await timed('transcribe', ai.transcribe(a, progress))
  for (const s of r.segments) console.log(`[${s.start.toFixed(1)}–${s.end.toFixed(1)}] ${s.text}${s.english !== s.text ? `\n          → ${s.english}` : ''}`)
  console.log('\nlanguage:', r.language)
} else if (cmd === 'plan') {
  const transcript = isAudio(a) ? await timed('transcribe', ai.transcribe(a, progress))
    : a.endsWith('.json') ? JSON.parse(await readFile(a, 'utf8')) : await readFile(a, 'utf8')
  const notes = !b ? undefined : isImage(b) ? (await ai.ocrNotes(b, progress)).text : await readFile(b, 'utf8')
  const plan = await timed('draftCarePlan', ai.draftCarePlan({ childId: 'FOBE-CHILD-DEMO', transcript, notes }, progress))
  summary(plan)
  // safety self-check: the recording alone never mentions medication
  if (!notes) assert.equal(plan.medication.status, 'missing', 'medication must be missing without notes')
  console.log('\n' + JSON.stringify(plan))
} else if (cmd === 'ocr') {
  console.log((await timed('ocr', ai.ocrNotes(a, progress))).text)
} else if (cmd === 'lanyard') {
  const t = ai.lanyardText(JSON.parse(await readFile(a, 'utf8')), b ? b.split(',') : [])
  assert.ok(t.length <= 130)
  console.log(t, `(${t.length} chars)`)
} else if (cmd === 'selftest') { // no models needed
  const src = "He's allergic to eggs, he gets a rash. Fourteenth of March, 2017."
  assert.equal(ai.quoteMatch("allergic to eggs", src), 'exact')
  assert.equal(ai.quoteMatch('March 14, 2017', src), 'close')
  assert.equal(ai.quoteMatch('Mum Aisha 07700 900106', src), 'none')
  assert.equal(ai.quoteMatch('', src), 'none')
  // health facts from machine-translated speech always need a human check; written notes don't
  assert.equal(ai.leaf('allergies', 'Eggs', "allergic to eggs", src, '').status, 'needs_review')
  assert.equal(ai.leaf('allergies', 'Eggs', "allergic to eggs", src).status, 'filled')
  assert.equal(ai.leaf('medication', 'Calpol', 'takes Calpol daily', src).status, 'missing')
  assert.equal(ai.leaf('medication', 'None', "allergic to eggs", src).status, 'missing') // quote isn't about medicine
  assert.equal(ai.leaf('gender', 'Male', 'allergic to eggs', src, src, '"Male" or "Female", only if stated').status, 'filled')
  assert.equal(ai.leaf('physical_mobility', 'walking, mobility, running off', "allergic to eggs", src, src, 'walking, mobility, running off').status, 'missing')
  const plan = JSON.parse(await readFile(new URL('../shared/careplan.example.json', import.meta.url), 'utf8'))
  const lt = ai.lanyardText(plan)
  assert.ok(lt.length <= 130 && !/Qureshi|Autism|Pakistani|2015/.test(lt), lt)
  assert.ok(/Qureshi/.test(ai.lanyardText(plan, ['surname'])))
  assert.ok(ai.lanyardText(plan, ['surname', 'dob', 'diagnosis', 'ethnicity']).includes('07700 900101'), 'contact must survive trimming')
  const merged = ai.mergePlans(plan, { ...plan, medication: { value: 'None', source: 'x', status: 'filled' }, dob: { value: null, source: null, status: 'missing' } })
  assert.equal(merged.medication.value, 'None')
  assert.equal(merged.dob.value, '2015-06-02')
  console.log('selftest ok |', lt)
} else {
  console.log('usage: node test.js transcribe|plan|ocr|lanyard|selftest <file> [file] [--use-cache]')
}
process.exit(0)
