# Browser Game Studio

Monorepo for agentic browser-game development: shared runtime packages, per-tool apps, and games that consume them. **Beach Buggy** is the first game.

## Layout

```
games/beach-buggy     playable racer
packages/core         SceneDocument, assets manifest, input
packages/physics      arcade World.step
packages/assets       glTF / texture loaders
packages/three-render pose bind
tools/gltf-preview
tools/texture-preview
tools/animation-preview
tools/scene-editor
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
npm run dev:game      # http://localhost:5173
npm run dev:gltf      # :5174
npm run dev:texture   # :5175
npm run dev:anim      # :5176
npm run dev:scene     # :5177
```

Beach Buggy: WASD / arrows, Space boost, R restart, **F8** (or `` ` ``) to file a feedback report. See [AGENTS.md](AGENTS.md).

```bash
npm run feedback:latest   # newest in-game report as JSON
```

Import an asset (after an agent writes a file):

```bash
npm run import -w @studio/import-cli -- --file ./model.glb --id buggy --game beach-buggy
```

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
