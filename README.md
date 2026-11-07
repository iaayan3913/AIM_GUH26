# FOBE Care Plan AI

Local-first AI that turns family-visit recordings and handwritten notes into care plans for disabled children at FOBE (Friends of Bright Eyes). Nothing leaves the building: AI runs on-device with Tether QVAC, devices sync peer-to-peer with Holepunch, and the family worker signs off with a YubiKey.

Great Uni Hack 2026 · Tether track. See **BRIEF.md** for the full plan.

## Run (office PC / Vivobook)
```
cd sync && npm install && npm run seed && cd ..
cd ai   && npm install && cd ..
cd ui   && npm install && npm start      # http://localhost:3000
```

## Progress
- [ai/CHECKPOINTS.md](ai/CHECKPOINTS.md)
- [sync/CHECKPOINTS.md](sync/CHECKPOINTS.md)
- [ui/CHECKPOINTS.md](ui/CHECKPOINTS.md)

## Git rules (so three people can push at the same time with no conflicts)
1. **Only edit your own folder** (`ai/`, `sync/` or `ui/`). `shared/` is frozen; to change it, tell the team, and one person makes the edit.
2. Each folder has its **own package.json and lockfile**. Never create a root package.json, and never run `npm install` from the root.
3. Everyone works on `main`. Before pushing, always run: `git add <your-folder> && git commit -m "[<folder>] ..." && git pull --rebase && git push`
4. Never `git push --force`, never `git add .` from the root, and never commit `node_modules`, models, `data/` or recordings (already in .gitignore).
5. If `git pull --rebase` ever reports a conflict, stop and check: it means someone edited outside their folder.

All child data in this repo is fake.
