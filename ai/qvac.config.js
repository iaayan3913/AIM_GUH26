import { fileURLToPath } from 'node:url'

// Models live in ai/models (gitignored) so the demo works with Wi-Fi off.
export default {
  cacheDirectory: fileURLToPath(new URL('./models', import.meta.url)),
  loggerLevel: 'warn'
}
