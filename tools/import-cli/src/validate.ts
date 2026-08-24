import { readFileSync, statSync } from 'node:fs'
import type { AssetKind } from '@studio/core'

const MAX_BYTES = 40 * 1024 * 1024

export function validateAssetFile(path: string, kind: AssetKind): void {
  const st = statSync(path)
  if (st.size <= 0) throw new Error(`Empty file: ${path}`)
  if (st.size > MAX_BYTES) throw new Error(`File too large: ${path}`)
  if (kind === 'gltf') {
    const buf = readFileSync(path)
    if (buf.subarray(0, 4).toString() === 'glTF') return
    const text = buf.toString('utf8')
    const json = JSON.parse(text) as { asset?: { version?: string } }
    if (!json.asset?.version) throw new Error('glTF missing asset.version')
  }
}
