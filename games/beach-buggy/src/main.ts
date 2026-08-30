import {
  fixedSteps,
  getAsset,
  parseSceneDocument,
  type AssetManifest,
  type SceneDocument,
} from '@studio/core'
import { instantiateGltf, loadManifest } from '@studio/assets'
import {
  World,
  createSandboxScene,
  parseVehicleTuning,
  type VehicleTuning,
} from '@studio/physics'
import { applyVehicle, placeEntities } from '@studio/three-render'
import * as THREE from 'three'
import { createDevMode, tagRacer } from './dev/DevModeController'
import { LookbackBuffer } from './dev/lookback'
import { isPanelField } from './dev/panel'
import { createStudioDrawer } from './dev/studioDrawer'
import {
  createBuggyMesh,
  createEnvironment,
  createFlatGround,
  createTrackMesh,
  followFlatGround,
  prepareImportedVehicle,
} from './visuals'

const TOTAL_LAPS_SANDBOX = 999
const TOTAL_LAPS_TRACK = 3
const RACER_COUNT = 1

const canvas = document.querySelector<HTMLCanvasElement>('#game')!
const placeEl = document.querySelector('#place')!
const lapEl = document.querySelector('#lap')!
const speedEl = document.querySelector('#speed')!
const countdownEl = document.querySelector('#countdown')!
const overlay = document.querySelector<HTMLElement>('#overlay')!
const startBtn = document.querySelector<HTMLButtonElement>('#start-btn')!

const keys = new Set<string>()
const lookback = new LookbackBuffer()
let scenePath = 'sandbox-flat'
let flatGround = true
let dev: ReturnType<typeof createDevMode> | undefined
let studio: ReturnType<typeof createStudioDrawer> | undefined

window.addEventListener('keydown', (e) => {
  if (isPanelField(e.target)) return
  if (e.code === 'F8' || e.code === 'Backquote') {
    e.preventDefault()
    if (e.repeat) return
    dev?.toggle({ pause: !e.shiftKey })
    return
  }
  keys.add(e.code)
  if (e.code === 'KeyR' && !dev?.isActive()) restartRace()
})
window.addEventListener('keyup', (e) => {
  if (isPanelField(e.target)) return
  keys.delete(e.code)
})

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.shadowMap.enabled = true
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.05

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x7ec8ff)
const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 2000)
const hemi = new THREE.HemisphereLight(0xb1e1ff, 0xd2a679, 0.85)
scene.add(hemi)
const sun = new THREE.DirectionalLight(0xfff0d0, 1.15)
sun.position.set(40, 60, 20)
sun.castShadow = true
sun.shadow.mapSize.set(2048, 2048)
scene.add(sun)

let terrainRoot: THREE.Object3D = createFlatGround()
scene.add(terrainRoot)
const entityMeshes = new Map<string, THREE.Object3D>()

let sceneDoc: SceneDocument = createSandboxScene()
let manifest: AssetManifest = { version: 1, assets: [] }
let tuning: VehicleTuning = parseVehicleTuning(undefined)
let world: World | undefined
let physicsAcc = 0

type Racer = {
  mesh: THREE.Group
  isPlayer: boolean
  skill: number
  lookAhead: number
  name: string
}

const buggyColors = [0xff6b2c, 0x2f9bff, 0x3dcf6a, 0xf2d64b]
const names = ['You', 'Sandy', 'Coral', 'Dune']
let racers: Racer[] = []

function playerInput() {
  if (
    dev?.isTyping() ||
    studio?.isTyping() ||
    (dev?.isActive() && dev.isPaused()) ||
    studio?.isPaused()
  ) {
    return { throttle: 0, steer: 0, brake: 0, boost: false }
  }
  return {
    throttle: keys.has('ArrowUp') || keys.has('KeyW') ? 1 : 0,
    brake: keys.has('ArrowDown') || keys.has('KeyS') ? 1 : 0,
    steer: (keys.has('ArrowLeft') || keys.has('KeyA') ? 1 : 0) + (keys.has('ArrowRight') || keys.has('KeyD') ? -1 : 0),
    boost: keys.has('Space'),
  }
}

function emptyInputs(count: number) {
  return Array.from({ length: count }, () => ({ throttle: 0, steer: 0, brake: 1, boost: false }))
}

async function racerMesh(i: number): Promise<THREE.Group> {
  const buggyRef = getAsset(manifest, 'buggy')
  if (buggyRef) {
    try {
      return prepareImportedVehicle(await instantiateGltf(buggyRef))
    } catch {
      /* fallback primitives */
    }
  }
  return createBuggyMesh(buggyColors[i % buggyColors.length])
}

function clearEntityMeshes(): void {
  for (const obj of entityMeshes.values()) scene.remove(obj)
  entityMeshes.clear()
}

function rebuildTerrain(): void {
  scene.remove(terrainRoot)
  if (flatGround) {
    terrainRoot = createFlatGround()
  } else if (world) {
    const group = new THREE.Group()
    group.add(createEnvironment())
    group.add(createTrackMesh(world.samples, world.totalLength, world.halfWidth, world.boostPads))
    terrainRoot = group
  } else {
    terrainRoot = createEnvironment()
  }
  scene.add(terrainRoot)
}

async function placeSceneEntities(): Promise<void> {
  clearEntityMeshes()
  if (flatGround) return
  placeEntities(scene, sceneDoc, entityMeshes)
  for (const entity of sceneDoc.entities) {
    const ref = getAsset(manifest, entity.assetId)
    if (!ref || ref.kind !== 'gltf') continue
    try {
      const mesh = await instantiateGltf(ref)
      const placeholder = entityMeshes.get(entity.id)
      if (placeholder) scene.remove(placeholder)
      mesh.position.set(...entity.position)
      mesh.rotation.y = entity.rotationY
      mesh.scale.setScalar(entity.scale)
      entityMeshes.set(entity.id, mesh)
      scene.add(mesh)
    } catch {
      /* keep placeholder */
    }
  }
}

async function spawnRacers(): Promise<void> {
  for (const r of racers) scene.remove(r.mesh)
  racers = []
  world?.dispose()
  world = await World.create(RACER_COUNT, {
    scene: sceneDoc,
    totalLaps: flatGround ? TOTAL_LAPS_SANDBOX : TOTAL_LAPS_TRACK,
    laterals: flatGround ? [0] : [1.8],
    backend: 'rapier',
    tuning,
    flatGround,
  })
  physicsAcc = 0
  rebuildTerrain()
  await placeSceneEntities()
  for (let i = 0; i < 90; i++) world.step(world.timestep, emptyInputs(RACER_COUNT))
  world.plantOnStartGrid()
  for (let i = 0; i < RACER_COUNT; i++) {
    const mesh = await racerMesh(i)
    scene.add(mesh)
    applyVehicle(mesh, world.bodies[i])
    tagRacer(mesh, i, names[i])
    racers.push({
      mesh,
      isPlayer: i === 0,
      skill: 0.55 + i * 0.12,
      lookAhead: 10 + i * 2,
      name: names[i],
    })
  }
  dev?.onWorldReset()
}

type Phase = 'menu' | 'countdown' | 'racing'
let phase: Phase = 'menu'
let countdown = 3
let countdownAcc = 0

function updateHud(): void {
  const body = world?.bodies[0]
  if (!body) return
  if (flatGround) {
    placeEl.textContent = ''
    lapEl.textContent = ''
  } else {
    placeEl.textContent = `P${body.place}`
    lapEl.textContent = `Lap ${Math.min(body.lap, TOTAL_LAPS_TRACK)}/${TOTAL_LAPS_TRACK}`
  }
  speedEl.textContent = `${Math.max(0, Math.round(body.speed * 2.1))} mph`
}

async function startRace(): Promise<void> {
  await spawnRacers()
  phase = 'countdown'
  countdown = 3
  countdownAcc = 0
  countdownEl.textContent = '3'
  overlay.classList.add('hidden')
}

function restartRace(): void {
  if (phase === 'menu') return
  void startRace()
}

startBtn.addEventListener('click', () => void startRace())

function updateCamera(dt: number): void {
  const body = world?.bodies[0]
  if (!body) return
  const s = studio?.getSettings()
  const backDist = s?.cameraBack ?? 11
  const height = s?.cameraHeight ?? 5.5
  const lookAhead = s?.cameraLookAhead ?? 8
  const back = new THREE.Vector3(
    -Math.sin(body.heading) * backDist,
    height,
    -Math.cos(body.heading) * backDist,
  )
  camera.position.lerp(body.position.clone().add(back), 1 - Math.exp(-3.2 * dt))
  camera.lookAt(
    body.position
      .clone()
      .add(new THREE.Vector3(Math.sin(body.heading) * lookAhead, 1.4, Math.cos(body.heading) * lookAhead)),
  )
  if (flatGround) followFlatGround(terrainRoot, body.position)
}

function stepPhysicsFrame(frameDt: number, inputs: ReturnType<typeof playerInput>[]): void {
  if (!world || dev?.isPaused() || studio?.isPaused()) return
  const { steps, rest } = fixedSteps(physicsAcc, frameDt, world.timestep)
  physicsAcc = rest
  for (let i = 0; i < steps; i++) {
    world.step(world.timestep, inputs)
    dev?.afterPhysicsStep()
  }
}

let last = performance.now()
function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000)
  last = now

  if (!world) {
    renderer.render(scene, camera)
    requestAnimationFrame(frame)
    return
  }

  if (phase === 'countdown') {
    countdownAcc += dt
    stepPhysicsFrame(dt, emptyInputs(racers.length))
    world.holdForCountdown()
    if (countdownAcc >= 1) {
      countdownAcc = 0
      countdown -= 1
      if (countdown > 0) countdownEl.textContent = String(countdown)
      else if (countdown === 0) {
        countdownEl.textContent = 'GO!'
        countdownAcc = 0
        phase = 'racing'
      }
    }
    racers.forEach((r, i) => applyVehicle(r.mesh, world!.bodies[i]))
    updateCamera(dt)
  } else if (phase === 'racing') {
    countdownAcc += dt
    if (countdownEl.textContent === 'GO!' && countdownAcc > 0.7) countdownEl.textContent = ''
    stepPhysicsFrame(dt, [playerInput()])
    racers.forEach((r, i) => applyVehicle(r.mesh, world!.bodies[i]))
    updateHud()
    updateCamera(dt)
  } else {
    updateCamera(dt)
  }

  renderer.render(scene, camera)
  dev?.afterRender(now)
  studio?.updateInspect()
  requestAnimationFrame(frame)
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
})

function sceneQueryPath(): string | null {
  const raw = new URLSearchParams(window.location.search).get('scene')
  if (!raw) return null
  if (raw.startsWith('/scenes/') && raw.endsWith('.json')) return raw
  if (/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(raw)) return `/scenes/${raw}.json`
  return null
}

async function loadBootScene(): Promise<void> {
  const path = sceneQueryPath()
  if (!path) {
    scenePath = 'sandbox-flat'
    sceneDoc = createSandboxScene()
    flatGround = true
    return
  }
  const res = await fetch(path)
  if (!res.ok) throw new Error(`Failed to load scene ${path} (${res.status})`)
  sceneDoc = parseSceneDocument(await res.json())
  scenePath = path
  flatGround = sceneDoc.id === 'sandbox-flat'
}

async function boot(): Promise<void> {
  try {
    await loadBootScene()
  } catch (err) {
    console.warn(err)
    scenePath = 'sandbox-flat'
    sceneDoc = createSandboxScene()
    flatGround = true
  }
  try {
    manifest = await loadManifest('/assets/manifest.json')
  } catch {
    manifest = { version: 1, assets: [] }
  }
  try {
    const tuningRes = await fetch('/tuning/buggy-default.json')
    if (tuningRes.ok) tuning = parseVehicleTuning(await tuningRes.json())
  } catch {
    tuning = parseVehicleTuning(undefined)
  }

  await spawnRacers()
  studio = createStudioDrawer({
    camera,
    hemi,
    sun,
    renderer,
    canvas,
    defaultMaxSpeed: tuning.maxSpeed,
    getTuning: () => tuning,
    getWorld: () => world,
    getPhase: () => phase,
    getSceneDoc: () => sceneDoc,
    getScenePath: () => scenePath,
    lookback,
  })
  dev = createDevMode({
    scene,
    camera,
    canvas,
    overlay,
    lookback,
    getWorld: () => world,
    getPhase: () => phase,
    getSceneDoc: () => sceneDoc,
    getScenePath: () => scenePath,
  })
  updateHud()
  const sub = document.querySelector('#overlay-sub')
  if (sub) {
    sub.textContent = flatGround
      ? 'One car on a flat plane.'
      : `Track scene: ${sceneDoc.id}. Drive the ribbon.`
  }
  overlay.classList.remove('hidden')
  requestAnimationFrame(frame)
}

void boot()
