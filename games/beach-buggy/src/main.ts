import { getAsset, parseSceneDocument, type AssetManifest, type SceneDocument } from '@studio/core'
import { instantiateGltf, loadManifest } from '@studio/assets'
import { World, aiInput, createDefaultBeachScene } from '@studio/physics'
import { applyVehicle, placeEntities } from '@studio/three-render'
import * as THREE from 'three'
import { createBuggyMesh, createEnvironment, createTrackMesh } from './visuals'

const TOTAL_LAPS = 3
const AI_COUNT = 3

const canvas = document.querySelector<HTMLCanvasElement>('#game')!
const placeEl = document.querySelector('#place')!
const lapEl = document.querySelector('#lap')!
const speedEl = document.querySelector('#speed')!
const countdownEl = document.querySelector('#countdown')!
const overlay = document.querySelector('#overlay')!
const overlayTitle = document.querySelector('#overlay-title')!
const overlaySub = document.querySelector('#overlay-sub')!
const startBtn = document.querySelector<HTMLButtonElement>('#start-btn')!

const keys = new Set<string>()
window.addEventListener('keydown', (e) => {
  keys.add(e.code)
  if (e.code === 'KeyR') restartRace()
})
window.addEventListener('keyup', (e) => keys.delete(e.code))

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.shadowMap.enabled = true

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x7ec8ff)
scene.fog = new THREE.Fog(0x9ad4ff, 120, 280)
const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 500)
scene.add(new THREE.HemisphereLight(0xb1e1ff, 0xd2a679, 0.85))
const sun = new THREE.DirectionalLight(0xfff0d0, 1.15)
sun.position.set(40, 60, 20)
sun.castShadow = true
sun.shadow.mapSize.set(2048, 2048)
scene.add(sun)
scene.add(createEnvironment())

let sceneDoc: SceneDocument = createDefaultBeachScene()
let manifest: AssetManifest = { version: 1, assets: [] }
let world = new World(1 + AI_COUNT, { scene: sceneDoc, totalLaps: TOTAL_LAPS })
const entityMeshes = new Map<string, THREE.Object3D>()
let trackMesh: THREE.Object3D | undefined

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

function rebuildTrack(): void {
  if (trackMesh) scene.remove(trackMesh)
  trackMesh = createTrackMesh(world.samples, world.halfWidth)
  scene.add(trackMesh)
}

function playerInput() {
  return {
    throttle: keys.has('ArrowUp') || keys.has('KeyW') ? 1 : 0,
    brake: keys.has('ArrowDown') || keys.has('KeyS') ? 1 : 0,
    steer: (keys.has('ArrowLeft') || keys.has('KeyA') ? 1 : 0) + (keys.has('ArrowRight') || keys.has('KeyD') ? -1 : 0),
    boost: keys.has('Space'),
  }
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
  world = new World(1 + AI_COUNT, { scene: sceneDoc, totalLaps: TOTAL_LAPS })
  rebuildTrack()
  for (let i = 0; i < 1 + AI_COUNT; i++) {
    const mesh = await racerMesh(i)
    scene.add(mesh)
    applyVehicle(mesh, world.bodies[i])
    racers.push({
      mesh,
      isPlayer: i === 0,
      skill: 0.55 + i * 0.12,
      lookAhead: 10 + i * 2,
      name: names[i],
    })
  }
}

type Phase = 'menu' | 'countdown' | 'racing' | 'finished'
let phase: Phase = 'menu'
let countdown = 3
let countdownAcc = 0
let finishOrder: string[] = []

function ordinal(n: number): string {
  if (n === 1) return '1st'
  if (n === 2) return '2nd'
  if (n === 3) return '3rd'
  return `${n}th`
}

function updateHud(): void {
  const body = world.bodies[0]
  if (!body) return
  placeEl.textContent = ordinal(body.place)
  lapEl.textContent = `Lap ${Math.min(body.lap, TOTAL_LAPS)} / ${TOTAL_LAPS}`
  speedEl.textContent = `${Math.max(0, Math.round(body.speed * 2.1))} mph`
}

async function startRace(): Promise<void> {
  await spawnRacers()
  finishOrder = []
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

function endRace(): void {
  phase = 'finished'
  countdownEl.textContent = ''
  const playerPlace = world.bodies[0]?.place ?? 4
  overlayTitle.textContent = playerPlace === 1 ? 'You Win!' : 'Race Over'
  overlaySub.textContent = finishOrder.map((n, i) => `${ordinal(i + 1)} ${n}`).join(' · ')
  startBtn.textContent = 'Race Again'
  overlay.classList.remove('hidden')
}

startBtn.addEventListener('click', () => void startRace())

function updateCamera(dt: number): void {
  const body = world.bodies[0]
  if (!body) return
  const back = new THREE.Vector3(
    -Math.sin(body.heading) * 11,
    5.5,
    -Math.cos(body.heading) * 11,
  )
  camera.position.lerp(body.position.clone().add(back), 1 - Math.exp(-5 * dt))
  camera.lookAt(
    body.position
      .clone()
      .add(new THREE.Vector3(Math.sin(body.heading) * 8, 1.4, Math.cos(body.heading) * 8)),
  )
}

let last = performance.now()
function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000)
  last = now

  if (phase === 'countdown') {
    countdownAcc += dt
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
    racers.forEach((r, i) => applyVehicle(r.mesh, world.bodies[i]))
    updateCamera(dt)
  } else if (phase === 'racing') {
    countdownAcc += dt
    if (countdownEl.textContent === 'GO!' && countdownAcc > 0.7) countdownEl.textContent = ''
    const inputs = racers.map((r, i) =>
      r.isPlayer
        ? playerInput()
        : aiInput(world.bodies[i], world.samples, world.totalLength, r.skill, r.lookAhead, now),
    )
    world.step(dt, inputs)
    racers.forEach((r, i) => {
      applyVehicle(r.mesh, world.bodies[i])
      if (world.bodies[i].finished && !finishOrder.includes(r.name)) finishOrder.push(r.name)
    })
    updateHud()
    updateCamera(dt)
    if (world.bodies[0]?.finished && finishOrder.includes('You')) {
      const rest = racers
        .filter((r) => !finishOrder.includes(r.name))
        .sort((a, b) => world.bodies[racers.indexOf(a)].progress - world.bodies[racers.indexOf(b)].progress)
        .reverse()
        .map((r) => r.name)
      finishOrder.push(...rest)
      endRace()
    }
  } else {
    updateCamera(dt)
  }

  renderer.render(scene, camera)
  requestAnimationFrame(frame)
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
})

async function boot(): Promise<void> {
  const scenePath = new URLSearchParams(location.search).get('scene') ?? '/scenes/default.json'
  try {
    const res = await fetch(scenePath)
    if (res.ok) sceneDoc = parseSceneDocument(await res.json())
  } catch {
    sceneDoc = createDefaultBeachScene()
  }
  try {
    manifest = await loadManifest('/assets/manifest.json')
  } catch {
    manifest = { version: 1, assets: [] }
  }
  world = new World(1 + AI_COUNT, { scene: sceneDoc, totalLaps: TOTAL_LAPS })
  rebuildTrack()
  placeEntities(scene, sceneDoc, entityMeshes)
  for (const entity of sceneDoc.entities) {
    const ref = getAsset(manifest, entity.assetId)
    if (!ref) continue
    try {
      const inst = await instantiateGltf(ref)
      const old = entityMeshes.get(entity.id)
      if (old) scene.remove(old)
      inst.position.set(...entity.position)
      inst.rotation.y = entity.rotationY
      inst.scale.setScalar(entity.scale)
      scene.add(inst)
      entityMeshes.set(entity.id, inst)
    } catch {
      /* keep placeholder */
    }
  }
  await spawnRacers()
  updateHud()
  overlay.classList.remove('hidden')
  requestAnimationFrame(frame)
}

void boot()
