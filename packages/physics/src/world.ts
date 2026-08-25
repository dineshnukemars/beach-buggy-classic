import * as THREE from 'three'
import type { InputFrame, SceneDocument, TrackSpec } from '@studio/core'
import { initPhysics } from './init'
import { createRapierSimulation, FIXED_TIMESTEP, RapierSimulation } from './rapierSim'
import {
  defaultBeachTrackSpec,
  projectOntoTrack,
  sampleAtProgress,
  samplesFromSpec,
  trackLength,
  type TrackSample,
} from './track'
import { initialCheckpointIndex, checkpointProgresses, defaultCheckpointFractions } from './race'
import { DEFAULT_VEHICLE_TUNING, type VehicleTuning } from './tuning'
import { createVehicleState, stepVehicleArcade, type VehicleState } from './vehicle'

export type PhysicsBackend = 'arcade' | 'rapier'

export type WorldOptions = {
  scene?: SceneDocument
  totalLaps?: number
  laterals?: number[]
  backend?: PhysicsBackend
  tuning?: VehicleTuning
}

export class World {
  readonly samples: TrackSample[]
  readonly totalLength: number
  readonly halfWidth: number
  readonly boostPads: number[]
  readonly totalLaps: number
  readonly bodies: VehicleState[]
  readonly timestep: number
  readonly backend: PhysicsBackend

  private readonly checkpointFractions: number[]
  private readonly checkpointProgressList: number[]
  private rapier?: RapierSimulation
  private simTime = 0

  private constructor(bodyCount: number, options: WorldOptions, backend: PhysicsBackend) {
    this.backend = backend
    this.timestep = backend === 'rapier' ? FIXED_TIMESTEP : 1 / 60
    const track: TrackSpec = options.scene?.track ?? defaultBeachTrackSpec()
    this.samples = samplesFromSpec(track)
    this.totalLength = trackLength(this.samples)
    this.halfWidth = track.halfWidth
    this.boostPads = track.boostPads
    this.totalLaps = options.totalLaps ?? 3
    this.checkpointFractions = track.checkpoints ?? defaultCheckpointFractions()
    this.checkpointProgressList = checkpointProgresses(this.checkpointFractions, this.totalLength)

    if (backend === 'rapier') {
      if (!options.scene?.track) throw new Error('Rapier backend requires a scene track')
      this.rapier = createRapierSimulation(bodyCount, options.scene, {
        totalLaps: this.totalLaps,
        laterals: options.laterals,
        tuning: options.tuning ?? DEFAULT_VEHICLE_TUNING,
      })
      this.bodies = this.rapier.bodies
      return
    }

    const laterals = options.laterals ?? [1.8, -1.8, 4.2, -4.2]
    const start = sampleAtProgress(this.samples, this.totalLength, 2)
    this.bodies = []
    for (let i = 0; i < bodyCount; i++) {
      const state = createVehicleState(start, laterals[i] ?? 0)
      const progress = projectOntoTrack(this.samples, state.position, this.totalLength).progress
      state.lastProgress = progress
      state.progress = progress
      state.checkpointIndex = initialCheckpointIndex(progress, this.checkpointProgressList)
      state.raceDistance = progress
      this.bodies.push(state)
    }
  }

  static async create(bodyCount: number, options: WorldOptions = {}): Promise<World> {
    const backend = options.backend ?? 'rapier'
    if (backend === 'rapier') await initPhysics()
    return new World(bodyCount, options, backend)
  }

  onBoostPad(state: VehicleState): boolean {
    if (this.rapier) return this.rapier.onBoostPad(state)
    const p = ((state.progress % this.totalLength) + this.totalLength) % this.totalLength
    for (const frac of this.boostPads) {
      const pad = frac * this.totalLength
      if (Math.abs(p - pad) < 3.5 || Math.abs(p - pad - this.totalLength) < 3.5) return true
    }
    return false
  }

  step(dt: number, inputs: InputFrame[]): void {
    if (this.rapier) {
      this.rapier.step(dt, inputs)
      this.simTime = this.rapier.simClock
      return
    }

    for (let i = 0; i < this.bodies.length; i++) {
      const body = this.bodies[i]
      const input = inputs[i] ?? { throttle: 0, steer: 0, brake: 0, boost: false }
      stepVehicleArcade(
        body,
        input,
        this.samples,
        this.totalLength,
        dt,
        this.totalLaps,
        this.onBoostPad(body),
        this.halfWidth,
        this.checkpointFractions,
      )
    }
    const sorted = [...this.bodies].sort((a, b) => b.raceDistance - a.raceDistance)
    sorted.forEach((body, i) => {
      body.place = i + 1
    })
    this.simTime += dt
  }

  teleport(index: number, position: THREE.Vector3, rotation?: THREE.Quaternion): void {
    if (this.rapier) {
      const rot = rotation ?? this.bodies[index]?.rotation
      if (!rot) return
      this.rapier.teleport(index, position, rot)
      return
    }
    const body = this.bodies[index]
    if (!body) return
    body.position.copy(position)
    if (rotation) body.rotation.copy(rotation)
    body.speed = 0
  }

  get simClock(): number {
    return this.simTime
  }

  dispose(): void {
    this.rapier?.dispose()
    this.rapier = undefined
  }
}
