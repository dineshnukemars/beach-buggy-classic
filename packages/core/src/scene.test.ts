import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseSceneDocument } from './scene'

test('parseSceneDocument accepts a valid track scene', () => {
  const doc = parseSceneDocument({
    version: 1,
    id: 'test',
    track: {
      halfWidth: 7.5,
      centerline: [
        [0, 0, 0],
        [1, 0, 0],
        [1, 0, 1],
      ],
      boostPads: [0, 0.5],
    },
    entities: [{ id: 'e1', assetId: 'box', position: [0, 0, 0], rotationY: 0, scale: 1 }],
  })
  assert.equal(doc.id, 'test')
  assert.equal(doc.entities.length, 1)
})

test('parseSceneDocument rejects bad version', () => {
  assert.throws(() => parseSceneDocument({ version: 2, id: 'x', entities: [] }))
})

test('parseSceneDocument rejects bad entity collider', () => {
  assert.throws(() =>
    parseSceneDocument({
      version: 1,
      id: 'test',
      entities: [
        {
          id: 'e1',
          assetId: 'box',
          position: [0, 0, 0],
          rotationY: 0,
          scale: 1,
          collider: { type: 'sphere', halfExtents: [1, 1, 1] },
        },
      ],
    }),
  )
})

test('parseSceneDocument rejects boost pad outside [0, 1)', () => {
  assert.throws(() =>
    parseSceneDocument({
      version: 1,
      id: 'test',
      track: {
        halfWidth: 7.5,
        centerline: [
          [0, 0, 0],
          [1, 0, 0],
          [1, 0, 1],
        ],
        boostPads: [1],
      },
      entities: [],
    }),
  )
})
