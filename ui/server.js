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
const db = await openDb(DB_DIR)
const { ai, name: aiName } = await loadAi()
console.log(`[db] ${DB_DIR} (writable: ${db.writable})`)
console.log(`[ai] using ${aiName}`)

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
  res.json(withMeta(saved))
}))

app.get('/api/next-child-id', wrap(async (req, res) => {
  res.json({ child_id: await nextChildId() })
}))

async function nextChildId () {
  const plans = await db.listPlans()
  const max = plans.reduce((m, p) => Math.max(m, Number(String(p.child_id).match(/(\d+)$/)?.[1] || 0)), 0)
  return `FOBE-CHILD-${String(max + 1).padStart(4, '0')}`
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

app.post('/api/visits', gate, upload.fields([{ name: 'audio', maxCount: 1 }, { name: 'photo', maxCount: 1 }]), wrap(async (req, res) => {
  const audio = req.files?.audio?.[0]?.path || inboxPath(req.body.audioPath)
  const photo = req.files?.photo?.[0]?.path || inboxPath(req.body.photoPath)
  const typed = (req.body.notes || '').trim()
  if (!audio && !photo && !typed) return res.status(400).json({ error: 'Add a recording, a photo of your notes, or typed notes' })

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
      await runVisit(job, { audio, photo, typed })
    } catch (e) {
      console.error('[visit]', e)
      Object.assign(job, { status: 'error', error: e.message || String(e) })
    } finally { busy = false }
  })
  res.json({ jobId: id })
}))
let aiQueue = Promise.resolve()
let busy = false

async function runVisit (job, { audio, photo, typed }) {
  const t0 = Date.now()
  // Each stage gets a slice of the overall progress bar.
  const stages = [audio && ['transcribe', 50], photo && ['ocr', 15], ['draft', 35]].filter(Boolean)
  const total = stages.reduce((s, [, w]) => s + w, 0)
  let done = 0
  const progressFor = (weight, label) => (stage, pct) => {
    job.stage = label
    job.detail = stage && stage !== 'done' ? String(stage) : ''
    job.percent = Math.min(99, Math.round(((done + (weight * (pct || 0)) / 100) / total) * 100))
  }
  const finish = (w) => { done += w }

  let transcript = null
  if (audio) {
    const w = stages.find((s) => s[0] === 'transcribe')[1]
    transcript = await ai.transcribe(audio, progressFor(w, 'Transcribing and translating the recording'))
    finish(w)
  }
  let ocrText = ''
  const warnings = []
  if (photo) {
    const w = stages.find((s) => s[0] === 'ocr')[1]
    try {
      ocrText = (await ai.ocrNotes(photo, progressFor(w, 'Reading the photo of your notes')))?.text || ''
    } catch (e) {
      // Not fatal: the recording / typed notes still make a draft.
      console.warn('[ocr]', e.message)
      warnings.push(`The photo of the notes could not be read (${e.message}). Please type anything important from it.`)
    }
    finish(w)
  }
  const notes = [typed, ocrText].filter(Boolean).join('\n\n')
  const existingPlan = job.isNew ? undefined : (await db.getPlan(job.childId)) || undefined
  const w = stages.find((s) => s[0] === 'draft')[1]
  const plan = await ai.draftCarePlan({ childId: job.childId, transcript, notes, existingPlan }, progressFor(w, 'Drafting the care plan'))
  plan.child_id = job.childId
  plan.approved_by = null
  plan.approved_at = null

  job.result = { plan, transcript, notes, typed, ocrText, warnings, existed: !!existingPlan, seconds: Math.round((Date.now() - t0) / 1000) }
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
