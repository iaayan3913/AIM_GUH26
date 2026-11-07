// New visit: recording / photo of notes / typed notes -> progress -> review.
import { api, esc, fullName, toast, auth } from './util.js'
import { renderPlan, collectPlan, flagSummary, wireJumps } from './planform.js'

export async function renderVisit (main, childId = '', prefill = {}) {
  const children = await api('/api/children')
  main.innerHTML = `
    <h1>New visit</h1>
    <p class="muted">Add the recording, a photo of your notes, typed notes, or any mix. Everything is processed on this PC. Nothing is saved until you review it.</p>
    <form id="visit" class="panel">
      <div class="form-row">
        <label for="child">Which child?</label>
        <select id="child" name="childId" class="input">
          <option value="new">New child (create a new care plan)</option>
          ${children.map((c) => `<option value="${esc(c.child_id)}" ${c.child_id === childId ? 'selected' : ''}>${esc(fullName(c))} (${esc(c.child_id)})</option>`).join('')}
        </select>
      </div>
      <div class="form-row">
        <label for="audio">Recording of the visit</label>
        <span class="hint">Audio file, e.g. .wav, .mp3 or .m4a. English, Urdu, Bengali and Hindi are understood.</span>
        ${prefill.audioPath ? `<p class="notice">Using <strong>${esc(prefill.audioName)}</strong> from the work phone.</p>` : '<input id="audio" name="audio" type="file" accept="audio/*,.wav,.mp3,.m4a,.ogg,.webm">'}
      </div>
      <div class="form-row">
        <label for="photo">Photo of your handwritten notes</label>
        ${prefill.photoPath ? `<p class="notice">Using <strong>${esc(prefill.photoName)}</strong> from the work phone.</p>` : '<input id="photo" name="photo" type="file" accept="image/*">'}
      </div>
      <div class="form-row">
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
  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    if (!(await auth.ensure('start a new visit'))) return
    const fd = new FormData(form)
    if (prefill.audioPath) fd.set('audioPath', prefill.audioPath)
    if (prefill.photoPath) fd.set('photoPath', prefill.photoPath)
    for (const k of ['audio', 'photo']) { const f = fd.get(k); if (f && !f.size) fd.delete(k) }
    if (!fd.get('audio') && !fd.get('photo') && !fd.get('audioPath') && !fd.get('photoPath') && !String(fd.get('notes') || '').trim()) {
      toast('Add a recording, a photo or some typed notes first', 'error')
      return
    }
    form.querySelector('[type=submit]').disabled = true
    try {
      const { jobId } = await api('/api/visits', { method: 'POST', body: fd })
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
  renderPlan(form, plan, { mode: 'review', age: null })

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
