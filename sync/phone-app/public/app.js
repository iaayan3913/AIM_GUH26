// FOBE work phone web app (no libraries). Talks to phone-app/server.js on the same origin.
'use strict'

const $ = (id) => document.getElementById(id)
const state = { status: null, recording: null, wav: null, photo: null }

// ---------- helpers ----------

async function api (path, opts = {}) {
  const res = await fetch(path, opts)
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
  return body
}

function toast (msg) {
  const t = $('toast')
  t.textContent = msg
  t.hidden = false
  clearTimeout(toast.timer)
  toast.timer = setTimeout(() => { t.hidden = true }, 3500)
}

const pad = (n) => String(n).padStart(2, '0')
const stamp = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
const hhmm = (iso) => { const d = new Date(iso); return `${pad(d.getHours())}:${pad(d.getMinutes())}` }
const dateGB = (s) => s ? new Date(s + (s.length === 10 ? 'T12:00:00' : '')).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'
const size = (n) => n > 1e6 ? (n / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

async function upload (blob, name, kind) {
  if (!state.status?.paired) { toast('Pair with the office PC first'); location.hash = '#pair'; throw new Error('Not paired') }
  const item = await api(`/api/files?name=${encodeURIComponent(name)}&kind=${kind}`, {
    method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: blob
  })
  toast(item.status === 'delivered' ? `${name} delivered` : state.status.connected ? `Sending ${name}…` : `${name} queued – will send when the office is online`)
  location.hash = '#outbox'
  return item
}

// ---------- navigation ----------

const screens = ['pair', 'record', 'notes', 'outbox', 'backup']
function route () {
  let tab = location.hash.slice(1)
  if (!screens.includes(tab)) tab = state.status?.paired ? 'record' : 'pair'
  for (const s of screens) $('screen-' + s).hidden = s !== tab
  for (const a of document.querySelectorAll('.tabs a')) {
    if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page')
    else a.removeAttribute('aria-current')
  }
  if (tab === 'outbox') refreshOutbox()
  if (tab === 'backup') refreshBackup()
  window.scrollTo(0, 0)
}
window.addEventListener('hashchange', route)

// ---------- 1. pair + status pill ----------

async function refreshStatus () {
  try {
    const s = await api('/api/status')
    state.status = s
    const pill = $('pill')
    if (!s.paired) { pill.className = 'pill pill-grey'; pill.textContent = 'Not paired' } else if (s.connected) { pill.className = 'pill pill-ok'; pill.textContent = 'Connected to Office PC' } else { pill.className = 'pill pill-warn'; pill.textContent = 'Office offline – files queued' }
    const badge = $('badge')
    badge.hidden = !s.queued
    badge.textContent = s.queued
    if (!showPairForm.forced) {
      $('pair-form').hidden = s.paired
      $('pair-done').hidden = !s.paired
    }
    $('pair-key-shown').textContent = s.pairingKey || ''
    $('pair-office').textContent = s.connected ? `Connected to ${s.officeName || 'Office PC'}` : 'Office PC not reachable right now'
  } catch {
    const pill = $('pill')
    pill.className = 'pill pill-grey'
    pill.textContent = 'Phone app stopped'
  }
}

function showPairForm (on) {
  showPairForm.forced = on
  $('pair-form').hidden = !on
  $('pair-done').hidden = on
  if (on) $('pair-key').focus()
}

$('pair-key').addEventListener('input', (e) => {
  const raw = e.target.value.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 16)
  e.target.value = raw.match(/.{1,4}/g)?.join('-') || ''
})
$('pair-key').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('pair-btn').click() })
$('pair-btn').addEventListener('click', async () => {
  $('pair-error').textContent = ''
  $('pair-btn').disabled = true
  try {
    await api('/api/pair', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: $('pair-key').value }) })
    showPairForm(false)
    await refreshStatus()
    toast('Paired. Looking for the office PC…')
  } catch (err) {
    $('pair-error').textContent = err.message
  } finally {
    $('pair-btn').disabled = false
  }
})
$('repair-btn').addEventListener('click', () => showPairForm(true))

// ---------- 2. record (MediaRecorder -> 16 kHz mono WAV) ----------

$('consent').addEventListener('change', () => {
  if (!state.recording) {
    $('rec-btn').disabled = !$('consent').checked
    $('rec-hint').textContent = $('consent').checked ? 'Press the button to start recording.' : 'Tick the consent box to start.'
  }
})

$('rec-btn').addEventListener('click', () => state.recording ? stopRecording() : startRecording())

async function startRecording () {
  $('rec-error').textContent = ''
  if (!$('consent').checked) return
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { $('rec-error').textContent = 'This browser cannot record audio. Use Edge or Chrome.'; return }
  discardRecording()
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } })
    const rec = new MediaRecorder(stream)
    const chunks = []
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data) }
    rec.onstop = () => finishRecording(stream, new Blob(chunks, { type: rec.mimeType }))
    rec.start(1000)
    const started = Date.now()
    state.recording = { rec, started, timer: setInterval(() => tick(started), 250) }
    tick(started)
    $('rec-btn').classList.add('recording')
    $('rec-btn').setAttribute('aria-label', 'Stop recording')
    $('rec-label').textContent = 'Stop'
    $('rec-hint').textContent = 'Recording… press Stop when the meeting ends.'
    $('consent').disabled = true
  } catch (err) {
    $('rec-error').textContent = err.name === 'NotAllowedError' ? 'Microphone permission was refused. Allow it in the address bar and try again.' : 'Could not start the microphone: ' + err.message
  }
}

function tick (started) {
  const s = Math.floor((Date.now() - started) / 1000)
  $('rec-timer').textContent = `${pad(Math.floor(s / 60))}:${pad(s % 60)}`
}

function stopRecording () {
  const r = state.recording
  if (!r) return
  clearInterval(r.timer)
  r.rec.stop()
  state.recording = null
  $('rec-btn').classList.remove('recording')
  $('rec-btn').setAttribute('aria-label', 'Start recording')
  $('rec-label').textContent = 'Record'
  $('rec-btn').disabled = true
  $('rec-hint').textContent = 'Converting to WAV…'
}

async function finishRecording (stream, blob) {
  stream.getTracks().forEach(t => t.stop())
  try {
    const wav = await toWav16kMono(blob)
    state.wav = { blob: wav, name: `visit_${stamp()}.wav` }
    $('rec-audio').src = URL.createObjectURL(wav)
    $('rec-size').textContent = size(wav.size)
    $('rec-review').hidden = false
    $('rec-hint').textContent = 'Listen back if you like, then send it to the office.'
  } catch (err) {
    $('rec-error').textContent = 'Could not convert the recording: ' + err.message
    resetRecorder()
  }
}

// Decode whatever MediaRecorder produced (webm/opus), downmix + resample to 16 kHz mono, encode PCM16 WAV.
async function toWav16kMono (blob) {
  const ctx = new AudioContext()
  let decoded
  try { decoded = await ctx.decodeAudioData(await blob.arrayBuffer()) } finally { ctx.close() }
  const rate = 16000
  const off = new OfflineAudioContext(1, Math.max(1, Math.ceil(decoded.duration * rate)), rate)
  const src = off.createBufferSource()
  src.buffer = decoded
  src.connect(off.destination)
  src.start()
  const rendered = await off.startRendering()
  return encodeWav(rendered.getChannelData(0), rate)
}

function encodeWav (samples, rate) {
  const buf = new ArrayBuffer(44 + samples.length * 2)
  const v = new DataView(buf)
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)) }
  str(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); str(8, 'WAVE')
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true)
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true)
  str(36, 'data'); v.setUint32(40, samples.length * 2, true)
  for (let i = 0, o = 44; i < samples.length; i++, o += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return new Blob([buf], { type: 'audio/wav' })
}

function discardRecording () {
  if ($('rec-audio').src) URL.revokeObjectURL($('rec-audio').src)
  $('rec-audio').removeAttribute('src')
  $('rec-review').hidden = true
  state.wav = null
}

function resetRecorder () {
  discardRecording()
  $('consent').disabled = false
  $('consent').checked = false // consent is confirmed again for every recording
  $('rec-btn').disabled = true
  $('rec-timer').textContent = '00:00'
  $('rec-hint').textContent = 'Tick the consent box to start.'
}

$('rec-send').addEventListener('click', async () => {
  if (!state.wav) return
  $('rec-send').disabled = true
  try { await upload(state.wav.blob, state.wav.name, 'recording'); resetRecorder() } catch (err) { $('rec-error').textContent = err.message } finally { $('rec-send').disabled = false }
})
$('rec-discard').addEventListener('click', resetRecorder)

// ---------- 3. notes: photo (file or camera) + typed ----------

$('photo-btn').addEventListener('click', () => $('photo-file').click())
$('photo-file').addEventListener('change', (e) => {
  const f = e.target.files[0]
  if (f) showPhoto(f, safePhotoName(f.name))
  e.target.value = ''
})
const safePhotoName = (n) => `notes-photo_${stamp()}${(n.match(/\.[a-z0-9]{1,5}$/i) || ['.jpg'])[0].toLowerCase()}`

function showPhoto (blob, name) {
  if (state.photo) URL.revokeObjectURL($('photo-preview').src)
  state.photo = { blob, name }
  $('photo-preview').src = URL.createObjectURL(blob)
  $('photo-review').hidden = false
}
function clearPhoto () {
  if (state.photo) URL.revokeObjectURL($('photo-preview').src)
  state.photo = null
  $('photo-review').hidden = true
}

let camStream = null
$('cam-btn').addEventListener('click', async () => {
  $('notes-error').textContent = ''
  try {
    camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } } })
    $('cam-video').srcObject = camStream
    $('cam').hidden = false
    $('cam-btn').hidden = true
    clearPhoto()
  } catch (err) {
    $('notes-error').textContent = 'Could not open the camera: ' + err.message
  }
})
function closeCamera () {
  if (camStream) camStream.getTracks().forEach(t => t.stop())
  camStream = null
  $('cam').hidden = true
  $('cam-btn').hidden = false
}
$('cam-close').addEventListener('click', closeCamera)
$('cam-snap').addEventListener('click', () => {
  const v = $('cam-video')
  const c = document.createElement('canvas')
  c.width = v.videoWidth
  c.height = v.videoHeight
  c.getContext('2d').drawImage(v, 0, 0)
  c.toBlob(b => { closeCamera(); showPhoto(b, `notes-photo_${stamp()}.jpg`) }, 'image/jpeg', 0.92)
})
$('photo-send').addEventListener('click', async () => {
  if (!state.photo) return
  $('photo-send').disabled = true
  try { await upload(state.photo.blob, state.photo.name, 'photo'); clearPhoto() } catch (err) { $('notes-error').textContent = err.message } finally { $('photo-send').disabled = false }
})
$('photo-discard').addEventListener('click', clearPhoto)

$('notes-send').addEventListener('click', async () => {
  const text = $('notes-text').value.trim()
  if (!text) { $('notes-error').textContent = 'Type some notes first.'; return }
  $('notes-error').textContent = ''
  $('notes-send').disabled = true
  try {
    await upload(new Blob([text + '\n'], { type: 'text/plain' }), `notes_${stamp()}.txt`, 'notes')
    $('notes-text').value = ''
  } catch (err) { $('notes-error').textContent = err.message } finally { $('notes-send').disabled = false }
})

// ---------- 4. outbox ----------

const STATUS = { queued: 'Queued', sending: 'Sending…', delivered: 'Delivered ✓', error: 'Failed' }
const KIND = { recording: '🎙️', photo: '📷', notes: '📝', file: '📄' }

async function refreshOutbox () {
  try {
    const items = await api('/api/outbox')
    $('outbox-list').innerHTML = items.length
      ? items.map(i => `<li><div><div class="name">${KIND[i.kind] || ''} ${esc(i.name)}</div><div class="sub">${size(i.size)} · added ${hhmm(i.createdAt)}${i.deliveredAt ? ' · delivered ' + hhmm(i.deliveredAt) : ''}${i.error ? ' · ' + esc(i.error) : ''}</div></div><span class="status st-${i.status}">${STATUS[i.status]}</span></li>`).join('')
      : '<li class="empty">Nothing sent yet</li>'
  } catch {}
}

// ---------- 5. backup (read-only) ----------

async function refreshBackup () {
  try {
    const b = await api('/api/backup')
    $('backup-synced').textContent = (b.lastSynced ? `Last synced ${hhmm(b.lastSynced)}` : 'Last synced: never') + (b.online ? ' · live' : ' · office offline, showing the saved copy')
    const today = new Date().toISOString().slice(0, 10)
    const soon = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10)
    let html
    if (b.state === 'unpaired') html = '<li class="empty">Pair with the office PC to get the backup</li>'
    else if (b.state === 'waiting') html = '<li class="empty">Waiting for the first sync from the office PC…</li>'
    else if (b.state === 'encrypted') html = `<li class="empty">Encrypted backup: ${b.blocks} blocks stored. This device has no passphrase, so it can't read them.</li>`
    else if (b.state === 'error') html = `<li class="empty">${esc(b.error)}</li>`
    else if (!b.plans.length) html = '<li class="empty">No care plans yet</li>'
    else {
      html = b.plans.map(p => {
        const cls = !p.review_due ? 'due-ok' : p.review_due < today ? 'due-overdue' : p.review_due <= soon ? 'due-soon' : 'due-ok'
        const label = cls === 'due-overdue' ? 'Review overdue' : cls === 'due-soon' ? 'Review due soon' : 'Review due'
        return `<li><div><div class="name">${esc(p.name)}</div><div class="sub">Last updated ${dateGB(p.last_updated)}</div></div><span class="status ${cls}" title="${label}">${label}<br>${dateGB(p.review_due)}</span></li>`
      }).join('')
    }
    $('backup-list').innerHTML = html
  } catch {}
}

// ---------- start ----------

async function poll () {
  await refreshStatus()
  const tab = location.hash.slice(1)
  if (tab === 'outbox') refreshOutbox()
  if (tab === 'backup') refreshBackup()
}

refreshStatus().then(route)
setInterval(poll, 2000)
