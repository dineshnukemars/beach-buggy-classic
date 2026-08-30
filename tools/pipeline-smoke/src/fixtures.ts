import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Tiny triangle glTF 2.0 (embedded buffer). */
export function minimalGltfJson(): string {
  return JSON.stringify({
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 3,
        type: 'VEC3',
        max: [1, 1, 0],
        min: [0, 0, 0],
      },
    ],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }],
    buffers: [
      {
        byteLength: 36,
        uri: 'data:application/octet-stream;base64,AAAAAAAAAAAAAAAAAACAPwAAAAAAAAAAAAAAAAAAgD8AAAAA',
      },
    ],
  })
}

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

export function writeFixtures(dir: string): { gltf: string; png: string } {
  mkdirSync(dir, { recursive: true })
  const gltf = join(dir, 'ci-cube.gltf')
  const png = join(dir, 'ci-sand.png')
  writeFileSync(gltf, minimalGltfJson())
  writeFileSync(png, PNG_1X1)
  return { gltf, png }
}
