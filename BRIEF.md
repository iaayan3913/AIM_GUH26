# FOBE Care Plan AI: Build Brief (Tether track, v2)

**Rules:** nothing cloud, ever (all AI runs locally via QVAC). Any P2P (Holepunch/Pears stack) is fine. FAKE data only.
**Deadline:** submit by **17:15** (hard deadline 17:30), live demo afterwards. **Feature freeze 16:30.**

## The problem (pitch numbers)
- FOBE supports **100+ disabled children**.
- Each child: parent meetings of up to **4 hours**, then about **2 hours** writing the care plan by hand from handwritten notes.
- That's **200+ hours a year** of a family worker's time just writing plans, and she spends the meeting writing notes instead of listening to the family.
- Families speak English, Urdu, Bengali/Sylheti, Hindi and Pakistani regional languages.
- The data is children's health information, so it should never touch the cloud.

## What it does
1. The family worker records the meeting (with consent) and/or photographs or types her notes.
2. Her office PC transcribes and translates the meeting **locally**, then drafts the care plan in FOBE's exact format.
3. Anything not clearly said is flagged amber as **missing**. The AI never guesses medication, allergies or diagnosis.
4. She edits the draft, then **taps her YubiKey to sign it off**. Only she can edit, and only on her PC.
5. She prints it for the secure folder. Every version is kept (append-only history), and annual reviews are flagged automatically.
6. **P2P:** her work phone sends recordings and photos straight to the office PC over Holepunch, with no email, WhatsApp or cloud. A read-only encrypted backup lives on a second FOBE device.
7. **Stretch:** NFC lanyard tag with vital "if I'm lost" info.

## Laptops (important)
QVAC supports Windows **x64 only**. It will NOT run on the Snapdragon (ARM) Galaxy Book.
- **ASUS Vivobook (i5-13500H) = "office PC".** Runs QVAC, the database and the UI. Person A develops here, and the final demo runs here.
- **Galaxy Book 4 Edge = "work phone".** Sends files and holds the read-only backup. If Holepunch native modules fail on ARM, install the **x64 Node.js** build on it (Windows runs it under emulation).
- Third laptop: UI development (Person C), integrated onto the Vivobook at C5.

## Languages: be honest in the pitch
Whisper handles English, Urdu, Bengali and Hindi. **Sylheti and Pahari/Mirpuri are poorly supported or not supported.** Say so: "For Sylheti, the worker fills those parts in. Next step: community-recorded Sylheti data." Judges trust teams who know their limits. Record the demo clip in English + Urdu/Bengali.

## Repo layout (each person only touches their own folder)
```
BRIEF.md  README.md  .gitignore          <- Mehraz only
shared/   CONTRACT.md, careplan.example.json, seed/   <- FROZEN
  seed/children.json                     5 fake children (the demo database)
  seed/inputs/demo-visit-script.md       script to record demo-visit.wav
  seed/inputs/demo-handwritten-notes.md  notes to hand-write and photograph
  seed/inputs/demo-notes-typed.txt       typed version / OCR fallback
ai/    Person A   (own package.json + CHECKPOINTS.md)
sync/  Person B   (db.js, seed.js and test-db.js already WORK)
ui/    Person C   (own package.json + CHECKPOINTS.md)
```

## Demo database (already built and tested)
`sync/db.js` is a local Hyperbee database (Holepunch) with `putPlan`, `getPlan`, `listPlans` and `history` (every version kept).
```
cd sync
npm install
npm test        # list/get/edit/history check
npm run seed    # loads the 5 fake children into sync/data/office-pc
```
Seed children: Maryam (autism, non-verbal), Leo (cerebral palsy, **review due soon**), Ibrahim (epilepsy, Sylheti words), Zara (Down syndrome, hearing), Aarav (ADHD, **review overdue soon**).
Demo child created live: **Ayaan Malik** (from the recording and the notes).

---

## Prompts: paste into each person's Claude Code, opened in the repo root

### Person A: AI (Vivobook)
> Read BRIEF.md, shared/CONTRACT.md, shared/careplan.example.json and ai/CHECKPOINTS.md. You own ONLY the /ai folder. Never create, edit or delete files outside /ai, and never edit package files outside /ai. Build the /ai module exactly as specified in shared/CONTRACT.md using the Tether QVAC SDK (`npm install @qvac/sdk` inside /ai; docs at https://docs.qvac.tether.io). Everything runs locally with no cloud APIs; models are downloaded once into /ai/models (gitignored). Work through the checkpoints A0→A7 in order. Start by running `npx qvac doctor` and the smallest transcription and completion examples before writing anything else. Transcription: use a multilingual Whisper model (not an .en model), the largest that runs in under ~60 s for a 1.5-minute clip. The audio switches between English, Urdu and Bengali, so output the original and an English translation (use Whisper's translate option or QVAC translation if available, otherwise translate with the LLM). Care plan: use the best local LLM that runs at an acceptable speed (try a 3–4B instruct model, falling back to Llama 3.2 1B). Generate ONE SECTION AT A TIME with small JSON prompts rather than the whole plan at once (small models are more reliable that way), then validate and assemble. Rules: never invent a value; if it's not stated, set status "missing"; every filled value includes a short source quote; medication/allergies/diagnosis are "needs_review" unless stated explicitly. Use shared/seed/inputs/demo-visit-script.md (the 'what the AI should produce' table) as the test. Add a --use-cache option that saves and replays results from /ai/cache. After each checkpoint, update ai/CHECKPOINTS.md (status, notes, measured timings), then `git add ai && git commit -m "[ai] A<n> done" && git pull --rebase && git push`. Never force-push.

### Person B: database + P2P (Galaxy Book + Vivobook)
> Read BRIEF.md, shared/CONTRACT.md and sync/CHECKPOINTS.md. You own ONLY the /sync folder. Never create, edit or delete files outside /sync. sync/db.js, seed.js and test-db.js already work; keep their exported functions unchanged. Create sync/index.js that re-exports db.js and adds the P2P functions in shared/CONTRACT.md using Holepunch libraries (hyperswarm, corestore, hyperbee, hyperdrive, b4a); no servers, no cloud. Roles: the office PC is the ONLY writer of care plans. The "phone" peer sends files (visit recordings, photos of notes) to the office over Hyperswarm/Hyperdrive, and can hold a read-only replica of the plans (backup). Pairing: the office shows a key, the phone pastes it. Work through checkpoints B0→B5 in order, writing a runnable demo script for each one (e.g. `node demo-office.js`, `node demo-phone.js`). If peers can't discover each other on the venue Wi-Fi, add a fallback using a local HyperDHT bootstrap node on the LAN or a phone hotspot, and document the exact commands. After each checkpoint, update sync/CHECKPOINTS.md, then `git add sync && git commit -m "[sync] B<n> done" && git pull --rebase && git push`. Never force-push.

### Person C: UI + YubiKey (then integrate on the Vivobook)
> Read BRIEF.md, shared/CONTRACT.md, shared/careplan.example.json and ui/CHECKPOINTS.md. You own ONLY the /ui folder. Never create, edit or delete files outside /ui. Build a local web app: Express server (ui/server.js) on http://localhost:3000 serving static files from ui/public. No CDNs, external fonts or cloud; bundle every library locally via npm. Use the REAL database from ../sync/db.js (run `npm run seed` in /sync first) and create ui/mock.js returning fake AI results with exactly the shapes in shared/CONTRACT.md, until checkpoint C5 swaps in the real ../ai. Screens are in ui/CHECKPOINTS.md (C0→C7). The care plan view follows FOBE's sections in this order: header (last updated, age, photo consent, DOB, gender, ethnicity, diagnosis, medication, allergies), About me (hobbies/interests, watch out), Attributes (physical/mobility, communication/learning, emotional & social, toileting/self-care, dietary, specific words/phrases), Challenging behaviours + control measures. Fields with status missing/needs_review are highlighted amber, and the source quote shows on hover/tap. The print view is a clean A4 layout. YubiKey: WebAuthn with @simplewebauthn/server + @simplewebauthn/browser (served locally), rpID 'localhost'; signing off a plan requires a fresh authentication. Design: calm, accessible, large text, high contrast. After each checkpoint, update ui/CHECKPOINTS.md, then `git add ui && git commit -m "[ui] C<n> done" && git pull --rebase && git push`. Never force-push.

---

## Timeline
| Time | What |
|---|---|
| 13:20 | Mehraz pushes this scaffold. Everyone clones. Record `demo-visit.wav`, write and photograph the notes |
| 13:45 | A0 / B0 / C0. **If QVAC won't run by 14:00, tell everyone immediately** |
| 15:00 | Check-in: read all three CHECKPOINTS.md files together (5 minutes) |
| 15:45 | Integration on the Vivobook starts (C5) |
| 16:30 | **Feature freeze.** Cut whatever isn't done; the cache (A4) covers slow inference |
| 16:30–17:10 | Rehearse twice, record a backup demo video, write the submission |
| 17:15 | Submit |

## Demo script (90 s)
1. "FOBE supports 100+ disabled children. Every care plan costs a family worker about 2 hours of writing after up to 4 hours of meetings." Tell a real (anonymised) story.
2. Turn Wi-Fi **off**. Play the Urdu/English visit → transcript + translation → draft plan. Medication shows amber "missing": "It never guesses."
3. Add the photo of the handwritten notes → the gaps fill in.
4. Edit one field → tap the YubiKey to sign off → print preview.
5. Wi-Fi on → "the work phone sent this recording peer-to-peer; the backup copy updated live."
6. (Stretch) Tap the lanyard tag with any phone.
7. Close: "Children's data never left the building."

## Before anyone codes
- Download QVAC models on the Vivobook now (venue Wi-Fi gets slow).
- Install Node.js 22.17+ on every laptop (x64 build on the Galaxy Book if ARM modules fail).
- Text FOBE's family worker for a one-line quote.
