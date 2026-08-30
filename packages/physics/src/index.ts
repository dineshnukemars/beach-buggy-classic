import type { SceneDocument } from '@studio/core'
import { defaultBeachTrackSpec, SANDBOX_GROUND_HALF } from './track'

export function createDefaultBeachScene(): SceneDocument {
  return {
    version: 1,
    id: 'beach-default',
    track: defaultBeachTrackSpec(),
    entities: [],
  }
}

/** Straight centerline on y = 0. Used with `WorldOptions.flatGround` — not the probe track. */
export function createSandboxScene(): SceneDocument {
  return {
    version: 1,
    id: 'sandbox-flat',
    track: {
      halfWidth: SANDBOX_GROUND_HALF,
      centerline: [
        [0, 0, -100],
        [0, 0, 0],
        [0, 0, 100],
      ],
      boostPads: [],
    },
    entities: [],
  }
}

export * from './init'
export * from './tuning'
export * from './trackGeometry'
export { FIXED_TIMESTEP } from './rapierSim'
export * from './track'
export * from './vehicle'
export * from './world'
export * from './simTelemetry'
