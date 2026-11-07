// Picks the AI implementation.
//   FOBE_AI=mock  -> always ui/mock.js
//   FOBE_AI=real  -> ../ai/index.js (fails loudly if it can't load)
//   unset         -> mock (until C5 integration)
import fs from 'node:fs'

export async function loadAi () {
  const mode = process.env.FOBE_AI || 'mock'
  if (mode === 'real') {
    const url = new URL('../ai/index.js', import.meta.url)
    if (!fs.existsSync(url)) throw new Error('FOBE_AI=real but ../ai/index.js does not exist')
    const ai = await import(url.href)
    for (const fn of ['transcribe', 'ocrNotes', 'draftCarePlan', 'lanyardText']) {
      if (typeof ai[fn] !== 'function') console.warn(`[ai] ../ai/index.js has no ${fn}(), using mock for it`)
    }
    const mock = await import('./mock.js')
    return { name: 'real', ai: { ...mock, ...pickFns(ai) } }
  }
  return { name: 'mock', ai: await import('./mock.js') }
}

function pickFns (mod) {
  const out = {}
  for (const [k, v] of Object.entries(mod)) if (typeof v === 'function') out[k] = v
  return out
}
