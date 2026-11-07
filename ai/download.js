// Download every model once into ai/models (run with Wi-Fi on): node download.js [NAME ...]
import { fileURLToPath } from 'node:url'
process.env.QVAC_CONFIG_PATH ??= fileURLToPath(new URL('./qvac.config.js', import.meta.url))
const q = await import('@qvac/sdk')

const names = process.argv.slice(2).length ? process.argv.slice(2)
  : ['WHISPER_LARGE_V3_TURBO', 'QWEN3_4B_INST_Q4_K_M', 'QWEN3_5_4B_MULTIMODAL_Q4_K_M', 'MMPROJ_QWEN3_5_4B_MULTIMODAL_Q8_0', 'LLAMA_3_2_1B_INST_Q4_0']
for (const n of names) {
  const t = Date.now()
  await q.downloadAsset({ assetSrc: q[n] })
  console.log(n, 'ok', ((Date.now() - t) / 1000).toFixed(0) + 's')
}
process.exit(0)
