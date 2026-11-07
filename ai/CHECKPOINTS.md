# /ai checkpoints (Person A, on the ASUS Vivobook)

Status key: ⬜ not started · 🟨 in progress · ✅ done · ❌ blocked (write why)
**Claude: update this file after every checkpoint, then commit `[ai] A<n> done` and push.**

| # | Checkpoint | Done when | Target | Status | Notes |
|---|---|---|---|---|---|
| A0 | QVAC installed | `npx qvac doctor` passes on the Vivobook (Node ≥ 22.17). Note whether Vulkan GPU or CPU is used | 13:45 | ✅ | `npx @qvac/cli doctor` passes (Node 22.22, SDK 0.23). **Vulkan GPU: Intel Iris Xe.** First worker start can exceed 30 s: set `QVAC_RPC_INIT_TIMEOUT_MS=180000`. Models in `ai/models` via `ai/qvac.config.js`; `node download.js` fetches all. Smoke test: Whisper tiny 1.2 s for 10 s clip, Llama 1B 7 s reply |
| A1 | Transcribe English | `node test.js transcribe <english clip>` prints the text | 14:00 | ✅ | `node test.js transcribe <wav>`: 15 s English clip in 10.5 s incl. model load (Whisper small q8, Vulkan). Default model is large-v3-turbo (`FOBE_ASR` env to override) |
| A2 | Mixed-language transcript | `demo-visit.wav` → `{ original, english, segments }`, Urdu/Bengali lines translated to English | 14:45 | 🟨 | Pipeline done: Whisper large-v3-turbo (`language: auto`) → any Urdu/Bengali/Hindi-script segment translated by the LLM. 116 s English clip → 44 s. **Waiting for real demo-visit.wav to test mixed languages.** Romanised Urdu would pass through untranslated |
| A3 | Draft care plan | transcript + typed notes → valid JSON matching `shared/careplan.example.json`; medication = `missing` when only the recording is used | 15:15 | ✅ | Qwen3-4B Q4_K_M, 6 small JSON-schema calls (identity, health, about_me, attributes, words, behaviours) sharing a KV-cached prefix. Matches the expected table from the script transcript; medication/diagnosis/gender/ethnicity/surname/photo_consent = missing. Every value needs a quote found in the source, else missing. Health fields filled only if quote says allerg/medic/diagnos. ~116 s cold, ~80 s warm (call `warmup()` at server start). Llama 1B fallback: 55 s but hallucinates |
| A4 | Cache for demo | every result saved to `ai/cache/<input-name>.json`; `--use-cache` flag returns it instantly (backup if live inference is slow) | 15:30 | ✅ | Every result is saved to `ai/cache/` (`transcript-<file>.json`, `plan-<childId>-<hash>.json`). `--use-cache` flag or `FOBE_USE_CACHE=1` replays in 0.75 s. Transcript + typed notes fills the gaps (gender, ethnicity, photo consent, diagnosis, medication None, contact) |
| A5 | Lanyard text | `lanyardText(plan)` ≤ 130 chars, no diagnosis/ethnicity/surname/DOB unless opted in | 15:40 | ✅ | Deterministic, no LLM: name, allergy, emergency contact, communication; surname/dob/diagnosis/ethnicity only via `optIns`. e.g. `Ayaan. ALLERGY: eggs. Call Aisha 07700 900106. ...` (102 chars). `node test.js selftest` checks it |
| A6 | OCR handwritten notes (stretch) | photo of `demo-handwritten-notes` → text that's good enough for A3 | 16:00 | ⬜ | |
| A7 | Update an existing plan (stretch) | `existingPlan` passed in → only changed fields updated, the rest kept | 16:15 | ⬜ | |

## Timings measured (fill in, needed for the pitch)
- Transcribe 1.5 min clip: 44 s for a 116 s clip incl. model load (large-v3-turbo, Vulkan GPU)
- Draft care plan: 116 s cold / ~80 s warm (Qwen3-4B on CPU, 9.5 tok/s; GPU was slower at 7.7 tok/s)
- Models used: Whisper large-v3-turbo / LLM Qwen3-4B Q4_K_M
