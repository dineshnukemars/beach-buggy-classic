# Beach Buggy Classic — local singleplayer + AI

## Scope (this phase) — local play ready

Browser Beach Buggy–style race **locally**:
- Three.js + TypeScript + Vite (no WASM)
- Player buggy + 3 AI opponents on one looping beach track
- Arcade controls, boost pads, 3 laps, place HUD, finish screen
- **Deferred:** Colyseus / multiplayer / Docker / AWS

## Run

```bash
npm install
npm run dev
```

Open http://localhost:5173 — Start Race, WASD/arrows, Space boost, R restart.

## Later

- Multiplayer authoritative server
- Docker + AWS deploy
