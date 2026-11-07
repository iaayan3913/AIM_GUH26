// Version history per child (append-only: every save is kept).
import { api, esc, fmtDateTime, fullName, ageFromDobClient } from './util.js'
import { allFields, getPath, renderPlan } from './planform.js'

const name = (p) => fullName({ first_name: p.first_name?.value, surname: p.surname?.value })

// Which fields differ between two versions (by label).
function changes (newer, older) {
  if (!older) return ['First version']
  const out = allFields()
    .filter(([path]) => {
      const a = getPath(newer, path)
      const b = getPath(older, path)
      return JSON.stringify([a?.value ?? null, a?.status]) !== JSON.stringify([b?.value ?? null, b?.status])
    })
    .map(([, label]) => label)
  if (newer.approved_at && newer.approved_at !== older.approved_at) out.unshift('Signed off')
  return out.length ? out : ['No field changes']
}

export async function renderHistory (main, childId) {
  const versions = await api(`/api/plans/${encodeURIComponent(childId)}/history`) // newest first
  const id = encodeURIComponent(childId)
  main.innerHTML = `
    <p><a href="#/child/${id}">← Back to the current plan</a></p>
    <h1>Version history: ${esc(versions[0] ? name(versions[0]) : childId)}</h1>
    <p class="muted">${versions.length} version${versions.length === 1 ? '' : 's'}. Every save is kept; nothing is ever overwritten.</p>
    ${versions.map((v, i) => `
      <section class="panel">
        <div class="history-item">
          <div>
            <h2 style="margin:0">${esc(fmtDateTime(v.saved_at))} ${i === 0 ? '<span class="badge ok">Current</span>' : ''}</h2>
            <p style="margin:4px 0">${v.approved_at
              ? `<span class="badge ok">Signed off</span> by ${esc(v.approved_by)} on ${esc(fmtDateTime(v.approved_at))}`
              : '<span class="badge amber">Draft</span>'}</p>
            <p class="muted" style="margin:0">Changed: ${changes(v, versions[i + 1]).map(esc).join(', ')}</p>
          </div>
          <a class="btn" href="#/child/${id}/version/${encodeURIComponent(v.saved_at)}">View</a>
        </div>
      </section>`).join('')}`
}

export async function renderVersion (main, childId, savedAt) {
  const versions = await api(`/api/plans/${encodeURIComponent(childId)}/history`)
  const v = versions.find((x) => x.saved_at === savedAt)
  if (!v) throw new Error('That version was not found')
  const id = encodeURIComponent(childId)
  main.innerHTML = `
    <p><a href="#/child/${id}/history">← Back to version history</a></p>
    <h1>${esc(name(v))}</h1>
    <div class="notice amber"><strong>Old version (read-only)</strong> saved ${esc(fmtDateTime(v.saved_at))}.
      ${v.approved_at ? `Signed off by ${esc(v.approved_by)}.` : 'Not signed off.'}
      ${versions[0].saved_at === v.saved_at ? 'This is the current version.' : ''}</div>
    <div id="plan"></div>`
  renderPlan(main.querySelector('#plan'), v, { mode: 'view', age: ageFromDobClient(v.dob?.value) })
}
