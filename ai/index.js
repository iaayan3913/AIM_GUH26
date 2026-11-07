// FOBE /ai module: see shared/CONTRACT.md. 100% local inference via QVAC.
import { fileURLToPath } from 'node:url'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, join } from 'node:path'
import { createHash } from 'node:crypto'

const here = (p) => fileURLToPath(new URL(p, import.meta.url))
process.env.QVAC_CONFIG_PATH ??= here('./qvac.config.js')
process.env.QVAC_RPC_INIT_TIMEOUT_MS ??= '180000' // first worker start can be slow on Windows
const q = await import('@qvac/sdk')

const ASR_MODEL = process.env.FOBE_ASR || 'WHISPER_LARGE_V3_TURBO'
const LLM_MODEL = process.env.FOBE_LLM || 'QWEN3_4B_INST_Q4_K_M'
const CACHE_DIR = here('./cache')
const noop = () => {}

// ---------- cache (A4) ----------
export const useCache = () => process.argv.includes('--use-cache') || process.env.FOBE_USE_CACHE === '1'

async function cached (key, fn) {
  const file = join(CACHE_DIR, key + '.json')
  if (useCache() && existsSync(file)) return JSON.parse(await readFile(file, 'utf8'))
  const result = await fn()
  await mkdir(CACHE_DIR, { recursive: true })
  await writeFile(file, JSON.stringify(result, null, 2))
  return result
}

// ---------- models (loaded once, kept warm) ----------
const loaded = {}
function model (name, modelConfig) {
  loaded[name] ??= q.loadModel({ modelSrc: q[name], modelConfig }).catch((e) => { delete loaded[name]; throw e })
  return loaded[name]
}
const asr = () => model(ASR_MODEL, { language: 'auto', translate: false, temperature: 0, contextParams: { use_gpu: true, flash_attn: true } })
const llm = () => model(LLM_MODEL, { ctx_size: 4096, temp: 0, reasoning_budget: 0, device: process.env.FOBE_DEVICE || 'cpu' }) // CPU measured faster than Iris Xe: 9.5 vs 7.7 tok/s

// Call at server start so the first request doesn't pay ~45 s of model loading.
export async function warmup () { await Promise.all([asr(), llm()]) }

// shortcut: separate vision model for OCR (~3 GB extra RAM); could replace Qwen3-4B entirely if A3 quality holds.
const vlm = () => model('QWEN3_5_4B_MULTIMODAL_Q4_K_M', { ctx_size: 4096, reasoning_budget: 0, projectionModelSrc: q.MMPROJ_QWEN3_5_4B_MULTIMODAL_Q8_0 })

async function chat (system, user, schema, kvCache, modelId) {
  const t = Date.now()
  const run = q.completion({
    modelId: modelId ?? await llm(),
    history: [
      ...(system ? [{ role: 'system', content: system + ' /no_think' }] : []),
      typeof user === 'string' ? { role: 'user', content: user } : user
    ],
    stream: true,
    generationParams: { temp: 0, predict: 700, reasoning_budget: 0 },
    ...(kvCache && { kvCache }),
    ...(schema && { responseFormat: { type: 'json_schema', json_schema: { name: 'out', schema } } })
  })
  for await (const _ of run.events); // eslint-disable-line no-unused-vars
  const final = await run.final
  if (process.env.FOBE_DEBUG) console.error('   llm', Date.now() - t, 'ms', JSON.stringify(await run.stats))
  const text = final.contentText.replace(/<think>[\s\S]*?<\/think>/g, '').trim()
  return schema ? JSON.parse(text) : text
}

// ---------- transcribe (A1, A2) ----------
const SCRIPTS = { ur: /[؀-ۿ]/, bn: /[ঀ-৿]/, hi: /[ऀ-ॿ]/ }
const scriptOf = (t) => Object.keys(SCRIPTS).find((k) => SCRIPTS[k].test(t)) || 'en'

export async function transcribe (audioPath, onProgress = noop) {
  return cached('transcript-' + basename(audioPath), async () => {
    onProgress('transcribing', 5)
    const raw = await q.transcribe({ modelId: await asr(), audioChunk: audioPath, metadata: true })
    const segments = []
    for (const [i, s] of raw.entries()) {
      const text = s.text.trim()
      if (!text) continue
      // shortcut: script-based detection; romanised Urdu/Bengali passes through untranslated.
      const english = scriptOf(text) === 'en'
        ? text
        : await chat('Translate the user text (Urdu, Bengali, Hindi or mixed) into plain English. Reply with the translation only.', text)
      segments.push({ start: s.startMs / 1000, end: s.endMs / 1000, text, english })
      onProgress('translating to English', 50 + Math.round((50 * (i + 1)) / raw.length))
    }
    const langs = [...new Set(segments.map((s) => scriptOf(s.text)))]
    return {
      language: langs.join('+') || 'en',
      original: segments.map((s) => s.text).join(' '),
      english: segments.map((s) => s.english).join(' '),
      segments
    }
  })
}

// ---------- draftCarePlan (A3, A7) ----------
const SECTIONS = [
  { name: 'identity', fields: {
    first_name: "child's first name. If the WORKER'S NOTES spell the name differently from the recording, use the notes",
    surname: "child's family name / surname, e.g. the last word of the child's full name (only if written or said)",
    dob: 'date of birth, written as YYYY-MM-DD',
    gender: '"Male" or "Female", only if explicitly stated with a word like boy/girl/male/female; pronouns alone are NOT enough',
    ethnicity: 'only if explicitly stated (e.g. Pakistani, Bangladeshi)',
    photo_consent: '"Yes" or "No" for consent to take PHOTOS of the child. Consent to RECORD the meeting is NOT photo consent',
    emergency_contact: 'relationship, name and phone number, e.g. "Mum (Name) - 07700 900000"'
  } },
  { name: 'health', fields: {
    diagnosis: 'medical diagnosis, only if explicitly stated',
    medication: 'medicines the child takes, or "None" if the SOURCE says no meds / no medication. Empty if medication is never mentioned',
    allergies: 'allergies and reaction, only if explicitly stated'
  } },
  { name: 'about_me', fields: {
    hobbies_interests: 'things the child loves or enjoys doing',
    watch_out: 'things to watch out for: triggers, what happens, what helps'
  } },
  { name: 'attributes', fields: {
    physical_mobility: 'walking, mobility, running off, safety near roads',
    communication_learning: 'how the child communicates and understands, languages understood',
    emotional_social: 'emotional and social needs, how they calm down, play with others',
    toileting_self_care: 'toilet training, help needed with self care',
    dietary: 'diet and food needs (e.g. halal, foods eaten). Do not include allergies'
  } }
]
const HEALTH = { diagnosis: /diagnos|\bdx\b/i, medication: /medic|\bmeds?\b|tablet|inhaler|dose/i, allergies: /allerg/i }
const MUST_MENTION = { photo_consent: /photo|picture/i } // else the model confuses recording consent with photo consent

const SYSTEM = 'You fill in one section of a disabled child\'s care plan from a family visit. Use ONLY facts stated in the SOURCE. ' +
  'Never guess or infer. If a field is not stated, set value and quote to "". ' +
  'quote = 3 to 12 exact words copied from the SOURCE that support the value. Keep values short.'

// source goes in the system prompt so all sections share one prefix (KV-cache reuse)
const withSource = (source) => `${SYSTEM}\n\nSOURCE:\n<<<\n${source}\n>>>`
const kvKey = (source) => 'plan-' + createHash('sha1').update(source).digest('hex').slice(0, 12)

const norm = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
// Is the quote really in the source? 'exact' = most word pairs appear in order,
// 'close' = most single words appear (small models paraphrase slightly), else 'none' (likely invented).
export function quoteMatch (quote, source) {
  const q = norm(quote ?? '').split(' ').filter(Boolean)
  if (!q.length) return 'none'
  const src = ' ' + norm(source) + ' '
  const frac = (grams) => grams.filter((g) => src.includes(' ' + g + ' ')).length / grams.length
  const pairs = q.slice(1).map((w, i) => q[i] + ' ' + w)
  if (frac(pairs.length ? pairs : q) >= 0.6) return 'exact'
  return frac(q) >= 0.6 ? 'close' : 'none'
}

const MISSING = () => ({ value: null, source: null, status: 'missing' })

function leaf (key, value, quote, source) {
  const v = String(value ?? '').trim()
  if (!v || /^(not (stated|mentioned|specified|known)|unknown|n\/?a|none stated|-)$/i.test(v)) return MISSING()
  const match = quoteMatch(quote, source)
  if (match === 'none') return MISSING() // never invent: no supporting quote = not stated
  if (MUST_MENTION[key] && !MUST_MENTION[key].test(quote)) return MISSING()
  if (key in HEALTH) {
    // medication/allergies/diagnosis: filled only when the quote states it explicitly
    return { value: v, source: quote, status: match === 'exact' && HEALTH[key].test(quote) ? 'filled' : 'needs_review' }
  }
  const okDate = key !== 'dob' || (/^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(v)))
  return { value: v, source: quote, status: match === 'exact' && okDate ? 'filled' : 'needs_review' }
}

async function section ({ fields }, source) {
  const props = Object.fromEntries(Object.keys(fields).map((k) => [k, {
    type: 'object', properties: { value: { type: 'string' }, quote: { type: 'string' } }, required: ['value', 'quote'], additionalProperties: false
  }]))
  const list = Object.entries(fields).map(([k, d]) => `- ${k}: ${d}`).join('\n')
  const out = await chat(withSource(source), `Fields:\n${list}\n\nReply as JSON.`,
    { type: 'object', properties: props, required: Object.keys(fields), additionalProperties: false }, kvKey(source))
  return Object.fromEntries(Object.keys(fields).map((k) => [k, leaf(k, out[k]?.value, out[k]?.quote, source)]))
}

async function listSection (source, itemDesc, itemProps) {
  const schema = {
    type: 'object',
    properties: { items: { type: 'array', maxItems: 6, items: {
      type: 'object', properties: { ...Object.fromEntries(itemProps.map((p) => [p, { type: 'string' }])), quote: { type: 'string' } },
      required: [...itemProps, 'quote'], additionalProperties: false
    } } },
    required: ['items'], additionalProperties: false
  }
  const out = await chat(withSource(source), `List ${itemDesc}. Fields per item: ${itemProps.join(', ')}, quote. ` +
    'Use an empty list if none are stated. Reply as JSON.', schema, kvKey(source))
  const seen = new Set()
  const items = (out.items || []).filter((it) => {
    const k = norm(it[itemProps[0]] ?? '')
    if (!k || seen.has(k) || quoteMatch(it.quote, source) === 'none') return false
    return seen.add(k)
  })
  if (!items.length) return MISSING()
  const verified = items.every((it) => quoteMatch(it.quote, source) === 'exact')
  return {
    value: items.map(({ quote, ...rest }) => rest),
    source: items.map((it) => `"${it.quote}"`).join('; '),
    status: verified ? 'filled' : 'needs_review'
  }
}

export async function draftCarePlan ({ childId, transcript, notes, existingPlan } = {}, onProgress = noop) {
  const said = typeof transcript === 'string' ? transcript : transcript?.english
  const source = [said && `RECORDING (translated to English):\n${said}`, notes && `WORKER'S NOTES:\n${notes}`].filter(Boolean).join('\n\n')
  const key = 'plan-' + childId + '-' + createHash('sha1').update(source + JSON.stringify(existingPlan ?? null)).digest('hex').slice(0, 8)
  return cached(key, async () => {
    const draft = await buildPlan(childId, source, onProgress)
    return existingPlan ? mergePlans(existingPlan, draft) : draft
  })
}

async function buildPlan (childId, source, onProgress) {
  const today = new Date().toISOString().slice(0, 10)
  if (!source.trim()) throw new Error('draftCarePlan: need a transcript or notes')
  const steps = SECTIONS.length + 2
  const parts = {}
  for (const [i, s] of SECTIONS.entries()) {
    onProgress('drafting ' + s.name, Math.round((100 * i) / steps))
    parts[s.name] = await section(s, source)
  }
  onProgress('drafting words_phrases', Math.round((100 * SECTIONS.length) / steps))
  const words = await listSection(source, 'words or sounds the CHILD himself/herself says (or signs the child makes) that have a special meaning, and what each means. Not words said by adults', ['word_or_sign', 'meaning'])
  onProgress('drafting challenging_behaviours', Math.round((100 * (SECTIONS.length + 1)) / steps))
  const behaviours = await listSection(source, 'challenging behaviours, what triggers them and what calms them (control measures)', ['behaviour', 'triggers', 'control_measures'])
  onProgress('done', 100)
  const { identity: id, health: h } = parts
  return {
    child_id: childId,
    last_updated: { value: today, source: 'AI draft from visit', status: 'filled' },
    first_name: id.first_name,
    surname: id.surname,
    dob: id.dob,
    gender: id.gender,
    ethnicity: id.ethnicity,
    photo_consent: id.photo_consent,
    photo_path: null,
    diagnosis: h.diagnosis,
    medication: h.medication,
    allergies: h.allergies,
    emergency_contact: id.emergency_contact,
    about_me: parts.about_me,
    attributes: { ...parts.attributes, words_phrases: words },
    challenging_behaviours: behaviours,
    approved_by: null,
    approved_at: null
  }
}

// A7: keep every existing field unless the new draft actually found something for it.
const isLeaf = (o) => o && typeof o === 'object' && 'status' in o && 'value' in o
export function mergePlans (oldPlan, draft) {
  const walk = (a, b) => {
    if (isLeaf(b) || isLeaf(a)) return isLeaf(b) && b.status !== 'missing' ? b : (a ?? b)
    if (b && typeof b === 'object' && !Array.isArray(b)) {
      return Object.fromEntries([...new Set([...Object.keys(a || {}), ...Object.keys(b)])].map((k) => [k, walk(a?.[k], b[k])]))
    }
    return b ?? a
  }
  return { ...walk(oldPlan, draft), child_id: oldPlan.child_id ?? draft.child_id, photo_path: oldPlan.photo_path ?? null, approved_by: null, approved_at: null }
}

// ---------- lanyardText (A5) ----------
export function lanyardText (plan, optIns = []) {
  const val = (f) => (f && f.status !== 'missing' && f.value) || ''
  const first = (s) => String(s).split(/[.;(]/)[0].trim()
  const parts = [
    [val(plan.first_name), optIns.includes('surname') && val(plan.surname)].filter(Boolean).join(' '),
    optIns.includes('dob') && val(plan.dob) && 'DOB ' + val(plan.dob),
    optIns.includes('diagnosis') && val(plan.diagnosis) && first(val(plan.diagnosis)),
    optIns.includes('ethnicity') && val(plan.ethnicity),
    val(plan.allergies) && !/^none/i.test(val(plan.allergies)) && 'ALLERGY: ' + first(val(plan.allergies)),
    val(plan.emergency_contact) && 'Call ' + val(plan.emergency_contact),
    val(plan.attributes?.communication_learning) && first(val(plan.attributes.communication_learning))
  ].filter(Boolean)
  // drop lowest-priority parts until it fits, then hard-trim as a last resort
  while (parts.length > 1 && parts.join('. ').length > 130) parts.pop()
  return parts.join('. ').slice(0, 130)
}

// ---------- ocrNotes (A6) ----------
export async function ocrNotes (imagePath, onProgress = noop) {
  return cached('ocr-' + basename(imagePath), async () => {
    onProgress('loading vision model', 10)
    const modelId = await vlm()
    onProgress('reading notes', 40)
    const text = await chat(null, {
      role: 'user',
      content: 'Transcribe the handwritten notes in this image exactly, line by line, keeping capitals and numbers. Output only the text. /no_think',
      attachments: [{ path: imagePath }]
    }, null, null, modelId)
    onProgress('done', 100)
    return { text }
  })
}

export async function close () { await q.close?.() }
