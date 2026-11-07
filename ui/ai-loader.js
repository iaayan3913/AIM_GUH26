// Picks the AI implementation.
//   FOBE_AI=real  -> ../ai/index.js (fails loudly if it can't load)
//   FOBE_AI=mock  -> ui/mock.js
//   unset (auto)  -> real if ../ai is installed (ai/node_modules/@qvac/sdk), otherwise mock
// FOBE_USE_CACHE=1 is read by ../ai itself (replays ai/cache for the demo).
import fs from 'node:fs'

export async function loadAi () {
  const mode = process.env.FOBE_AI || 'auto'
  const entry = new URL('../ai/index.js', import.meta.url)
  const installed = fs.existsSync(entry) && fs.existsSync(new URL('../ai/node_modules/@qvac/sdk', import.meta.url))

  if (mode === 'real' || (mode === 'auto' && installed)) {
    try {
      const ai = await import(entry.href)
      const missing = ['transcribe', 'ocrNotes', 'draftCarePlan', 'lanyardText'].filter((fn) => typeof ai[fn] !== 'function')
      if (missing.length) throw new Error(`../ai/index.js is missing ${missing.join(', ')}`)
      return { name: process.env.FOBE_USE_CACHE === '1' ? 'real (cache on)' : 'real', ai }
    } catch (e) {
      if (mode === 'real') throw e
      console.warn(`[ai] could not load ../ai (${e.message}); using mock`)
    }
  }
  return { name: 'mock', ai: await import('./mock.js') }
}
