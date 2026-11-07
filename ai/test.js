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
} else {
  console.log('usage: node test.js transcribe|plan|ocr|lanyard <file> [file] [--use-cache]')
}
process.exit(0)
