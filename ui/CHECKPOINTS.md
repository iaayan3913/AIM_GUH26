# /ui checkpoints (Person C)

Status key: ⬜ not started · 🟨 in progress · ✅ done · ❌ blocked (write why)
**Claude: update this file after every checkpoint, then commit `[ui] C<n> done` and push.**

| # | Checkpoint | Done when | Target | Status | Notes |
|---|---|---|---|---|---|
| C0 | Server runs | `npm start` → http://localhost:3000; uses the REAL `../sync/db.js` (already works) + `mock.js` for AI | 13:45 | ✅ | `cd ui && npm install && npm start`. Opens `../sync/data/office-pc` (run `npm run seed` in /sync first). AI = `mock.js` by default; `FOBE_AI=real` loads `../ai/index.js` (see ai-loader.js). Binds to 127.0.0.1 only. Uploads go to `ui/data/` (gitignored) |
| C1 | Child list | name, age (computed), last updated, "review due" badge (amber within 30 days, red overdue) | 14:15 | ⬜ | Leo + Aarav are due soon in the seed data |
| C2 | Care plan + print view | FOBE section layout; Print → clean A4 with footer "FOBE – confidential – do not remove from folder – version <date>" | 14:45 | ⬜ | |
| C3 | New visit + review | upload audio / photo / typed notes → progress → draft with missing/needs_review fields in amber, source quote shown on hover/tap, every field editable | 15:30 | ⬜ | |
| C4 | YubiKey passkey | register + log in with the YubiKey 5C (WebAuthn, rpID `localhost`); "Sign off" needs a fresh tap and sets approved_by/approved_at | 16:00 | ⬜ | |
| C5 | Integration | mock swapped for real `../ai` + `../sync` on the Vivobook; full demo flow works end to end | 16:20 | ⬜ | |
| C6 | Inbox (stretch) | "Received from work phone" list (from sync `onFileReceived`) with a "Create care plan" button | 16:30 | ⬜ | |
| C7 | Lanyard + history (stretch) | lanyard screen (text, character count, opt-in boxes, copy); version history list per child | 16:30 | ⬜ | |

**Feature freeze 16:30.** After that, fix bugs and rehearse only.
