# /sync checkpoints (Person B)

Status key: ⬜ not started · 🟨 in progress · ✅ done · ❌ blocked (write why)
**Claude: update this file after every checkpoint, then commit `[sync] B<n> done` and push.**

| # | Checkpoint | Done when | Target | Status | Notes |
|---|---|---|---|---|---|
| B0 | Local DB on Windows | `npm install` then `npm test` and `npm run seed` pass on BOTH laptops (already passing on Linux) | 13:45 | ✅ (Galaxy Book) · Vivobook pending | Galaxy Book (Win11 arm64, Node 25.4 arm64): all native modules (rocksdb, sodium, udx) load natively, **no x64 Node needed**. test + seed pass. Vivobook: run the same 3 commands. |
| B1 | Pairing | `startPeer()` on two laptops on the same Wi-Fi connects via Hyperswarm using a pairing key; both print "peer connected" | 14:30 | ✅ (one laptop, 2 terminals) · 2-laptop pending | Pairing key = 80 random bits, shown as `xxxx-xxxx-xxxx-xxxx` (case/dashes ignored), saved so the phone pairs once. Topic = hash(key); each side proves it knows the key (hash of key + Noise handshake hash), otherwise the connection is dropped. Phone re-queries the DHT every 5 s while disconnected. Connects in ~2–6 s over the public DHT. |
| B2 | Phone → office file transfer | "phone" laptop sends `demo-visit.wav` + notes photo, and the office receives it in `data/inbox/` through `onFileReceived` | 15:15 | ✅ (one laptop) | Phone writes files into its own Hyperdrive "outbox"; the office replicates it and copies new files to `sync/data/inbox/` (path is fixed to the sync folder, whatever the cwd). Files sent while the office is offline are queued and delivered on the next connection (good for the "Wi-Fi on" demo moment). Each file is delivered once (`data/inbox/.received.json`). |
| B3 | Read-only backup replica | `replicaDb()` on laptop 2 shows the office's care plans and updates live when the office edits; writing to it is refused | 15:45 | ✅ (one laptop) | Phone gets the office DB key automatically after pairing. Replica downloads the full core, so it still works with the office off. `putPlan` throws "Read-only backup..."; raw Hyperbee writes also fail (not the writer). `onChange(cb)` fires on live updates. |
| B4 | Venue Wi-Fi fallback | if peers can't find each other, run a local HyperDHT bootstrap on the LAN (or a hotspot) and document the exact command here | 16:00 | ⬜ | |
| B5 | Encryption at rest (stretch) | the data folder isn't readable as plain text; document the method used | 16:15 | ⬜ | |

## Tests
```
cd sync
npm test            # db: list/get/edit/history
npm run test:p2p    # B1+B2+B3 end to end, on one machine with a private in-process DHT (no internet)
```

## Demo commands (PowerShell, from the repo root)
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
