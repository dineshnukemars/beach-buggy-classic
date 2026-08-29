import { fixedSteps, getAsset, type AssetManifest, type SceneDocument } from '@studio/core'
import { instantiateGltf, loadManifest } from '@studio/assets'
import {
  World,
  createSandboxScene,
  parseVehicleTuning,
  type VehicleTuning,
} from '@studio/physics'
import { applyVehicle } from '@studio/three-render'
import * as THREE from 'three'
import { createDevMode, tagRacer } from './dev/DevModeController'
import { LookbackBuffer } from './dev/lookback'
import { isPanelField } from './dev/panel'
import { createBuggyMesh, createFlatGround, followFlatGround } from './visuals'

const TOTAL_LAPS = 999
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
let scenePath = '/scenes/default.json'
let dev: ReturnType<typeof createDevMode> | undefined

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
scene.add(new THREE.HemisphereLight(0xb1e1ff, 0xd2a679, 0.85))
const sun = new THREE.DirectionalLight(0xfff0d0, 1.15)
sun.position.set(40, 60, 20)
sun.castShadow = true
sun.shadow.mapSize.set(2048, 2048)
scene.add(sun)
const ground = createFlatGround()
scene.add(ground)

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
  if (dev?.isTyping() || (dev?.isActive() && dev.isPaused())) {
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
      return await instantiateGltf(buggyRef)
    } catch {
      /* fallback primitives */
    }
  }
  return createBuggyMesh(buggyColors[i % buggyColors.length])
}

async function spawnRacers(): Promise<void> {
  for (const r of racers) scene.remove(r.mesh)
  racers = []
  world?.dispose()
  world = await World.create(RACER_COUNT, {
    scene: sceneDoc,
    totalLaps: TOTAL_LAPS,
    laterals: [0],
    backend: 'rapier',
    tuning,
    flatGround: true,
  })
  physicsAcc = 0
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
  placeEl.textContent = ''
  lapEl.textContent = ''
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
  const back = new THREE.Vector3(
    -Math.sin(body.heading) * 11,
    5.5,
    -Math.cos(body.heading) * 11,
  )
  camera.position.lerp(body.position.clone().add(back), 1 - Math.exp(-3.2 * dt))
  camera.lookAt(
    body.position
      .clone()
      .add(new THREE.Vector3(Math.sin(body.heading) * 8, 1.4, Math.cos(body.heading) * 8)),
  )
  followFlatGround(ground, body.position)
}

function stepPhysicsFrame(frameDt: number, inputs: ReturnType<typeof playerInput>[]): void {
  if (!world || dev?.isPaused()) return
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
  requestAnimationFrame(frame)
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
})

async function boot(): Promise<void> {
  scenePath = 'sandbox-flat'
  sceneDoc = createSandboxScene()
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
  overlay.classList.remove('hidden')
  requestAnimationFrame(frame)
}

void boot()
