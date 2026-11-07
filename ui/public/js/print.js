// Print view: FOBE's own care plan form on A4, for the secure folder.
import { api, esc, fmtDate } from './util.js'
import { docSheetHtml } from './docsheet.js'

export async function renderPrint (main, childId) {
  const { plan, meta } = await api(`/api/plans/${encodeURIComponent(childId)}`)
  const version = fmtDate((plan.saved_at || '').slice(0, 10)) || fmtDate(plan.last_updated?.value)
  const footer = `FOBE – confidential – do not remove from folder – version ${version}`

  main.innerHTML = `
    <div class="actions no-print">
      <a class="btn" href="#/child/${encodeURIComponent(childId)}">← Back to plan</a>
      <button class="btn primary" id="print">Print</button>
      ${plan.approved_at ? '' : '<span class="badge amber">Not signed off – prints marked DRAFT</span>'}
    </div>
    <article class="sheet" aria-label="Printable care plan">
      <!-- The empty tfoot repeats on every printed page, reserving room for the fixed footer. -->
      <table class="print-wrap"><tbody><tr><td>
        ${docSheetHtml(plan, meta, { interactive: false, padRows: 4 })}
      </td></tr></tbody><tfoot><tr><td><div class="print-spacer"></div></td></tr></tfoot></table>
      <div class="foot">${esc(footer)}</div>
    </article>
    <div class="print-foot">${esc(footer)}</div>
  `
  main.querySelector('#print').addEventListener('click', () => window.print())
}
