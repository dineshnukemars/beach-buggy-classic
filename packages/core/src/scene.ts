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
  offset?: Vec3Tuple
}

export type SceneEntity = {
  id: string
  assetId: string
  position: Vec3Tuple
  rotationY: number
  scale: number
  opacity?: number
  collider?: EntityCollider
}

export type SceneLook = {
  groundTextureId?: string
  trackTextureId?: string
}

export type SceneDocument = {
  version: 1
  id: string
  track?: TrackSpec
  entities: SceneEntity[]
  look?: SceneLook
}

function isVec3Tuple(v: unknown): v is Vec3Tuple {
  return (
    Array.isArray(v) &&
    v.length === 3 &&
    typeof v[0] === 'number' &&
    typeof v[1] === 'number' &&
    typeof v[2] === 'number' &&
    Number.isFinite(v[0]) &&
    Number.isFinite(v[1]) &&
    Number.isFinite(v[2])
  )
}

function parseEntity(raw: unknown, index: number): SceneEntity {
  if (!raw || typeof raw !== 'object') throw new Error(`entities[${index}] must be an object`)
  const e = raw as Record<string, unknown>
  if (typeof e.id !== 'string' || !e.id) throw new Error(`entities[${index}].id required`)
  if (typeof e.assetId !== 'string' || !e.assetId) throw new Error(`entities[${index}].assetId required`)
  if (!isVec3Tuple(e.position)) throw new Error(`entities[${index}].position must be [x,y,z]`)
  if (typeof e.rotationY !== 'number' || !Number.isFinite(e.rotationY)) {
    throw new Error(`entities[${index}].rotationY must be a number`)
  }
  if (typeof e.scale !== 'number' || !Number.isFinite(e.scale) || e.scale <= 0) {
    throw new Error(`entities[${index}].scale must be a positive number`)
  }
  let collider: EntityCollider | undefined
  if (e.collider !== undefined) {
    if (!e.collider || typeof e.collider !== 'object') {
      throw new Error(`entities[${index}].collider must be an object`)
    }
    const c = e.collider as Record<string, unknown>
    if (c.type !== 'box') throw new Error(`entities[${index}].collider.type must be 'box'`)
    if (!isVec3Tuple(c.halfExtents)) {
      throw new Error(`entities[${index}].collider.halfExtents must be [x,y,z]`)
    }
    if (c.halfExtents.some((n) => n <= 0)) {
      throw new Error(`entities[${index}].collider.halfExtents must be positive`)
    }
    let offset: Vec3Tuple | undefined
    if (c.offset !== undefined) {
      if (!isVec3Tuple(c.offset)) {
        throw new Error(`entities[${index}].collider.offset must be [x,y,z]`)
      }
      offset = c.offset
    }
    collider = { type: 'box', halfExtents: c.halfExtents, ...(offset ? { offset } : {}) }
  }
  let opacity: number | undefined
  if (e.opacity !== undefined) {
    if (typeof e.opacity !== 'number' || !Number.isFinite(e.opacity) || e.opacity < 0 || e.opacity > 1) {
      throw new Error(`entities[${index}].opacity must be in [0, 1]`)
    }
    opacity = e.opacity
  }
  return {
    id: e.id,
    assetId: e.assetId,
    position: e.position,
    rotationY: e.rotationY,
    scale: e.scale,
    ...(opacity !== undefined ? { opacity } : {}),
    ...(collider ? { collider } : {}),
  }
}

export function parseSceneDocument(raw: unknown): SceneDocument {
  if (!raw || typeof raw !== 'object') throw new Error('SceneDocument must be an object')
  const doc = raw as Record<string, unknown>
  if (doc.version !== 1) throw new Error('SceneDocument.version must be 1')
  if (typeof doc.id !== 'string' || !doc.id) throw new Error('SceneDocument.id required')
  if (!Array.isArray(doc.entities)) throw new Error('SceneDocument.entities required')
  const entities = doc.entities.map((e, i) => parseEntity(e, i))
  let track: TrackSpec | undefined
  if (doc.track) {
    if (typeof doc.track !== 'object' || !doc.track) throw new Error('track must be an object')
    const t = doc.track as Record<string, unknown>
    if (!Array.isArray(t.centerline) || t.centerline.length < 3) {
      throw new Error('track.centerline needs at least 3 points')
    }
    for (let i = 0; i < t.centerline.length; i++) {
      if (!isVec3Tuple(t.centerline[i])) throw new Error(`track.centerline[${i}] must be [x,y,z]`)
    }
    if (typeof t.halfWidth !== 'number' || t.halfWidth <= 0) {
      throw new Error('track.halfWidth must be a positive number')
    }
    if (!Array.isArray(t.boostPads)) throw new Error('track.boostPads required')
    for (let i = 0; i < t.boostPads.length; i++) {
      const p = t.boostPads[i]
      if (typeof p !== 'number' || !Number.isFinite(p) || p < 0 || p >= 1) {
        throw new Error(`track.boostPads[${i}] must be in [0, 1)`)
      }
    }
    let checkpoints: number[] | undefined
    if (t.checkpoints !== undefined) {
      if (!Array.isArray(t.checkpoints)) throw new Error('track.checkpoints must be an array')
      for (let i = 0; i < t.checkpoints.length; i++) {
        const p = t.checkpoints[i]
        if (typeof p !== 'number' || !Number.isFinite(p) || p < 0 || p >= 1) {
          throw new Error(`track.checkpoints[${i}] must be in [0, 1)`)
        }
      }
      checkpoints = t.checkpoints as number[]
    }
    track = {
      halfWidth: t.halfWidth,
      centerline: t.centerline as Vec3Tuple[],
      boostPads: t.boostPads as number[],
      ...(checkpoints ? { checkpoints } : {}),
    }
  }
  let look: SceneLook | undefined
  if (doc.look !== undefined) {
    if (typeof doc.look !== 'object' || !doc.look) throw new Error('look must be an object')
    const l = doc.look as Record<string, unknown>
    look = {}
    if (l.groundTextureId !== undefined) {
      if (typeof l.groundTextureId !== 'string' || !l.groundTextureId) {
        throw new Error('look.groundTextureId must be a non-empty string')
      }
      look.groundTextureId = l.groundTextureId
    }
    if (l.trackTextureId !== undefined) {
      if (typeof l.trackTextureId !== 'string' || !l.trackTextureId) {
        throw new Error('look.trackTextureId must be a non-empty string')
      }
      look.trackTextureId = l.trackTextureId
    }
    if (!Object.keys(look).length) look = undefined
  }
  return {
    version: 1,
    id: doc.id,
    ...(track ? { track } : {}),
    ...(look ? { look } : {}),
    entities,
  }
}

export function emptyScene(id: string): SceneDocument {
  return { version: 1, id, entities: [] }
}
