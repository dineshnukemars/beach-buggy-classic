export type Vec3Tuple = [number, number, number]

export type TrackSpec = {
  halfWidth: number
  centerline: Vec3Tuple[]
  boostPads: number[]
  checkpoints?: number[]
}

export type EntityCollider = {
  type: 'box'
  halfExtents: Vec3Tuple
}

export type SceneEntity = {
  id: string
  assetId: string
  position: Vec3Tuple
  rotationY: number
  scale: number
  collider?: EntityCollider
}

export type SceneDocument = {
  version: 1
  id: string
  track?: TrackSpec
  entities: SceneEntity[]
}

export function parseSceneDocument(raw: unknown): SceneDocument {
  if (!raw || typeof raw !== 'object') throw new Error('SceneDocument must be an object')
  const doc = raw as SceneDocument
  if (doc.version !== 1) throw new Error('SceneDocument.version must be 1')
  if (typeof doc.id !== 'string' || !doc.id) throw new Error('SceneDocument.id required')
  if (!Array.isArray(doc.entities)) throw new Error('SceneDocument.entities required')
  if (doc.track) {
    if (!Array.isArray(doc.track.centerline) || doc.track.centerline.length < 3) {
      throw new Error('track.centerline needs at least 3 points')
    }
    if (typeof doc.track.halfWidth !== 'number' || doc.track.halfWidth <= 0) {
      throw new Error('track.halfWidth must be a positive number')
    }
    if (!Array.isArray(doc.track.boostPads)) throw new Error('track.boostPads required')
  }
  return doc
}

export function emptyScene(id: string): SceneDocument {
  return { version: 1, id, entities: [] }
}
