# Browser Game Studio

Monorepo for agentic browser-game development: shared runtime packages, per-tool apps, and games that consume them. **Beach Buggy** is the first game.

## Layout

```
games/beach-buggy     playable racer + unified dev studio (dev only)
packages/core         SceneDocument, assets manifest, input, sceneOps
packages/physics      arcade World.step
packages/assets       glTF / texture loaders
packages/three-render pose bind
tools/import-cli
tools/feedback-cli
tools/pipeline-smoke
```

## Setup

```bash
npm run setup
```

Installs npm dependencies, Playwright Chromium, links Blender to `~/.local/bin`, and runs unit tests.

Requires **Node.js 20+** and **Blender** (macOS app at `/Applications/Blender.app`).

## Run

```bash
npm install
npm run dev          # http://localhost:5173 — game + dev studio rails
```

In **dev**, the game loads with left/right studio rails: **Map** (scene editor), **Assets** (drag glTF onto canvas), **Texture**, **Anim**, and right-rail **Inspect** / **Tune**. Toggle rails with **Hide studio**. **Edit** pauses physics and enables orbit + gizmos; **Play** rebuilds Rapier and races.

Production `vite build` stays full-bleed (no rails).

Beach Buggy: WASD / arrows, Space boost, R restart, **F8** (or `` ` ``) to file a feedback report. See [AGENTS.md](AGENTS.md).

```bash
npm run feedback:latest   # newest in-game report as JSON
```

Import an asset (CLI for agents):

```bash
npm run import -w @studio/import-cli -- --file ./model.glb --id buggy --game beach-buggy
```

In dev you can also drop `.glb` / `.png` onto the studio panels or canvas (POST `/api/assets`).

## Test

```bash
npm test
npx playwright install chromium   # once
npm run test:pipeline
```

`test:pipeline` writes deterministic fixture glTF/PNG (not AI), imports them, attaches them to a scene, steps physics, then boots the game in Playwright.

## Add another game

1. Copy `games/beach-buggy` to `games/my-game` and rename the package `@studio/my-game`.
2. Depend on `@studio/core`, `@studio/physics`, `@studio/assets`, `@studio/three-render`.
3. Load a `SceneDocument` JSON; omit `track` if you are not making a racer.
4. Add `"dev:my-game": "npm run dev -w @studio/my-game"` at the repo root.
