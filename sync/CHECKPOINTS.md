# /sync checkpoints (Person B)

Status key: ⬜ not started · 🟨 in progress · ✅ done · ❌ blocked (write why)
**Claude: update this file after every checkpoint, then commit `[sync] B<n> done` and push.**

| # | Checkpoint | Done when | Target | Status | Notes |
|---|---|---|---|---|---|
| B0 | Local DB on Windows | `npm install` then `npm test` and `npm run seed` pass on BOTH laptops (already passing on Linux) | 13:45 | ✅ (Galaxy Book) · Vivobook pending | Galaxy Book (Win11 arm64, Node 25.4 arm64): all native modules (rocksdb, sodium, udx) load natively, **no x64 Node needed**. test + seed pass. Added deps hyperdrive, hyperdht. Vivobook: run the same 3 commands. |
| B1 | Pairing | `startPeer()` on two laptops on the same Wi-Fi connects via Hyperswarm using a pairing key; both print "peer connected" | 14:30 | ⬜ | |
| B2 | Phone → office file transfer | "phone" laptop sends `demo-visit.wav` + notes photo, and the office receives it in `data/inbox/` through `onFileReceived` | 15:15 | ⬜ | |
| B3 | Read-only backup replica | `replicaDb()` on laptop 2 shows the office's care plans and updates live when the office edits; writing to it is refused | 15:45 | ⬜ | |
| B4 | Venue Wi-Fi fallback | if peers can't find each other, run a local HyperDHT bootstrap on the LAN (or a hotspot) and document the exact command here | 16:00 | ⬜ | |
| B5 | Encryption at rest (stretch) | the data folder isn't readable as plain text; document the method used | 16:15 | ⬜ | |

## Demo commands (fill in once they work)
- Office PC: `...`
- Work phone laptop: `...`
