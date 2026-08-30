import type { EnvironmentGeneration } from '@studio/core'
import type { TrackSample } from '@studio/physics'
import { buildTrackRibbon, DEFAULT_HALF_WIDTH, ribbonToThreeGeometry } from '@studio/physics'
import { loadTexture } from '@studio/assets'
import { getAsset, type AssetManifest, type SceneLook } from '@studio/core'
import { tagStudioRef } from '@studio/three-render'
import * as THREE from 'three'

export const ENV_GENERATION: EnvironmentGeneration = {
  palmCount: 0,
  palmRadiusBase: 68,
  palmRadiusStep: 4,
  angleOffset: 0.2,
}

const GROUND_CELL = 8
const GROUND_TILE = 2000

export async function createFlatGround(manifest: AssetManifest, look?: SceneLook): Promise<THREE.Group> {
  const group = new THREE.Group()
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0, side: THREE.DoubleSide })
  const texRef = look?.groundTextureId ? getAsset(manifest, look.groundTextureId) : undefined
  if (texRef?.kind === 'texture') {
    try {
      const tex = await loadTexture(texRef.path)
      tex.wrapS = THREE.RepeatWrapping
      tex.wrapT = THREE.RepeatWrapping
      tex.repeat.set(GROUND_TILE / GROUND_CELL, GROUND_TILE / GROUND_CELL)
      tex.colorSpace = THREE.SRGBColorSpace
      mat.map = tex
    } catch {
      applyCheckerFallback(mat)
    }
  } else {
    applyCheckerFallback(mat)
  }
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(GROUND_TILE, GROUND_TILE), mat)
  ground.rotation.x = -Math.PI / 2
  ground.receiveShadow = true
  tagStudioRef(ground, { kind: 'environment', id: 'env:ground', label: 'Ground' })
  group.add(ground)
  return group
}

function applyCheckerFallback(mat: THREE.MeshStandardMaterial): void {
  const cells = 16
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 512
  const ctx = canvas.getContext('2d')!
  const cell = 512 / cells
  for (let y = 0; y < cells; y++) {
    for (let x = 0; x < cells; x++) {
      ctx.fillStyle = (x + y) % 2 === 0 ? '#6e6e6e' : '#4f4f4f'
      ctx.fillRect(x * cell, y * cell, cell, cell)
    }
  }
  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(GROUND_TILE / GROUND_CELL, GROUND_TILE / GROUND_CELL)
  tex.colorSpace = THREE.SRGBColorSpace
  mat.map = tex
}

export function followFlatGround(ground: THREE.Object3D, pos: THREE.Vector3): void {
  ground.position.x = Math.round(pos.x / GROUND_CELL) * GROUND_CELL
  ground.position.z = Math.round(pos.z / GROUND_CELL) * GROUND_CELL
}

export function prepareImportedVehicle(root: THREE.Group): THREE.Group {
  root.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.castShadow = true
      obj.receiveShadow = true
    }
  })

  const bounds = new THREE.Box3().setFromObject(root)
  const minY = bounds.min.y
  const size = bounds.getSize(new THREE.Vector3())
  const targetTrackWidth = 1.7
  const scale = size.x > 0.01 ? Math.min(1.5, Math.max(0.5, targetTrackWidth / size.x)) : 1

  const wrapper = new THREE.Group()
  const visualPivot = new THREE.Group()
  visualPivot.name = 'visualPivot'
  visualPivot.userData.autoGroundY = -minY * scale
  visualPivot.position.y = visualPivot.userData.autoGroundY as number
  if (Math.abs(scale - 1) > 0.01) root.scale.setScalar(scale)
  visualPivot.add(root)
  wrapper.add(visualPivot)
  return wrapper
}

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

export async function createTrackMesh(
  samples: TrackSample[],
  totalLength: number,
  manifest: AssetManifest,
  look?: SceneLook,
  halfWidth = DEFAULT_HALF_WIDTH,
  boostPads: number[] = [0.12, 0.37, 0.62, 0.87],
): Promise<THREE.Group> {
  const group = new THREE.Group()
  tagStudioRef(group, { kind: 'track', id: 'track:road', label: 'Track' })
  const roadMat = new THREE.MeshStandardMaterial({ color: 0x8b7355, roughness: 0.9 })
  const texRef = look?.trackTextureId ? getAsset(manifest, look.trackTextureId) : undefined
  if (texRef?.kind === 'texture') {
    try {
      const tex = await loadTexture(texRef.path)
      tex.wrapS = THREE.RepeatWrapping
      tex.wrapT = THREE.RepeatWrapping
      tex.repeat.set(4, 20)
      tex.colorSpace = THREE.SRGBColorSpace
      roadMat.map = tex
    } catch {
      /* keep default color */
    }
  }
  const ribbon = buildTrackRibbon(samples, totalLength, halfWidth, boostPads)
  const road = new THREE.Mesh(ribbonToThreeGeometry(ribbon), roadMat)
  road.receiveShadow = true
  tagStudioRef(road, { kind: 'track', id: 'track:road', label: 'Road' })
  group.add(road)

  const lineMat = new THREE.MeshStandardMaterial({ color: 0xfff3c4, roughness: 0.8 })
  for (let i = 0; i < samples.length; i += 4) {
    const s = samples[i]
    const dash = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.06, 1.6), lineMat)
    dash.position.copy(s.position).add(new THREE.Vector3(0, 0.12, 0))
    dash.lookAt(s.position.clone().add(s.tangent))
    group.add(dash)
  }

  const boostMat = new THREE.MeshStandardMaterial({
    color: 0x33ddff,
    emissive: 0x1188aa,
    emissiveIntensity: 0.6,
  })
  ribbon.boostPads.forEach((pad, i) => {
    const padHalfY = 0.04
    const padMesh = new THREE.Mesh(new THREE.BoxGeometry(4.5, padHalfY * 2, 3.2), boostMat)
    padMesh.position.copy(pad.position).add(new THREE.Vector3(0, padHalfY, 0))
    padMesh.quaternion.setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      Math.atan2(pad.tangent.x, pad.tangent.z),
    )
    tagStudioRef(padMesh, { kind: 'track', id: `track:boost-${i}`, label: `Boost pad ${i}` })
    group.add(padMesh)
  })
  return group
}

export async function createEnvironment(manifest: AssetManifest, look?: SceneLook): Promise<THREE.Group> {
  const env = new THREE.Group()
  const groundMat = new THREE.MeshStandardMaterial({ color: 0xb8954a, roughness: 1 })
  const texRef = look?.groundTextureId ? getAsset(manifest, look.groundTextureId) : undefined
  if (texRef?.kind === 'texture') {
    try {
      const tex = await loadTexture(texRef.path)
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping
      tex.repeat.set(8, 8)
      tex.colorSpace = THREE.SRGBColorSpace
      groundMat.map = tex
    } catch {
      /* default sand color */
    }
  }
  const ground = new THREE.Mesh(new THREE.CircleGeometry(180, 64), groundMat)
  ground.rotation.x = -Math.PI / 2
  ground.position.y = -0.15
  ground.receiveShadow = true
  tagStudioRef(ground, { kind: 'environment', id: 'env:ground', label: 'Sand' })
  env.add(ground)
  const water = new THREE.Mesh(
    new THREE.CircleGeometry(220, 64),
    new THREE.MeshStandardMaterial({ color: 0x1a6b8a, roughness: 0.25, metalness: 0.2 }),
  )
  water.rotation.x = -Math.PI / 2
  water.position.y = -0.35
  tagStudioRef(water, { kind: 'environment', id: 'env:water', label: 'Water' })
  env.add(water)
  const palmTrunkMat = new THREE.MeshStandardMaterial({ color: 0x8b5a2b, roughness: 0.9 })
  const palmLeafMat = new THREE.MeshStandardMaterial({ color: 0x2f8f4e, roughness: 0.8 })
  const { palmCount, palmRadiusBase, palmRadiusStep, angleOffset } = ENV_GENERATION
  for (let i = 0; i < palmCount; i++) {
    const angle = (i / palmCount) * Math.PI * 2 + angleOffset
    const r = palmRadiusBase + (i % 5) * palmRadiusStep
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
    tagStudioRef(palm, { kind: 'environment', id: `env:palm-${i}`, label: `Palm ${i}` })
    env.add(palm)
  }
  return env
}
