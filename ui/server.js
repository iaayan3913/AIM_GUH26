// FOBE Care Plan UI server. Local only: binds to localhost, no CDNs, no cloud.
import express from 'express'
import session from 'express-session'
import multer from 'multer'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadAi } from './ai-loader.js'
import { mountAuth } from './auth.js'
import { mountInbox } from './inbox.js'

// Real sync module (DB + P2P). Falls back to the plain DB if the P2P deps aren't installed.
let sync
try {
  sync = await import('../sync/index.js')
} catch (e) {
  console.warn(`[sync] P2P unavailable (${e.message}); using ../sync/db.js only. Fix: cd sync && npm install`)
  sync = await import('../sync/db.js')
}
const { openDb, ageFromDob, reviewDue } = sync

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT) || 3000
const DB_DIR = process.env.FOBE_DB_DIR || path.join(HERE, '../sync/data/office-pc')
const DATA = process.env.FOBE_DATA_DIR || path.join(HERE, 'data') // gitignored: uploads, YubiKey credentials
const UPLOADS = path.join(DATA, 'uploads')
fs.mkdirSync(UPLOADS, { recursive: true })

if (!fs.existsSync(DB_DIR)) {
  console.error(`No database at ${DB_DIR}. Run: cd sync && npm install && npm run seed`)
  process.exit(1)
}
// Only ONE process may open the office db (sync/data/office-pc). We open it once here and
// start the office peer on the same db (inbox.js), so never run sync/demo-office.js alongside.
let db
try {
  db = await openDb(DB_DIR) // picks up FOBE_DB_PASSPHRASE itself
} catch (e) {
  if (/lock/i.test(`${e.code} ${e.message}`)) {
    console.error(`The care plan database is already open in another process.\nStop sync/demo-office.js (or another "npm start") and try again.\n(${e.message})`)
  } else {
    console.error(`Could not open the care plan database: ${e.message}`)
  }
  process.exit(1)
}
const { ai, name: aiName } = await loadAi()
console.log(`[db] ${DB_DIR} (writable: ${db.writable})`)
console.log(`[ai] using ${aiName}`)
// Load the QVAC models in the background now, so the first draft in the demo isn't slow.
if (aiName !== 'mock' && typeof ai.warmup === 'function') {
  const t = Date.now()
  ai.warmup().then(() => console.log(`[ai] models ready (${Math.round((Date.now() - t) / 1000)} s)`))
    .catch((e) => console.warn('[ai] warmup failed (models will load on first use):', e.message))
}

const app = express()
app.disable('x-powered-by')
app.use(express.json({ limit: '5mb' }))
app.use(session({
  secret: crypto.randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'strict', maxAge: 8 * 60 * 60 * 1000 }
}))

// Static files + locally bundled libraries (no CDNs).
const noCache = { setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache') } // always revalidate (cheap on localhost)
app.use(express.static(path.join(HERE, 'public'), noCache))
// FOBE logo from ui/private/ (gitignored, never pushed). The page falls back to a text logo if absent.
// Also accepts "FOBE logo.png" in the repo root (gitignored too). Type is sniffed: that file is really a WebP.
app.get('/brand/logo', (req, res) => {
  const dir = path.join(HERE, 'private')
  const file = [...['fobe-logo.png', 'fobe-logo.webp', 'fobe-logo.jpeg', 'fobe-logo.jpg'].map((f) => path.join(dir, f)), path.join(HERE, '..', 'FOBE logo.png')]
    .find((f) => fs.existsSync(f))
  if (!file) return res.status(404).end()
  const head = fs.readFileSync(file).subarray(0, 12)
  const type = head.toString('latin1', 8, 12) === 'WEBP' ? 'image/webp' : head[0] === 0xff ? 'image/jpeg' : 'image/png'
  res.setHeader('Cache-Control', 'no-cache')
  res.type(type).sendFile(file)
})
app.use('/vendor/simplewebauthn', express.static(path.join(HERE, 'node_modules/@simplewebauthn/browser/esm'), noCache))

// ---------- helpers ----------
const today = () => new Date().toISOString().slice(0, 10)
const val = (f) => (f && typeof f === 'object' && 'value' in f ? f.value : f)

function reviewInfo (plan) {
  const last = val(plan.last_updated)
  if (!last) return { review_due: null, review_status: 'unknown', review_days: null }
  const due = reviewDue(last)
  const days = Math.round((new Date(due) - new Date(today())) / 86400000)
  return { review_due: due, review_days: days, review_status: days < 0 ? 'overdue' : days <= 30 ? 'soon' : 'ok' }
}

function countFlags (node, acc = { missing: 0, needs_review: 0 }) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return acc
  if ('status' in node && 'value' in node) {
    if (node.status in acc) acc[node.status]++
    return acc
  }
  for (const v of Object.values(node)) countFlags(v, acc)
  return acc
}

function summary (plan) {
  const dob = val(plan.dob)
  return {
    child_id: plan.child_id,
    first_name: val(plan.first_name),
    surname: val(plan.surname),
    age: dob ? ageFromDob(dob) : null,
    last_updated: val(plan.last_updated),
    saved_at: plan.saved_at,
    approved_by: plan.approved_by,
    approved_at: plan.approved_at,
    flags: countFlags(plan),
    ...reviewInfo(plan)
  }
}

function withMeta (plan) {
  const dob = val(plan.dob)
  return { plan, meta: { age: dob ? ageFromDob(dob) : null, flags: countFlags(plan), ...reviewInfo(plan) } }
}

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)

// YubiKey login: editing, saving, new visits and sign-off need a signed-in worker.
const gate = mountAuth(app, { dataDir: DATA, port: PORT, db, wrap })

// ---------- care plans ----------
app.get('/api/status', (req, res) => {
  res.json({ ok: true, ai: aiName, db: { writable: db.writable } })
})

app.get('/api/children', wrap(async (req, res) => {
  const plans = await db.listPlans()
  const list = plans.map(summary).sort((a, b) => (a.first_name || '').localeCompare(b.first_name || ''))
  res.json(list)
}))

app.get('/api/plans/:id', wrap(async (req, res) => {
  const plan = await db.getPlan(req.params.id)
  if (!plan) return res.status(404).json({ error: 'No care plan for that child' })
  res.json(withMeta(plan))
}))

app.get('/api/plans/:id/history', wrap(async (req, res) => {
  const versions = await db.history(req.params.id)
  res.json(versions.reverse()) // newest first
}))

// Save = new version. Any edit clears the sign-off (it must be signed again).
app.put('/api/plans/:id', gate, wrap(async (req, res) => {
  const plan = req.body?.plan
  if (!plan || plan.child_id !== req.params.id) return res.status(400).json({ error: 'Plan child_id does not match' })
  if (!db.writable) return res.status(403).json({ error: 'This database is a read-only copy' })
  const saved = await db.putPlan({ ...plan, approved_by: null, approved_at: null })
  for (const j of jobs.values()) if (j.childId === req.params.id) j.saved = true
  res.json(withMeta(saved))
}))

// Lanyard "if I'm lost" tag text (<= 130 chars, opt-in only for sensitive details).
const LANYARD_OPT_INS = ['surname', 'dob', 'diagnosis', 'ethnicity']
app.post('/api/plans/:id/lanyard', wrap(async (req, res) => {
  const plan = await db.getPlan(req.params.id)
  if (!plan) return res.status(404).json({ error: 'No care plan for that child' })
  const optIns = [].concat(req.body?.optIns || []).filter((o) => LANYARD_OPT_INS.includes(o))
  const text = String(await ai.lanyardText(plan, optIns) ?? '').slice(0, 130)
  res.json({ text })
}))

app.get('/api/next-child-id', wrap(async (req, res) => {
  res.json({ child_id: await nextChildId() })
}))

// Next free ID. New-child drafts that are still waiting for review reserve their ID too,
// so two unsaved drafts can never get the same child ID (saving one would overwrite the other).
async function nextChildId () {
  const num = (id) => Number(String(id).match(/(\d+)$/)?.[1] || 0)
  const ids = (await db.listPlans()).map((p) => num(p.child_id))
  for (const j of jobs.values()) if (j.isNew && !j.saved) ids.push(num(j.childId))
  return `FOBE-CHILD-${String(Math.max(0, ...ids) + 1).padStart(4, '0')}`
}

// ---------- new visit -> AI draft ----------
// Each upload gets its own folder and KEEPS its original file name (../ai caches by file name).
const safeName = (n) => path.basename(String(n)).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 120) || 'file'
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      req.uploadDir ??= path.join(UPLOADS, `${Date.now()}-${crypto.randomBytes(3).toString('hex')}`)
      fs.mkdir(req.uploadDir, { recursive: true }, (e) => cb(e, req.uploadDir))
    },
    filename: (req, file, cb) => cb(null, safeName(Buffer.from(file.originalname, 'latin1').toString('utf8')))
  }),
  limits: { fileSize: 200 * 1024 * 1024 }
})

// Work phone inbox (P2P). Files from it are used by name, only from the inbox folder.
const inbox = await mountInbox(app, { sync, db, gate, wrap, dataDir: DATA })
const inboxPath = (name) => inbox.resolve(name)

const jobs = new Map()

// Several recordings / photos / notes files per visit (uploads and/or files from the work phone inbox).
const listOf = (v) => (v == null ? [] : Array.isArray(v) ? v : [v])
app.post('/api/visits', gate, upload.fields([{ name: 'audio', maxCount: 12 }, { name: 'photo', maxCount: 12 }, { name: 'notesFile', maxCount: 12 }]), wrap(async (req, res) => {
  const audios = [...(req.files?.audio || []).map((f) => f.path), ...listOf(req.body.audioPath).map(inboxPath)].filter(Boolean)
  const photos = [...(req.files?.photo || []).map((f) => f.path), ...listOf(req.body.photoPath).map(inboxPath)].filter(Boolean)
  const noteFiles = [...(req.files?.notesFile || []).map((f) => f.path), ...listOf(req.body.textPath).map(inboxPath)].filter(Boolean)
  const typed = [(req.body.notes || '').trim(), ...noteFiles.map((p) => { try { return fs.readFileSync(p, 'utf-8').trim() } catch { return '' } })]
    .filter(Boolean).join('\n\n')
  if (!audios.length && !photos.length && !typed) return res.status(400).json({ error: 'Add a recording, a photo of your notes, or typed notes' })

  let childId = req.body.childId
  const isNew = !childId || childId === 'new'
  if (isNew) childId = await nextChildId()

  const id = crypto.randomUUID()
  const job = { id, childId, isNew, status: 'running', stage: 'starting', percent: 0, result: null, error: null }
  jobs.set(id, job)
  if (busy) job.stage = 'Waiting for the previous draft to finish'
  // One job at a time: the local models share the PC's CPU/GPU.
  aiQueue = aiQueue.then(async () => {
    busy = true
    try {
      await runVisit(job, { audios, photos, typed })
    } catch (e) {
      console.error('[visit]', e)
      Object.assign(job, { status: 'error', error: e.message || String(e) })
    } finally { busy = false }
  })
  res.json({ jobId: id, childId })
}))
let aiQueue = Promise.resolve()
let busy = false

// Several recordings -> one transcript (segment times continue across files). One file = unchanged (AI cache still hits).
function mergeTranscripts (list) {
  const ts = list.filter(Boolean)
  if (ts.length <= 1) return ts[0] || null
  const segments = []
  let offset = 0
  for (const t of ts) {
    let end = offset
    for (const s of t.segments || []) {
      segments.push({ ...s, start: (s.start || 0) + offset, end: (s.end || 0) + offset })
      end = Math.max(end, (s.end || 0) + offset)
    }
    offset = end + 1
  }
  return {
    language: [...new Set(ts.map((t) => t.language).filter(Boolean))].join(' + '),
    original: ts.map((t) => (t.original || '').trim()).filter(Boolean).join('\n\n'),
    english: ts.map((t) => (t.english || '').trim()).filter(Boolean).join('\n\n'),
    segments
  }
}

async function runVisit (job, { audios, photos, typed }) {
  const t0 = Date.now()
  // Each stage gets a slice of the overall progress bar.
  const stages = [audios.length && ['transcribe', 50], photos.length && ['ocr', 15], ['draft', 35]].filter(Boolean)
  const total = stages.reduce((s, [, w]) => s + w, 0)
  let done = 0
  const progressFor = (weight, label) => (stage, pct) => {
    job.stage = label
    job.detail = stage && stage !== 'done' ? String(stage) : ''
    job.percent = Math.min(99, Math.round(((done + (weight * (pct || 0)) / 100) / total) * 100))
  }
  const finish = (w) => { done += w }
  const of = (i, n) => (n > 1 ? ` (${i + 1} of ${n})` : '')

  const warnings = []
  const transcripts = []
  if (audios.length) {
    const w = stages.find((s) => s[0] === 'transcribe')[1] / audios.length
    for (const [i, audio] of audios.entries()) {
      const t = await ai.transcribe(audio, progressFor(w, `Transcribing and translating the recording${of(i, audios.length)}`))
      if (!(t?.english || t?.original || '').trim()) warnings.push(`No speech about the child could be understood in ${path.basename(audio)}, so nothing was taken from it.`)
      transcripts.push(t)
      finish(w)
    }
  }
  const transcript = mergeTranscripts(transcripts)
  const ocrTexts = []
  if (photos.length) {
    const w = stages.find((s) => s[0] === 'ocr')[1] / photos.length
    for (const [i, photo] of photos.entries()) {
      try {
        const text = (await ai.ocrNotes(photo, progressFor(w, `Reading the photo of your notes${of(i, photos.length)}`)))?.text || ''
        if (text.trim()) ocrTexts.push(text.trim())
        else warnings.push(`No text could be read from ${path.basename(photo)}. Please type anything important from it.`)
      } catch (e) {
        // Not fatal: the recording / typed notes still make a draft.
        console.warn('[ocr]', e.message)
        warnings.push(`${path.basename(photo)} could not be read (${e.message}). Please type anything important from it.`)
      }
      finish(w)
    }
  }
  const ocrText = ocrTexts.join('\n\n')
  const notes = [typed, ocrText].filter(Boolean).join('\n\n')
  const existingPlan = job.isNew ? undefined : (await db.getPlan(job.childId)) || undefined
  const w = stages.find((s) => s[0] === 'draft')[1]
  const plan = await ai.draftCarePlan({ childId: job.childId, transcript, notes, existingPlan }, progressFor(w, 'Drafting the care plan'))
  plan.child_id = job.childId
  plan.approved_by = null
  plan.approved_at = null

  job.result = { plan, transcript, notes, typed, ocrText, warnings, ai: aiName, existed: !!existingPlan, seconds: Math.round((Date.now() - t0) / 1000) }
  Object.assign(job, { status: 'done', stage: 'Draft ready', detail: '', percent: 100 })
  console.log(`[visit] ${job.childId} drafted in ${job.result.seconds}s`)
}

app.get('/api/jobs/:id', (req, res) => {
  const job = jobs.get(req.params.id)
  if (!job) return res.status(404).json({ error: 'Unknown job (the server may have restarted)' })
  res.json(job)
})

// ---------- errors + start ----------
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }))
app.use((err, req, res, next) => {
  if (!err.status || err.status >= 500) console.error(err)
  res.status(err.status || 500).json({ error: err.message || 'Server error' })
})

const server = app.listen(PORT, '127.0.0.1', () => {
  console.log(`FOBE care plans: http://localhost:${PORT}`)
})

async function shutdown () {
  server.close()
  await inbox.close()
  await ai.close?.().catch(() => {})
  await db.close().catch(() => {})
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
