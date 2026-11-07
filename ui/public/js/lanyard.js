// Lanyard NFC tag: short "if I'm lost" text, max 130 characters.
import { api, esc, toast, fullName } from './util.js'

const MAX = 130
const OPTS = [
  ['surname', 'Surname'],
  ['dob', 'Date of birth'],
  ['diagnosis', 'Diagnosis'],
  ['ethnicity', 'Ethnicity']
]

export async function renderLanyard (main, childId) {
  const { plan } = await api(`/api/plans/${encodeURIComponent(childId)}`)
  const name = fullName({ first_name: plan.first_name?.value, surname: plan.surname?.value })

  main.innerHTML = `
    <p><a href="#/child/${encodeURIComponent(childId)}">← Back to ${esc(name)}'s plan</a></p>
    <h1>Lanyard tag</h1>
    <p class="muted">Short "if I'm lost" text for the NFC tag on ${esc(plan.first_name?.value || 'the child')}'s lanyard. Anyone who taps it with a phone sees this text, so keep it to what helps someone get them home safely.</p>
    <div class="review-layout" style="grid-template-columns:minmax(0,1fr) minmax(0,1.4fr)">
      <section class="panel">
        <h2>Include only if the family agreed</h2>
        <p class="muted">Name, allergies and the emergency contact are always included. How they communicate is added if there is room.</p>
        <div class="checks" id="opts">
          ${OPTS.map(([k, label]) => `<label><input type="checkbox" value="${k}"> ${esc(label)}</label>`).join('')}
        </div>
      </section>
      <section class="panel">
        <h2><label for="text">Tag text</label></h2>
        <textarea id="text" class="input" rows="4" maxlength="${MAX}" style="font-size:1.25rem"></textarea>
        <p><span id="count" class="counter" aria-live="polite"></span></p>
        <div class="actions">
          <button class="btn primary" id="copy">Copy text</button>
          <button class="btn" id="reset">Regenerate</button>
        </div>
        <p class="muted">To write the tag: copy this text, open an NFC writer app on the work phone, and hold the tag to the phone.</p>
      </section>
    </div>`

  const text = main.querySelector('#text')
  const count = main.querySelector('#count')
  const update = () => {
    const n = text.value.length
    count.textContent = `${n} / ${MAX} characters`
    count.classList.toggle('over', n > MAX)
    main.querySelector('#copy').disabled = !n || n > MAX
  }
  const generate = async () => {
    const optIns = [...main.querySelectorAll('#opts input:checked')].map((c) => c.value)
    const r = await api(`/api/plans/${encodeURIComponent(childId)}/lanyard`, { method: 'POST', body: { optIns } })
    text.value = r.text
    update()
  }
  text.addEventListener('input', update)
  main.querySelectorAll('#opts input').forEach((c) => c.addEventListener('change', () => generate().catch((e) => toast(e.message, 'error'))))
  main.querySelector('#reset').addEventListener('click', () => generate().catch((e) => toast(e.message, 'error')))
  main.querySelector('#copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(text.value)
    } catch {
      text.select()
      document.execCommand('copy')
    }
    toast('Copied')
  })
  await generate()
}
