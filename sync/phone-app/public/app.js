// FOBE work phone web app (no libraries). Talks to phone-app/server.js on the same origin.
'use strict'

const $ = (id) => document.getElementById(id)
const icon = (name, cls = '') => `<svg class="ic ${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`
const state = {
  status: null,
  outbox: [],
  drafts: [],
  plans: [],
  visit: loadVisit(),
  recording: null,
  wav: null,
  audio: null,
  photos: []
}

// ---------- helpers ----------

async function api (path, opts = {}) {
  const res = await fetch(path, opts)
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
  return body
}

function toast (msg, ic = 'check-circle') {
  const t = $('toast')
  t.innerHTML = icon(ic) + `<span>${esc(msg)}</span>`
  t.hidden = false
  clearTimeout(toast.timer)
  toast.timer = setTimeout(() => { t.hidden = true }, 3800)
}

const pad = (n) => String(n).padStart(2, '0')
const today = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const hhmm = (iso) => { const d = new Date(iso); return `${pad(d.getHours())}:${pad(d.getMinutes())}` }
const dateGB = (s) => s ? new Date(s + (s.length === 10 ? 'T12:00:00' : '')).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'
const size = (n) => n > 1e6 ? (n / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const initials = (name) => (name || '?').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase()
const avatarClass = (name) => 'av-' + ([...(name || '')].reduce((a, c) => a + c.charCodeAt(0), 0) % 5)
const fmtDur = (s) => `${pad(Math.floor(s / 60))}:${pad(Math.floor(s % 60))}`

// File names: <Child-Name>_<type>_<date>_<n>; the worker can rename before sending.
const BAD = /[<>:"/\\|?*\x00-\x1f]/g
const slug = (s) => String(s || '').replace(BAD, '').trim().replace(/\s+/g, '-').replace(/-+/g, '-') || 'Child'
const cleanBase = (s) => String(s || '').replace(BAD, '').trim().replace(/\.(wav|txt|jpe?g|png|webp|m4a|ogg|mp3)$/i, '')
const KIND_OF_TYPE = { recording: 'recording', audio: 'audio', 'notes-photo': 'photo', notes: 'notes' }
function defaultName (type) {
  const base = `${slug(state.visit?.child)}_${type}_${today()}_`
  const used = (n) => visitItems().some(d => d.name.startsWith(base + n + '.') || d.name.startsWith(base + n + '_p'))
  let n = 1
  while (used(n)) n++
  return base + n
}
function setName (inputId, type, force = false) {
  const el = $(inputId)
  if (force || !el.dataset.touched) { el.value = defaultName(type); delete el.dataset.touched }
}
for (const id of ['rec-name', 'audio-name', 'photo-name', 'notes-name']) {
  $(id).addEventListener('input', (e) => {
    const v = e.target.value.replace(BAD, '')
    if (v !== e.target.value) e.target.value = v
    e.target.dataset.touched = '1'
  })
}
function readName (inputId) {
  const base = cleanBase($(inputId).value)
  if (!base) throw new Error('Please enter a file name')
  return base
}

// ---------- visit (kept in this browser) ----------

function loadVisit () { try { return JSON.parse(localStorage.getItem('fobe.visit')) } catch { return null } }
function saveVisit (v) {
  state.visit = v
  if (v) localStorage.setItem('fobe.visit', JSON.stringify(v))
  else localStorage.removeItem('fobe.visit')
}
// Files added during a visit are drafts on this phone; "Finish visit" sends them all.
const visitItems = () => state.visit ? state.drafts.filter(d => d.visitId === state.visit.id) : []

async function upload (blob, name, kind) {
  if (!state.visit) throw new Error('Start a visit first')
  const q = new URLSearchParams({ name, kind, child: state.visit.child, visit: state.visit.id })
  const d = await api('/api/drafts?' + q, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: blob })
  state.drafts = [...state.drafts.filter(x => x.id !== d.id), d]
  renderVisit()
  return d
}

function afterSend (count, label) {
  toast(`${label} added to the visit`, 'check-circle')
  location.hash = '#visit'
}

async function refreshDrafts () {
  if (!state.visit) { state.drafts = []; return }
  try {
    state.drafts = await api('/api/drafts?visit=' + encodeURIComponent(state.visit.id))
    if (current === 'visit') renderVisit()
  } catch {}
}

// ---------- navigation ----------

const SCREENS = ['pair', 'visit', 'record', 'audio', 'photo', 'notes', 'outbox', 'backup']
const CAPTURE = ['record', 'audio', 'photo', 'notes']
let current = null
function route () {
  let tab = location.hash.slice(1)
  if (!SCREENS.includes(tab)) tab = state.status && !state.status.paired ? 'pair' : 'visit'
  if (CAPTURE.includes(tab) && !state.visit) { tab = 'visit'; history.replaceState(null, '', '#visit') }
  if (current === 'photo' && tab !== 'photo') closeCamera()
  current = tab
  for (const s of SCREENS) $('screen-' + s).hidden = s !== tab
  const navTab = CAPTURE.includes(tab) ? 'visit' : tab
  for (const a of document.querySelectorAll('.tabs a')) {
    if (a.dataset.tab === navTab) a.setAttribute('aria-current', 'page')
    else a.removeAttribute('aria-current')
  }
  for (const el of document.querySelectorAll('.back-child')) el.textContent = state.visit ? `Visit · ${state.visit.child}` : 'Visit'
  if (tab === 'record' && !state.wav) setName('rec-name', 'recording')
  if (tab === 'notes') setName('notes-name', 'notes')
  if (tab === 'photo' && !state.photos.length) setName('photo-name', 'notes-photo')
  if (tab === 'audio' && !state.audio) setName('audio-name', 'audio')
  render()
  window.scrollTo(0, 0)
}
window.addEventListener('hashchange', route)

function render () {
  renderPill()
  if (current === 'pair') renderConnection()
  if (current === 'visit') renderVisit()
  if (current === 'outbox') renderOutbox()
  if (current === 'backup') renderBackup()
}

// ---------- status pill + connection ----------

function renderPill () {
  const s = state.status
  const pill = $('pill')
  let cls = 'pill-grey'; let ic = 'link'; let text = 'Not paired'
  if (!s) { text = 'Phone app stopped'; ic = 'alert' } else if (s.paired && s.connected) { cls = 'pill-ok'; ic = 'wifi'; text = 'Connected to Office PC' } else if (s.paired) { cls = 'pill-warn'; ic = 'wifi-off'; text = 'Office offline – files queued' }
  pill.className = 'pill ' + cls
  pill.innerHTML = icon(ic) + `<span>${text}</span>`
  const badge = $('badge')
  badge.hidden = !s?.queued
  badge.textContent = s?.queued || ''
}

let pairFormOpen = false
function renderConnection () {
  const s = state.status
  const card = $('conn-card')
  if (!s?.paired) {
    card.className = 'card conn-card conn-none'
    card.innerHTML = `<div class="conn-ic">${icon('link')}</div><div class="conn-title">Not paired yet</div><p class="muted small">Pair once with the office PC to send files and keep a backup.</p>`
    $('pair-form').hidden = false
    $('pair-cancel').hidden = true
    return
  }
  const ok = s.connected
  card.className = 'card conn-card ' + (ok ? 'conn-ok' : 'conn-warn')
  card.innerHTML = `<div class="conn-ic">${icon(ok ? 'wifi' : 'wifi-off')}</div>
    <div class="conn-title">${ok ? 'Connected to Office PC' : 'Office PC offline'}</div>
    <p class="muted small" style="margin:4px 0 0">${ok ? 'Office PC · ' + esc((s.officeName || '').replace(/\s*\(office\)$/, '') || 'FOBE') :'New files wait in the outbox and send automatically when the office is back.'}</p>
    <div class="key-box"><div class="eyebrow">Paired with key</div><div class="key-shown">${esc(s.pairingKey)}</div></div>
    ${pairFormOpen ? '' : '<button id="repair-btn" class="btn btn-text">' + icon('key') + 'Pair with a different office</button>'}`
  $('pair-form').hidden = !pairFormOpen
  $('pair-cancel').hidden = false
  const rb = $('repair-btn')
  if (rb) rb.onclick = () => { pairFormOpen = true; renderConnection(); $('pair-key').focus() }
}

$('pair-key').addEventListener('input', (e) => {
  const raw = e.target.value.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 16)
  e.target.value = raw.match(/.{1,4}/g)?.join('-') || ''
})
$('pair-key').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('pair-btn').click() })
$('pair-cancel').addEventListener('click', () => { pairFormOpen = false; renderConnection() })
$('pair-btn').addEventListener('click', async () => {
  $('pair-error').textContent = ''
  $('pair-btn').disabled = true
  try {
    await api('/api/pair', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: $('pair-key').value }) })
    pairFormOpen = false
    $('pair-key').value = ''
    await refreshStatus()
    toast('Paired. Looking for the office PC…', 'link')
  } catch (err) {
    $('pair-error').textContent = err.message
  } finally {
    $('pair-btn').disabled = false
  }
})

// ---------- visit hub ----------

const KIND_ICON = { recording: 'mic', audio: 'audio-file', photo: 'image', notes: 'note', file: 'note' }
const STATUS = {
  queued: ['clock', 'Queued'],
  sending: ['sync', 'Sending'],
  delivered: ['check', 'Delivered'],
  error: ['alert', 'Failed']
}
const chip = (st) => `<span class="chip st-${st}">${icon(STATUS[st][0], st === 'sending' ? 'spin' : '')}${STATUS[st][1]}</span>`
const itemRow = (i, showChild) => `<li>
  <span class="kind-ic kind-${i.kind}">${icon(KIND_ICON[i.kind] || 'note')}</span>
  <div class="grow"><div class="name">${esc(i.name).replace(/([_-])/g, '$1<wbr>')}</div>
  <div class="sub">${showChild && i.child ? esc(i.child) + ' · ' : ''}${size(i.size)} · ${hhmm(i.createdAt)}${i.error ? ' · ' + esc(i.error) : ''}</div></div>
  ${chip(i.status)}</li>`

function renderVisit () {
  const v = state.visit
  $('visit-start').hidden = !!v
  $('visit-active').hidden = !v
  if (!v) {
    const n = $('child-name').value.trim()
    $('name-example').textContent = `${slug(n || 'Ayaan Malik')}_recording_${today()}_1.wav`
    return
  }
  const items = visitItems()
  const n = items.length
  const files = n === 1 ? 'file' : 'files'
  $('visit-avatar').className = 'avatar ' + avatarClass(v.child)
  $('visit-avatar').textContent = initials(v.child)
  if (!$('visit-child').querySelector('input')) $('visit-child').textContent = v.child
  $('visit-sub').textContent = `Started ${hhmm(v.startedAt)} · ${n ? `${n} ${files} ready to send` : 'no files yet'}`
  $('visit-count').textContent = n || ''
  // don't redraw the list while a file is being renamed
  if (!$('visit-list').querySelector('input')) {
    $('visit-list').innerHTML = n
      ? items.map(draftRow).join('')
      : `<li class="empty">${icon('plus')}<span>Nothing added yet. Record audio, upload audio, add photos of your notes or type notes. Everything stays here until you finish the visit.</span></li>`
  }
  $('visit-hint').hidden = !n
  $('visit-finish-label').textContent = n ? `Finish visit & send ${n} ${files}` : 'Finish visit'
  $('visit-finish').disabled = !!state.recording
}

const draftRow = (d) => `<li data-id="${d.id}">
  ${d.kind === 'photo'
    ? `<img class="kind-ic thumb-ic" src="/api/drafts/${d.id}/file" alt="">`
    : `<span class="kind-ic kind-${d.kind}">${icon(KIND_ICON[d.kind] || 'note')}</span>`}
  <div class="grow"><div class="name">${esc(d.name).replace(/([_-])/g, '$1<wbr>')}</div>
  <div class="sub">${size(d.size)} · added ${hhmm(d.createdAt)}</div></div>
  <div class="row-actions">
    ${d.kind === 'recording' || d.kind === 'audio' ? `<button class="icon-btn sm" data-act="play" aria-label="Play ${esc(d.name)}">${icon('play')}</button>` : ''}
    <button class="icon-btn sm" data-act="rename" aria-label="Rename ${esc(d.name)}">${icon('pencil')}</button>
    <button class="icon-btn sm danger" data-act="delete" aria-label="Remove ${esc(d.name)}">${icon('trash')}</button>
  </div></li>`

const splitExt = (name) => { const m = name.match(/^(.*?)(\.[a-z0-9]{1,5})?$/i); return [m[1], m[2] || ''] }

let player = null
$('visit-list').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-act]')
  if (!btn) return
  const li = btn.closest('li')
  const d = state.drafts.find(x => x.id === li.dataset.id)
  if (!d) return
  $('finish-error').textContent = ''
  if (btn.dataset.act === 'delete') {
    if (!confirm(`Remove ${d.name} from this visit?`)) return
    await api('/api/drafts/' + d.id, { method: 'DELETE' }).catch(() => {})
    state.drafts = state.drafts.filter(x => x.id !== d.id)
    renderVisit()
    toast(`${d.name} removed`, 'trash')
  } else if (btn.dataset.act === 'play') {
    if (player && !player.paused && player.dataset.id === d.id) { player.pause(); return }
    if (player) player.pause()
    player = new Audio('/api/drafts/' + d.id + '/file')
    player.dataset.id = d.id
    player.play().catch(() => {})
  } else if (btn.dataset.act === 'rename') {
    const [base, ext] = splitExt(d.name)
    const nameEl = li.querySelector('.name')
    nameEl.innerHTML = `<div class="name-field"><input class="input" autocomplete="off" spellcheck="false" aria-label="New file name"><span class="ext">${esc(ext)}</span></div>`
    const inp = nameEl.querySelector('input')
    inp.value = base
    inp.focus()
    inp.select()
    let finished = false
    const done = async (save) => {
      if (finished) return
      finished = true
      const nb = cleanBase(inp.value)
      if (save && nb && nb + ext !== d.name) {
        try {
          const upd = await api('/api/drafts/' + d.id, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: nb + ext }) })
          Object.assign(d, upd)
          toast(`Renamed to ${upd.name}`, 'pencil')
        } catch (err) { $('finish-error').textContent = err.message }
      }
      nameEl.innerHTML = ''
      renderVisit()
    }
    inp.addEventListener('input', () => { inp.value = inp.value.replace(BAD, '') })
    inp.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') done(true); if (ev.key === 'Escape') done(false) })
    inp.addEventListener('blur', () => done(true))
  }
})

function startVisit (name) {
  const child = name.replace(/\s+/g, ' ').trim()
  if (!child) { $('visit-error').textContent = 'Enter the child\'s name to start the visit.'; return }
  $('visit-error').textContent = ''
  saveVisit({ id: Date.now().toString(36), child, startedAt: new Date().toISOString() })
  $('child-name').value = ''
  for (const id of ['rec-name', 'audio-name', 'photo-name', 'notes-name']) delete $(id).dataset.touched
  renderVisit()
  toast(`Visit started for ${child}`, 'visit')
}
$('visit-start-btn').addEventListener('click', () => startVisit($('child-name').value))
$('child-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') startVisit($('child-name').value) })
$('child-name').addEventListener('input', () => renderVisit())

$('visit-rename').addEventListener('click', () => {
  const box = $('visit-child')
  if (box.querySelector('input')) return
  box.innerHTML = '<input class="input" id="rename-input" aria-label="Child name" autocomplete="off" list="children">'
  const inp = $('rename-input')
  inp.value = state.visit.child
  inp.focus()
  inp.select()
  let finished = false
  const done = async (save) => {
    if (finished) return
    finished = true
    const v = inp.value.replace(/\s+/g, ' ').trim()
    const old = state.visit.child
    if (save && v && v !== old) {
      saveVisit({ ...state.visit, child: v })
      for (const id of ['rec-name', 'audio-name', 'photo-name', 'notes-name']) delete $(id).dataset.touched
      // rename files already in the visit that use the old name
      const oldPrefix = slug(old) + '_'
      let renamed = 0
      for (const d of visitItems()) {
        if (!d.name.startsWith(oldPrefix)) continue
        try {
          Object.assign(d, await api('/api/drafts/' + d.id, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: slug(v) + '_' + d.name.slice(oldPrefix.length), child: v }) }))
          renamed++
        } catch {}
      }
      toast(renamed ? `Renamed ${renamed} ${renamed === 1 ? 'file' : 'files'} to ${slug(v)}_…` : `Files will be named ${slug(v)}_…`, 'pencil')
    }
    box.textContent = state.visit.child
    renderVisit()
  }
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false) })
  inp.addEventListener('blur', () => done(true))
})

$('visit-finish').addEventListener('click', async () => {
  const n = visitItems().length
  const child = state.visit.child
  $('finish-error').textContent = ''
  if (n && !state.status?.paired) { $('finish-error').textContent = 'Pair with the office PC first (Connection tab).'; return }
  const btn = $('visit-finish')
  btn.disabled = true
  try {
    if (n) {
      $('visit-finish-label').textContent = `Sending ${n} ${n === 1 ? 'file' : 'files'}…`
      const r = await api(`/api/visits/${encodeURIComponent(state.visit.id)}/finish`, { method: 'POST' })
      state.outbox = [...r.sent.reverse(), ...state.outbox]
    }
    saveVisit(null)
    state.drafts = []
    renderVisit()
    const online = state.status?.connected
    if (!n) toast(`Visit for ${child} finished`, 'check-circle')
    else toast(online ? `Visit finished · ${n} ${n === 1 ? 'file' : 'files'} sent to the office` : `Visit finished · ${n} ${n === 1 ? 'file' : 'files'} queued until the office is online`, online ? 'send' : 'clock')
    if (n) location.hash = '#outbox'
  } catch (err) {
    $('finish-error').textContent = err.message
    renderVisit()
  } finally {
    btn.disabled = !!state.recording
  }
})

// ---------- record (MediaRecorder -> 16 kHz mono WAV) ----------

function updateRecButton () {
  if (state.recording) return
  const ok = $('consent').checked && !state.wav
  $('rec-btn').disabled = !ok
  $('rec-hint').textContent = state.wav ? 'Add or discard this recording to record another.' : $('consent').checked ? 'Press the button to start recording.' : 'Tick the consent box to start.'
}
$('consent').addEventListener('change', updateRecButton)
$('rec-btn').addEventListener('click', () => state.recording ? stopRecording() : startRecording())

async function startRecording () {
  $('rec-error').textContent = ''
  if (!$('consent').checked) return
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { $('rec-error').textContent = 'This browser cannot record audio. Use Edge or Chrome.'; return }
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
    $('rec-icon').innerHTML = '<use href="#i-stop"/>'
    $('rec-label').textContent = 'Stop'
    $('rec-hint').textContent = 'Recording… you can switch screens, it keeps going.'
    $('consent').disabled = true
    $('rec-banner').hidden = false
  } catch (err) {
    $('rec-error').textContent = err.name === 'NotAllowedError' ? 'Microphone permission was refused. Allow it in the address bar and try again.' : 'Could not start the microphone: ' + err.message
  }
}

function tick (started) {
  const t = fmtDur((Date.now() - started) / 1000)
  $('rec-timer').textContent = t
  $('rec-banner-time').textContent = t
}

function stopRecording () {
  const r = state.recording
  if (!r) return
  clearInterval(r.timer)
  r.rec.stop()
  state.recording = null
  $('rec-banner').hidden = true
  $('rec-btn').classList.remove('recording')
  $('rec-btn').setAttribute('aria-label', 'Start recording')
  $('rec-icon').innerHTML = '<use href="#i-mic"/>'
  $('rec-label').textContent = 'Record'
  $('rec-btn').disabled = true
  $('rec-hint').textContent = 'Preparing the recording…'
}

async function finishRecording (stream, blob) {
  stream.getTracks().forEach(t => t.stop())
  try {
    const wav = await toWav16kMono(blob)
    state.wav = wav
    $('rec-audio').src = URL.createObjectURL(wav)
    $('rec-info').textContent = `${$('rec-timer').textContent} · 16 kHz mono WAV · ${size(wav.size)}`
    setName('rec-name', 'recording')
    $('rec-review').hidden = false
    updateRecButton()
    if (current !== 'record') toast('Recording stopped. Open Record audio to add it to the visit.', 'mic')
  } catch (err) {
    $('rec-error').textContent = 'Could not convert the recording: ' + err.message
    resetRecorder()
  }
}

// Decode whatever the browser produced (webm/opus, m4a, ogg, mp3…), downmix + resample to 16 kHz mono, PCM16 WAV.
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

function resetRecorder () {
  if ($('rec-audio').src) URL.revokeObjectURL($('rec-audio').src)
  $('rec-audio').removeAttribute('src')
  $('rec-review').hidden = true
  state.wav = null
  $('consent').disabled = false
  $('consent').checked = false // consent is confirmed again for every recording
  $('rec-timer').textContent = '00:00'
  delete $('rec-name').dataset.touched
  updateRecButton()
}

$('rec-send').addEventListener('click', async () => {
  if (!state.wav) return
  $('rec-error').textContent = ''
  $('rec-send').disabled = true
  try {
    const name = readName('rec-name') + '.wav'
    await upload(state.wav, name, 'recording')
    resetRecorder()
    afterSend(1, name)
  } catch (err) { $('rec-error').textContent = err.message } finally { $('rec-send').disabled = false }
})
$('rec-discard').addEventListener('click', resetRecorder)

// ---------- upload audio file ----------

$('audio-pick').addEventListener('click', () => $('audio-file').click())
$('audio-file').addEventListener('change', (e) => {
  const f = e.target.files[0]
  e.target.value = ''
  if (!f) return
  if (state.audio?.url) URL.revokeObjectURL(state.audio.url)
  const isWav = /\.wav$/i.test(f.name) || /wav/.test(f.type)
  state.audio = { file: f, isWav, url: URL.createObjectURL(f), origBase: cleanBase(f.name.replace(/\.[^.]+$/, '')) }
  $('audio-player').src = state.audio.url
  $('audio-orig').textContent = f.name
  $('audio-info').textContent = `${size(f.size)} · ${isWav ? 'WAV, sent unchanged' : 'will be converted to 16 kHz WAV'}`
  $('audio-player').onloadedmetadata = () => { if (isFinite($('audio-player').duration)) $('audio-info').textContent = `${fmtDur($('audio-player').duration)} · ` + $('audio-info').textContent }
  $('audio-consent').checked = false
  setName('audio-name', 'audio')
  $('audio-review').hidden = false
  $('audio-error').textContent = ''
})
$('audio-keep').addEventListener('click', () => {
  if (!state.audio) return
  $('audio-name').value = state.audio.origBase
  $('audio-name').dataset.touched = '1'
})
function resetAudio () {
  if (state.audio?.url) URL.revokeObjectURL(state.audio.url)
  state.audio = null
  $('audio-player').removeAttribute('src')
  $('audio-review').hidden = true
  delete $('audio-name').dataset.touched
}
$('audio-discard').addEventListener('click', resetAudio)
$('audio-send').addEventListener('click', async () => {
  if (!state.audio) return
  $('audio-error').textContent = ''
  if (!$('audio-consent').checked) { $('audio-error').textContent = 'Confirm the parent agreed to this recording.'; return }
  const btn = $('audio-send')
  btn.disabled = true
  try {
    const name = readName('audio-name') + '.wav'
    let blob = state.audio.file
    if (!state.audio.isWav) {
      btn.lastChild.textContent = 'Converting…'
      blob = await toWav16kMono(blob)
    }
    btn.lastChild.textContent = 'Adding…'
    await upload(blob, name, 'audio')
    resetAudio()
    afterSend(1, name)
  } catch (err) {
    $('audio-error').textContent = /decode/i.test(err.message) ? 'This audio format could not be read. Try WAV, M4A, MP3 or OGG.' : err.message
  } finally {
    btn.disabled = false
    btn.lastChild.textContent = 'Add to visit'
  }
})

// ---------- photos (multi-page) ----------

$('photo-pick').addEventListener('click', () => $('photo-file').click())
$('photo-file').addEventListener('change', (e) => {
  for (const f of e.target.files) addPhoto(f)
  e.target.value = ''
})

function addPhoto (blob) {
  state.photos.push({ blob, url: URL.createObjectURL(blob), ext: /png/.test(blob.type) ? '.png' : /webp/.test(blob.type) ? '.webp' : '.jpg' })
  if (state.photos.length === 1) setName('photo-name', 'notes-photo')
  renderPhotos()
}

function renderPhotos () {
  const n = state.photos.length
  $('photo-review').hidden = !n
  $('photo-count').textContent = n || ''
  $('photo-grid').innerHTML = state.photos.map((p, i) => `<div class="thumb"><img src="${p.url}" alt="Page ${i + 1}"><span class="pg">${n > 1 ? 'p' + (i + 1) : 'Page'}</span><button data-i="${i}" aria-label="Remove page ${i + 1}">${icon('x')}</button></div>`).join('')
  $('photo-ext').textContent = state.photos[0]?.ext || '.jpg'
  updatePhotoNames()
  $('photo-send-label').textContent = n > 1 ? `Add ${n} pages to visit` : 'Add to visit'
}
function updatePhotoNames () {
  const n = state.photos.length
  const base = cleanBase($('photo-name').value) || '…'
  $('photo-names').innerHTML = n > 1
    ? 'Saved as ' + state.photos.map((p, i) => `<code>${esc(base)}_p${i + 1}${p.ext}</code>`).join(' ')
    : ''
}
$('photo-name').addEventListener('input', updatePhotoNames)

$('photo-grid').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-i]')
  if (!b) return
  const [p] = state.photos.splice(Number(b.dataset.i), 1)
  URL.revokeObjectURL(p.url)
  renderPhotos()
})

function clearPhotos () {
  for (const p of state.photos) URL.revokeObjectURL(p.url)
  state.photos = []
  delete $('photo-name').dataset.touched
  renderPhotos()
}
$('photo-discard').addEventListener('click', clearPhotos)

let camStream = null
$('cam-btn').addEventListener('click', async () => {
  $('photo-error').textContent = ''
  try {
    camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } } })
    $('cam-video').srcObject = camStream
    $('cam').hidden = false
  } catch (err) {
    $('photo-error').textContent = 'Could not open the camera: ' + err.message
  }
})
function closeCamera () {
  if (camStream) camStream.getTracks().forEach(t => t.stop())
  camStream = null
  $('cam').hidden = true
}
$('cam-close').addEventListener('click', closeCamera)
$('cam-snap').addEventListener('click', () => {
  const v = $('cam-video')
  if (!v.videoWidth) return
  const c = document.createElement('canvas')
  c.width = v.videoWidth
  c.height = v.videoHeight
  c.getContext('2d').drawImage(v, 0, 0)
  c.toBlob(b => { addPhoto(b); toast(`Page ${state.photos.length} captured`, 'camera') }, 'image/jpeg', 0.92)
})

$('photo-send').addEventListener('click', async () => {
  if (!state.photos.length) return
  $('photo-error').textContent = ''
  $('photo-send').disabled = true
  try {
    const base = readName('photo-name')
    const n = state.photos.length
    for (let i = 0; i < n; i++) {
      const p = state.photos[i]
      await upload(p.blob, `${base}${n > 1 ? '_p' + (i + 1) : ''}${p.ext}`, 'photo')
    }
    closeCamera()
    clearPhotos()
    afterSend(n, n > 1 ? `${n} pages` : 'Photo')
  } catch (err) { $('photo-error').textContent = err.message } finally { $('photo-send').disabled = false }
})

// ---------- typed notes ----------

$('notes-send').addEventListener('click', async () => {
  const text = $('notes-text').value.trim()
  $('notes-error').textContent = ''
  if (!text) { $('notes-error').textContent = 'Type some notes first.'; return }
  $('notes-send').disabled = true
  try {
    const name = readName('notes-name') + '.txt'
    await upload(new Blob([text + '\n'], { type: 'text/plain' }), name, 'notes')
    $('notes-text').value = ''
    delete $('notes-name').dataset.touched
    afterSend(1, name)
  } catch (err) { $('notes-error').textContent = err.message } finally { $('notes-send').disabled = false }
})

// ---------- outbox ----------

function renderOutbox () {
  const items = state.outbox
  const count = (st) => items.filter(i => i.status === st).length
  const parts = [['queued', count('queued')], ['sending', count('sending')], ['delivered', count('delivered')], ['error', count('error')]].filter(([, n]) => n)
  $('outbox-summary').innerHTML = parts.map(([st, n]) => `<span class="chip st-${st}">${icon(STATUS[st][0])}${n} ${STATUS[st][1].toLowerCase()}</span>`).join('')
  $('outbox-list').innerHTML = items.length
    ? items.map(i => itemRow(i, true)).join('')
    : `<li class="empty">${icon('send')}<span>Nothing sent yet. Files go straight to the office PC, peer-to-peer. If the office is offline they wait here and send automatically.</span></li>`
}

// ---------- backup (read-only) ----------

let backupInfo = null
function renderBackup () {
  const b = backupInfo
  if (!b) return
  const synced = $('backup-synced')
  synced.className = 'synced ' + (b.online ? 'live' : 'stale')
  synced.innerHTML = icon(b.online ? 'sync' : 'clock') + (b.lastSynced ? `Last synced ${hhmm(b.lastSynced)}` : 'Not synced yet') + (b.online ? ' · live' : ' · office offline, showing saved copy')
  const nowIso = today()
  const soon = today(new Date(Date.now() + 30 * 864e5))
  let html
  if (b.state === 'unpaired') html = `<li class="empty">${icon('link')}<span>Pair with the office PC to receive the backup.</span></li>`
  else if (b.state === 'waiting') html = `<li class="empty">${icon('sync')}<span>Waiting for the first sync from the office PC…</span></li>`
  else if (b.state === 'encrypted') html = `<li class="empty">${icon('lock')}<span>Encrypted backup: ${b.blocks} blocks stored. This device has no passphrase, so it can't read them.</span></li>`
  else if (b.state === 'error') html = `<li class="empty">${icon('alert')}<span>${esc(b.error)}</span></li>`
  else if (!b.plans.length) html = `<li class="empty">${icon('visit')}<span>No care plans yet.</span></li>`
  else {
    html = b.plans.map(p => {
      const cls = !p.review_due ? 'due-ok' : p.review_due < nowIso ? 'due-overdue' : p.review_due <= soon ? 'due-soon' : 'due-ok'
      const label = cls === 'due-overdue' ? 'Review overdue' : cls === 'due-soon' ? 'Review due soon' : 'Review due'
      return `<li><div class="avatar sm ${avatarClass(p.name)}">${esc(initials(p.name))}</div>
        <div class="grow"><div class="name" style="word-break:normal">${esc(p.name)}</div><div class="sub">Updated ${dateGB(p.last_updated)}</div></div>
        <span class="chip chip-due ${cls}"><small>${label}</small>${dateGB(p.review_due)}</span></li>`
    }).join('')
  }
  $('backup-list').innerHTML = html
}

async function refreshBackup () {
  try {
    backupInfo = await api('/api/backup')
    state.plans = backupInfo.plans || []
    const names = [...new Set(state.plans.map(p => p.name))]
    $('children').innerHTML = names.map(n => `<option value="${esc(n)}">`).join('')
    if (current === 'backup') renderBackup()
  } catch {}
}

// ---------- polling ----------

async function refreshStatus () {
  try { state.status = await api('/api/status') } catch { state.status = null }
  renderPill()
  if (current === 'pair') renderConnection()
}

async function refreshOutbox () {
  try {
    state.outbox = await api('/api/outbox')
    if (current === 'visit') renderVisit()
    if (current === 'outbox') renderOutbox()
  } catch {}
}

let ticks = 0
async function poll () {
  await refreshStatus()
  await refreshOutbox()
  await refreshDrafts()
  if (current === 'backup' || ticks % 5 === 0) await refreshBackup()
  ticks++
}

window.addEventListener('beforeunload', (e) => { if (state.recording) { e.preventDefault(); e.returnValue = '' } })

;(async () => {
  await refreshStatus()
  await refreshOutbox()
  await refreshDrafts()
  await refreshBackup()
  route()
  setInterval(poll, 2000)
})()
