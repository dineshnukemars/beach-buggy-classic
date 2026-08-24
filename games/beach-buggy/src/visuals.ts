import type { TrackSample } from '@studio/physics'
import { DEFAULT_HALF_WIDTH } from '@studio/physics'
import * as THREE from 'three'

export function createBuggyMesh(color: number): THREE.Group {
  const buggy = new THREE.Group()
  const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.15 })
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.7 })
  const accentMat = new THREE.MeshStandardMaterial({
    color: 0xffdd66,
    emissive: 0xaa6600,
    emissiveIntensity: 0.25,
  })
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.55, 2.4), bodyMat)
  body.position.y = 0.45
  body.castShadow = true
  buggy.add(body)
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.4, 1.1), darkMat)
  cabin.position.set(0, 0.85, -0.15)
  buggy.add(cabin)
  const nose = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.35, 0.7), bodyMat)
  nose.position.set(0, 0.4, 1.2)
  buggy.add(nose)
  for (const [x, z] of [
    [-0.85, 0.85],
    [0.85, 0.85],
    [-0.85, -0.95],
    [0.85, -0.95],
  ] as const) {
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.32, 12), darkMat)
    wheel.rotation.z = Math.PI / 2
    wheel.position.set(x, 0.38, z)
    buggy.add(wheel)
  }
  const roll = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.06, 6, 16), accentMat)
  roll.rotation.x = Math.PI / 2
  roll.position.set(0, 1.05, -0.2)
  buggy.add(roll)
  return buggy
}

export function createTrackMesh(samples: TrackSample[], halfWidth = DEFAULT_HALF_WIDTH): THREE.Group {
  const group = new THREE.Group()
  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i]
    const left = s.position.clone().add(s.binormal.clone().multiplyScalar(halfWidth))
    const right = s.position.clone().add(s.binormal.clone().multiplyScalar(-halfWidth))
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
  const road = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({ color: 0x8b7355, roughness: 0.9 }),
  )
  road.receiveShadow = true
  road.position.y = 0.05
  group.add(road)

  const lineMat = new THREE.MeshStandardMaterial({ color: 0xfff3c4, roughness: 0.8 })
  for (let i = 0; i < samples.length; i += 4) {
    const s = samples[i]
    const dash = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.06, 1.6), lineMat)
    dash.position.copy(s.position).add(new THREE.Vector3(0, 0.12, 0))
    dash.lookAt(s.position.clone().add(s.tangent))
    group.add(dash)
  }

  const leftPts: THREE.Vector3[] = []
  const rightPts: THREE.Vector3[] = []
  for (const s of samples) {
    leftPts.push(s.position.clone().add(s.binormal.clone().multiplyScalar(halfWidth + 0.3)).setY(s.position.y + 0.45))
    rightPts.push(s.position.clone().add(s.binormal.clone().multiplyScalar(-(halfWidth + 0.3))).setY(s.position.y + 0.45))
  }
  leftPts.push(leftPts[0].clone())
  rightPts.push(rightPts[0].clone())
  const railMat = new THREE.MeshStandardMaterial({ color: 0xf5f7fa, roughness: 0.35 })
  for (const pts of [leftPts, rightPts]) {
    const curve = new THREE.CatmullRomCurve3(pts, true)
    group.add(new THREE.Mesh(new THREE.TubeGeometry(curve, samples.length, 0.22, 6, true), railMat))
  }

  const boostMat = new THREE.MeshStandardMaterial({
    color: 0x33ddff,
    emissive: 0x1188aa,
    emissiveIntensity: 0.6,
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
    new THREE.MeshStandardMaterial({ color: 0x1a6b8a, roughness: 0.25, metalness: 0.2 }),
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
