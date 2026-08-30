import type { SceneDocument, SceneEntity, Vec3Tuple } from '@studio/core'
import { parseSceneDocument } from '@studio/core'
import { createDefaultBeachScene } from '@studio/physics'

export type Selection =
  | { kind: 'point'; index: number }
  | { kind: 'entity'; id: string }
  | null

export function cloneDoc(doc: SceneDocument): SceneDocument {
  return parseSceneDocument(JSON.parse(JSON.stringify(doc)))
}

export function ensureTrack(doc: SceneDocument): SceneDocument {
  if (doc.track) return doc
  const beach = createDefaultBeachScene()
  return { ...doc, track: beach.track }
}

export function setSceneId(doc: SceneDocument, id: string): SceneDocument {
  return { ...doc, id: id.trim() || doc.id }
}

export function setHalfWidth(doc: SceneDocument, halfWidth: number): SceneDocument {
  const withTrack = ensureTrack(doc)
  return { ...withTrack, track: { ...withTrack.track!, halfWidth } }
}

export function setCenterlinePoint(doc: SceneDocument, index: number, point: Vec3Tuple): SceneDocument {
  const withTrack = ensureTrack(doc)
  const centerline = withTrack.track!.centerline.map((p, i) => (i === index ? point : p))
  return { ...withTrack, track: { ...withTrack.track!, centerline } }
}

export function insertCenterlinePoint(doc: SceneDocument, afterIndex: number): SceneDocument {
  const withTrack = ensureTrack(doc)
  const pts = withTrack.track!.centerline
  const a = pts[afterIndex]!
  const b = pts[(afterIndex + 1) % pts.length]!
  const mid: Vec3Tuple = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]
  const centerline = [...pts.slice(0, afterIndex + 1), mid, ...pts.slice(afterIndex + 1)]
  return { ...withTrack, track: { ...withTrack.track!, centerline } }
}

export function removeCenterlinePoint(doc: SceneDocument, index: number): SceneDocument {
  const withTrack = ensureTrack(doc)
  const pts = withTrack.track!.centerline
  if (pts.length <= 3) throw new Error('track needs at least 3 points')
  const centerline = pts.filter((_, i) => i !== index)
  return { ...withTrack, track: { ...withTrack.track!, centerline } }
}

export function upsertEntity(doc: SceneDocument, entity: SceneEntity): SceneDocument {
  const rest = doc.entities.filter((e) => e.id !== entity.id)
  return { ...doc, entities: [...rest, entity] }
}

export function removeEntity(doc: SceneDocument, id: string): SceneDocument {
  return { ...doc, entities: doc.entities.filter((e) => e.id !== id) }
}

export function nextEntityId(doc: SceneDocument, assetId: string): string {
  const base = assetId.replace(/[^a-zA-Z0-9_-]/g, '_') || 'prop'
  let n = 1
  const ids = new Set(doc.entities.map((e) => e.id))
  while (ids.has(`${base}-${n}`)) n += 1
  return `${base}-${n}`
}

export function createEntity(doc: SceneDocument, assetId: string, position: Vec3Tuple): SceneEntity {
  return {
    id: nextEntityId(doc, assetId),
    assetId,
    position,
    rotationY: 0,
    scale: 1,
    collider: { type: 'box', halfExtents: [0.5, 0.5, 0.5] },
  }
}
