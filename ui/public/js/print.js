// Print view: clean A4 for the secure folder.
import { api, esc, fmtDate, fmtDateTime, fullName, initials } from './util.js'
import { SECTIONS, getPath, isList, valueHtml } from './planform.js'

const NR = '<span class="nr">Not recorded</span>'
// Medication stays inside the header table; the other lists get their own block.
const ownBlock = (p, t) => isList(t) && p !== 'medication'

export async function renderPrint (main, childId) {
  const { plan, meta } = await api(`/api/plans/${encodeURIComponent(childId)}`)
  const names = { first_name: plan.first_name?.value, surname: plan.surname?.value }
  const version = fmtDate((plan.saved_at || '').slice(0, 10)) || fmtDate(plan.last_updated?.value)
  const footer = `FOBE – confidential – do not remove from folder – version ${version}`

  const cell = (path, type) => {
    if (path === '@age') return meta.age != null ? String(meta.age) : NR
    return valueHtml(type, getPath(plan, path)?.value) ?? NR
  }

  const sectionHtml = (s) => {
    // Name is in the page title, so skip it in the table.
    const simple = s.fields.filter(([p, , t]) => !ownBlock(p, t) && p !== 'first_name' && p !== 'surname')
    const lists = s.fields.filter(([p, , t]) => ownBlock(p, t))
    return `<h2>${esc(s.title)}</h2>
      ${simple.length ? `<table>${simple.map(([p, label, t]) => `<tr><th>${esc(label)}</th><td>${cell(p, t)}</td></tr>`).join('')}</table>` : ''}
      ${lists.map(([p, label, t]) => `${s.fields.length > 1 ? `<h3 style="font-size:11pt;margin:8pt 0 3pt">${esc(label)}</h3>` : ''}${cell(p, t)}`).join('')}`
  }

  main.innerHTML = `
    <div class="actions no-print">
      <a class="btn" href="#/child/${encodeURIComponent(childId)}">← Back to plan</a>
      <button class="btn primary" id="print">Print</button>
      ${plan.approved_at ? '' : '<span class="badge amber">Not signed off – prints marked DRAFT</span>'}
    </div>
    <article class="sheet" aria-label="Printable care plan">
      <div class="head">
        <div class="photo" aria-hidden="true">${esc(initials(names))}</div>
        <div>
          <div style="font-size:9pt;letter-spacing:.06em">FRIENDS OF BRIGHT EYES (FOBE) · CARE PLAN</div>
          <h1>${esc(fullName(names))}</h1>
          <div>Child ID: ${esc(plan.child_id)}</div>
          <div>${plan.approved_at
            ? `Signed off by ${esc(plan.approved_by)} on ${esc(fmtDateTime(plan.approved_at))}`
            : '<span class="draft">DRAFT – NOT SIGNED OFF</span>'}</div>
        </div>
      </div>
      ${SECTIONS.map(sectionHtml).join('')}
      <div class="foot">${esc(footer)}</div>
    </article>
    <div class="print-foot">${esc(footer)}</div>
  `
  main.querySelector('#print').addEventListener('click', () => window.print())
}
