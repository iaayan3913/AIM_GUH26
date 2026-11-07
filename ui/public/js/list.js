// Child list: name, computed age, last updated, review-due badge.
import { api, esc, fmtDate, reviewBadge, fullName } from './util.js'

export async function renderList (main) {
  const children = await api('/api/children')
  const urgent = children.filter((c) => c.review_status === 'overdue' || c.review_status === 'soon')

  main.innerHTML = `
    <div class="list-head">
      <div>
        <h1>Children</h1>
        <p class="muted">${children.length} care plan${children.length === 1 ? '' : 's'} on this PC.</p>
      </div>
      <div class="actions" style="margin:0">
        <input id="q" class="search" type="search" placeholder="Search by name" aria-label="Search by name">
        <a class="btn primary" href="#/visit">+ New visit</a>
      </div>
    </div>
    ${urgent.length ? `<div class="notice amber"><strong>${urgent.length} annual review${urgent.length === 1 ? '' : 's'} due soon or overdue:</strong> ${urgent.map((c) => esc(c.first_name)).join(', ')}</div>` : ''}
    <table class="children">
      <thead><tr><th>Name</th><th>Age</th><th>Last updated</th><th>Annual review</th><th>Plan</th></tr></thead>
      <tbody>
        ${children.map((c) => `
          <tr data-id="${esc(c.child_id)}" data-name="${esc(fullName(c).toLowerCase())}">
            <td class="name"><a href="#/child/${encodeURIComponent(c.child_id)}">${esc(fullName(c))}</a><span class="id">${esc(c.child_id)}</span></td>
            <td>${c.age ?? '<span class="badge amber">DOB missing</span>'}</td>
            <td>${esc(fmtDate(c.last_updated)) || '—'}</td>
            <td>${reviewBadge(c)}</td>
            <td>${planBadge(c)}</td>
          </tr>`).join('')}
      </tbody>
    </table>
    ${children.length ? '' : '<p class="loading">No care plans yet. Run <code>npm run seed</code> in /sync, or start a new visit.</p>'}
  `

  main.querySelectorAll('tbody tr').forEach((tr) => {
    tr.addEventListener('click', (e) => {
      if (e.target.closest('a')) return
      location.hash = `#/child/${encodeURIComponent(tr.dataset.id)}`
    })
  })
  const q = main.querySelector('#q')
  q.addEventListener('input', () => {
    const s = q.value.trim().toLowerCase()
    main.querySelectorAll('tbody tr').forEach((tr) => { tr.hidden = s && !tr.dataset.name.includes(s) })
  })
}

function planBadge (c) {
  const n = c.flags.missing + c.flags.needs_review
  const signed = c.approved_at ? '<span class="badge ok">Signed off</span>' : '<span class="badge amber">Draft</span>'
  return n ? `${signed} <span class="badge amber">${n} to check</span>` : signed
}
