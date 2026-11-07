// Care plan laid out exactly like FOBE's Word template ("Care plan template.doc"):
// logo + "Care Plan" + Last Updated / Age / Photo Consent, name + photo, D.O.B. / Gender / Ethnicity,
// Diagnosis / Medication / Allergies, About Me (blue), Attributes (pink),
// Challenging Behaviour (red) / Control Measures (green).
// interactive = on-screen preview: amber flags, "Missing" badges and source quotes.
import { esc, fmtDate, fmtDateTime, initials } from './util.js'
import { getPath, isFlagged, fid, statusBadge, sourceTip, toRows, flatText } from './planform.js'

const EMPTY = { value: null, source: null, status: 'missing' }
const isEmpty = (v) => v == null || v === '' || (Array.isArray(v) && v.length === 0)

// Plain text for a value, in the style a worker would write it on the form.
function asText (type, v) {
  if (isEmpty(v)) return ''
  if (type === 'date') return fmtDate(v)
  if (Array.isArray(v) && type === 'meds') {
    return toRows('meds', v).map((r) => [[r.name, r.dose].filter(Boolean).join(' '), r.time].filter(Boolean).join(' – ')).join('\n')
  }
  if (Array.isArray(v) && type === 'words') {
    return toRows('words', v).map((r) => (r.meaning ? `“${r.word_or_sign}” – ${r.meaning}` : r.word_or_sign)).join('\n')
  }
  return flatText(v)
}

export function docSheetHtml (plan, meta, { interactive = false, padRows = 0 } = {}) {
  const NR = interactive ? '<span class="nr">Not recorded – ask the family</span>' : '<span class="nr">Not recorded</span>'

  // One or more fields in a cell. Each gets its own amber flag + source on screen.
  const cell = (fields) => fields.map(([path, type = 'text', label = '']) => {
    const f = getPath(plan, path) || EMPTY
    const text = asText(type, f.value)
    const body = text ? esc(text) : NR
    if (!interactive) return `${label ? `<div class="dv-label">${esc(label)}</div>` : ''}<div class="dv-text">${body}</div>`
    const flag = isFlagged(f)
    const tags = `${flag ? statusBadge(f) : ''}${sourceTip(f, label || path)}`
    return `<div class="dv ${flag ? 'flag' : ''}" id="${fid(path)}">
      ${label || tags ? `<div class="dv-label">${esc(label)} ${tags}</div>` : ''}
      <div class="dv-text">${body}</div></div>`
  }).join('')

  const name = [plan.first_name?.value, plan.surname?.value].filter(Boolean).join(' ')
  const nameFlags = interactive
    ? [['first_name', 'First name'], ['surname', 'Surname']].map(([p, label]) => {
        const f = getPath(plan, p) || EMPTY
        if (!isFlagged(f)) return ''
        return `<span class="dv-inline" id="${fid(p)}"><span class="badge amber">${label} ${f.status === 'missing' ? 'missing' : 'needs review'}</span>${sourceTip(f, label)}</span>`
      }).join(' ')
    : ''
  const age = meta?.age != null ? String(meta.age) : ''
  const consent = getPath(plan, 'photo_consent')?.value

  // Challenging behaviours: one row per behaviour, like the template's table.
  const cb = getPath(plan, 'challenging_behaviours') || EMPTY
  const cbRows = Array.isArray(cb.value) ? toRows('behaviours', cb.value) : []
  const cbText = !Array.isArray(cb.value) && !isEmpty(cb.value) ? flatText(cb.value) : ''
  const pad = Math.max(0, padRows - cbRows.length - (cbText ? 1 : 0))
  const cbFlag = interactive && isFlagged(cb)

  return `
  <div class="fobe-doc">
    <table class="d-head">
      <colgroup><col style="width:16%"><col style="width:42%"><col style="width:16%"><col style="width:10%"><col style="width:16%"></colgroup>
      <tr>
        <td class="d-logo" rowspan="2"><img src="/brand/logo" alt="FOBE – friends of bright eyes" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'d-logo-text',innerHTML:'fobe<small>friends of bright eyes</small>'}))"></td>
        <td class="d-title" rowspan="2">Care Plan</td>
        <th>Last Updated:</th><th>Age:</th><th>Photo Consent:</th>
      </tr>
      <tr>
        <td class="d-c">${cell([['last_updated', 'date']])}</td>
        <td class="d-c">${interactive ? `<div class="dv">${age ? esc(age) : NR}</div>` : esc(age)}</td>
        <td class="d-c">${cell([['photo_consent', 'text']])}</td>
      </tr>
    </table>

    <table class="d-id">
      <colgroup><col style="width:9%"><col style="width:15%"><col style="width:9%"><col style="width:15%"><col style="width:11%"><col style="width:15%"><col style="width:26%"></colgroup>
      <tr>
        <td class="d-name" colspan="6">${esc(name) || '<span class="nr">Name not recorded</span>'} ${nameFlags}</td>
        <td class="d-photo" rowspan="5">${consent === 'No' ? '<span class="nr">No photo consent</span>' : `<span class="d-initials" aria-hidden="true">${esc(initials({ first_name: plan.first_name?.value, surname: plan.surname?.value }))}</span><span class="nr">Photo</span>`}</td>
      </tr>
      <tr>
        <th>D.O.B.</th><td>${cell([['dob', 'date']])}</td>
        <th>Gender</th><td>${cell([['gender', 'text']])}</td>
        <th>Ethnicity</th><td>${cell([['ethnicity', 'text']])}</td>
      </tr>
      <tr><th colspan="2" class="d-l">Diagnosis:</th><th colspan="2" class="d-l">Medication:</th><th colspan="2" class="d-l">Allergies:</th></tr>
      <tr class="d-box">
        <td colspan="2">${cell([['diagnosis', 'text']])}</td>
        <td colspan="2">${cell([['medication', 'meds']])}</td>
        <td colspan="2">${cell([['allergies', 'text']])}</td>
      </tr>
      <tr><th colspan="2" class="d-l">Emergency contact:</th><td colspan="4">${cell([['emergency_contact', 'text']])}</td></tr>
    </table>

    <table class="d-two">
      <tr><td colspan="2" class="d-bar d-about">About Me:</td></tr>
      <tr><th>Hobbies Interests</th><th class="d-watch">Watch Out!</th></tr>
      <tr class="d-box">
        <td>${cell([['about_me.hobbies_interests', 'text']])}</td>
        <td>${cell([['about_me.watch_out', 'text']])}</td>
      </tr>
    </table>

    <table class="d-attr">
      <colgroup><col style="width:16%"><col></colgroup>
      <tr><td colspan="2" class="d-bar d-attrs">Attributes:</td></tr>
      <tr><th>Physical / Mobility</th><td>${cell([['attributes.physical_mobility', 'text']])}</td></tr>
      <tr><th>Communication / Learning / Emotional &amp; Social</th><td>${cell([
        ['attributes.communication_learning', 'text', interactive ? 'Communication / learning' : ''],
        ['attributes.emotional_social', 'text', 'Emotional & social']
      ])}</td></tr>
      <tr><th>Toileting /<br>Self-Care</th><td>${cell([['attributes.toileting_self_care', 'text']])}</td></tr>
      <tr><th>Dietary</th><td>${cell([['attributes.dietary', 'text']])}</td></tr>
      <tr><th>Specific words/ phrases used?</th><td>${cell([['attributes.words_phrases', 'words']])}</td></tr>
    </table>

    <table class="d-two d-cb ${cbFlag ? 'flag' : ''}" ${interactive ? `id="${fid('challenging_behaviours')}"` : ''}>
      <tr>
        <th class="d-bar d-behav">Challenging Behaviour ${interactive ? `${cbFlag ? statusBadge(cb) : ''}${sourceTip(cb, 'Challenging behaviours')}` : ''}</th>
        <th class="d-bar d-control">Control Measures</th>
      </tr>
      ${cbRows.map((r) => `<tr>
        <td>${esc(r.behaviour || '')}${r.triggers ? `<div class="d-trig"><strong>Triggers:</strong> ${esc(r.triggers)}</div>` : ''}</td>
        <td>${esc(r.control_measures || '')}</td>
      </tr>`).join('')}
      ${cbText ? `<tr><td colspan="2">${esc(cbText)}</td></tr>` : ''}
      ${!cbRows.length && !cbText ? `<tr><td colspan="2" class="${cbFlag ? 'd-flagcell' : ''}">${NR}</td></tr>` : ''}
      ${'<tr class="d-empty"><td></td><td></td></tr>'.repeat(pad)}
    </table>

    <table class="d-sign">
      <tr>
        <th>Signed off by</th><td>${plan.approved_at ? esc(plan.approved_by) : '<strong>DRAFT – NOT SIGNED OFF</strong>'}</td>
        <th>Date</th><td>${plan.approved_at ? esc(fmtDateTime(plan.approved_at)) : ''}</td>
        <th>Child ID</th><td>${esc(plan.child_id)}</td>
      </tr>
    </table>
  </div>`
}
