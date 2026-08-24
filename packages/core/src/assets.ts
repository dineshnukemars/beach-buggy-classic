export type AssetKind = 'gltf' | 'texture' | 'audio'

export type AssetRef = {
  id: string
  kind: AssetKind
  path: string
  scale?: number
  wheelNodes?: string[]
}

export type AssetManifest = {
  version: 1
  assets: AssetRef[]
}

export function emptyManifest(): AssetManifest {
  return { version: 1, assets: [] }
}

export function upsertAsset(manifest: AssetManifest, ref: AssetRef): AssetManifest {
  const rest = manifest.assets.filter((a) => a.id !== ref.id)
  return { version: 1, assets: [...rest, ref] }
}

export function getAsset(manifest: AssetManifest, id: string): AssetRef | undefined {
  return manifest.assets.find((a) => a.id === id)
}
