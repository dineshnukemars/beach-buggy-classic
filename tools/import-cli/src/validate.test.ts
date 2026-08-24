import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { validateAssetFile } from './validate.ts'

test('validateAssetFile accepts minimal glTF JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gltf-'))
  const file = join(dir, 'box.gltf')
  writeFileSync(
    file,
    JSON.stringify({
      asset: { version: '2.0' },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ mesh: 0 }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
      accessors: [
        { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', max: [1, 1, 0], min: [0, 0, 0] },
      ],
      bufferViews: [{ buffer: 0, byteLength: 36 }],
      buffers: [{ byteLength: 36, uri: 'data:application/octet-stream;base64,AAAAAAAAAAAAAAAAAACAPwAAAAAAAAAAAAAAAAAAgD8AAAAA' }],
    }),
  )
  validateAssetFile(file, 'gltf')
})

test('validateAssetFile rejects empty', () => {
  const dir = mkdtempSync(join(tmpdir(), 'empty-'))
  const file = join(dir, 'x.gltf')
  writeFileSync(file, '')
  assert.throws(() => validateAssetFile(file, 'gltf'))
})
