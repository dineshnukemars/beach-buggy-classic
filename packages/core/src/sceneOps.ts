import type { SceneDocument, SceneEntity, Vec3Tuple } from './scene'
import { parseSceneDocument } from './scene'

export type Selection =
  | { kind: 'point'; index: number }
  | { kind: 'entity'; id: string }
  | { kind: 'player' }
  | null

export function cloneDoc(doc: SceneDocument): SceneDocument {
  return parseSceneDocument(JSON.parse(JSON.stringify(doc)))
}

const DEFAULT_TRACK = {
  halfWidth: 7.5,
  centerline: [
    [0, 0, 0],
    [40, 0, 0],
    [40, 0, 40],
    [0, 0, 40],
  ] as Vec3Tuple[],
  boostPads: [0.25, 0.75] as number[],
}

export function ensureTrack(doc: SceneDocument): SceneDocument {
  if (doc.track) return doc
  return { ...doc, track: { ...DEFAULT_TRACK, centerline: [...DEFAULT_TRACK.centerline] } }
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

/** Entity-local collider offset rotated by rotationY and scaled for world placement. */
export function rotatedColliderOffset(
  offset: Vec3Tuple | undefined,
  rotationY: number,
  scale: number,
): Vec3Tuple {
  if (!offset) return [0, 0, 0]
  const [ox, oy, oz] = offset
  const cos = Math.cos(rotationY)
  const sin = Math.sin(rotationY)
  return [(ox * cos + oz * sin) * scale, oy * scale, (-ox * sin + oz * cos) * scale]
}

export function setGroundTexture(doc: SceneDocument, textureId: string | undefined): SceneDocument {
  const look = { ...doc.look, groundTextureId: textureId }
  if (!textureId) delete look.groundTextureId
  return { ...doc, look: Object.keys(look).length ? look : undefined }
}

export function setTrackTexture(doc: SceneDocument, textureId: string | undefined): SceneDocument {
  const look = { ...doc.look, trackTextureId: textureId }
  if (!textureId) delete look.trackTextureId
  return { ...doc, look: Object.keys(look).length ? look : undefined }
}
