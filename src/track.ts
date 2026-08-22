import * as THREE from 'three'

export type TrackSample = {
  position: THREE.Vector3
  tangent: THREE.Vector3
  normal: THREE.Vector3
  binormal: THREE.Vector3
}

/** Closed beach loop — wavy oval with a few S-curves. */
export function createTrackCenterline(pointCount = 240): THREE.Vector3[] {
  const points: THREE.Vector3[] = []
  for (let i = 0; i < pointCount; i++) {
    const t = (i / pointCount) * Math.PI * 2
    const radius = 52 + Math.sin(t * 2) * 8 + Math.cos(t * 3) * 4
    const x = Math.cos(t) * radius
    const z = Math.sin(t) * radius * 0.72
    const y = 0.2 + Math.sin(t * 3) * 0.35
    points.push(new THREE.Vector3(x, y, z))
  }
  return points
}

export function buildTrackSamples(centerline: THREE.Vector3[]): TrackSample[] {
  const samples: TrackSample[] = []
  const n = centerline.length
  for (let i = 0; i < n; i++) {
    const prev = centerline[(i - 1 + n) % n]
    const curr = centerline[i]
    const next = centerline[(i + 1) % n]
    const tangent = next.clone().sub(prev).normalize()
    const up = new THREE.Vector3(0, 1, 0)
    const binormal = new THREE.Vector3().crossVectors(up, tangent).normalize()
    const normal = new THREE.Vector3().crossVectors(tangent, binormal).normalize()
    samples.push({
      position: curr.clone(),
      tangent,
      normal,
      binormal,
    })
  }
  return samples
}

export function trackLength(samples: TrackSample[]): number {
  let len = 0
  for (let i = 0; i < samples.length; i++) {
    const a = samples[i].position
    const b = samples[(i + 1) % samples.length].position
    len += a.distanceTo(b)
  }
  return len
}

/** Progress along track in [0, length). */
export function projectOntoTrack(
  samples: TrackSample[],
  worldPos: THREE.Vector3,
  totalLength: number,
): { progress: number; sampleIndex: number; lateral: number; nearest: THREE.Vector3 } {
  let bestDist = Infinity
  let bestIndex = 0
  let bestNearest = samples[0].position.clone()
  let bestLateral = 0

  for (let i = 0; i < samples.length; i++) {
    const a = samples[i].position
    const b = samples[(i + 1) % samples.length].position
    const ab = b.clone().sub(a)
    const ap = worldPos.clone().sub(a)
    const t = THREE.MathUtils.clamp(ap.dot(ab) / ab.lengthSq(), 0, 1)
    const nearest = a.clone().add(ab.multiplyScalar(t))
    const dist = worldPos.distanceTo(nearest)
    if (dist < bestDist) {
      bestDist = dist
      bestIndex = i
      bestNearest = nearest
      const side = samples[i].binormal
      bestLateral = worldPos.clone().sub(nearest).dot(side)
    }
  }

  let progress = 0
  for (let i = 0; i < bestIndex; i++) {
    progress += samples[i].position.distanceTo(samples[(i + 1) % samples.length].position)
  }
  const a = samples[bestIndex].position
  progress += a.distanceTo(bestNearest)
  progress = ((progress % totalLength) + totalLength) % totalLength

  return { progress, sampleIndex: bestIndex, lateral: bestLateral, nearest: bestNearest }
}

export function sampleAtProgress(
  samples: TrackSample[],
  totalLength: number,
  progress: number,
): TrackSample {
  const target = ((progress % totalLength) + totalLength) % totalLength
  let acc = 0
  for (let i = 0; i < samples.length; i++) {
    const a = samples[i]
    const b = samples[(i + 1) % samples.length]
    const seg = a.position.distanceTo(b.position)
    if (acc + seg >= target || i === samples.length - 1) {
      const t = seg > 0 ? (target - acc) / seg : 0
      return {
        position: a.position.clone().lerp(b.position, t),
        tangent: a.tangent.clone().lerp(b.tangent, t).normalize(),
        normal: a.normal.clone().lerp(b.normal, t).normalize(),
        binormal: a.binormal.clone().lerp(b.binormal, t).normalize(),
      }
    }
    acc += seg
  }
  return samples[0]
}

export const TRACK_HALF_WIDTH = 7.5

export function createTrackMesh(samples: TrackSample[]): THREE.Group {
  const group = new THREE.Group()
  const halfW = TRACK_HALF_WIDTH
  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []

  for (let i = 0; i < samples.length; i++) {
    const s = samples[i]
    const left = s.position.clone().add(s.binormal.clone().multiplyScalar(halfW))
    const right = s.position.clone().add(s.binormal.clone().multiplyScalar(-halfW))
    left.y += 0.02
    right.y += 0.02
    positions.push(left.x, left.y, left.z, right.x, right.y, right.z)
    const u = i / samples.length
    uvs.push(0, u * 40, 1, u * 40)
  }

  for (let i = 0; i < samples.length; i++) {
    const i0 = i * 2
    const i1 = i0 + 1
    const i2 = ((i + 1) % samples.length) * 2
    const i3 = i2 + 1
    indices.push(i0, i2, i1, i1, i2, i3)
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geo.setIndex(indices)
  geo.computeVertexNormals()

  const sandMat = new THREE.MeshStandardMaterial({
    color: 0x8b7355,
    roughness: 0.9,
    metalness: 0.02,
  })
  const road = new THREE.Mesh(geo, sandMat)
  road.receiveShadow = true
  road.position.y = 0.05
  group.add(road)

  // Center dashed line for readability
  const lineMat = new THREE.MeshStandardMaterial({
    color: 0xfff3c4,
    emissive: 0x665522,
    emissiveIntensity: 0.15,
    roughness: 0.8,
  })
  for (let i = 0; i < samples.length; i += 4) {
    const s = samples[i]
    const dash = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.06, 1.6), lineMat)
    dash.position.copy(s.position).add(new THREE.Vector3(0, 0.12, 0))
    const look = s.position.clone().add(s.tangent)
    dash.lookAt(look)
    group.add(dash)
  }

  // Edge rails (simple tubes)
  const leftPts: THREE.Vector3[] = []
  const rightPts: THREE.Vector3[] = []
  for (const s of samples) {
    leftPts.push(s.position.clone().add(s.binormal.clone().multiplyScalar(halfW + 0.3)).setY(s.position.y + 0.45))
    rightPts.push(s.position.clone().add(s.binormal.clone().multiplyScalar(-(halfW + 0.3))).setY(s.position.y + 0.45))
  }
  leftPts.push(leftPts[0].clone())
  rightPts.push(rightPts[0].clone())

  const railMat = new THREE.MeshStandardMaterial({ color: 0xf5f7fa, roughness: 0.35, metalness: 0.1 })
  for (const pts of [leftPts, rightPts]) {
    const curve = new THREE.CatmullRomCurve3(pts, true)
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, samples.length, 0.22, 6, true), railMat)
    tube.castShadow = true
    group.add(tube)
  }

  // Boost pads every ~1/4 lap
  const boostMat = new THREE.MeshStandardMaterial({
    color: 0x33ddff,
    emissive: 0x1188aa,
    emissiveIntensity: 0.6,
    roughness: 0.35,
  })
  for (let k = 0; k < 4; k++) {
    const idx = Math.floor((k / 4) * samples.length)
    const s = samples[idx]
    const pad = new THREE.Mesh(new THREE.BoxGeometry(4.5, 0.08, 3.2), boostMat)
    pad.position.copy(s.position).add(new THREE.Vector3(0, 0.08, 0))
    pad.lookAt(s.position.clone().add(s.tangent))
    pad.rotateX(-Math.PI / 2)
    group.add(pad)
  }

  return group
}

export function createEnvironment(): THREE.Group {
  const env = new THREE.Group()

  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(180, 64),
    new THREE.MeshStandardMaterial({ color: 0xb8954a, roughness: 1 }),
  )
  ground.rotation.x = -Math.PI / 2
  ground.position.y = -0.15
  ground.receiveShadow = true
  env.add(ground)

  const water = new THREE.Mesh(
    new THREE.CircleGeometry(220, 64),
    new THREE.MeshStandardMaterial({
      color: 0x1a6b8a,
      roughness: 0.25,
      metalness: 0.2,
    }),
  )
  water.rotation.x = -Math.PI / 2
  water.position.y = -0.35
  env.add(water)

  const palmTrunkMat = new THREE.MeshStandardMaterial({ color: 0x8b5a2b, roughness: 0.9 })
  const palmLeafMat = new THREE.MeshStandardMaterial({ color: 0x2f8f4e, roughness: 0.8 })
  for (let i = 0; i < 28; i++) {
    const angle = (i / 28) * Math.PI * 2 + 0.2
    const r = 68 + (i % 5) * 4
    const palm = new THREE.Group()
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.4, 6, 6), palmTrunkMat)
    trunk.position.y = 3
    trunk.castShadow = true
    palm.add(trunk)
    for (let j = 0; j < 5; j++) {
      const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.35, 3.2, 4), palmLeafMat)
      leaf.position.y = 6.2
      leaf.rotation.z = 0.9
      leaf.rotation.y = (j / 5) * Math.PI * 2
      palm.add(leaf)
    }
    palm.position.set(Math.cos(angle) * r, 0, Math.sin(angle) * r)
    env.add(palm)
  }

  return env
}
