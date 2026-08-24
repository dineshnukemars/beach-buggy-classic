import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import { dirname, extname, join, resolve } from 'node:path'
import { emptyManifest, upsertAsset, type AssetKind, type AssetManifest } from '@studio/core'
import { validateAssetFile } from './validate.ts'

export function studioRoot(from = process.cwd()): string {
  let dir = resolve(from)
  for (let i = 0; i < 8; i++) {
    const pkg = join(dir, 'package.json')
    if (existsSync(pkg)) {
      const json = JSON.parse(readFileSync(pkg, 'utf8')) as { workspaces?: string[] }
      if (json.workspaces) return dir
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return resolve(from)
}

export function gameAssetsDir(root: string, game: string, ci: boolean): string {
  const base = join(root, 'games', game, 'public', 'assets')
  return ci ? join(base, '_ci') : base
}

export function importFile(opts: {
  file: string
  game: string
  id: string
  kind?: AssetKind
  ci?: boolean
  root?: string
}): { dest: string; manifestPath: string } {
  const root = opts.root ?? studioRoot()
  const src = resolve(opts.file)
  if (!existsSync(src)) throw new Error(`File not found: ${src}`)
  const kind = opts.kind ?? inferKind(src)
  validateAssetFile(src, kind)

  const destDir = gameAssetsDir(root, opts.game, Boolean(opts.ci))
  mkdirSync(destDir, { recursive: true })
  const destName = `${opts.id}${extname(src) || (kind === 'gltf' ? '.gltf' : '.png')}`
  const dest = join(destDir, destName)
  copyFileSync(src, dest)

  const assetsRoot = join(root, 'games', opts.game, 'public', 'assets')
  mkdirSync(assetsRoot, { recursive: true })
  const manifestPath = join(assetsRoot, 'manifest.json')
  let manifest: AssetManifest = emptyManifest()
  if (existsSync(manifestPath)) {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as AssetManifest
  }
  const rel = opts.ci ? `assets/_ci/${destName}` : `assets/${destName}`
  manifest = upsertAsset(manifest, { id: opts.id, kind, path: rel, scale: 1 })
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
  return { dest, manifestPath }
}

function inferKind(file: string): AssetKind {
  const ext = extname(file).toLowerCase()
  if (ext === '.gltf' || ext === '.glb') return 'gltf'
  if (ext === '.png' || ext === '.jpg' || ext === '.jpeg' || ext === '.webp') return 'texture'
  if (ext === '.mp3' || ext === '.ogg' || ext === '.wav') return 'audio'
  throw new Error(`Unknown asset kind for ${file}`)
}
