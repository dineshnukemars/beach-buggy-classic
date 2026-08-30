import {
  computeAgentHints,
  makeFeedbackId,
  serializePoseHistory,
  upsertAsset,
  type FeedbackReport,
  type SceneEntity,
  type Selection,
  type Vec3Tuple,
} from '@studio/core'
import type { VehicleTuning, World } from '@studio/physics'
import * as THREE from 'three'
import { ENV_GENERATION } from '../visuals'
import type { LookbackBuffer } from './lookback'
import { playerSlice } from './lookback'
import { isPanelField } from './panel'
import { blobToBase64, submitFeedback } from './submit'
import {
  loadStudioSettings,
  saveStudioSettings,
  sunPositionFromSettings,
  type StudioSettings,
} from './studioSettings'
import { quatTuple, vec3Tuple } from './tagging'

export type StudioDrawerHost = {
  camera: THREE.PerspectiveCamera
  hemi: THREE.HemisphereLight
  sun: THREE.DirectionalLight
  renderer: THREE.WebGLRenderer
  canvas: HTMLCanvasElement
  defaultMaxSpeed: number
  defaultChassisOffsetY: number
  getTuning: () => VehicleTuning
  getWorld: () => World | undefined
  getPhase: () => string
  getSceneDoc: () => { id: string }
  getScenePath: () => string
  getMode: () => 'edit' | 'play'
  isSimPaused: () => boolean
  getManifest: () => import('@studio/core').AssetManifest
  setManifest: (manifest: import('@studio/core').AssetManifest) => void
  applyPlayerVehicleVisual: () => void
  lookback: LookbackBuffer
  setPhysicsDebug?: (on: boolean) => void
  onSimPauseChange?: () => void
  getSelection: () => Selection
  getDoc: () => import('@studio/core').SceneDocument
  patchSelectedEntity: (patch: (entity: SceneEntity) => SceneEntity) => void
  reconfigurePlayerWheels: () => void
}

type SliderSpec = {
  key: keyof StudioSettings
  label: string
  min: number
  max: number
  step: number
  format?: (v: number) => string
}

const CAMERA_SLIDERS: SliderSpec[] = [
  { key: 'cameraBack', label: 'Back distance', min: 4, max: 24, step: 0.5 },
  { key: 'cameraHeight', label: 'Height', min: 1, max: 14, step: 0.25 },
  { key: 'cameraFov', label: 'FOV', min: 35, max: 90, step: 1 },
  { key: 'cameraLookAhead', label: 'Look ahead', min: 0, max: 20, step: 0.5 },
]

const LIGHT_SLIDERS: SliderSpec[] = [
  { key: 'hemiIntensity', label: 'Hemisphere', min: 0, max: 2, step: 0.05 },
  { key: 'sunIntensity', label: 'Sun', min: 0, max: 3, step: 0.05 },
  { key: 'sunAzimuth', label: 'Sun azimuth', min: 0, max: 360, step: 1, format: (v) => `${Math.round(v)}°` },
  { key: 'sunElevation', label: 'Sun elevation', min: 5, max: 89, step: 1, format: (v) => `${Math.round(v)}°` },
]

const WHEEL_LABELS = ['Front left', 'Front right', 'Rear left', 'Rear right'] as const

type WheelTuneField = 'offsetX' | 'offsetZ' | 'radius' | 'restLength' | 'maxTravel'

type WheelTuneSpec = {
  field: WheelTuneField
  label: string
  min: number
  max: number
  step: number
}

const WHEEL_TUNE_SLIDERS: WheelTuneSpec[] = [
  { field: 'offsetX', label: 'Hub offset X', min: -2, max: 2, step: 0.02 },
  { field: 'offsetZ', label: 'Hub offset Z', min: -2, max: 2, step: 0.02 },
  { field: 'radius', label: 'Wheel radius', min: 0.12, max: 0.75, step: 0.01 },
  { field: 'restLength', label: 'Suspension rest', min: 0.1, max: 0.9, step: 0.01 },
  { field: 'maxTravel', label: 'Suspension travel', min: 0.05, max: 0.45, step: 0.01 },
]

const VEHICLE_SLIDERS: SliderSpec[] = [
  {
    key: 'playerMeshOpacity',
    label: 'Mesh opacity',
    min: 0,
    max: 1,
    step: 0.01,
    format: (v) => `${Math.round(v * 100)}%`,
  },
  { key: 'visualOffsetX', label: 'Visual offset X', min: -1, max: 1, step: 0.01 },
  { key: 'visualOffsetY', label: 'Visual offset Y', min: -1, max: 1, step: 0.01 },
  { key: 'visualOffsetZ', label: 'Visual offset Z', min: -1, max: 1, step: 0.01 },
  { key: 'chassisOffsetY', label: 'Chassis offset Y', min: 0, max: 1.5, step: 0.01 },
]

type EntityTuneField =
  | 'opacity'
  | 'offsetX'
  | 'offsetY'
  | 'offsetZ'
  | 'halfX'
  | 'halfY'
  | 'halfZ'

type EntityTuneSpec = {
  field: EntityTuneField
  label: string
  min: number
  max: number
  step: number
  format?: (v: number) => string
}

const ENTITY_TUNE_SLIDERS: EntityTuneSpec[] = [
  {
    field: 'opacity',
    label: 'Opacity',
    min: 0,
    max: 1,
    step: 0.01,
    format: (v) => `${Math.round(v * 100)}%`,
  },
  { field: 'offsetX', label: 'Collider offset X', min: -3, max: 3, step: 0.05 },
  { field: 'offsetY', label: 'Collider offset Y', min: -3, max: 3, step: 0.05 },
  { field: 'offsetZ', label: 'Collider offset Z', min: -3, max: 3, step: 0.05 },
  { field: 'halfX', label: 'Half X', min: 0.05, max: 5, step: 0.05 },
  { field: 'halfY', label: 'Half Y', min: 0.05, max: 5, step: 0.05 },
  { field: 'halfZ', label: 'Half Z', min: 0.05, max: 5, step: 0.05 },
]

export function createStudioDrawer(host: StudioDrawerHost) {
  const toggle = document.querySelector<HTMLButtonElement>('#studio-toggle')
  const drawer = document.querySelector<HTMLElement>('#studio-drawer')!
  const embedded = Boolean(document.querySelector('#studio-tune-mount'))
  const closeBtn = document.querySelector<HTMLButtonElement>('#studio-close')
  const inspectEl = document.querySelector<HTMLElement>('#studio-inspect')!
  const pauseBtn = document.querySelector<HTMLButtonElement>('#studio-pause')!
  const resetBtn = document.querySelector<HTMLButtonElement>('#studio-reset')!
  const shadowsInput = document.querySelector<HTMLInputElement>('#studio-shadows')!
  const physicsDebugInput = document.querySelector<HTMLInputElement>('#studio-physics-debug')!
  const recordStart = document.querySelector<HTMLButtonElement>('#studio-record-start')!
  const recordStop = document.querySelector<HTMLButtonElement>('#studio-record-stop')!
  const recordDownload = document.querySelector<HTMLButtonElement>('#studio-record-download')!
  const saveClipBtn = document.querySelector<HTMLButtonElement>('#studio-save-clip')!
  const recordStatus = document.querySelector<HTMLElement>('#studio-record-status')!
  const vehicleNote = document.querySelector<HTMLElement>('#studio-vehicle-note')
  const tuneTitle = document.querySelector<HTMLElement>('#studio-tune-title')
  const vehicleSection = document.querySelector<HTMLElement>('#studio-vehicle')
  const wheelTuneSection = document.querySelector<HTMLElement>('#studio-wheel-tune')
  const entityTuneSection = document.querySelector<HTMLElement>('#studio-entity-tune')

  const settingsBaseline = loadStudioSettings(host.defaultMaxSpeed, host.defaultChassisOffsetY)
  let settings = { ...settingsBaseline }
  let open = false
  let paused = false
  let recorder: MediaRecorder | undefined
  let recordChunks: Blob[] = []
  let recordedBlob: Blob | undefined
  let clipBusy = false

  const sliderEls = new Map<keyof StudioSettings, HTMLInputElement>()
  const valueEls = new Map<keyof StudioSettings, HTMLElement>()
  const entitySliderEls = new Map<EntityTuneField, HTMLInputElement>()
  const entityValueEls = new Map<EntityTuneField, HTMLElement>()
  const wheelSliderEls = new Map<WheelTuneField, HTMLInputElement>()
  const wheelValueEls = new Map<WheelTuneField, HTMLElement>()
  let entityTuneValues: Record<EntityTuneField, number> = {
    opacity: 1,
    offsetX: 0,
    offsetY: 0,
    offsetZ: 0,
    halfX: 0.5,
    halfY: 0.5,
    halfZ: 0.5,
  }

  function bindSlider(section: HTMLElement, spec: SliderSpec, onInput?: () => void): void {
    const row = document.createElement('label')
    row.className = 'studio-row'
    const name = document.createElement('span')
    name.textContent = spec.label
    const input = document.createElement('input')
    input.type = 'range'
    input.min = String(spec.min)
    input.max = String(spec.max)
    input.step = String(spec.step)
    input.value = String(settings[spec.key])
    input.dataset.vehicleTune = VEHICLE_SLIDERS.some((s) => s.key === spec.key) ? '1' : '0'
    const val = document.createElement('span')
    val.className = 'studio-val'
    val.textContent = spec.format ? spec.format(settings[spec.key] as number) : String(settings[spec.key])
    input.addEventListener('input', () => {
      if (input.disabled) return
      const num = Number(input.value)
      settings = { ...settings, [spec.key]: num }
      val.textContent = spec.format ? spec.format(num) : String(num)
      applySettings()
      saveStudioSettings(settings)
      onInput?.()
    })
    row.append(name, input, val)
    section.append(row)
    sliderEls.set(spec.key, input)
    valueEls.set(spec.key, val)
  }

  function entityFieldValue(entity: SceneEntity | undefined, field: EntityTuneField): number {
    if (!entity) return entityTuneValues[field]
    const off = entity.collider?.offset ?? [0, 0, 0]
    const half = entity.collider?.halfExtents ?? [0.5, 0.5, 0.5]
    switch (field) {
      case 'opacity':
        return entity.opacity ?? 1
      case 'offsetX':
        return off[0]
      case 'offsetY':
        return off[1]
      case 'offsetZ':
        return off[2]
      case 'halfX':
        return half[0]
      case 'halfY':
        return half[1]
      case 'halfZ':
        return half[2]
    }
  }

  function applyEntityTune(field: EntityTuneField, value: number): void {
    host.patchSelectedEntity((entity) => {
      const off: Vec3Tuple = [...(entity.collider?.offset ?? [0, 0, 0])]
      const half: Vec3Tuple = [...(entity.collider?.halfExtents ?? [0.5, 0.5, 0.5])]
      let opacity = entity.opacity ?? 1
      if (field === 'opacity') opacity = value
      if (field === 'offsetX') off[0] = value
      if (field === 'offsetY') off[1] = value
      if (field === 'offsetZ') off[2] = value
      if (field === 'halfX') half[0] = value
      if (field === 'halfY') half[1] = value
      if (field === 'halfZ') half[2] = value
      entityTuneValues[field] = value
      return {
        ...entity,
        opacity,
        collider: {
          type: 'box',
          halfExtents: half,
          ...(off.some((n) => n !== 0) ? { offset: off } : {}),
        },
      }
    })
  }

  function bindEntityTuneSlider(section: HTMLElement, spec: EntityTuneSpec): void {
    const row = document.createElement('label')
    row.className = 'studio-row'
    const name = document.createElement('span')
    name.textContent = spec.label
    const input = document.createElement('input')
    input.type = 'range'
    input.min = String(spec.min)
    input.max = String(spec.max)
    input.step = String(spec.step)
    input.value = String(entityTuneValues[spec.field])
    input.dataset.entityTune = '1'
    const val = document.createElement('span')
    val.className = 'studio-val'
    val.textContent = spec.format ? spec.format(entityTuneValues[spec.field]) : String(entityTuneValues[spec.field])
    input.addEventListener('input', () => {
      if (input.disabled) return
      const num = Number(input.value)
      val.textContent = spec.format ? spec.format(num) : String(num)
      applyEntityTune(spec.field, num)
    })
    row.append(name, input, val)
    section.append(row)
    entitySliderEls.set(spec.field, input)
    entityValueEls.set(spec.field, val)
  }

  function syncEntityTuneSliders(entity: SceneEntity | undefined): void {
    for (const spec of ENTITY_TUNE_SLIDERS) {
      const v = entityFieldValue(entity, spec.field)
      entityTuneValues[spec.field] = v
      const input = entitySliderEls.get(spec.field)
      const valEl = entityValueEls.get(spec.field)
      if (!input || !valEl) continue
      input.value = String(v)
      valEl.textContent = spec.format ? spec.format(v) : String(v)
    }
  }

  function wheelFieldValue(wheelIndex: number, field: WheelTuneField): number {
    return host.getTuning().wheels[wheelIndex]?.[field] ?? 0
  }

  function applyWheelTune(wheelIndex: number, field: WheelTuneField, value: number): void {
    const wheels = host.getTuning().wheels
    const wheel = wheels[wheelIndex]
    if (!wheel) return
    wheels[wheelIndex] = { ...wheel, [field]: value }
    host.reconfigurePlayerWheels()
  }

  function bindWheelTuneSlider(section: HTMLElement, spec: WheelTuneSpec): void {
    const row = document.createElement('label')
    row.className = 'studio-row'
    const name = document.createElement('span')
    name.textContent = spec.label
    const input = document.createElement('input')
    input.type = 'range'
    input.min = String(spec.min)
    input.max = String(spec.max)
    input.step = String(spec.step)
    input.dataset.wheelTune = '1'
    const val = document.createElement('span')
    val.className = 'studio-val'
    row.append(name, input, val)
    section.append(row)
    input.addEventListener('input', () => {
      if (input.disabled) return
      const sel = host.getSelection()
      if (sel?.kind !== 'wheel') return
      const num = Number(input.value)
      val.textContent = String(num)
      applyWheelTune(sel.index, spec.field, num)
    })
    wheelSliderEls.set(spec.field, input)
    wheelValueEls.set(spec.field, val)
  }

  function syncWheelTuneSliders(wheelIndex: number | undefined): void {
    if (wheelIndex === undefined) return
    for (const spec of WHEEL_TUNE_SLIDERS) {
      const v = wheelFieldValue(wheelIndex, spec.field)
      const input = wheelSliderEls.get(spec.field)
      const valEl = wheelValueEls.get(spec.field)
      if (!input || !valEl) continue
      input.value = String(v)
      valEl.textContent = String(v)
    }
  }

  function syncTuneTarget(): void {
    const sel = host.getSelection()
    const entity =
      sel?.kind === 'entity' ? host.getDoc().entities.find((e) => e.id === sel.id) : undefined
    const showEntity = Boolean(entity)
    const showWheel = sel?.kind === 'wheel'
    vehicleSection?.classList.toggle('hidden', showEntity || showWheel)
    wheelTuneSection?.classList.toggle('hidden', !showWheel)
    entityTuneSection?.classList.toggle('hidden', !showEntity)
    if (tuneTitle) {
      if (showEntity) tuneTitle.textContent = `Entity: ${entity!.id}`
      else if (showWheel) tuneTitle.textContent = `Wheel: ${WHEEL_LABELS[sel!.index] ?? sel!.index}`
      else if (sel?.kind === 'player') tuneTitle.textContent = 'Player vehicle'
      else tuneTitle.textContent = 'Player vehicle'
    }
    if (showEntity) syncEntityTuneSliders(entity)
    if (showWheel) syncWheelTuneSliders(sel.index)
    syncVehicleTuneGate()
  }

  function applyVehicleManifestOffset(): void {
    const offset: Vec3Tuple = [settings.visualOffsetX, settings.visualOffsetY, settings.visualOffsetZ]
    const buggy = host.getManifest().assets.find((a) => a.id === 'buggy')
    if (!buggy) return
    host.setManifest(upsertAsset(host.getManifest(), { ...buggy, visualOffset: offset }))
  }

  function bindSections(): void {
    const cameraSection = drawer.querySelector<HTMLElement>('#studio-camera')!
    const lightSection = drawer.querySelector<HTMLElement>('#studio-lighting')!
    const handlingSection = drawer.querySelector<HTMLElement>('#studio-handling')!
    for (const spec of CAMERA_SLIDERS) bindSlider(cameraSection, spec)
    for (const spec of LIGHT_SLIDERS) bindSlider(lightSection, spec)
    bindSlider(handlingSection, {
      key: 'maxSpeed',
      label: 'Max speed',
      min: 10,
      max: 80,
      step: 1,
      format: (v) => `${Math.round(v)} m/s`,
    })
    const vehicleSectionEl = document.querySelector<HTMLElement>('#studio-vehicle')
    if (vehicleSectionEl) {
      for (const spec of VEHICLE_SLIDERS) {
        bindSlider(vehicleSectionEl, spec, () => {
          if (spec.key.startsWith('visualOffset')) {
            applyVehicleManifestOffset()
            host.applyPlayerVehicleVisual()
          } else if (spec.key === 'playerMeshOpacity') {
            host.applyPlayerVehicleVisual()
          } else if (spec.key === 'chassisOffsetY') {
            host.getTuning().chassisOffset = [0, settings.chassisOffsetY, 0]
          }
        })
      }
    }
    if (entityTuneSection) {
      for (const spec of ENTITY_TUNE_SLIDERS) bindEntityTuneSlider(entityTuneSection, spec)
    }
    if (wheelTuneSection) {
      for (const spec of WHEEL_TUNE_SLIDERS) bindWheelTuneSlider(wheelTuneSection, spec)
    }
  }

  function vehicleTuneEnabled(): boolean {
    return host.getMode() === 'edit' || host.isSimPaused()
  }

  function syncVehicleTuneGate(): void {
    const enabled = vehicleTuneEnabled()
    const sel = host.getSelection()
    const tuningEntity = sel?.kind === 'entity'
    const tuningWheel = sel?.kind === 'wheel'
    for (const [key, input] of sliderEls) {
      if (!VEHICLE_SLIDERS.some((s) => s.key === key)) continue
      input.disabled = !enabled || tuningEntity || tuningWheel
    }
    for (const input of entitySliderEls.values()) {
      input.disabled = !enabled || !tuningEntity
    }
    for (const input of wheelSliderEls.values()) {
      input.disabled = !enabled || !tuningWheel
    }
    if (vehicleNote) {
      if (tuningWheel) {
        vehicleNote.textContent = enabled
          ? 'Adjusting one wheel — others stay fixed. Switch to Play to race-test.'
          : 'Edit mode or pause physics to tune.'
      } else if (tuningEntity) {
        vehicleNote.textContent = enabled
          ? 'Collider changes apply on Play.'
          : 'Edit mode or pause physics to tune.'
      } else {
        vehicleNote.textContent = enabled
          ? 'Chassis offset Y needs Apply physics / switch to Play.'
          : 'Edit mode or pause physics to tune.'
      }
    }
  }

  function syncSliders(): void {
    for (const [key, input] of sliderEls) {
      input.value = String(settings[key])
      const valEl = valueEls.get(key)
      if (!valEl) continue
      const spec = [
        ...CAMERA_SLIDERS,
        ...LIGHT_SLIDERS,
        ...VEHICLE_SLIDERS,
        { key: 'maxSpeed' as const, format: (v: number) => `${Math.round(v)} m/s` },
      ].find((s) => s.key === key)
      valEl.textContent = spec?.format ? spec.format(settings[key] as number) : String(settings[key])
    }
    shadowsInput.checked = settings.shadows
    physicsDebugInput.checked = settings.showPhysicsDebug
  }

  function applySettings(): void {
    host.camera.fov = settings.cameraFov
    host.camera.updateProjectionMatrix()
    host.hemi.intensity = settings.hemiIntensity
    host.sun.intensity = settings.sunIntensity
    host.sun.position.copy(sunPositionFromSettings(settings))
    host.renderer.shadowMap.enabled = settings.shadows
    host.sun.castShadow = settings.shadows
    host.getTuning().maxSpeed = settings.maxSpeed
    host.getTuning().chassisOffset = [0, settings.chassisOffsetY, 0]
    host.setPhysicsDebug?.(settings.showPhysicsDebug)
    syncVehicleTuneGate()
  }

  function setOpen(next: boolean): void {
    open = next
    if (!embedded) drawer.classList.toggle('hidden', !open)
    toggle?.setAttribute('aria-expanded', open ? 'true' : 'false')
  }

  function setPaused(next: boolean): void {
    paused = next
    pauseBtn.textContent = paused ? 'Resume physics' : 'Pause physics'
    pauseBtn.setAttribute('aria-pressed', paused ? 'true' : 'false')
    syncVehicleTuneGate()
    host.onSimPauseChange?.()
  }

  function updateInspect(): void {
    if (!open) return
    const world = host.getWorld()
    const body = world?.bodies[0]
    if (!body) {
      inspectEl.textContent = 'No world'
      return
    }
    const contacts = body.wheelContacts.filter(Boolean).length
    inspectEl.textContent = [
      `y ${body.position.y.toFixed(2)}`,
      `speed ${body.speed.toFixed(1)} m/s`,
      `heading ${((body.heading * 180) / Math.PI).toFixed(0)}°`,
      `wheels ${contacts}/4`,
      `sim ${world.simClock.toFixed(2)}s`,
    ].join(' · ')
  }

  function setRecordStatus(text: string): void {
    recordStatus.textContent = text
  }

  function startRecording(): void {
    if (recorder?.state === 'recording') return
    recordChunks = []
    recordedBlob = undefined
    recordDownload.disabled = true
    const stream = host.canvas.captureStream(30)
    const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
      ? 'video/webm;codecs=vp9'
      : 'video/webm'
    recorder = new MediaRecorder(stream, { mimeType: mime })
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) recordChunks.push(e.data)
    }
    recorder.onstop = () => {
      recordedBlob = new Blob(recordChunks, { type: mime })
      recordDownload.disabled = false
      setRecordStatus('Recording stopped — download ready')
    }
    recorder.start(250)
    recordStart.disabled = true
    recordStop.disabled = false
    setRecordStatus('Recording…')
  }

  function stopRecording(): void {
    if (recorder?.state === 'recording') recorder.stop()
    recordStart.disabled = false
    recordStop.disabled = true
  }

  function downloadRecording(): void {
    if (!recordedBlob) return
    const url = URL.createObjectURL(recordedBlob)
    const a = document.createElement('a')
    a.href = url
    a.download = `beach-buggy-${Date.now()}.webm`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function saveInspectClip(): Promise<void> {
    if (clipBusy) return
    const world = host.getWorld()
    if (!world) {
      setRecordStatus('No world for clip')
      return
    }
    clipBusy = true
    saveClipBtn.disabled = true
    setRecordStatus('Saving clip…')
    try {
      const png = await capturePng(host.canvas)
      const snap = host.lookback.snapshot()
      const ref = { kind: 'environment' as const, id: 'studio:clip', label: 'Studio clip' }
      const player = world.bodies[0]
      const report: FeedbackReport = {
        version: 1,
        id: makeFeedbackId(ref),
        createdAt: new Date().toISOString(),
        issue: { tags: ['other'], note: 'studio clip' },
        target: {
          ...ref,
          worldTransform: {
            position: [player.position.x, player.position.y, player.position.z],
            quaternion: quatTuple(player.rotation),
            heading: player.heading,
            scale: 1,
          },
        },
        context: {
          sceneId: host.getSceneDoc().id,
          scenePath: host.getScenePath(),
          phase: host.getPhase(),
          simClock: world.simClock,
          player: playerSlice(player),
          camera: {
            position: vec3Tuple(host.camera.position),
            quaternion: quatTuple(host.camera.quaternion),
          },
          environment: ENV_GENERATION,
        },
        attachments: {
          screenshot: 'screenshot.png',
          poseHistory: 'pose-history.jsonl',
          frames: snap.frames.length ? 'frames' : undefined,
        },
        agentHints: computeAgentHints({
          kind: ref.kind,
          tags: ['other'],
          scenePath: host.getScenePath(),
        }),
      }
      const framePayload = []
      for (let i = 0; i < snap.frames.length; i++) {
        framePayload.push({
          filename: `${String(i).padStart(2, '0')}.jpg`,
          jpegBase64: await blobToBase64(snap.frames[i].blob),
        })
      }
      const result = await submitFeedback({
        report,
        screenshotPngBase64: await blobToBase64(png),
        poseHistoryJsonl: serializePoseHistory(snap.poses),
        frames: framePayload.length ? framePayload : undefined,
      })
      setRecordStatus(`Saved clip ${result.id}`)
    } catch (err) {
      setRecordStatus(err instanceof Error ? err.message : 'Clip save failed')
    } finally {
      clipBusy = false
      saveClipBtn.disabled = false
    }
  }

  toggle?.addEventListener('click', () => setOpen(!open))
  closeBtn?.addEventListener('click', () => setOpen(false))
  pauseBtn.addEventListener('click', () => setPaused(!paused))
  resetBtn.addEventListener('click', () => {
    settings = { ...settingsBaseline }
    saveStudioSettings(settings)
    syncSliders()
    applySettings()
    applyVehicleManifestOffset()
    host.applyPlayerVehicleVisual()
    setRecordStatus('Settings restored')
  })
  shadowsInput.addEventListener('change', () => {
    settings.shadows = shadowsInput.checked
    applySettings()
    saveStudioSettings(settings)
  })
  physicsDebugInput.addEventListener('change', () => {
    settings.showPhysicsDebug = physicsDebugInput.checked
    applySettings()
    saveStudioSettings(settings)
  })
  recordStart.addEventListener('click', () => startRecording())
  recordStop.addEventListener('click', () => stopRecording())
  recordDownload.addEventListener('click', () => downloadRecording())
  saveClipBtn.addEventListener('click', () => void saveInspectClip())

  bindSections()
  syncSliders()
  applySettings()
  applyVehicleManifestOffset()
  host.applyPlayerVehicleVisual()
  syncTuneTarget()
  recordStop.disabled = true
  recordDownload.disabled = true
  if (embedded) setOpen(true)

  return {
    getSettings: () => settings,
    isOpen: () => open,
    isPaused: () => paused,
    isTyping: () => isPanelField(document.activeElement),
    updateInspect,
    syncVehicleTuneGate,
    syncTuneTarget,
    dispose: () => {
      if (recorder?.state === 'recording') recorder.stop()
    },
  }
}

function capturePng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('screenshot failed'))
    }, 'image/png')
  })
}
