// Fake AI results with exactly the shapes in shared/CONTRACT.md.
// Used until checkpoint C5 swaps in the real ../ai module.
// Behaves like the real thing for the demo: never guesses, flags gaps as "missing",
// and fills gaps when the photo of the notes / typed notes are added.

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function steps (onProgress, stage, totalMs = 1500, n = 5) {
  for (let i = 1; i <= n; i++) {
    await wait(totalMs / n)
    onProgress?.(stage, Math.round((i / n) * 100))
  }
}

const SEGMENTS = [
  { start: 0, end: 6, text: 'Before we start, are you happy for me to record this meeting so I can write Ayaan\'s care plan?', english: 'Before we start, are you happy for me to record this meeting so I can write Ayaan\'s care plan?' },
  { start: 6, end: 8, text: 'Yes, that\'s fine.', english: 'Yes, that\'s fine.' },
  { start: 8, end: 10, text: 'Great. So Ayaan\'s date of birth?', english: 'Great. So Ayaan\'s date of birth?' },
  { start: 10, end: 14, text: 'Fourteenth of March, 2017. He\'s nine.', english: 'Fourteenth of March, 2017. He\'s nine.' },
  { start: 14, end: 16, text: 'And what does he love doing?', english: 'And what does he love doing?' },
  { start: 16, end: 24, text: 'اسے ٹرینیں بہت پسند ہیں، وہ گھنٹوں ٹرین کی ویڈیوز دیکھ سکتا ہے۔ اور تیراکی، پانی میں وہ بہت پرسکون رہتا ہے۔', english: 'He loves trains, he can watch train videos for hours. And swimming, he\'s very calm in water.' },
  { start: 24, end: 26, text: 'Anything we should watch out for?', english: 'Anything we should watch out for?' },
  { start: 26, end: 34, text: 'Crowds. جب بہت سارے لوگ اور شور ہوتا ہے تو وہ کان بند کر لیتا ہے اور جھولنے لگتا ہے۔ پھر اسے ایک پرسکون کونے کی ضرورت ہوتی ہے۔', english: 'Crowds. When there are lots of people and noise, he covers his ears and starts rocking. Then he needs a quiet corner.' },
  { start: 34, end: 36, text: 'How does he communicate?', english: 'How does he communicate?' },
  { start: 36, end: 44, text: 'He has a few words. "Choo-choo" means he wants the train. If he says "finish", he wants to stop whatever he is doing.', english: 'He has a few words. "Choo-choo" means he wants the train. If he says "finish", he wants to stop whatever he is doing.' },
  { start: 44, end: 48, text: 'বাড়িতে দাদির সাথে সে বাংলাও বোঝে।', english: 'At home with his grandmother he understands Bengali too.' },
  { start: 48, end: 50, text: 'And mobility?', english: 'And mobility?' },
  { start: 50, end: 55, text: 'He walks fine, but he runs off if he sees a train. You have to hold his hand near roads.', english: 'He walks fine, but he runs off if he sees a train. You have to hold his hand near roads.' },
  { start: 55, end: 56, text: 'Toileting?', english: 'Toileting?' },
  { start: 56, end: 60, text: 'He\'s toilet trained but needs reminding, and help with wiping.', english: 'He\'s toilet trained but needs reminding, and help with wiping.' },
  { start: 60, end: 62, text: 'Food and allergies?', english: 'Food and allergies?' },
  { start: 62, end: 67, text: 'اسے انڈوں سے الرجی ہے، اسے خارش ہو جاتی ہے۔ اور وہ صرف حلال کھاتا ہے۔', english: 'He\'s allergic to eggs, he gets a rash. And he only eats halal.' },
  { start: 67, end: 69, text: 'Any behaviours that can be challenging?', english: 'Any behaviours that can be challenging?' },
  { start: 69, end: 76, text: 'If he\'s upset he sometimes hits his head on the wall. We give him his headphones and his train book and he calms down.', english: 'If he\'s upset he sometimes hits his head on the wall. We give him his headphones and his train book and he calms down.' },
  { start: 76, end: 78, text: 'Thank you, that\'s really helpful.', english: 'Thank you, that\'s really helpful.' }
]

const DEMO_NOTES = `VISIT 07/11 - AYAAN MALIK
DX: AUTISM (DIAGNOSED AGE 4)
BOY. PAKISTANI.
PHOTO CONSENT - YES
MUM: AISHA 07700 900106
NO MEDS - MUM CONFIRMED BY PHONE`

// transcribe(audioPath) -> { language, original, english, segments: [{ start, end, text, english }] }
export async function transcribe (audioPath, onProgress) {
  onProgress?.('transcribing', 0)
  await steps(onProgress, 'transcribing', 2500, 10)
  return {
    language: 'ur',
    original: SEGMENTS.map((s) => s.text).join(' '),
    english: SEGMENTS.map((s) => s.english).join(' '),
    segments: SEGMENTS
  }
}

// ocrNotes(imagePath) -> { text }
export async function ocrNotes (imagePath, onProgress) {
  onProgress?.('reading notes', 0)
  await steps(onProgress, 'reading notes', 1200, 4)
  return { text: DEMO_NOTES }
}

const F = (value, source, status = 'filled') => ({ value, source, status })
const MISSING = () => ({ value: null, source: null, status: 'missing' })

// draftCarePlan({ childId, transcript, notes, existingPlan? }) -> carePlan
export async function draftCarePlan ({ childId, transcript, notes, existingPlan } = {}, onProgress) {
  onProgress?.('drafting care plan', 0)
  await steps(onProgress, 'drafting care plan', 3000, 10)

  const t = (typeof transcript === 'string' ? transcript : transcript?.english || '') || ''
  const n = (notes || '').toUpperCase()
  const heard = t.length > 0
  const say = (quote) => `Parent: "${quote}"`
  const note = (line) => `Notes: "${line}"`
  const fromAudio = (value, quote, status) => (heard ? F(value, say(quote), status) : MISSING())
  const fromNotes = (re, value, line, status) => (re.test(n) ? F(value, note(line), status) : MISSING())

  const today = new Date().toISOString().slice(0, 10)
  const plan = {
    child_id: childId,
    last_updated: F(today, 'Date of visit'),
    first_name: heard || /AYAAN/.test(n) ? F('Ayaan', heard ? 'FW: "So Ayaan\'s date of birth?"' : note('AYAAN MALIK')) : MISSING(),
    surname: fromNotes(/MALIK/, 'Malik', 'VISIT 07/11 - AYAAN MALIK'),
    dob: fromAudio('2017-03-14', 'Fourteenth of March, 2017. He\'s nine.'),
    gender: fromNotes(/\bBOY\b/, 'Male', 'BOY. PAKISTANI.'),
    ethnicity: fromNotes(/PAKISTANI/, 'Pakistani', 'BOY. PAKISTANI.'),
    photo_consent: fromNotes(/PHOTO CONSENT - YES/, 'Yes', 'PHOTO CONSENT - YES'),
    photo_path: null,
    diagnosis: fromNotes(/DX: AUTISM/, 'Autism (diagnosed age 4)', 'DX: AUTISM (DIAGNOSED AGE 4)', 'needs_review'),
    medication: fromNotes(/NO MEDS/, 'None', 'NO MEDS - MUM CONFIRMED BY PHONE'),
    allergies: fromAudio('Eggs (causes a rash)', 'He\'s allergic to eggs, he gets a rash.'),
    emergency_contact: fromNotes(/MUM: AISHA/, 'Mum (Aisha) - 07700 900106', 'MUM: AISHA 07700 900106'),
    about_me: {
      hobbies_interests: fromAudio('Trains (watching train videos), swimming - very calm in water', 'He loves trains, he can watch train videos for hours. And swimming'),
      watch_out: fromAudio('Crowds and noise: covers his ears and rocks, then needs a quiet corner', 'When there are lots of people and noise, he covers his ears and starts rocking.')
    },
    attributes: {
      physical_mobility: fromAudio('Walks independently. Runs off if he sees a train - hold his hand near roads', 'He walks fine, but he runs off if he sees a train.'),
      communication_learning: fromAudio('Has a few words. Understands Bengali at home with his grandmother', 'He has a few words... he understands Bengali too.'),
      emotional_social: MISSING(),
      toileting_self_care: fromAudio('Toilet trained but needs reminders, and help with wiping', 'He\'s toilet trained but needs reminding, and help with wiping.'),
      dietary: fromAudio('Halal only', 'he only eats halal.'),
      words_phrases: fromAudio([
        { word_or_sign: 'Choo-choo', meaning: 'Wants the train' },
        { word_or_sign: 'Finish', meaning: 'Wants to stop what he is doing' }
      ], '"Choo-choo" means he wants the train. If he says "finish", he wants to stop')
    },
    challenging_behaviours: fromAudio([
      { behaviour: 'Hits his head on the wall when upset', triggers: 'Being upset (e.g. crowds, noise)', control_measures: 'Give him his headphones and his train book' }
    ], 'If he\'s upset he sometimes hits his head on the wall. We give him his headphones and his train book'),
    approved_by: null,
    approved_at: null
  }

  // Keep anything the existing plan already had that this visit did not cover.
  if (existingPlan) mergeMissing(plan, existingPlan)
  return plan
}

function isField (x) { return x && typeof x === 'object' && 'status' in x && 'value' in x }
function mergeMissing (draft, old) {
  for (const k of Object.keys(old)) {
    if (isField(draft[k]) && draft[k].status === 'missing' && isField(old[k]) && old[k].status !== 'missing') draft[k] = old[k]
    else if (draft[k] && !isField(draft[k]) && typeof draft[k] === 'object' && !Array.isArray(draft[k]) && old[k]) mergeMissing(draft[k], old[k])
  }
}

// lanyardText(carePlan, optIns = []) -> string (<= 130 chars)
export async function lanyardText (plan, optIns = []) {
  const v = (f) => (f && f.status !== 'missing' ? f.value : null)
  const parts = [`I'm ${v(plan.first_name) || 'a FOBE child'}.`]
  if (optIns.includes('diagnosis') && v(plan.diagnosis)) parts.push(`${String(v(plan.diagnosis)).split(/[,(]/)[0].trim()}.`)
  if (optIns.includes('communication') && v(plan.attributes?.communication_learning)) parts.push(String(v(plan.attributes.communication_learning)).split('.')[0] + '.')
  if (optIns.includes('allergies') && v(plan.allergies)) parts.push(`Allergy: ${v(plan.allergies)}.`)
  if (optIns.includes('contact') && v(plan.emergency_contact)) parts.push(`Call ${v(plan.emergency_contact)}.`)
  let s = parts.join(' ')
  if (s.length > 130) s = s.slice(0, 129) + '…'
  return s
}
