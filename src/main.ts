import * as THREE from 'three'
import {
  buildTrackSamples,
  createEnvironment,
  createTrackCenterline,
  createTrackMesh,
  projectOntoTrack,
  trackLength,
  sampleAtProgress,
} from './track'
import {
  aiInput,
  createBuggyMesh,
  createVehicleState,
  stepVehicle,
  syncMesh,
  type VehicleInput,
  type VehicleState,
} from './vehicle'

const TOTAL_LAPS = 3
const AI_COUNT = 3

const canvas = document.querySelector<HTMLCanvasElement>('#game')!
const placeEl = document.querySelector('#place')!
const lapEl = document.querySelector('#lap')!
const speedEl = document.querySelector('#speed')!
const countdownEl = document.querySelector('#countdown')!
const messageEl = document.querySelector('#message')!
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

const hemi = new THREE.HemisphereLight(0xb1e1ff, 0xd2a679, 0.85)
scene.add(hemi)
const sun = new THREE.DirectionalLight(0xfff0d0, 1.15)
sun.position.set(40, 60, 20)
sun.castShadow = true
sun.shadow.mapSize.set(2048, 2048)
sun.shadow.camera.left = -80
sun.shadow.camera.right = 80
sun.shadow.camera.top = 80
sun.shadow.camera.bottom = -80
scene.add(sun)

scene.add(createEnvironment())

const centerline = createTrackCenterline()
const samples = buildTrackSamples(centerline)
const totalLength = trackLength(samples)
scene.add(createTrackMesh(samples))

type Racer = {
  state: VehicleState
  mesh: THREE.Group
  isPlayer: boolean
  skill: number
  lookAhead: number
  name: string
}

const buggyColors = [0xff6b2c, 0x2f9bff, 0x3dcf6a, 0xf2d64b]
const racers: Racer[] = []

function spawnRacers(): void {
  for (const r of racers) scene.remove(r.mesh)
  racers.length = 0

  const start = sampleAtProgress(samples, totalLength, 2)
  const laterals = [1.8, -1.8, 4.2, -4.2]
  const names = ['You', 'Sandy', 'Coral', 'Dune']

  for (let i = 0; i < 1 + AI_COUNT; i++) {
    const state = createVehicleState(start, laterals[i] ?? 0)
    state.lastProgress = projectOntoTrack(samples, state.position, totalLength).progress
    const mesh = createBuggyMesh(buggyColors[i % buggyColors.length])
    scene.add(mesh)
    syncMesh(mesh, state)
    racers.push({
      state,
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

function playerInput(): VehicleInput {
  const up = keys.has('ArrowUp') || keys.has('KeyW')
  const down = keys.has('ArrowDown') || keys.has('KeyS')
  const left = keys.has('ArrowLeft') || keys.has('KeyA')
  const right = keys.has('ArrowRight') || keys.has('KeyD')
  return {
    throttle: up ? 1 : 0,
    brake: down ? 1 : 0,
    steer: (left ? 1 : 0) + (right ? -1 : 0),
    boost: keys.has('Space'),
  }
}

function onBoostPad(state: VehicleState): boolean {
  const p = ((state.progress % totalLength) + totalLength) % totalLength
  for (let k = 0; k < 4; k++) {
    const pad = (k / 4) * totalLength
    if (Math.abs(p - pad) < 3.5 || Math.abs(p - pad - totalLength) < 3.5) return true
  }
  return false
}

function updatePlaces(): void {
  const sorted = [...racers].sort((a, b) => b.state.progress - a.state.progress)
  sorted.forEach((r, i) => {
    r.state.place = i + 1
  })
}

function ordinal(n: number): string {
  if (n === 1) return '1st'
  if (n === 2) return '2nd'
  if (n === 3) return '3rd'
  return `${n}th`
}

function updateHud(): void {
  const player = racers[0]
  if (!player) return
  placeEl.textContent = ordinal(player.state.place)
  lapEl.textContent = `Lap ${Math.min(player.state.lap, TOTAL_LAPS)} / ${TOTAL_LAPS}`
  speedEl.textContent = `${Math.max(0, Math.round(player.state.speed * 2.1))} mph`
}

function startRace(): void {
  spawnRacers()
  finishOrder = []
  phase = 'countdown'
  countdown = 3
  countdownAcc = 0
  countdownEl.textContent = '3'
  messageEl.textContent = ''
  overlay.classList.add('hidden')
}

function restartRace(): void {
  if (phase === 'menu') return
  startRace()
}

function endRace(): void {
  phase = 'finished'
  countdownEl.textContent = ''
  const playerPlace = racers[0]?.state.place ?? 4
  overlayTitle.textContent = playerPlace === 1 ? 'You Win!' : 'Race Over'
  overlaySub.textContent = finishOrder.map((n, i) => `${ordinal(i + 1)} ${n}`).join(' · ')
  startBtn.textContent = 'Race Again'
  overlay.classList.remove('hidden')
}

startBtn.addEventListener('click', () => startRace())

function updateCamera(dt: number): void {
  const player = racers[0]
  if (!player) return
  const back = new THREE.Vector3(
    -Math.sin(player.state.heading) * 11,
    5.5,
    -Math.cos(player.state.heading) * 11,
  )
  const desired = player.state.position.clone().add(back)
  camera.position.lerp(desired, 1 - Math.exp(-5 * dt))
  const look = player.state.position
    .clone()
    .add(new THREE.Vector3(Math.sin(player.state.heading) * 8, 1.4, Math.cos(player.state.heading) * 8))
  camera.lookAt(look)
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
      if (countdown > 0) {
        countdownEl.textContent = String(countdown)
      } else if (countdown === 0) {
        countdownEl.textContent = 'GO!'
        countdownAcc = 0
        phase = 'racing'
      }
    }
    for (const r of racers) syncMesh(r.mesh, r.state)
    updateCamera(dt)
  } else if (phase === 'racing') {
    countdownAcc += dt
    if (countdownEl.textContent === 'GO!' && countdownAcc > 0.7) {
      countdownEl.textContent = ''
    }

    for (const r of racers) {
      if (r.state.finished) continue
      const input = r.isPlayer
        ? playerInput()
        : aiInput(r.state, samples, totalLength, r.skill, r.lookAhead)
      stepVehicle(r.state, input, samples, totalLength, dt, TOTAL_LAPS, onBoostPad(r.state))
      if (r.state.finished && !finishOrder.includes(r.name)) {
        finishOrder.push(r.name)
      }
      syncMesh(r.mesh, r.state)
    }

    updatePlaces()
    updateHud()
    updateCamera(dt)

    if (racers[0]?.state.finished && finishOrder.includes('You')) {
      const rest = racers
        .filter((r) => !finishOrder.includes(r.name))
        .sort((a, b) => b.state.progress - a.state.progress)
        .map((r) => r.name)
      finishOrder.push(...rest)
      endRace()
    }
  } else if (phase === 'finished' || phase === 'menu') {
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

spawnRacers()
updateHud()
overlay.classList.remove('hidden')
requestAnimationFrame(frame)
