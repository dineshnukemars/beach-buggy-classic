import type { InputFrame, SceneDocument, TrackSpec } from '@studio/core'
import {
  defaultBeachTrackSpec,
  projectOntoTrack,
  sampleAtProgress,
  samplesFromSpec,
  trackLength,
  type TrackSample,
} from './track'
import { createVehicleState, stepVehicle, type VehicleState } from './vehicle'

export type WorldOptions = {
  scene?: SceneDocument
  totalLaps?: number
  laterals?: number[]
}

export class World {
  readonly samples: TrackSample[]
  readonly totalLength: number
  readonly halfWidth: number
  readonly boostPads: number[]
  readonly totalLaps: number
  readonly bodies: VehicleState[]

  constructor(bodyCount: number, options: WorldOptions = {}) {
    const track: TrackSpec = options.scene?.track ?? defaultBeachTrackSpec()
    this.samples = samplesFromSpec(track)
    this.totalLength = trackLength(this.samples)
    this.halfWidth = track.halfWidth
    this.boostPads = track.boostPads
    this.totalLaps = options.totalLaps ?? 3
    const laterals = options.laterals ?? [1.8, -1.8, 4.2, -4.2]
    const start = sampleAtProgress(this.samples, this.totalLength, 2)
    this.bodies = []
    for (let i = 0; i < bodyCount; i++) {
      const state = createVehicleState(start, laterals[i] ?? 0)
      state.lastProgress = projectOntoTrack(this.samples, state.position, this.totalLength).progress
      this.bodies.push(state)
    }
  }

  onBoostPad(state: VehicleState): boolean {
    const p = ((state.progress % this.totalLength) + this.totalLength) % this.totalLength
    for (const frac of this.boostPads) {
      const pad = frac * this.totalLength
      if (Math.abs(p - pad) < 3.5 || Math.abs(p - pad - this.totalLength) < 3.5) return true
    }
    return false
  }

  step(dt: number, inputs: InputFrame[]): void {
    for (let i = 0; i < this.bodies.length; i++) {
      const body = this.bodies[i]
      const input = inputs[i] ?? { throttle: 0, steer: 0, brake: 0, boost: false }
      stepVehicle(
        body,
        input,
        this.samples,
        this.totalLength,
        dt,
        this.totalLaps,
        this.onBoostPad(body),
        this.halfWidth,
      )
    }
    const sorted = [...this.bodies].sort((a, b) => b.progress - a.progress)
    sorted.forEach((body, i) => {
      body.place = i + 1
    })
  }
}
