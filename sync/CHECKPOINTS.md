# /sync checkpoints (Person B)

Status key: ⬜ not started · 🟨 in progress · ✅ done · ❌ blocked (write why)
**Claude: update this file after every checkpoint, then commit `[sync] B<n> done` and push.**

| # | Checkpoint | Done when | Target | Status | Notes |
|---|---|---|---|---|---|
| B0 | Local DB on Windows | `npm install` then `npm test` and `npm run seed` pass on BOTH laptops (already passing on Linux) | 13:45 | ✅ both laptops | Galaxy Book (Win11 arm64, Node 25.4 arm64): all native modules (rocksdb, sodium, udx) load natively, **no x64 Node needed**. Vivobook (x64): install + seed done. |
| B1 | Pairing | `startPeer()` on two laptops on the same Wi-Fi connects via Hyperswarm using a pairing key; both print "peer connected" | 14:30 | ✅ 2 laptops (phone hotspot) | Pairing key = 80 random bits, shown as `xxxx-xxxx-xxxx-xxxx` (case/dashes ignored), saved so the phone pairs once. Topic = hash(key); each side proves it knows the key (hash of key + Noise handshake hash), otherwise the connection is dropped. Phone re-queries the DHT every 5 s while disconnected. Connects in ~2–6 s over the public DHT. |
| B2 | Phone → office file transfer | "phone" laptop sends `demo-visit.wav` + notes photo, and the office receives it in `data/inbox/` through `onFileReceived` | 15:15 | ✅ 2 laptops | Phone writes files into its own Hyperdrive "outbox"; the office replicates it and copies new files to `sync/data/inbox/` (path is fixed to the sync folder, whatever the cwd). Files sent while the office is offline are queued and delivered on the next connection (good for the "Wi-Fi on" demo moment). Each file is delivered once (`data/inbox/.received.json`). Sending a file with the **same name and same bytes** again (e.g. `demo-visit.wav` in a rehearsal) reuses the existing inbox file instead of making `demo-visit (2).wav`, so the AI cache (keyed by file name) still hits; it is touched so it shows as just received. Same name with different bytes is still saved as `(2)`. |
| B3 | Read-only backup replica | `replicaDb()` on laptop 2 shows the office's care plans and updates live when the office edits; writing to it is refused | 15:45 | ✅ 2 laptops | Phone gets the office DB key automatically after pairing. Replica downloads the full core, so it still works with the office off. `putPlan` throws "Read-only backup..."; raw Hyperbee writes also fail (not the writer). `onChange(cb)` fires on live updates. |
| B4 | Venue Wi-Fi fallback | if peers can't find each other, run a local HyperDHT bootstrap on the LAN (or a hotspot) and document the exact command here | 16:00 | ✅ 2 laptops on a phone hotspot | `bootstrap.js` runs a private 3-node HyperDHT on the LAN (UDP 49737). Peers use it via `FOBE_BOOTSTRAP=ip:port` or `--bootstrap ip:port`, which replaces the public DHT entirely, so it works with no internet. Tested: pairing <1 s, file + live backup OK. Venue is **eduroam (Windows "Public" network)**, which usually blocks laptop-to-laptop traffic, so plan on the phone hotspot. See "Wi-Fi fallback" below. |
| B5 | Encryption at rest (stretch) | the data folder isn't readable as plain text; document the method used | 16:15 | ✅ (one laptop) | Opt-in: set `FOBE_DB_PASSPHRASE`. Every Hypercore block (care plans on the office PC and the backups, plus the phone outbox with its recordings) is encrypted with XSalsa20 (libsodium, Hypercore block encryption). Key = Argon2id(passphrase) and is never saved to disk. A wrong or missing passphrase is refused on the office. A backup laptop **without** the passphrase still stores the ciphertext ("blind backup") but can't read it. Files in `data/inbox/` are plain so the AI can read them. `FOBE_DB_PASSPHRASE=x npm run test:p2p` scans every storage file for plaintext: none found. Unset = exactly as before. |
| B6 | Work phone web app | `npm run phone` opens http://localhost:3001: pair, record visit (consent first), notes photo/typed, outbox, read-only backup | 16:30 | ✅ 2 laptops, real mic + webcam | `sync/phone-app/`: Express on 127.0.0.1:3001 (local only), vanilla JS with no CDNs, 420 px phone layout. Reuses startPeer / sendFile / replicaDb. Recording: MediaRecorder, converted in the browser to **16 kHz mono 16-bit WAV** (verified in Edge). Consent must be ticked for each recording. Photo via file upload or webcam, typed notes saved as .txt. Outbox shows Queued / Sending… / Delivered ✓ and survives restarts (`data/phone/outbox.json`). Backup shows name, last updated, review due (amber = due within 30 days, red = overdue) and "Last synced hh:mm", with no edit buttons anywhere. Tested: pair with the office offline, queue a wav + txt, office comes online, both Delivered, backup + live update. **Redesign (15:45):** FOBE template colours (navy #002060, blue, pink, red, green), inline SVG icons (no emojis, no icon library). **Visit** screen: pick the child (suggestions from the backup), then add any number of recordings, uploaded audio (any format → 16 kHz WAV in the browser; WAV sent unchanged), multi-page photos and typed notes; every file listed under the visit with its status. File names default to `Child-Name_recording_2026-11-07_1.wav` (`_audio_`, `_notes-photo_…_p1.jpg`, `_notes_…txt`) and are editable before sending; "Use the original file name" for uploads. Tabs: Visit · Outbox · Care plans · Connection. Browser-tested end to end in headless Edge (pair, visit, notes, audio upload + conversion, 2-page photo, rename, finish; 0 JS errors). |

## Tests
```
cd sync
npm test            # db: list/get/edit/history
npm run test:p2p    # B1+B2(+duplicate names)+B3 end to end, one machine, private in-process DHT (no internet)
$env:FOBE_DB_PASSPHRASE="x"; npm run test:p2p   # + B5: no plaintext anywhere on disk
```

## DEMO DAY (final setup)
Both laptops on the **phone hotspot**. Office = Vivobook running the UI; work phone = Galaxy Book running the phone app.
1. **Vivobook (office):** `cd ui; npm start` (opens `sync/data/office-pc` and starts the office peer itself; do NOT also run `demo-office.js`). Pairing key is on the UI's "From work phone" page. Use `FOBE_USE_CACHE=1` for the AI (see ai/CHECKPOINTS.md).
2. **Galaxy Book (work phone):** `cd sync; npm run phone`, open http://localhost:3001. It's already paired (pairing is saved). The pill must be green, "Connected to Office PC".
3. On stage: send from the phone → the file appears at the top of the UI's "From work phone" list within a few seconds → Create care plan. Backup tab shows the plans and "Last synced hh:mm"; after sign-off on the office it updates live.
4. **AI cache hits only for the same file name.** A live recording gets a new name each time, so it runs live (slow). To send the pre-cached `demo-visit.wav`: in the phone app, Visit → **Upload audio** → choose `demo-visit.wav` → tick consent → **Use the original file name** → Send. WAV files are sent byte-for-byte, so the name and content match the cache. Re-sending it in rehearsals is fine (no `(2)` copies). (CLI alternative: `node demo-phone.js C:\path\to\demo-visit.wav` with the app stopped.)
5. If the pill stays amber: see "Wi-Fi fallback (B4)" below (bootstrap on the Vivobook, `FOBE_BOOTSTRAP` on both).
6. "Database is locked": a leftover node process holds the folder. Close the other terminal, or `Stop-Process -Name node` (kills ALL node processes on that laptop).

## Demo commands, terminal versions (PowerShell)
Run `cd sync; npm install; npm run seed` once on each laptop first.

**Office PC** (Vivobook; for now terminal 1 on the Galaxy Book):
```
cd sync; node demo-office.js
```
It prints `PAIRING KEY: abcd-efgh-ijkl-mnop`. Commands: `list`, `edit FOBE-CHILD-0002 allergies Peanuts`, `files`, `key`, `quit`.

**Work phone** (Galaxy Book, terminal 2):
```
cd sync; node demo-phone.js <PAIRING-KEY> --backup
```
- B1: both terminals print `>> peer connected`.
- B2: add files on the command line, `node demo-phone.js <KEY> C:\path\demo-visit.wav C:\path\notes.jpg --backup`, or drag a file into the phone terminal and press Enter. Office prints `>> received ...` and saves to `sync\data\inbox\`.
- B3: phone lists the 5 plans. Type `edit FOBE-CHILD-0002 allergies Peanuts` in the office terminal and the phone prints `>> backup updated live: Leo Bennett changed allergies`. Type `write` in the phone terminal to show the refusal.
- Reset demo data afterwards: `npm run seed` (office). Phone data lives in `sync\data\phone\`; delete it to unpair.
- Windows Firewall: click **Allow** for Node.js (Private networks) the first time.

## Work phone app (B6)
```
cd sync; npm run phone          # then open http://localhost:3001 in Edge
```
- Uses the same folder as `demo-phone.js` (`data/phone`), so it reuses that pairing. **Stop demo-phone.js first** (only one process can open the folder).
- Office PC side is unchanged: `node demo-office.js` (or the UI).
- Options: `npm run phone -- --port 3002 --dir ./data/phone2 --bootstrap ip:port`. `FOBE_BOOTSTRAP` / `FOBE_DB_PASSPHRASE` env vars work too.
- First recording: Edge asks for microphone permission, click Allow. The old CLI is still `npm run phone:cli`.

## Wi-Fi fallback (B4)
Try the normal commands first. If `peer connected` doesn't appear within ~20 s:
1. Put **both laptops on a phone hotspot** (eduroam usually isolates clients). No internet is needed after this.
2. On the **office PC**, terminal 1: `cd sync; node bootstrap.js`. It prints its address, e.g. `192.168.43.10:49737`.
3. Office PC, terminal 2: `cd sync; $env:FOBE_BOOTSTRAP="192.168.43.10:49737"; node demo-office.js`
4. Work phone: `cd sync; $env:FOBE_BOOTSTRAP="192.168.43.10:49737"; node demo-phone.js <PAIRING-KEY> --backup`
5. If the phone still can't connect, the office PC's firewall is blocking inbound UDP. In an **admin** PowerShell on the office PC, run
   `New-NetFirewallRule -DisplayName "FOBE node" -Direction Inbound -Program (Get-Command node).Source -Action Allow -Profile Any`
   (remove it afterwards with `Remove-NetFirewallRule -DisplayName "FOBE node"`). Check with `ping <office IP>` from the phone laptop.
- Test on one laptop: terminal 1 `node bootstrap.js --host 127.0.0.1`, then add `--bootstrap 127.0.0.1:49737` to both demo commands.
- For the UI: set `$env:FOBE_BOOTSTRAP` before `npm start`. `startPeer` and `replicaDb` read it automatically.

## Encryption at rest (B5)
Use a **new** folder: an existing plain DB can't be switched to encrypted. Use the same passphrase on both laptops.
- Office: `cd sync; $env:FOBE_DB_PASSPHRASE="fobe demo"; node seed.js ./data/office-secure; node demo-office.js --dir ./data/office-secure`
- Phone: `cd sync; $env:FOBE_DB_PASSPHRASE="fobe demo"; node demo-phone.js <KEY> --backup --dir ./data/phone-secure`
- Blind backup demo: run the phone command without the passphrase (and a different `--dir`). It prints `encrypted backup: N blocks stored (ciphertext only...)`.
- Show it on screen: `Select-String -Path data\office-pc\db\* -Pattern Maryam -SimpleMatch -List` finds the name in the plain DB. The same command on `data\office-secure\db\*` finds nothing.
- UI: set `$env:FOBE_DB_PASSPHRASE` before `npm start`. `openDb`, `startPeer` and `replicaDb` pick it up automatically.

## For the UI (Person C): office side in ui/server.js
```js
import path from 'node:path'
import { openDb, startPeer, onFileReceived } from '../sync/index.js'
const db = await openDb(path.join(import.meta.dirname, '../sync/data/office-pc'))
const peer = await startPeer({ db, role: 'office' })   // peer.pairingKey -> show on screen
peer.onPeer(p => ...)                                  // { name, role }
onFileReceived(f => ...)                               // { name, path, from, size, receivedAt }
```
Only one process can open `sync/data/office-pc` at a time, so stop `demo-office.js` before starting the UI.
