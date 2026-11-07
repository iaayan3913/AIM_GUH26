# Module contract (FROZEN: only change it after telling the whole team)

This is how the three folders talk to each other. Build against these exact function names, and mock the other folders until integration.

## Care plan format
See `careplan.example.json`. Every leaf field is:
```json
{ "value": <any or null>, "source": "<quote from transcript/notes or null>", "status": "filled" | "needs_review" | "missing" }
```
`child_id`, `photo_path`, `approved_by`, `approved_at` and `saved_at` are plain values (not wrapped).
`age` is NOT stored. Compute it from `dob` with `ageFromDob()` in `sync/db.js`.
Review due date = `last_updated` + 1 year (`reviewDue()` in `sync/db.js`).

## /ai (Person A) exports from `ai/index.js`
```js
transcribe(audioPath)            -> { language, original, english, segments: [{ start, end, text, english }] }
ocrNotes(imagePath)              -> { text }
draftCarePlan({ childId, transcript, notes, existingPlan? })   -> carePlan   // status per field, never guesses
lanyardText(carePlan, optIns = []) -> string (<= 130 chars)
```
All functions are async. Each one may emit progress through an optional last argument `onProgress(stage, percent)`.

## /sync (Person B) exports from `sync/index.js`
`sync/db.js` already works (tested): `openDb(dir)` -> `{ putPlan, getPlan, listPlans, history, key, writable, close }`.
Person B adds:
```js
startPeer({ db, role: 'office' | 'phone', pairingKey? })  -> { pairingKey, onPeer(cb), close() }
sendFile(peer, filePath)          // phone -> office: visit recording / photo of notes
onFileReceived(cb)                // office gets { name, path, from }
replicaDb(dir, officeDbKey)       // read-only backup copy of the plans on another device
```

## /ui (Person C) owns the running app
`ui/server.js` = Express on http://localhost:3000. Only the UI imports `../ai` and `../sync`.
Until integration, the UI uses `ui/mock.js` (fake responses with the same shapes as above).

## Folder ownership
| Folder | Owner | Who else may edit |
|---|---|---|
| `/ai` | Person A | nobody |
| `/sync` | Person B | nobody |
| `/ui` | Person C | nobody |
| `/shared` | frozen | change only after telling the team (one person makes the edit) |
| root `README.md`, `.gitignore` | Mehraz | nobody |
