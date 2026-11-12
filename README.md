# HearMe (FOBE Care Plan AI)

**Turn a family visit into a draft care plan in minutes, without the child's data ever leaving the building.**

FOBE (Friends of Bright Eyes) is a Luton charity supporting 100+ disabled children. Today a family worker meets parents for up to 4 hours, takes handwritten notes, then spends about 2 hours writing each care plan by hand: 200+ hours a year of writing, and time spent writing instead of listening to the family.

HearME records the visit (with consent), transcribes and translates it **on the office PC**, and drafts the care plan in FOBE's own format. The worker checks it, signs it off with a YubiKey tap, and prints it for the secure folder.

> Built in one day at the **Great Uni Hack 2026 (Tether track)**: AI that runs 100% locally, with peer-to-peer distribution. All child data in this repo is fake.

---

## What it does

1. **Capture.** The worker records the meeting and/or photographs or types her notes, on the office PC or on her work phone.
2. **Phone → office, peer-to-peer.** The work phone sends recordings and photos straight to the office PC over Holepunch. No email, WhatsApp or cloud. Files queue on the phone while offline and arrive when it reconnects.
3. **Local AI.** The office PC transcribes the visit (English, Urdu, Bengali, Hindi, and Sylheti through Bengali), translates it to English, reads the handwritten notes, and drafts the plan one section at a time with a local LLM (Tether QVAC).
4. **It never guesses.** Every value must be backed by a quote from the recording or notes, which shows when you hover or tap the field. Anything not clearly said is flagged amber as **missing**. Medication, allergies and diagnosis that came only from machine-translated speech are flagged **needs review**.
5. **Review and sign off.** Every field is editable. Signing off needs a fresh **YubiKey** tap and records who signed it and when.
6. **Print and keep.** The print view matches FOBE's paper care plan form (A4, "confidential – do not remove from folder" footer). Every save is a new version, so the full history is kept, and annual reviews are flagged automatically (amber within 30 days, red when overdue).
7. **Read-only backup.** A second FOBE device holds a live, read-only copy of the plans, which can be encrypted at rest. It refuses edits; only the office PC can write.
8. **Lanyard tag (stretch).** A ≤130-character "if I'm lost" text for an NFC tag, with sensitive details (surname, DOB, diagnosis, ethnicity) only included when the family opts in.

## How it stays local

| Part | Runs on | Technology | Network |
|---|---|---|---|
| Transcription, translation, OCR, drafting | Office PC | [Tether QVAC](https://docs.qvac.tether.io) SDK: IndicConformer 600M / Whisper large-v3-turbo, Qwen3.5-4B (translation + vision), Qwen3-4B Q4_K_M (plan) | None; works with Wi-Fi off |
| Care plan database | Office PC | Hyperbee on Corestore (append-only, every version kept), optional encryption at rest | None |
| Phone → office files, live backup | Work phone ↔ office PC | Holepunch: Hyperswarm, Hyperdrive, Protomux; pairing key + Noise handshake proof | Peer-to-peer only; local HyperDHT bootstrap for networks without internet |
| Web app | Office PC, `localhost:3000` only | Express + vanilla JS; every library bundled locally (no CDNs, no external fonts) | None |
| Sign-off | YubiKey 5C NFC over USB-C | WebAuthn (`@simplewebauthn`), rpID `localhost` | None |

```
 Work phone (Galaxy Book)                 Office PC (Vivobook)                      YubiKey
 ┌──────────────────────┐   Holepunch   ┌──────────────────────────────────┐   USB-C  ┌─────┐
 │ record / photo / type│ ────P2P────▶ │ inbox → QVAC: transcribe,         │ ◀─────▶ │ tap │
 │ outbox (queued)      │               │  translate, OCR, draft plan       │          └─────┘
 │ read-only backup  ◀──┼── live sync ──│ review + edit → sign off → print  │
 └──────────────────────┘               │ Hyperbee DB (every version kept)  │
                                        └──────────────────────────────────┘
```

## Measured on the demo laptop

ASUS Vivobook S15, Intel i5-13500H, Windows x64, Intel Iris Xe:

- **Transcription:** a 27 s Sylheti clip in ~30 s, including translation. Whisper turbo did a 116 s English clip in 44 s.
- **Care plan draft:** ~80 s warm, ~116 s cold (Qwen3-4B on CPU, 9.5 tok/s).
- **Handwritten notes (OCR):** ~90 s the first time, including model load.
- **Offline check:** the full pipeline was run with Wi-Fi off. Medication stayed "missing" from the recording alone.
- **Demo backup:** `FOBE_USE_CACHE=1` replays a previous run of the same files in under a second.

## Languages: what works and what doesn't

FOBE families speak English, Urdu, Bengali/Sylheti, Hindi and Pakistani regional languages.

- **Good:** English, Urdu, Hindi, Bengali.
- **Partial:** **Sylheti**. No speech model supports it directly, so we transcribe it in Bengali mode (IndicConformer) and translate with a small Sylheti glossary. Health facts that come only from translated speech are always flagged *needs review*.
- **Not supported:** **Pahari/Mirpuri**. The worker fills those parts in herself.

Next step: community-recorded Sylheti data to fine-tune on.

## Running it

**Requirements:**
- Windows **x64**: QVAC doesn't run on ARM, though the phone side does.
- Node.js **22.17+**
- About 9 GB of disk for the models
- A YubiKey (or any FIDO2 security key) for sign-off

Install each folder separately (there is no root `package.json`):

```powershell
cd sync; npm install; npm run seed; cd ..       # local database with 5 fake children
cd ai;   npm install; node download.js; cd ..   # QVAC models, once, with Wi-Fi on (~9 GB)
cd ui;   npm install; npm start                 # http://localhost:3000
```

1. Open **http://localhost:3000** (use `localhost`, not `127.0.0.1`, or the YubiKey won't work).
2. The first time, go to **Sign in with YubiKey**, type your name, and tap the key to register it.
3. **New visit** → add a recording, photos of notes and/or typed notes → **Create draft care plan** → review → **Save** → **Sign off with YubiKey** → **Print preview**.

**Work phone** (a second laptop, ARM is fine):
```powershell
cd sync; npm install; npm run phone             # http://localhost:3001
```
Enter the pairing key shown on the office PC's **From work phone** page. If the two machines can't find each other (e.g. eduroam blocks laptop-to-laptop traffic), use a phone hotspot and the local bootstrap described in [sync/CHECKPOINTS.md](sync/CHECKPOINTS.md).

**Useful settings:**

| Variable | Effect |
|---|---|
| `FOBE_USE_CACHE=1` | Replay saved AI results for the same files (demo backup) |
| `FOBE_AI=real` / `mock` | Force the real QVAC AI or the built-in test mock (default: real if installed) |
| `FOBE_DB_PASSPHRASE` | Encrypt the database at rest (use the same passphrase on every device) |
| `FOBE_BOOTSTRAP=ip:port` | Use a local HyperDHT bootstrap instead of the public one |
| `FOBE_P2P=0` | Turn the office peer off |

Only one process can open the office database, so don't run `sync/demo-office.js` alongside the UI.

## Repository layout

```
ai/      QVAC transcription, translation, OCR, care plan drafting, lanyard text
sync/    Hyperbee database + Holepunch P2P (phone → office files, read-only backup), work-phone app
ui/      Express web app on localhost:3000: child list, care plans, review, YubiKey sign-off, print, inbox
shared/  The contract between the three folders: CONTRACT.md, careplan.example.json, fake seed data
```

Each folder has its own `package.json` and a `CHECKPOINTS.md` with what was built, how it was tested, and timings:
[ai](ai/CHECKPOINTS.md) · [sync](sync/CHECKPOINTS.md) · [ui](ui/CHECKPOINTS.md).

The care plan format is in [shared/careplan.example.json](shared/careplan.example.json). Every field is `{ value, source, status: "filled" | "needs_review" | "missing" }`. Age is always computed from the date of birth, never generated by the AI.

## Privacy and safety

- **Nothing goes to the cloud.** There are no external APIs, CDNs or fonts at runtime. The app listens on `127.0.0.1` only.
- **Recordings are made only with consent,** and the phone app asks for consent before every recording.
- **The AI never invents a value.** A value without a matching quote in the source becomes "missing". Health fields need an explicit statement.
- **Only the signed-in worker can edit,** and only on the office PC. Every sign-off needs a fresh YubiKey tap.
- **Nothing is ever overwritten.** Every version is kept.
- **All data in this repo is fake.** FOBE's real paper template is kept out of the repo.

## Team

Built at the Great Uni Hack 2026 by:

- **Iyaaz Ahmed:** local AI (QVAC)
- **Mehraz Saif:** database, peer-to-peer and the work-phone app
- **Aayan Islam:** web app, YubiKey sign-off and integration
