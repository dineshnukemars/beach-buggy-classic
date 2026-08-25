import type { SceneDocument } from '@studio/core'
import { defaultBeachTrackSpec } from './track'

export function createDefaultBeachScene(): SceneDocument {
  return {
    version: 1,
    id: 'beach-default',
    track: defaultBeachTrackSpec(),
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
