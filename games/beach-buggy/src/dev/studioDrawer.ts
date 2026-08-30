import {
  computeAgentHints,
  makeFeedbackId,
  serializePoseHistory,
  type FeedbackReport,
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
  resetStudioSettings,
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
  getTuning: () => VehicleTuning
  getWorld: () => World | undefined
  getPhase: () => string
  getSceneDoc: () => { id: string }
  getScenePath: () => string
  lookback: LookbackBuffer
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

export function createStudioDrawer(host: StudioDrawerHost) {
  const toggle = document.querySelector<HTMLButtonElement>('#studio-toggle')!
  const drawer = document.querySelector<HTMLElement>('#studio-drawer')!
  const closeBtn = document.querySelector<HTMLButtonElement>('#studio-close')!
  const inspectEl = document.querySelector<HTMLElement>('#studio-inspect')!
  const pauseBtn = document.querySelector<HTMLButtonElement>('#studio-pause')!
  const resetBtn = document.querySelector<HTMLButtonElement>('#studio-reset')!
  const shadowsInput = document.querySelector<HTMLInputElement>('#studio-shadows')!
  const recordStart = document.querySelector<HTMLButtonElement>('#studio-record-start')!
  const recordStop = document.querySelector<HTMLButtonElement>('#studio-record-stop')!
  const recordDownload = document.querySelector<HTMLButtonElement>('#studio-record-download')!
  const saveClipBtn = document.querySelector<HTMLButtonElement>('#studio-save-clip')!
  const recordStatus = document.querySelector<HTMLElement>('#studio-record-status')!

  let settings = loadStudioSettings(host.defaultMaxSpeed)
  let open = false
  let paused = false
  let recorder: MediaRecorder | undefined
  let recordChunks: Blob[] = []
  let recordedBlob: Blob | undefined
  let clipBusy = false

  const sliderEls = new Map<keyof StudioSettings, HTMLInputElement>()
  const valueEls = new Map<keyof StudioSettings, HTMLElement>()

  function bindSlider(section: HTMLElement, spec: SliderSpec): void {
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
    const val = document.createElement('span')
    val.className = 'studio-val'
    val.textContent = spec.format ? spec.format(settings[spec.key] as number) : String(settings[spec.key])
    input.addEventListener('input', () => {
      const num = Number(input.value)
      settings = { ...settings, [spec.key]: num }
      val.textContent = spec.format ? spec.format(num) : String(num)
      applySettings()
      saveStudioSettings(settings)
    })
    row.append(name, input, val)
    section.append(row)
    sliderEls.set(spec.key, input)
    valueEls.set(spec.key, val)
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
  }

  function syncSliders(): void {
    for (const [key, input] of sliderEls) {
      input.value = String(settings[key])
      const valEl = valueEls.get(key)
      if (!valEl) continue
      const spec = [...CAMERA_SLIDERS, ...LIGHT_SLIDERS, { key: 'maxSpeed' as const, format: (v: number) => `${Math.round(v)} m/s` }].find(
        (s) => s.key === key,
      )
      valEl.textContent = spec?.format ? spec.format(settings[key] as number) : String(settings[key])
    }
    shadowsInput.checked = settings.shadows
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
  }

  function setOpen(next: boolean): void {
    open = next
    drawer.classList.toggle('hidden', !open)
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false')
  }

  function setPaused(next: boolean): void {
    paused = next
    pauseBtn.textContent = paused ? 'Resume physics' : 'Pause physics'
    pauseBtn.setAttribute('aria-pressed', paused ? 'true' : 'false')
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

  toggle.addEventListener('click', () => setOpen(!open))
  closeBtn.addEventListener('click', () => setOpen(false))
  pauseBtn.addEventListener('click', () => setPaused(!paused))
  resetBtn.addEventListener('click', () => {
    settings = resetStudioSettings(host.defaultMaxSpeed)
    syncSliders()
    applySettings()
    setRecordStatus('Settings reset')
  })
  shadowsInput.addEventListener('change', () => {
    settings.shadows = shadowsInput.checked
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
  recordStop.disabled = true
  recordDownload.disabled = true

  return {
    getSettings: () => settings,
    isOpen: () => open,
    isPaused: () => paused,
    isTyping: () => isPanelField(document.activeElement),
    updateInspect,
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
