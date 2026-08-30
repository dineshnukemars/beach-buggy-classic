import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  cloneDoc,
  createEntity,
  ensureTrack,
  insertCenterlinePoint,
  removeCenterlinePoint,
  removeEntity,
  rotatedColliderOffset,
  setCenterlinePoint,
  setGroundTexture,
  setHalfWidth,
  setSceneId,
  setTrackTexture,
  upsertEntity,
} from './sceneOps'
import { parseSceneDocument } from './scene'

const baseDoc = parseSceneDocument({
  version: 1,
  id: 'test',
  track: {
    halfWidth: 7.5,
    centerline: [
      [0, 0, 0],
      [10, 0, 0],
      [10, 0, 10],
    ],
    boostPads: [0.5],
  },
  entities: [{ id: 'e1', assetId: 'box', position: [1, 0, 1], rotationY: 0, scale: 1 }],
})

test('cloneDoc deep clones', () => {
  const copy = cloneDoc(baseDoc)
  copy.entities[0]!.position[0] = 99
  assert.notEqual(baseDoc.entities[0]!.position[0], 99)
})

test('ensureTrack adds track when missing', () => {
  const bare = parseSceneDocument({ version: 1, id: 'bare', entities: [] })
  const withTrack = ensureTrack(bare)
  assert.ok(withTrack.track)
  assert.ok(withTrack.track!.centerline.length >= 3)
})

test('setHalfWidth updates track', () => {
  const doc = setHalfWidth(baseDoc, 12)
  assert.equal(doc.track!.halfWidth, 12)
})

test('setCenterlinePoint updates one point', () => {
  const doc = setCenterlinePoint(baseDoc, 1, [5, 1, 5])
  assert.deepEqual(doc.track!.centerline[1], [5, 1, 5])
})

test('insertCenterlinePoint adds midpoint', () => {
  const before = baseDoc.track!.centerline.length
  const doc = insertCenterlinePoint(baseDoc, 0)
  assert.equal(doc.track!.centerline.length, before + 1)
})

test('removeCenterlinePoint removes point', () => {
  const fourPoint = insertCenterlinePoint(baseDoc, 1)
  const doc = removeCenterlinePoint(fourPoint, 1)
  assert.equal(doc.track!.centerline.length, 3)
})

test('removeCenterlinePoint needs at least 3 points', () => {
  const tiny = parseSceneDocument({
    version: 1,
    id: 'tiny',
    track: {
      halfWidth: 5,
      centerline: [
        [0, 0, 0],
        [1, 0, 0],
        [1, 0, 1],
      ],
      boostPads: [],
    },
    entities: [],
  })
  assert.throws(() => removeCenterlinePoint(tiny, 0))
})

test('upsertEntity replaces by id', () => {
  const entity = { ...baseDoc.entities[0]!, position: [2, 0, 2] as const }
  const doc = upsertEntity(baseDoc, entity)
  assert.equal(doc.entities.length, 1)
  assert.deepEqual(doc.entities[0]!.position, [2, 0, 2])
})

test('removeEntity drops entity', () => {
  const doc = removeEntity(baseDoc, 'e1')
  assert.equal(doc.entities.length, 0)
})

test('createEntity assigns unique id', () => {
  const e1 = createEntity(baseDoc, 'palm', [0, 0, 0])
  const doc = upsertEntity(baseDoc, e1)
  const e2 = createEntity(doc, 'palm', [1, 0, 1])
  assert.notEqual(e1.id, e2.id)
})

test('setSceneId trims id', () => {
  assert.equal(setSceneId(baseDoc, '  new-id  ').id, 'new-id')
})

test('setGroundTexture and setTrackTexture update look', () => {
  let doc = setGroundTexture(baseDoc, 'sand')
  assert.equal(doc.look?.groundTextureId, 'sand')
  doc = setTrackTexture(doc, 'asphalt')
  assert.equal(doc.look?.trackTextureId, 'asphalt')
  doc = setGroundTexture(doc, undefined)
  assert.equal(doc.look?.groundTextureId, undefined)
  assert.equal(doc.look?.trackTextureId, 'asphalt')
})

test('rotatedColliderOffset rotates around Y and scales', () => {
  const rotated = rotatedColliderOffset([1, 0, 0], Math.PI / 2, 2)
  assert.ok(Math.abs(rotated[0]) < 1e-10)
  assert.equal(rotated[1], 0)
  assert.equal(rotated[2], -2)
  assert.deepEqual(rotatedColliderOffset(undefined, 0, 1), [0, 0, 0])
})
