import {
  fixedSteps,
  getAsset,
  parseSceneDocument,
  setCenterlinePoint,
  type AssetManifest,
  type SceneDocument,
  type Selection,
  type Vec3Tuple,
} from '@studio/core'
import { instantiateGltf, loadManifest } from '@studio/assets'
import {
  World,
  createSandboxScene,
  parseVehicleTuning,
  type VehicleTuning,
} from '@studio/physics'
import { applyEntityOpacity, applyVehicle, placeEntities } from '@studio/three-render'
import * as THREE from 'three'
import { createDevMode, tagRacer } from './dev/DevModeController'
import { LookbackBuffer } from './dev/lookback'
import { isPanelField } from './dev/panel'
import { createPhysicsDebugLayer } from './dev/physicsDebug'
import { createStudioDrawer } from './dev/studioDrawer'
import { createEditOverlay } from './studio/editOverlay'
import { initStudioUi } from './studio/index'
import type { StudioHost, StudioMode } from './studio/types'
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
const LAST_SCENE_KEY = 'studio-last-scene'

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
let studioDrawer: ReturnType<typeof createStudioDrawer> | undefined
let physicsDebug: ReturnType<typeof createPhysicsDebugLayer> | undefined
let editOverlay: ReturnType<typeof createEditOverlay> | undefined
let studioMode: StudioMode = import.meta.env.DEV ? 'edit' : 'play'
let selection: Selection = null

const docListeners = new Set<() => void>()
const selListeners = new Set<() => void>()
const manifestListeners = new Set<() => void>()

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.shadowMap.enabled = true
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.05

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x7ec8ff)
const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 2000)
const hemi = new THREE.HemisphereLight(0xb1e1ff, 0xd2a679, 0.85)
scene.add(hemi)
const sun = new THREE.DirectionalLight(0xfff0d0, 1.15)
sun.position.set(40, 60, 20)
sun.castShadow = true
sun.shadow.mapSize.set(2048, 2048)
scene.add(sun)

let terrainRoot: THREE.Object3D = new THREE.Group()
scene.add(terrainRoot)
const entityMeshes = new Map<string, THREE.Object3D>()
const entityClips = new Map<string, THREE.AnimationClip[]>()
const entityMixers = new Map<string, THREE.AnimationMixer>()

let sceneDoc: SceneDocument = createSandboxScene()
let manifest: AssetManifest = { version: 1, assets: [] }
let tuning: VehicleTuning = parseVehicleTuning(undefined)
let world: World | undefined
let physicsAcc = 0
let viewportW = window.innerWidth
let viewportH = window.innerHeight

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

function notifyDoc(): void {
  for (const fn of docListeners) fn()
}
function notifySel(): void {
  for (const fn of selListeners) fn()
}
function notifyManifest(): void {
  for (const fn of manifestListeners) fn()
}

function setViewport(w: number, h: number): void {
  viewportW = Math.max(1, w)
  viewportH = Math.max(1, h)
  camera.aspect = viewportW / viewportH
  camera.updateProjectionMatrix()
  renderer.setSize(viewportW, viewportH, false)
}

function playerInput() {
  if (
    dev?.isTyping() ||
    studioDrawer?.isTyping() ||
    (dev?.isActive() && dev.isPaused()) ||
    studioDrawer?.isPaused() ||
    studioMode === 'edit'
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

function playerVehicleVisual(): { offset: Vec3Tuple; rotationY?: number } {
  const buggyRef = getAsset(manifest, 'buggy')
  const drawerSettings = studioDrawer?.getSettings()
  const base = buggyRef?.visualOffset ?? [0, 0, 0]
  const offset: Vec3Tuple = drawerSettings
    ? [drawerSettings.visualOffsetX, drawerSettings.visualOffsetY, drawerSettings.visualOffsetZ]
    : [base[0], base[1], base[2]]
  return { offset, rotationY: buggyRef?.visualRotationY }
}

function applyPlayerVehicleVisual(): void {
  const player = racers[0]
  if (!player) return
  const visual = playerVehicleVisual()
  const opacity = studioDrawer?.getSettings().playerMeshOpacity ?? 1
  applyEntityOpacity(player.mesh, opacity)
  if (world?.bodies[0]) applyVehicle(player.mesh, world.bodies[0], visual)
}

async function racerMesh(i: number): Promise<THREE.Group> {
  const buggyRef = getAsset(manifest, 'buggy')
  if (buggyRef) {
    try {
      const { root } = await instantiateGltf(buggyRef)
      return prepareImportedVehicle(root)
    } catch {
      /* fallback */
    }
  }
  return createBuggyMesh(buggyColors[i % buggyColors.length])
}

function clearEntityMeshes(): void {
  for (const obj of entityMeshes.values()) scene.remove(obj)
  entityMeshes.clear()
  entityClips.clear()
  for (const mixer of entityMixers.values()) mixer.stopAllAction()
  entityMixers.clear()
}

async function rebuildTerrain(): Promise<void> {
  scene.remove(terrainRoot)
  if (flatGround) {
    terrainRoot = await createFlatGround(manifest, sceneDoc.look)
  } else if (world) {
    const group = new THREE.Group()
    group.add(await createEnvironment(manifest, sceneDoc.look))
    group.add(
      await createTrackMesh(
        world.samples,
        world.totalLength,
        manifest,
        sceneDoc.look,
        world.halfWidth,
        world.boostPads,
      ),
    )
    terrainRoot = group
  } else {
    terrainRoot = await createEnvironment(manifest, sceneDoc.look)
  }
  scene.add(terrainRoot)
}

async function placeSceneEntities(): Promise<void> {
  clearEntityMeshes()
  placeEntities(scene, sceneDoc, entityMeshes)
  for (const entity of sceneDoc.entities) {
    let obj = entityMeshes.get(entity.id)
    if (!obj) continue
    obj.name = `entity:${entity.id}`
    const ref = getAsset(manifest, entity.assetId)
    if (ref?.kind === 'gltf') {
      try {
        const { root, clips } = await instantiateGltf(ref)
        root.name = `entity:${entity.id}`
        root.position.set(...entity.position)
        root.rotation.y = entity.rotationY
        root.scale.setScalar(entity.scale)
        scene.remove(obj)
        entityMeshes.set(entity.id, root)
        entityClips.set(entity.id, clips)
        scene.add(root)
        obj = root
        applyEntityOpacity(obj, entity.opacity ?? 1)
      } catch {
        obj.position.set(...entity.position)
        obj.rotation.y = entity.rotationY
        obj.scale.setScalar(entity.scale)
        applyEntityOpacity(obj, entity.opacity ?? 1)
      }
    } else {
      obj.position.set(...entity.position)
      obj.rotation.y = entity.rotationY
      obj.scale.setScalar(entity.scale)
      applyEntityOpacity(obj, entity.opacity ?? 1)
    }
  }
}

async function applyVisuals(): Promise<void> {
  flatGround = sceneDoc.id === 'sandbox-flat' && !sceneDoc.track
  if (sceneDoc.track) flatGround = false
  await rebuildTerrain()
  await placeSceneEntities()
  editOverlay?.update(sceneDoc, selection, studioMode === 'edit')
  notifyDoc()
}

async function applySim(): Promise<void> {
  await spawnRacers()
}

async function spawnRacers(): Promise<void> {
  for (const r of racers) scene.remove(r.mesh)
  racers = []
  world?.dispose()
  flatGround = sceneDoc.id === 'sandbox-flat' && !sceneDoc.track
  if (sceneDoc.track) flatGround = false
  world = await World.create(RACER_COUNT, {
    scene: sceneDoc,
    totalLaps: flatGround ? TOTAL_LAPS_SANDBOX : TOTAL_LAPS_TRACK,
    laterals: flatGround ? [0] : [1.8],
    backend: 'rapier',
    tuning,
    flatGround,
  })
  physicsAcc = 0
  await rebuildTerrain()
  await placeSceneEntities()
  for (let i = 0; i < 90; i++) world.step(world.timestep, emptyInputs(RACER_COUNT))
  world.plantOnStartGrid()
  for (let i = 0; i < RACER_COUNT; i++) {
    const mesh = await racerMesh(i)
    scene.add(mesh)
    applyVehicle(mesh, world.bodies[i], i === 0 ? playerVehicleVisual() : undefined)
    if (i === 0) applyEntityOpacity(mesh, studioDrawer?.getSettings().playerMeshOpacity ?? 1)
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
  physicsDebug?.onWorldReset()
  editOverlay?.update(sceneDoc, selection, studioMode === 'edit')
}

async function reloadManifest(): Promise<void> {
  try {
    manifest = await loadManifest('/assets/manifest.json')
  } catch {
    manifest = { version: 1, assets: [] }
  }
  notifyManifest()
}

const studioHost: StudioHost = {
  getDoc: () => sceneDoc,
  setDoc: (doc, opts) => {
    sceneDoc = doc
    scenePath = `/scenes/${doc.id}.json`
    if (opts?.clearSelection) selection = null
    notifyDoc()
    if (opts?.clearSelection) notifySel()
    if (opts?.skipVisuals) {
      editOverlay?.update(sceneDoc, selection, studioMode === 'edit')
      return
    }
    notifySel()
    void applyVisuals()
  },
  applyVisuals,
  applySim,
  reloadManifest,
  pickGround: (x, y) => editOverlay?.groundHit(x, y) ?? null,
  getManifest: () => manifest,
  getSelection: () => selection,
  setSelection: (sel) => {
    selection = sel
    notifySel()
    editOverlay?.update(sceneDoc, selection, studioMode === 'edit')
  },
  getMode: () => studioMode,
  setMode: async (mode) => {
    studioMode = mode
    editOverlay?.setVisible(mode === 'edit')
    studioDrawer?.syncVehicleTuneGate()
    if (mode === 'play') {
      await applySim()
      phase = 'menu'
      overlay.classList.remove('hidden')
    } else {
      editOverlay?.update(sceneDoc, selection, true)
    }
    notifyDoc()
  },
  onDocChange: (fn) => {
    docListeners.add(fn)
    return () => docListeners.delete(fn)
  },
  onSelectionChange: (fn) => {
    selListeners.add(fn)
    return () => selListeners.delete(fn)
  },
  onManifestChange: (fn) => {
    manifestListeners.add(fn)
    return () => manifestListeners.delete(fn)
  },
  getEntityClips: (id) => entityClips.get(id) ?? [],
  playEntityClip: (id, clipIndex) => {
    const obj = entityMeshes.get(id)
    const clips = entityClips.get(id)
    if (!obj || !clips?.[clipIndex]) return
    let mixer = entityMixers.get(id)
    if (!mixer) {
      mixer = new THREE.AnimationMixer(obj)
      entityMixers.set(id, mixer)
    }
    mixer.stopAllAction()
    mixer.clipAction(clips[clipIndex]).reset().play()
  },
  stopEntityClips: (id) => {
    if (id) {
      entityMixers.get(id)?.stopAllAction()
      return
    }
    for (const mixer of entityMixers.values()) mixer.stopAllAction()
  },
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
  if (studioMode === 'edit') await studioHost.setMode('play')
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
  if (studioMode === 'edit') return
  const body = world?.bodies[0]
  if (!body) return
  const s = studioDrawer?.getSettings()
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
  if (!world || dev?.isPaused() || studioDrawer?.isPaused() || studioMode === 'edit') return
  const { steps, rest } = fixedSteps(physicsAcc, frameDt, world.timestep)
  physicsAcc = rest
  for (let i = 0; i < steps; i++) {
    world.step(world.timestep, inputs)
    dev?.afterPhysicsStep()
  }
}

let draggingPoint: number | null = null

function bindEditCanvas(): void {
  if (!import.meta.env.DEV || !editOverlay) return

  canvas.addEventListener('pointerdown', (e) => {
    if (studioMode !== 'edit' || e.button !== 0) return
    if (editOverlay!.getTransform().dragging) return
    const assetId = undefined
    if (assetId) return
    const picked = editOverlay!.pickObject(e.clientX, e.clientY)
    if (!picked) return
    if (typeof picked.userData.pointIndex === 'number') {
      selection = { kind: 'point', index: picked.userData.pointIndex }
      draggingPoint = selection.index
      notifySel()
      editOverlay!.update(sceneDoc, selection, true)
      e.preventDefault()
      return
    }
    const ref = picked.userData.studioRef
    const entityId = ref?.kind === 'entity' ? ref.id : picked.name.replace(/^entity:/, '')
    if (entityId) {
      selection = { kind: 'entity', id: entityId }
      notifySel()
      editOverlay!.update(sceneDoc, selection, true)
    }
  })

  canvas.addEventListener('pointermove', (e) => {
    if (draggingPoint === null || studioMode !== 'edit') return
    const hit = editOverlay!.groundHit(e.clientX, e.clientY)
    if (!hit || !sceneDoc.track) return
    const prev = sceneDoc.track.centerline[draggingPoint]!
    const nextPt: [number, number, number] = [hit.x, prev[1], hit.z]
    sceneDoc = setCenterlinePoint(sceneDoc, draggingPoint, nextPt)
    notifyDoc()
    editOverlay!.update(sceneDoc, selection, true)
  })

  const endDrag = () => {
    if (draggingPoint === null) return
    draggingPoint = null
    void applyVisuals()
  }
  canvas.addEventListener('pointerup', endDrag)
  canvas.addEventListener('pointercancel', endDrag)
}

let last = performance.now()
function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000)
  last = now

  editOverlay?.updateControls(dt)
  for (const mixer of entityMixers.values()) mixer.update(dt)

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
    racers.forEach((r, i) =>
      applyVehicle(r.mesh, world!.bodies[i], i === 0 ? playerVehicleVisual() : undefined),
    )
    if (racers[0]) applyEntityOpacity(racers[0].mesh, studioDrawer?.getSettings().playerMeshOpacity ?? 1)
    updateCamera(dt)
  } else if (phase === 'racing') {
    countdownAcc += dt
    if (countdownEl.textContent === 'GO!' && countdownAcc > 0.7) countdownEl.textContent = ''
    stepPhysicsFrame(dt, [playerInput()])
    racers.forEach((r, i) =>
      applyVehicle(r.mesh, world!.bodies[i], i === 0 ? playerVehicleVisual() : undefined),
    )
    if (racers[0]) applyEntityOpacity(racers[0].mesh, studioDrawer?.getSettings().playerMeshOpacity ?? 1)
    updateHud()
    updateCamera(dt)
  } else {
    updateCamera(dt)
  }

  physicsDebug?.sync(world)
  renderer.render(scene, camera)
  dev?.afterRender(now)
  studioDrawer?.updateInspect()
  requestAnimationFrame(frame)
}

window.addEventListener('keydown', (e) => {
  if (isPanelField(e.target)) return
  if (e.code === 'F8' || e.code === 'Backquote') {
    e.preventDefault()
    if (e.repeat) return
    if (studioMode === 'edit') return
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

function sceneQueryPath(): string | null {
  const raw = new URLSearchParams(window.location.search).get('scene')
  if (!raw) return null
  if (raw.startsWith('/scenes/') && raw.endsWith('.json')) return raw
  if (/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(raw)) return `/scenes/${raw}.json`
  return null
}

async function loadBootScene(): Promise<void> {
  const path = sceneQueryPath()
  if (path) {
    const res = await fetch(path)
    if (!res.ok) throw new Error(`Failed to load scene ${path} (${res.status})`)
    sceneDoc = parseSceneDocument(await res.json())
    scenePath = path
    flatGround = sceneDoc.id === 'sandbox-flat' && !sceneDoc.track
    if (sceneDoc.track) flatGround = false
    return
  }
  if (import.meta.env.DEV) {
    const last = localStorage.getItem(LAST_SCENE_KEY)
    const candidates = [last, 'beach-default', 'default'].filter(Boolean) as string[]
    for (const id of candidates) {
      try {
        const res = await fetch(`/scenes/${id}.json`)
        if (!res.ok) continue
        sceneDoc = parseSceneDocument(await res.json())
        scenePath = `/scenes/${id}.json`
        flatGround = sceneDoc.id === 'sandbox-flat' && !sceneDoc.track
        if (sceneDoc.track) flatGround = false
        return
      } catch {
        /* try next */
      }
    }
  }
  scenePath = 'sandbox-flat'
  sceneDoc = createSandboxScene()
  flatGround = true
}

async function boot(): Promise<void> {
  setViewport(window.innerWidth, window.innerHeight)

  try {
    await loadBootScene()
  } catch (err) {
    console.warn(err)
    scenePath = 'sandbox-flat'
    sceneDoc = createSandboxScene()
    flatGround = true
  }
  await reloadManifest()
  try {
    const tuningRes = await fetch('/tuning/buggy-default.json')
    if (tuningRes.ok) tuning = parseVehicleTuning(await tuningRes.json())
  } catch {
    tuning = parseVehicleTuning(undefined)
  }

  if (!import.meta.env.DEV) {
    document.querySelector('#studio-rails-toggle')?.remove()
  }

  if (import.meta.env.DEV) {
    editOverlay = createEditOverlay(scene, camera, canvas, studioHost)
    editOverlay.setVisible(studioMode === 'edit')
    bindEditCanvas()
    physicsDebug = createPhysicsDebugLayer(scene)
    const ui = initStudioUi(studioHost, canvas, editOverlay)
    ui.shell?.observeStage(setViewport)
  } else {
    window.addEventListener('resize', () => setViewport(window.innerWidth, window.innerHeight))
  }

  if (studioMode === 'play') {
    await spawnRacers()
  } else {
    await applyVisuals()
    camera.position.set(0, 90, 110)
    camera.lookAt(0, 0, 0)
  }

  studioDrawer = createStudioDrawer({
    camera,
    hemi,
    sun,
    renderer,
    canvas,
    defaultMaxSpeed: tuning.maxSpeed,
    defaultChassisOffsetY: tuning.chassisOffset[1],
    getTuning: () => tuning,
    getWorld: () => world,
    getPhase: () => phase,
    getSceneDoc: () => sceneDoc,
    getScenePath: () => scenePath,
    getMode: () => studioMode,
    isSimPaused: () => Boolean(studioDrawer?.isPaused() || dev?.isActive() && dev.isPaused()),
    getManifest: () => manifest,
    setManifest: (next) => {
      manifest = next
      notifyManifest()
    },
    applyPlayerVehicleVisual,
    lookback,
    setPhysicsDebug: (on) => physicsDebug?.setEnabled(on),
  })
  physicsDebug?.setEnabled(studioDrawer.getSettings().showPhysicsDebug)
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
