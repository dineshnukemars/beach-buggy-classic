#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "==> Installing npm dependencies"
npm install

echo "==> Installing Playwright Chromium (for pipeline smoke tests)"
npx playwright install chromium

echo "==> Linking Blender into ~/.local/bin (if installed on macOS)"
BLENDER_APP="/Applications/Blender.app/Contents/MacOS/Blender"
LOCAL_BIN="${HOME}/.local/bin"
mkdir -p "$LOCAL_BIN"
if [[ -x "$BLENDER_APP" ]]; then
  cp "$ROOT/scripts/blender" "$LOCAL_BIN/blender"
  chmod +x "$LOCAL_BIN/blender"
  echo "    installed wrapper: $LOCAL_BIN/blender"
else
  echo "    skip: Blender not found at $BLENDER_APP"
  echo "    install Blender, then re-run: npm run setup"
fi

echo "==> Verifying toolchain"
node -v
npm -v
if command -v blender >/dev/null 2>&1; then
  blender --version | head -1
  blender --background --python-expr "import bpy; print('bpy ok')" 2>/dev/null | tail -1
else
  echo "blender: not on PATH (add ~/.local/bin to your shell if needed)"
fi
npx gltf-transform --help >/dev/null && echo "gltf-transform: ok"

echo "==> Running unit tests"
npm test

echo ""
echo "Setup complete. Dev server:"
echo "  npm run dev          http://localhost:5173 (game + unified studio rails)"
echo ""
echo "Optional: npm run test:pipeline"
