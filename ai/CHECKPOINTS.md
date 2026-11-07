# /ai checkpoints (Person A, on the ASUS Vivobook)

Status key: ⬜ not started · 🟨 in progress · ✅ done · ❌ blocked (write why)
**Claude: update this file after every checkpoint, then commit `[ai] A<n> done` and push.**

| # | Checkpoint | Done when | Target | Status | Notes |
|---|---|---|---|---|---|
| A0 | QVAC installed | `npx qvac doctor` passes on the Vivobook (Node ≥ 22.17). Note whether Vulkan GPU or CPU is used | 13:45 | ✅ | `npx @qvac/cli doctor` passes (Node 22.22, SDK 0.23). **Vulkan GPU: Intel Iris Xe.** First worker start can exceed 30 s: set `QVAC_RPC_INIT_TIMEOUT_MS=180000`. Models in `ai/models` via `ai/qvac.config.js`; `node download.js` fetches all. Smoke test: Whisper tiny 1.2 s for 10 s clip, Llama 1B 7 s reply |
| A1 | Transcribe English | `node test.js transcribe <english clip>` prints the text | 14:00 | ✅ | `node test.js transcribe <wav>`: 15 s English clip in 10.5 s incl. model load (Whisper small q8, Vulkan). Default model is large-v3-turbo (`FOBE_ASR` env to override) |
| A2 | Mixed-language transcript | `demo-visit.wav` → `{ original, english, segments }`, Urdu/Bengali lines translated to English | 14:45 | ⬜ | |
| A3 | Draft care plan | transcript + typed notes → valid JSON matching `shared/careplan.example.json`; medication = `missing` when only the recording is used | 15:15 | ⬜ | |
| A4 | Cache for demo | every result saved to `ai/cache/<input-name>.json`; `--use-cache` flag returns it instantly (backup if live inference is slow) | 15:30 | ⬜ | |
| A5 | Lanyard text | `lanyardText(plan)` ≤ 130 chars, no diagnosis/ethnicity/surname/DOB unless opted in | 15:40 | ⬜ | |
| A6 | OCR handwritten notes (stretch) | photo of `demo-handwritten-notes` → text that's good enough for A3 | 16:00 | ⬜ | |
| A7 | Update an existing plan (stretch) | `existingPlan` passed in → only changed fields updated, the rest kept | 16:15 | ⬜ | |

## Timings measured (fill in, needed for the pitch)
- Transcribe 1.5 min clip: ___ s
- Draft care plan: ___ s
- Models used: Whisper ___ / LLM ___
