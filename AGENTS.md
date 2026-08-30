# Agent playbook

Beach Buggy is iterated with in-game feedback reports. Humans mark what looks wrong; agents patch data or code.

## Read the latest report

```bash
npm run feedback:latest
```

That prints the newest `FeedbackReport` JSON from `games/beach-buggy/feedback/*/report.json`. Also open:

- `screenshot.png` in the same folder
- `pose-history.jsonl` (player pose, airborne time, wheel contacts, collisions)

```bash
npm run show -w @studio/feedback-cli -- --id <id> --json
npm run list -w @studio/feedback-cli -- --json
```

Example fixture (committed): `tools/feedback-cli/fixtures/example/report.json`.

## How a human files a report

1. `npm run dev` (game + studio on http://localhost:5173).
2. Switch to **Play**, start a race. Press **F8** (or `` ` ``). Lookback is frozen first, then physics pauses so you can click. Shift+F8 inspects without pausing.
3. Click the object. Add tags (`jumpy`, `misaligned`, …) and a note. Submit.
4. The Vite dev server writes `games/beach-buggy/feedback/{id}/`.

## Dev studio (same port)

`npm run dev` opens the unified studio: **Map** edits `public/scenes/*.json` via `/api/scenes`; **Assets** / **Texture** panels drag onto the live canvas; **Anim** plays glTF clips on selected entities. **Edit** mode uses orbit + gizmos on the game canvas (one WebGL context). **Play** rebuilds Rapier from the in-memory scene.

Scenes save to `games/beach-buggy/public/scenes/`. Asset drops call `POST /api/assets` (wraps `@studio/import-cli`).

## Run the sim probe

```bash
npm run sim:probe
```

That runs the Rapier scenario suite and writes `packages/physics/.tmp/sim-report.json` plus per-scenario `*.clip.json`. Exit is non-zero when any invariant fails.

1. Read the report: scenario PASS/FAIL lines, `violations[]`, and `hintFiles`.
2. Open the matching `packages/physics/.tmp/<scenario>.clip.json` if you need pose/wheel traces.
3. Patch hinted files first (tuning JSON before code).
4. Re-run `npm run sim:probe` until it is green, then `npm test`.
5. Use F8 feedback reports for things the sim cannot see (camera, lighting, mesh alignment).

`npm run drive:probe` is an alias for the same suite.

## How an agent fixes it

1. Run `npm run feedback:latest`.
2. Read `target`, `issue`, `agentHints`, `pose-history.jsonl`, and `screenshot.png`.
3. Patch hinted files first (scene/tuning JSON before code). Environment picks usually mean `games/beach-buggy/src/visuals.ts`.
4. Run `npm test` and `npm run test:pipeline`.
5. A human re-plays to confirm taste. Pipeline-smoke boots the canvas; it does not race or screenshot, so it will not catch “palm misaligned” by itself.
