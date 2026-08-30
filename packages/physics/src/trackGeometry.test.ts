import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as THREE from 'three'
import { buildTrackBoxes, buildTrackRibbon } from './trackGeometry'
import { buildTrackSamples, createTrackCenterline, trackLength } from './track'

test('road ribbon triangles face +Y', () => {
  const samples = buildTrackSamples(createTrackCenterline(32))
  const ribbon = buildTrackRibbon(samples, trackLength(samples), 7.5, [])
  const pos = ribbon.positions
  const idx = ribbon.indices
  let minY = Infinity
  for (let t = 0; t < idx.length; t += 3) {
    const verts = [idx[t]!, idx[t + 1]!, idx[t + 2]!].map((i) =>
      new THREE.Vector3(pos[i * 3]!, pos[i * 3 + 1]!, pos[i * 3 + 2]!),
    )
    const normal = verts[1]!.clone().sub(verts[0]!).cross(verts[2]!.clone().sub(verts[0]!)).normalize()
    assert.ok(normal.y > 0.4, `triangle ${t / 3} normal.y=${normal.y}`)
    minY = Math.min(minY, normal.y)
  }
  assert.ok(minY > 0.4)
})

test('track boxes sit under the ribbon and cover the loop', () => {
  const samples = buildTrackSamples(createTrackCenterline(32))
  const boxes = buildTrackBoxes(samples, 7.5)
  assert.ok(boxes.length >= 32)
  for (const box of boxes) {
    assert.ok(box.halfExtents[0] === 7.5)
    assert.ok(box.halfExtents[1] > 0.1)
    assert.ok(box.halfExtents[2] > 0.2)
  }
})
