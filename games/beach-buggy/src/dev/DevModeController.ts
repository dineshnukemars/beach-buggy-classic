import {
  computeAgentHints,
  makeFeedbackId,
  serializePoseHistory,
  type FeedbackReport,
  type FeedbackTag,
  type PoseHistorySample,
  type SceneDocument,
  type StudioRef,
} from '@studio/core'
import type { World } from '@studio/physics'
import { tagStudioRef } from '@studio/three-render'
import * as THREE from 'three'
import { ENV_GENERATION } from '../visuals'
import { playerSlice, type LookbackBuffer, type LookbackFrame } from './lookback'
import { bindPanel, isPanelField, resetPanel, selectedTags, setPanelOpen, setTargetLabel, type PanelElements } from './panel'
import { createPicker } from './picker'
import { blobToBase64, submitFeedback } from './submit'
import { quatTuple, vec3Tuple, worldBoxOf, worldTransformOf } from './tagging'

export type Phase = 'menu' | 'countdown' | 'racing' | 'finished'

export type DevModeHost = {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  canvas: HTMLCanvasElement
  overlay: HTMLElement
  lookback: LookbackBuffer
  getWorld: () => World | undefined
  getPhase: () => Phase
  getSceneDoc: () => SceneDocument
  getScenePath: () => string
}

export function createDevMode(host: DevModeHost) {
  const panel = bindPanel()
  const picker = createPicker(host.scene, host.camera)
  const messageEl = document.querySelector<HTMLElement>('#message')
  let active = false
  let paused = false
  let frozen: { poses: PoseHistorySample[]; frames: LookbackFrame[] } | undefined
  let picked: { object: THREE.Object3D; ref: StudioRef } | undefined
  let pendingPng: ((blob: Blob | null) => void) | undefined
  let busy = false

  function isActive(): boolean {
    return active
  }

  function isPaused(): boolean {
    return paused
  }

  function toggle(opts: { pause: boolean }): void {
    if (active) {
      exit()
      return
    }
    const world = host.getWorld()
    if (!world || host.getPhase() === 'menu') return
    host.lookback.pushPlayer(world.simClock, world.bodies[0], picked?.ref.id)
    frozen = host.lookback.snapshot()
    paused = opts.pause
    active = true
    host.canvas.style.cursor = 'crosshair'
    host.overlay.style.pointerEvents = 'none'
    resetPanel(panel)
    setPanelOpen(panel, true)
    panel.status.textContent = paused ? 'Paused. Click an object.' : 'Live inspect. Click an object.'
  }

  function exit(): void {
    active = false
    paused = false
    frozen = undefined
    picked = undefined
    busy = false
    picker.clear()
    setPanelOpen(panel, false)
    resetPanel(panel)
    host.canvas.style.cursor = ''
    host.overlay.style.pointerEvents = ''
  }

  function resume(): void {
    if (!active) return
    paused = false
    panel.status.textContent = 'Live inspect.'
  }

  function onWorldReset(): void {
    host.lookback.clear()
    picker.clear()
    picked = undefined
    frozen = undefined
    if (active) {
      setTargetLabel(panel, undefined)
      panel.status.textContent = 'World reset. Click an object.'
    }
  }

  function afterPhysicsStep(): void {
    if (paused) return
    const world = host.getWorld()
    const phase = host.getPhase()
    if (!world || (phase !== 'countdown' && phase !== 'racing')) return
    host.lookback.pushPlayer(world.simClock, world.bodies[0], picked?.ref.id)
  }

  function afterRender(nowMs: number): void {
    picker.update()
    if (pendingPng) {
      const done = pendingPng
      pendingPng = undefined
      host.canvas.toBlob((blob) => done(blob), 'image/png')
      return
    }
    if (paused) return
    const phase = host.getPhase()
    if (phase !== 'countdown' && phase !== 'racing') return
    host.lookback.maybeCaptureJpeg(host.canvas, nowMs, host.getWorld()?.simClock ?? 0)
  }

  function capturePng(): Promise<Blob> {
    return new Promise((resolve, reject) => {
      pendingPng = (blob) => {
        if (blob) resolve(blob)
        else reject(new Error('screenshot failed'))
      }
    })
  }

  async function submit(): Promise<void> {
    if (!active || busy) return
    if (!picked) {
      panel.status.textContent = 'Click an object first.'
      return
    }
    const world = host.getWorld()
    if (!world) {
      panel.status.textContent = 'No world.'
      return
    }
    const tags = selectedTags(panel)
    if (tags.length === 0 && !panel.note.value.trim()) {
      panel.status.textContent = 'Add a tag or a note.'
      return
    }
    const issueTags: FeedbackTag[] = tags.length ? tags : ['other']
    busy = true
    panel.status.textContent = 'Saving…'
    try {
      const png = await capturePng()
      const frames = (frozen ?? host.lookback.snapshot()).frames
      const poses = (frozen ?? host.lookback.snapshot()).poses
      const report = buildReport({
        ref: picked.ref,
        object: picked.object,
        tags: issueTags,
        note: panel.note.value.trim(),
        world,
        sceneDoc: host.getSceneDoc(),
        scenePath: host.getScenePath(),
        phase: host.getPhase(),
        camera: host.camera,
        hasFrames: frames.length > 0,
      })
      const framePayload = []
      for (let i = 0; i < frames.length; i++) {
        framePayload.push({
          filename: `${String(i).padStart(2, '0')}.jpg`,
          jpegBase64: await blobToBase64(frames[i].blob),
        })
      }
      const result = await submitFeedback({
        report,
        screenshotPngBase64: await blobToBase64(png),
        poseHistoryJsonl: serializePoseHistory(poses),
        frames: framePayload.length ? framePayload : undefined,
      })
      if (messageEl) {
        messageEl.textContent = `saved report ${result.id}`
        window.setTimeout(() => {
          if (messageEl.textContent === `saved report ${result.id}`) messageEl.textContent = ''
        }, 4000)
      }
      panel.status.textContent = `Saved ${result.id}`
      exit()
    } catch (err) {
      panel.status.textContent = err instanceof Error ? err.message : 'Save failed'
    } finally {
      busy = false
    }
  }

  host.canvas.addEventListener('pointerdown', (event) => {
    if (!active) return
    const hit = picker.pick(event.clientX, event.clientY, host.canvas)
    if (!hit) {
      panel.status.textContent = 'No tagged object there.'
      return
    }
    picked = hit
    setTargetLabel(panel, hit.ref)
    panel.status.textContent = 'Tagged. Add a note and submit.'
  })

  panel.submit.addEventListener('click', () => void submit())
  panel.resume.addEventListener('click', () => resume())
  panel.cancel.addEventListener('click', () => exit())

  return {
    isActive,
    isPaused,
    toggle,
    exit,
    resume,
    onWorldReset,
    afterPhysicsStep,
    afterRender,
    isTyping: () => isPanelField(document.activeElement),
    dispose: () => {
      exit()
      picker.dispose()
    },
    panel: panel as PanelElements,
  }
}

function buildReport(input: {
  ref: StudioRef
  object: THREE.Object3D
  tags: FeedbackTag[]
  note: string
  world: World
  sceneDoc: SceneDocument
  scenePath: string
  phase: Phase
  camera: THREE.Camera
  hasFrames: boolean
}): FeedbackReport {
  const player = input.world.bodies[0]
  const sceneEntity = input.sceneDoc.entities.find((e) => e.id === input.ref.id)
  const transform = worldTransformOf(input.object)
  if (sceneEntity) transform.rotationY = sceneEntity.rotationY
  if (input.ref.kind === 'racer') {
    const index = Number(input.ref.id.slice('racer:'.length))
    const body = input.world.bodies[index]
    if (body) {
      transform.position = [body.position.x, body.position.y, body.position.z]
      transform.quaternion = quatTuple(body.rotation)
      transform.heading = body.heading
    }
  }
  return {
    version: 1,
    id: makeFeedbackId(input.ref),
    createdAt: new Date().toISOString(),
    issue: { tags: input.tags, note: input.note },
    target: {
      ...input.ref,
      worldTransform: transform,
      boundingBox: worldBoxOf(input.object),
      sceneEntity,
    },
    context: {
      sceneId: input.sceneDoc.id,
      scenePath: input.scenePath,
      phase: input.phase,
      simClock: input.world.simClock,
      player: playerSlice(player),
      camera: {
        position: vec3Tuple(input.camera.position),
        quaternion: quatTuple(input.camera.quaternion),
      },
      environment: ENV_GENERATION,
    },
    attachments: {
      screenshot: 'screenshot.png',
      poseHistory: 'pose-history.jsonl',
      frames: input.hasFrames ? 'frames' : undefined,
    },
    agentHints: computeAgentHints({
      kind: input.ref.kind,
      tags: input.tags,
      scenePath: input.scenePath,
    }),
  }
}

export function tagRacer(mesh: THREE.Object3D, index: number, name: string): void {
  tagStudioRef(mesh, { kind: 'racer', id: `racer:${index}`, assetId: 'buggy', label: name })
}
