// FOBE Care Plan UI server. Local only: binds to localhost, no CDNs, no cloud.
import express from 'express'
import session from 'express-session'
import multer from 'multer'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { openDb, ageFromDob, reviewDue } from '../sync/db.js'
import { loadAi } from './ai-loader.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT) || 3000
const DB_DIR = process.env.FOBE_DB_DIR || path.join(HERE, '../sync/data/office-pc')
const DATA = path.join(HERE, 'data') // gitignored
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
app.use(express.static(path.join(HERE, 'public')))
app.use('/vendor/simplewebauthn', express.static(path.join(HERE, 'node_modules/@simplewebauthn/browser/esm')))

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

// Auth gate (YubiKey login is added at C4).
let requireAuth = (req, res, next) => next()
const gate = (req, res, next) => requireAuth(req, res, next)

// ---------- care plans ----------
app.get('/api/status', (req, res) => {
  res.json({ ok: true, ai: aiName, db: { writable: db.writable, key: db.key } })
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
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOADS,
    filename: (req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(3).toString('hex')}${path.extname(file.originalname).toLowerCase()}`)
  }),
  limits: { fileSize: 200 * 1024 * 1024 }
})

const jobs = new Map()

app.post('/api/visits', gate, upload.fields([{ name: 'audio', maxCount: 1 }, { name: 'photo', maxCount: 1 }]), wrap(async (req, res) => {
  const audio = req.files?.audio?.[0]?.path || req.body.audioPath || null
  const photo = req.files?.photo?.[0]?.path || req.body.photoPath || null
  const typed = (req.body.notes || '').trim()
  if (!audio && !photo && !typed) return res.status(400).json({ error: 'Add a recording, a photo of your notes, or typed notes' })

  let childId = req.body.childId
  const isNew = !childId || childId === 'new'
  if (isNew) childId = await nextChildId()

  const id = crypto.randomUUID()
  const job = { id, childId, isNew, status: 'running', stage: 'starting', percent: 0, result: null, error: null }
  jobs.set(id, job)
  runVisit(job, { audio, photo, typed }).catch((e) => {
    console.error('[visit]', e)
    Object.assign(job, { status: 'error', error: e.message || String(e) })
  })
  res.json({ jobId: id })
}))

async function runVisit (job, { audio, photo, typed }) {
  // Each stage gets a slice of the overall progress bar.
  const stages = [audio && ['transcribe', 50], photo && ['ocr', 15], ['draft', 35]].filter(Boolean)
  const total = stages.reduce((s, [, w]) => s + w, 0)
  let done = 0
  const progressFor = (weight, label) => (stage, pct) => {
    job.stage = label || stage
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
  if (photo) {
    const w = stages.find((s) => s[0] === 'ocr')[1]
    ocrText = (await ai.ocrNotes(photo, progressFor(w, 'Reading the photo of your notes')))?.text || ''
    finish(w)
  }
  const notes = [typed, ocrText].filter(Boolean).join('\n\n')
  const existingPlan = job.isNew ? undefined : (await db.getPlan(job.childId)) || undefined
  const w = stages.find((s) => s[0] === 'draft')[1]
  const plan = await ai.draftCarePlan({ childId: job.childId, transcript, notes, existingPlan }, progressFor(w, 'Drafting the care plan'))
  plan.child_id = job.childId
  plan.approved_by = null
  plan.approved_at = null

  job.result = { plan, transcript, notes, typed, ocrText, existed: !!existingPlan }
  Object.assign(job, { status: 'done', stage: 'Draft ready', percent: 100 })
}

app.get('/api/jobs/:id', (req, res) => {
  const job = jobs.get(req.params.id)
  if (!job) return res.status(404).json({ error: 'Unknown job (the server may have restarted)' })
  res.json(job)
})

// ---------- errors + start ----------
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }))
app.use((err, req, res, next) => {
  console.error(err)
  res.status(500).json({ error: err.message || 'Server error' })
})

const server = app.listen(PORT, '127.0.0.1', () => {
  console.log(`FOBE care plans: http://localhost:${PORT}`)
})

async function shutdown () {
  server.close()
  await db.close().catch(() => {})
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
