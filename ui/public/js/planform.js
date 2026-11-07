// Care plan in FOBE's section order. One component for both viewing and editing.
// Every leaf field is { value, source, status }. status "missing" / "needs_review" = amber.
import { esc, fmtDate } from './util.js'

export const SECTIONS = [
  {
    title: 'Personal details',
    fields: [
      ['first_name', 'First name', 'text'],
      ['surname', 'Surname', 'text'],
      ['last_updated', 'Last updated', 'date'],
      ['@age', 'Age', 'computed'],
      ['photo_consent', 'Photo consent', 'consent'],
      ['dob', 'Date of birth', 'date'],
      ['gender', 'Gender', 'text'],
      ['ethnicity', 'Ethnicity', 'text'],
      ['diagnosis', 'Diagnosis', 'long'],
      ['medication', 'Medication', 'meds'],
      ['allergies', 'Allergies', 'long'],
      ['emergency_contact', 'Emergency contact', 'text']
    ]
  },
  {
    title: 'About me',
    fields: [
      ['about_me.hobbies_interests', 'Hobbies and interests', 'long'],
      ['about_me.watch_out', 'Watch out for', 'long']
    ]
  },
  {
    title: 'Attributes',
    fields: [
      ['attributes.physical_mobility', 'Physical / mobility', 'long'],
      ['attributes.communication_learning', 'Communication / learning', 'long'],
      ['attributes.emotional_social', 'Emotional and social', 'long'],
      ['attributes.toileting_self_care', 'Toileting / self-care', 'long'],
      ['attributes.dietary', 'Dietary', 'long'],
      ['attributes.words_phrases', 'Specific words / phrases', 'words']
    ]
  },
  {
    title: 'Challenging behaviours and control measures',
    fields: [
      ['challenging_behaviours', 'Challenging behaviours', 'behaviours']
    ]
  }
]

export const LIST_COLS = {
  words: [['word_or_sign', 'Word, sign or phrase'], ['meaning', 'What it means']],
  behaviours: [['behaviour', 'Behaviour'], ['triggers', 'Triggers'], ['control_measures', 'Control measures']],
  meds: [['name', 'Medicine'], ['dose', 'Dose'], ['time', 'When / notes']]
}

const EMPTY = () => ({ value: null, source: null, status: 'missing' })
export const getPath = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj)
function setPath (obj, path, v) {
  const keys = path.split('.')
  let o = obj
  for (const k of keys.slice(0, -1)) o = o[k] ??= {}
  o[keys.at(-1)] = v
}

export const isFlagged = (f) => !f || f.status === 'missing' || f.status === 'needs_review'
const isEmpty = (v) => v == null || v === '' || (Array.isArray(v) && v.length === 0)

export function allFields () {
  return SECTIONS.flatMap((s) => s.fields).filter(([p]) => !p.startsWith('@'))
}

export function flaggedFields (plan) {
  return allFields().filter(([p]) => isFlagged(getPath(plan, p))).map(([p, label]) => ({ path: p, label, status: getPath(plan, p)?.status || 'missing' }))
}

export const fid = (path) => 'f-' + path.replace(/\./g, '-')

export function statusBadge (f) {
  if (!f || f.status === 'missing') return '<span class="badge amber">Missing</span>'
  if (f.status === 'needs_review') return '<span class="badge amber">Needs review</span>'
  return ''
}

export function sourceTip (f, label) {
  if (!f?.source) return ''
  return `<span class="src"><button type="button" class="src-btn" aria-label="Where this came from: ${esc(label)}">Source</button><span class="src-tip" role="tooltip">${esc(f.source)}</span></span>`
}

export const isList = (type) => type in LIST_COLS
const ADD_LABEL = { words: 'word or sign', behaviours: 'behaviour', meds: 'medicine' }

// The AI may return a list as strings, or a list field as plain text. Cope with all of them.
export function toRows (type, v) {
  const first = LIST_COLS[type][0][0]
  return v.map((r) => (r && typeof r === 'object' ? r : { [first]: String(r ?? '') }))
}
export const flatText = (v) => Array.isArray(v)
  ? v.map((x) => (x && typeof x === 'object' ? Object.values(x).filter(Boolean).join(' – ') : x)).join('\n')
  : (v && typeof v === 'object' ? Object.values(v).filter(Boolean).join(' – ') : String(v ?? ''))

// Same shape the edit table produces, so "no change" is detected reliably.
const normRows = (type, v) => toRows(type, v)
  .map((r) => Object.fromEntries(LIST_COLS[type].map(([k]) => [k, String(r[k] ?? '').trim()])))
  .filter((r) => Object.values(r).some(Boolean))

export function valueHtml (type, v) {
  if (isEmpty(v)) return null
  if (type === 'date') return esc(fmtDate(v))
  if (isList(type) && Array.isArray(v)) {
    const cols = LIST_COLS[type]
    return `<table class="grid"><thead><tr>${cols.map(([, h]) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
      <tbody>${toRows(type, v).map((row) => `<tr>${cols.map(([k]) => `<td>${esc(row[k])}</td>`).join('')}</tr>`).join('')}</tbody></table>`
  }
  return esc(flatText(v))
}

function inputHtml (path, type, v, label) {
  const id = fid(path) + '-in'
  if (type === 'date') return `<input id="${id}" type="date" data-path="${path}" value="${esc(v || '')}">`
  if (type === 'consent') {
    const opts = ['', 'Yes', 'No']
    if (v && !opts.includes(String(v))) opts.push(String(v))
    return `<select id="${id}" data-path="${path}">${opts.map((o) => `<option value="${esc(o)}" ${String(v ?? '') === o ? 'selected' : ''}>${esc(o) || '— not recorded —'}</option>`).join('')}</select>`
  }
  if (isList(type) && (isEmpty(v) || Array.isArray(v))) {
    const cols = LIST_COLS[type]
    const rows = Array.isArray(v) && v.length ? toRows(type, v) : [{}]
    return `<table class="grid" data-list="${path}" data-type="${type}">
      <thead><tr>${cols.map(([, h]) => `<th>${esc(h)}</th>`).join('')}<th><span class="sr-only">Remove</span></th></tr></thead>
      <tbody>${rows.map((r) => listRow(type, r)).join('')}</tbody></table>
      <div class="row-actions"><button type="button" class="btn small" data-add="${path}">+ Add ${ADD_LABEL[type]}</button></div>`
  }
  if (type === 'text' && (v == null || typeof v !== 'object')) return `<input id="${id}" type="text" data-path="${path}" value="${esc(v ?? '')}" aria-label="${esc(label)}">`
  // long text, or an unexpected shape from the AI -> plain text box
  const text = flatText(v)
  return `<textarea id="${id}" data-path="${path}" rows="${Math.max(2, Math.ceil(text.length / 60))}">${esc(text)}</textarea>`
}

function listRow (type, r = {}) {
  const cols = LIST_COLS[type]
  return `<tr>${cols.map(([k, h]) => `<td><textarea class="input" data-col="${k}" rows="2" aria-label="${esc(h)}">${esc(r?.[k] || '')}</textarea></td>`).join('')}
    <td><button type="button" class="btn small danger" data-remove aria-label="Remove row">Remove</button></td></tr>`
}

// mode: 'view' | 'edit' | 'review'
export function renderPlan (container, plan, { mode = 'view', age = null } = {}) {
  const editing = mode !== 'view'
  container.classList.toggle('edit', editing)
  container.innerHTML = SECTIONS.map((s) => `
    <section class="section" aria-label="${esc(s.title)}">
      <h2>${esc(s.title)}</h2>
      <div class="fields">
        ${s.fields.map(([path, label, type]) => {
          if (type === 'computed') {
            return `<div class="field"><div class="field-label">${esc(label)}</div><div class="field-value">${age ?? '—'} <span class="muted" style="font-size:.85rem">(from date of birth)</span></div></div>`
          }
          const f = getPath(plan, path) || EMPTY()
          const flag = isFlagged(f)
          const wide = isList(type)
          const shown = valueHtml(type, f.value)
          return `<div class="field ${flag ? 'flag' : ''}" id="${fid(path)}" ${wide ? 'style="grid-column:1/-1"' : ''}>
            <div class="field-label"><label for="${fid(path)}-in">${esc(label)}</label> ${statusBadge(f)} ${sourceTip(f, label)}</div>
            ${editing
              ? inputHtml(path, type, f.value, label) + (f.status === 'needs_review' && !isEmpty(f.value) ? `<label class="check"><input type="checkbox" data-confirm="${path}"> I have checked this is correct</label>` : '')
              : (shown !== null ? `<div class="field-value">${shown}</div>` : `<div class="field-value empty">Not recorded${f.status === 'missing' ? ' – ask the family' : ''}</div>`)}
          </div>`
        }).join('')}
      </div>
    </section>`).join('')

  wireSources(container)

  if (editing) {
    // Text boxes grow with their content so nothing is hidden.
    const grow = (t) => { t.style.height = 'auto'; t.style.height = t.scrollHeight + 4 + 'px' }
    requestAnimationFrame(() => container.querySelectorAll('textarea').forEach(grow))
    container.addEventListener('input', (e) => { if (e.target.tagName === 'TEXTAREA') grow(e.target) })
    container.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', () => {
      const table = container.querySelector(`[data-list="${b.dataset.add}"]`)
      table.tBodies[0].insertAdjacentHTML('beforeend', listRow(table.dataset.type))
      table.tBodies[0].lastElementChild.querySelector('textarea').focus()
    }))
    container.addEventListener('click', (e) => {
      const rm = e.target.closest('[data-remove]')
      if (rm) rm.closest('tr').remove()
    })
  }
}

// Read the form back into a new plan. Changed fields become "filled" with an edit note.
export function collectPlan (container, original, who = 'family worker') {
  const plan = structuredClone(original)
  const stamp = `Edited by ${who} on ${fmtDate(new Date().toISOString().slice(0, 10))}`

  const apply = (path, newVal, listType = null) => {
    const old = getPath(original, path) || EMPTY()
    const keepSrc = old.source && !/^Edited by /.test(old.source) ? ` (was: ${old.source})` : ''
    const same = JSON.stringify(old.value ?? null) === JSON.stringify(newVal) ||
      (typeof newVal === 'string' && old.value != null && flatText(old.value) === newVal) ||
      (listType && Array.isArray(old.value) && JSON.stringify(normRows(listType, old.value)) === JSON.stringify(newVal ?? []))
    if (same) return false
    setPath(plan, path, isEmpty(newVal)
      ? EMPTY()
      : { value: newVal, source: stamp + keepSrc, status: 'filled' })
    return true
  }

  container.querySelectorAll('[data-path]').forEach((el) => {
    const v = el.value.trim()
    apply(el.dataset.path, v === '' ? null : v)
  })
  container.querySelectorAll('[data-list]').forEach((table) => {
    const rows = [...table.tBodies[0].rows].map((tr) => {
      const r = {}
      tr.querySelectorAll('[data-col]').forEach((t) => { r[t.dataset.col] = t.value.trim() })
      return r
    }).filter((r) => Object.values(r).some(Boolean))
    apply(table.dataset.list, rows.length ? rows : null, table.dataset.type)
  })
  container.querySelectorAll('[data-confirm]').forEach((cb) => {
    if (!cb.checked) return
    const f = getPath(plan, cb.dataset.confirm)
    if (f && f.status === 'needs_review') setPath(plan, cb.dataset.confirm, { ...f, status: 'filled', source: `${f.source || ''} (checked by ${who})`.trim() })
  })
  return plan
}

export function flagSummary (plan) {
  const flags = flaggedFields(plan)
  if (!flags.length) return '<div class="notice green">Every field is filled in.</div>'
  return `<div class="notice amber"><strong>${flags.length} field${flags.length === 1 ? '' : 's'} to check:</strong>
    ${flags.map((f) => `<a href="javascript:void 0" data-jump="${fid(f.path)}">${esc(f.label)}</a> (${f.status === 'missing' ? 'missing' : 'needs review'})`).join(', ')}</div>`
}

// Tap to show the source on touch screens (hover/focus works on desktop).
export function wireSources (container) {
  container.querySelectorAll('.src-btn').forEach((b) => b.addEventListener('click', (e) => {
    e.preventDefault()
    const wrap = b.closest('.src')
    const open = !wrap.classList.contains('open')
    container.querySelectorAll('.src.open').forEach((x) => x.classList.remove('open'))
    wrap.classList.toggle('open', open)
  }))
}

export function wireJumps (root) {
  root.querySelectorAll('[data-jump]').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault()
    const el = document.getElementById(a.dataset.jump)
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    el?.querySelector('input, textarea, select, .src-btn')?.focus({ preventScroll: true })
  }))
}
