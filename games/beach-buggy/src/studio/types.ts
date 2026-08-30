import type { AssetManifest, SceneDocument, Selection } from '@studio/core'
import type * as THREE from 'three'

export type StudioMode = 'edit' | 'play'

export type StudioHost = {
  getDoc: () => SceneDocument
  setDoc: (doc: SceneDocument, opts?: { clearSelection?: boolean; skipVisuals?: boolean }) => void
  applyVisuals: () => Promise<void>
  applySim: () => Promise<void>
  reloadManifest: () => Promise<void>
  pickGround: (clientX: number, clientY: number) => THREE.Vector3 | null
  getManifest: () => AssetManifest
  getSelection: () => Selection
  setSelection: (sel: Selection) => void
  getMode: () => StudioMode
  setMode: (mode: StudioMode) => Promise<void>
  isOrbitFree: () => boolean
  isKeyDown: (code: string) => boolean
  getPickTargets: () => THREE.Object3D[]
  getPlayerObject: () => THREE.Object3D | null
  getWheelHubPosition: (wheelIndex: number) => THREE.Vector3 | null
  onDocChange: (fn: () => void) => () => void
  onSelectionChange: (fn: () => void) => () => void
  onManifestChange: (fn: () => void) => () => void
  getEntityClips: (entityId: string) => THREE.AnimationClip[]
  playEntityClip: (entityId: string, clipIndex: number) => void
  stopEntityClips: (entityId?: string) => void
}
