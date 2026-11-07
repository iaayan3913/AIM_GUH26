// Care plan screen: view, edit (every field), save as a new version.
import { api, esc, fmtDate, fmtDateTime, reviewBadge, fullName, initials, toast, auth } from './util.js'
import { renderPlan, collectPlan, flagSummary, wireJumps, wireSources } from './planform.js'
import { docSheetHtml } from './docsheet.js'

const v = (f) => f?.value ?? null

export async function renderPlanPage (main, childId, { edit = false } = {}) {
  const { plan, meta } = await api(`/api/plans/${encodeURIComponent(childId)}`)
  const names = { first_name: v(plan.first_name), surname: v(plan.surname) }
  const id = encodeURIComponent(childId)

  main.innerHTML = `
    <p class="no-print"><a href="#/">← All children</a></p>
    <div class="plan-top">
      <div class="plan-title">
        <h1>${esc(fullName(names))}</h1>
        <p class="sub">${meta.age != null ? `Age ${meta.age}` : 'Age unknown'} · ${esc(childId)} · Version saved ${esc(fmtDateTime(plan.saved_at))}</p>
        <p>${reviewBadge(meta)}</p>
        ${signoffNotice(plan)}
      </div>
    </div>
    <div class="actions" id="actions">
      <button class="btn primary" id="edit">Edit plan</button>
      ${signoffButton(plan)}
      <a class="btn" href="#/child/${id}/print">Print preview</a>
      <a class="btn" href="#/visit/${id}">New visit for ${esc(names.first_name || 'this child')}</a>
      <a class="btn" href="#/child/${id}/history">Version history</a>
      <a class="btn" href="#/child/${id}/lanyard">Lanyard tag</a>
    </div>
    <div id="flags">${flagSummary(plan)}</div>
    <form id="plan" autocomplete="off" onsubmit="return false"></form>
    <div class="savebar" id="savebar" hidden>
      <span><strong>Editing.</strong> Saving keeps the old version in the history.</span>
      <button class="btn primary" id="save">Save new version</button>
      <button class="btn" id="cancel">Cancel</button>
    </div>
  `
  wireJumps(main.querySelector('#flags'))
  const form = main.querySelector('#plan')
  const bar = main.querySelector('#savebar')
  const actions = main.querySelector('#actions')

  const setMode = (editing) => {
    if (editing) {
      renderPlan(form, plan, { mode: 'edit', age: meta.age })
    } else {
      // Preview in FOBE's own form layout, with amber flags + source quotes.
      form.classList.remove('edit')
      form.innerHTML = `<div class="plan-doc-wrap">${docSheetHtml(plan, meta, { interactive: true })}</div>`
      wireSources(form)
    }
    bar.hidden = !editing
    actions.hidden = editing
  }
  setMode(edit)

  main.querySelector('#edit').addEventListener('click', async () => {
    if (!(await auth.ensure('edit this plan'))) return
    setMode(true)
    form.querySelector('input, textarea, select')?.focus()
  })
  main.querySelector('#cancel').addEventListener('click', () => setMode(false))
  main.querySelector('#save').addEventListener('click', async (e) => {
    e.target.disabled = true
    try {
      const updated = collectPlan(form, plan, auth.user?.name)
      await api(`/api/plans/${id}`, { method: 'PUT', body: { plan: updated } })
      toast('Saved as a new version')
      await renderPlanPage(main, childId)
    } catch (err) {
      toast(err.message, 'error')
      e.target.disabled = false
    }
  })
  main.querySelector('#signoff')?.addEventListener('click', () => auth.signOff?.(childId, () => renderPlanPage(main, childId)))
}

function signoffNotice (plan) {
  if (plan.approved_at) return `<div class="notice green">Signed off by <strong>${esc(plan.approved_by)}</strong> on ${esc(fmtDateTime(plan.approved_at))}</div>`
  return '<div class="notice amber"><strong>Draft.</strong> Not signed off yet.</div>'
}

function signoffButton (plan) {
  if (plan.approved_at || !auth.signOff) return ''
  return '<button class="btn primary" id="signoff">Sign off with YubiKey</button>'
}

export { fmtDate }
