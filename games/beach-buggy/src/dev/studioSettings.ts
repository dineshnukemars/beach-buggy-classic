import * as THREE from 'three'

export const STORAGE_KEY = 'bbc-studio-settings'

export type StudioSettings = {
  cameraBack: number
  cameraHeight: number
  cameraFov: number
  cameraLookAhead: number
  hemiIntensity: number
  sunIntensity: number
  sunAzimuth: number
  sunElevation: number
  shadows: boolean
  showPhysicsDebug: boolean
  maxSpeed: number
  playerMeshOpacity: number
  visualOffsetX: number
  visualOffsetY: number
  visualOffsetZ: number
  chassisOffsetY: number
}

/** Defaults match hardcodes in main.ts before studio wiring. */
export const DEFAULT_STUDIO_SETTINGS: StudioSettings = {
  cameraBack: 11,
  cameraHeight: 5.5,
  cameraFov: 55,
  cameraLookAhead: 8,
  hemiIntensity: 0.85,
  sunIntensity: 1.15,
  sunAzimuth: 63.4,
  sunElevation: 53.1,
  shadows: true,
  showPhysicsDebug: false,
  maxSpeed: 42,
  playerMeshOpacity: 1,
  visualOffsetX: 0,
  visualOffsetY: 0,
  visualOffsetZ: 0,
  chassisOffsetY: 0.55,
}

const SUN_DISTANCE = Math.hypot(40, 60, 20)

export function sunPositionFromSettings(s: StudioSettings): THREE.Vector3 {
  const elev = (s.sunElevation * Math.PI) / 180
  const az = (s.sunAzimuth * Math.PI) / 180
  return new THREE.Vector3(
    SUN_DISTANCE * Math.cos(elev) * Math.sin(az),
    SUN_DISTANCE * Math.sin(elev),
    SUN_DISTANCE * Math.cos(elev) * Math.cos(az),
  )
}

export function loadStudioSettings(tuningMaxSpeed?: number, chassisOffsetY?: number): StudioSettings {
  const defaults: StudioSettings = {
    ...DEFAULT_STUDIO_SETTINGS,
    maxSpeed: tuningMaxSpeed ?? DEFAULT_STUDIO_SETTINGS.maxSpeed,
    chassisOffsetY: chassisOffsetY ?? DEFAULT_STUDIO_SETTINGS.chassisOffsetY,
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaults
    const parsed = JSON.parse(raw) as Partial<StudioSettings>
    return { ...defaults, ...parsed }
  } catch {
    return defaults
  }
}

export function saveStudioSettings(settings: StudioSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    /* quota or private mode */
  }
}

export function resetStudioSettings(tuningMaxSpeed?: number, chassisOffsetY?: number): StudioSettings {
  const settings = {
    ...DEFAULT_STUDIO_SETTINGS,
    maxSpeed: tuningMaxSpeed ?? DEFAULT_STUDIO_SETTINGS.maxSpeed,
    chassisOffsetY: chassisOffsetY ?? DEFAULT_STUDIO_SETTINGS.chassisOffsetY,
  }
  saveStudioSettings(settings)
  return settings
}
