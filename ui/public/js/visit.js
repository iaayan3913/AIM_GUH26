// New visit: recording / photo of notes / typed notes -> progress -> review.
import { api, esc, fullName, toast, auth, routeParams, ageFromDobClient } from './util.js'
import { renderPlan, collectPlan, flagSummary, wireJumps } from './planform.js'

export async function renderVisit (main, childId = '') {
  // Files picked in the work-phone inbox arrive as #/visit?audio=..&photo=..&text=.. (each may repeat)
  const q = routeParams()
  const KINDS = {
    audio: { label: 'Recording', icon: 'mic', field: 'audio', inboxField: 'audioPath', accept: 'audio/*,.wav,.mp3,.m4a,.ogg,.webm,.opus,.aac' },
    photo: { label: 'Photo of notes', icon: 'image', field: 'photo', inboxField: 'photoPath', accept: 'image/*' },
    notes: { label: 'Notes file', icon: 'note', field: 'notesFile', inboxField: 'textPath', accept: '.txt,text/plain' }
  }
  const items = [
    ...q.getAll('audio').map((n) => ({ kind: 'audio', name: n, inbox: true })),
    ...q.getAll('photo').map((n) => ({ kind: 'photo', name: n, inbox: true })),
    ...q.getAll('text').map((n) => ({ kind: 'notes', name: n, inbox: true }))
  ]
  const children = await api('/api/children')
  const ic = (id) => `<svg class="ic" aria-hidden="true"><use href="#i-${id}"/></svg>`
  const size = (b) => (b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`)

  main.innerHTML = `
    <h1>New visit</h1>
    <p class="muted">Add as many recordings, photos of your notes and notes files as you need, plus anything you want to type. Everything is processed on this PC. Nothing is saved until you review it.</p>
    <form id="visit" class="panel">
      <div class="form-row">
        <label for="child">Which child?</label>
        <select id="child" name="childId" class="input">
          <option value="new">New child (create a new care plan)</option>
          ${children.map((c) => `<option value="${esc(c.child_id)}" ${c.child_id === childId ? 'selected' : ''}>${esc(fullName(c))} (${esc(c.child_id)})</option>`).join('')}
        </select>
      </div>

      <div class="label">Add to this visit</div>
      <div class="vtiles">
        <button type="button" class="vtile t-pink" data-pick="audio"><span class="vtile-ic">${ic('mic')}</span><span><strong>Add recordings</strong><small>WAV, MP3, M4A, OGG · English, Urdu, Bengali, Hindi</small></span></button>
        <button type="button" class="vtile t-green" data-pick="photo"><span class="vtile-ic">${ic('image')}</span><span><strong>Add photos of notes</strong><small>JPG or PNG · one per page</small></span></button>
        <button type="button" class="vtile t-blue" data-pick="notes"><span class="vtile-ic">${ic('note')}</span><span><strong>Add notes files</strong><small>.txt, e.g. typed on the work phone</small></span></button>
      </div>
      ${Object.entries(KINDS).map(([k, v]) => `<input type="file" data-input="${k}" accept="${v.accept}" multiple hidden>`).join('')}

      <div class="vlist-head"><span class="label" style="margin:0">In this visit</span><span id="vcount" class="vcount"></span></div>
      <ul id="vfiles" class="vlist"></ul>

      <div class="form-row" style="margin-top:20px">
        <label for="notes">Typed notes</label>
        <textarea id="notes" name="notes" class="input" rows="6" placeholder="Anything you wrote down or want to add"></textarea>
      </div>
      <div class="actions">
        <button class="btn primary" type="submit">Create draft care plan</button>
        <a class="btn" href="#/">Cancel</a>
      </div>
    </form>
    <section id="progress" class="panel" hidden aria-live="polite">
      <h2>Working on the draft…</h2>
      <div class="progress-wrap">
        <progress id="bar" max="100" value="0" aria-labelledby="stage"></progress>
        <div class="stage" id="stage">Starting</div>
        <p class="muted">This runs on this PC, so it can take a minute. You can keep this page open.</p>
      </div>
    </section>
  `

  const form = main.querySelector('#visit')
  const list = main.querySelector('#vfiles')
  const draw = () => {
    main.querySelector('#vcount').textContent = items.length ? `${items.length} file${items.length === 1 ? '' : 's'}` : ''
    list.innerHTML = items.length
      ? items.map((it, i) => `<li>
          <span class="kind-ic kind-${it.kind === 'notes' ? 'text' : it.kind}">${ic(KINDS[it.kind].icon)}</span>
          <span class="vname"><strong>${esc(it.name)}</strong><small>${KINDS[it.kind].label}${it.file ? ` · ${size(it.file.size)}` : ''}${it.inbox ? ' · from the work phone' : ''}</small></span>
          <button type="button" class="btn small" data-remove="${i}" aria-label="Remove ${esc(it.name)}">${ic('x')}Remove</button>
        </li>`).join('')
      : '<li class="vempty">Nothing added yet. Use the buttons above: you can add several of each, and keep adding until you create the draft.</li>'
  }
  draw()

  main.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', () => main.querySelector(`[data-input="${b.dataset.pick}"]`).click()))
  main.querySelectorAll('[data-input]').forEach((input) => input.addEventListener('change', () => {
    for (const file of input.files) {
      if (items.some((it) => it.file && it.file.name === file.name && it.file.size === file.size)) continue
      items.push({ kind: input.dataset.input, name: file.name, file })
    }
    input.value = ''
    draw()
  }))
  list.addEventListener('click', (e) => {
    const b = e.target.closest('[data-remove]')
    if (!b) return
    items.splice(Number(b.dataset.remove), 1)
    draw()
  })

  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    if (!(await auth.ensure('start a new visit'))) return
    const notes = String(main.querySelector('#notes').value || '').trim()
    if (!items.length && !notes) {
      toast('Add a recording, a photo or some notes first', 'error')
      return
    }
    const fd = new FormData()
    fd.set('childId', main.querySelector('#child').value)
    fd.set('notes', notes)
    for (const it of items) {
      if (it.inbox) fd.append(KINDS[it.kind].inboxField, it.name)
      else fd.append(KINDS[it.kind].field, it.file, it.file.name)
    }
    const fromPhone = items.filter((it) => it.inbox).map((it) => it.name)
    form.querySelector('[type=submit]').disabled = true
    try {
      const { jobId, childId: cid } = await api('/api/visits', { method: 'POST', body: fd })
      if (fromPhone.length) api('/api/inbox/used', { method: 'POST', body: { names: fromPhone, childId: cid } }).catch(() => {})
      form.hidden = true
      main.querySelector('#progress').hidden = false
      await poll(main, jobId)
    } catch (err) {
      toast(err.message, 'error')
      form.querySelector('[type=submit]').disabled = false
    }
  })
}

async function poll (main, jobId) {
  const bar = main.querySelector('#bar')
  const stage = main.querySelector('#stage')
  for (;;) {
    if (!document.body.contains(bar)) return // user navigated away
    const job = await api(`/api/jobs/${jobId}`)
    bar.value = job.percent
    stage.textContent = `${job.stage}${job.detail ? ` – ${job.detail}` : ''} (${job.percent}%)`
    if (job.status === 'done') { location.hash = `#/review/${jobId}`; return }
    if (job.status === 'error') {
      stage.innerHTML = `<span class="notice red" style="display:block">The draft could not be made: ${esc(job.error)}</span>`
      return
    }
    await new Promise((r) => setTimeout(r, 500))
  }
}

export async function renderReview (main, jobId) {
  const job = await api(`/api/jobs/${jobId}`)
  if (job.status !== 'done') { location.hash = '#/visit'; return }
  const { plan, transcript, notes, existed, warnings = [], seconds } = job.result
  const name = [plan.first_name?.value, plan.surname?.value].filter(Boolean).join(' ') || 'New child'

  main.innerHTML = `
    <h1>Review draft: ${esc(name)}</h1>
    <div class="notice">This is an AI draft. <strong>Nothing is saved yet.</strong> Amber fields were not clearly said, so the AI left them for you. It never guesses medication, allergies or diagnosis.${seconds != null ? ` <span class="muted">Drafted on this PC in ${seconds} s.</span>` : ''}</div>
    ${job.result.ai === 'mock' ? '<div class="notice red"><strong>Test AI (mock) is running on this PC.</strong> It does not listen to recordings or read photos: it only knows the demo files. Real drafts need the QVAC AI (office PC).</div>' : ''}
    ${warnings.map((w) => `<div class="notice amber">${esc(w)}</div>`).join('')}
    <div id="flags">${flagSummary(plan)}</div>
    <div class="review-layout">
      <aside>
        ${transcript ? `
          <section class="panel">
            <h2>Recording (English)</h2>
            <p class="muted">Language detected: ${esc(transcript.language || 'unknown')}</p>
            <div class="transcript">${(transcript.segments?.length ? transcript.segments : [{ english: transcript.english, text: transcript.original }]).map((s) => `
              <div class="seg">${s.start != null ? `<span class="t">${fmtT(s.start)}</span> ` : ''}${esc(s.english || s.text)}
              ${s.text && s.english && s.text !== s.english ? `<div class="orig" dir="auto">${esc(s.text)}</div>` : ''}</div>`).join('')}
            </div>
          </section>` : ''}
        ${notes ? `<section class="panel"><h2>Notes</h2><div class="transcript" style="white-space:pre-wrap">${esc(notes)}</div></section>` : ''}
      </aside>
      <form id="plan" autocomplete="off" onsubmit="return false"></form>
    </div>
    <div class="savebar">
      <span>${existed ? 'Saving adds a new version to this child\'s history.' : 'Saving creates a new care plan.'}</span>
      <button class="btn primary" id="save">Save draft</button>
      ${auth.signOff ? '<button class="btn primary" id="saveSign">Save and sign off</button>' : ''}
      <a class="btn" href="#/">Discard</a>
    </div>
  `
  wireJumps(main.querySelector('#flags'))
  const form = main.querySelector('#plan')
  renderPlan(form, plan, { mode: 'review', age: ageFromDobClient(plan.dob?.value) })

  const save = async (andSign) => {
    if (!(await auth.ensure('save this plan'))) return
    const updated = collectPlan(form, plan, auth.user?.name)
    await api(`/api/plans/${encodeURIComponent(plan.child_id)}`, { method: 'PUT', body: { plan: updated } })
    toast('Care plan saved')
    location.hash = `#/child/${encodeURIComponent(plan.child_id)}`
    if (andSign) setTimeout(() => auth.signOff(plan.child_id, () => window.dispatchEvent(new HashChangeEvent('hashchange'))), 300)
  }
  main.querySelector('#save').addEventListener('click', () => save(false).catch((e) => toast(e.message, 'error')))
  main.querySelector('#saveSign')?.addEventListener('click', () => save(true).catch((e) => toast(e.message, 'error')))
}

const fmtT = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
