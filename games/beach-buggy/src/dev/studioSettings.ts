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
  maxSpeed: number
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
  maxSpeed: 42,
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

export function loadStudioSettings(tuningMaxSpeed?: number): StudioSettings {
  const defaults: StudioSettings = {
    ...DEFAULT_STUDIO_SETTINGS,
    maxSpeed: tuningMaxSpeed ?? DEFAULT_STUDIO_SETTINGS.maxSpeed,
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

export function resetStudioSettings(tuningMaxSpeed?: number): StudioSettings {
  const settings = {
    ...DEFAULT_STUDIO_SETTINGS,
    maxSpeed: tuningMaxSpeed ?? DEFAULT_STUDIO_SETTINGS.maxSpeed,
  }
  saveStudioSettings(settings)
  return settings
}
