import * as THREE from 'three'
import type { InputFrame } from '@studio/core'
import { CHASSIS_SPAWN_CLEARANCE } from './tuning'
import { projectOntoTrack, sampleAtProgress, type TrackSample } from './track'
import { advanceRaceState, checkpointProgresses, defaultCheckpointFractions } from './race'

export type VehicleInput = InputFrame

export type VehicleState = {
  position: THREE.Vector3
  rotation: THREE.Quaternion
  heading: number
  speed: number
  boostTimer: number
  lap: number
  progress: number
  lastProgress: number
  raceDistance: number
  checkpointIndex: number
  lastCheckpointProgress: number
  offTrackDistance: number
  airborneTime: number
  collisionCount: number
  wheelContacts: boolean[]
  finished: boolean
  place: number
}

export const BOOST_DURATION = 0.85

const MAX_SPEED = 42
const ACCEL = 28
const BRAKE = 40
const DRAG = 8
const STEER_RATE = 2.4
const BOOST_FORCE = 55

export function createVehicleState(spawn: TrackSample, lateral = 0): VehicleState {
  const pos = spawn.position
    .clone()
    .add(spawn.binormal.clone().multiplyScalar(lateral))
    .add(new THREE.Vector3(0, CHASSIS_SPAWN_CLEARANCE, 0))
  const heading = Math.atan2(spawn.tangent.x, spawn.tangent.z)
  const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), heading)
  return {
    position: pos,
    rotation,
    heading,
    speed: 0,
    boostTimer: 0,
    lap: 1,
    progress: 0,
    lastProgress: 0,
    raceDistance: 0,
    checkpointIndex: 0,
    lastCheckpointProgress: 0,
    offTrackDistance: 0,
    airborneTime: 0,
    collisionCount: 0,
    wheelContacts: [true, true, true, true],
    finished: false,
    place: 1,
  }
}

export function syncDerivedMotion(state: VehicleState): void {
  const euler = new THREE.Euler().setFromQuaternion(state.rotation, 'YXZ')
  state.heading = euler.y
}

export function stepVehicleArcade(
  state: VehicleState,
  input: VehicleInput,
  samples: TrackSample[],
  totalLength: number,
  dt: number,
  totalLaps: number,
  onBoostPad: boolean,
  halfWidth: number,
  checkpointFractions = defaultCheckpointFractions(),
): void {
  if (state.finished) return

  if (onBoostPad) state.boostTimer = Math.max(state.boostTimer, BOOST_DURATION * 0.65)
  if (input.boost && state.boostTimer <= 0 && state.speed > 8) state.boostTimer = BOOST_DURATION
  if (state.boostTimer > 0) state.boostTimer -= dt

  const steerScale = THREE.MathUtils.clamp(1 - Math.abs(state.speed) / (MAX_SPEED * 1.4), 0.35, 1)
  state.heading += input.steer * STEER_RATE * steerScale * dt
  state.rotation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), state.heading)

  const forwardAccel = input.throttle * ACCEL - input.brake * BRAKE
  const boost = state.boostTimer > 0 ? BOOST_FORCE : 0
  state.speed += (forwardAccel + boost - Math.sign(state.speed) * DRAG) * dt
  const cap = state.boostTimer > 0 ? MAX_SPEED * 1.25 : MAX_SPEED
  state.speed = THREE.MathUtils.clamp(state.speed, -12, cap)

  const dir = new THREE.Vector3(Math.sin(state.heading), 0, Math.cos(state.heading))
  state.position.addScaledVector(dir, state.speed * dt)

  const proj = projectOntoTrack(samples, state.position, totalLength)
  const limit = halfWidth - 0.9
  if (Math.abs(proj.lateral) > limit) {
    const push = (Math.abs(proj.lateral) - limit) * Math.sign(proj.lateral)
    state.position.addScaledVector(samples[proj.sampleIndex].binormal, -push)
    state.speed *= 0.92
  }
  state.position.y = proj.nearest.y + CHASSIS_SPAWN_CLEARANCE

  const race = advanceRaceState(
    state,
    samples,
    totalLength,
    state.position,
    checkpointProgresses(checkpointFractions, totalLength),
    totalLaps,
    Number.POSITIVE_INFINITY,
  )
  state.checkpointIndex = race.checkpointIndex
  state.lap = race.lap
  state.finished = race.finished
  state.raceDistance = race.raceDistance
  state.progress = race.progress
  state.lastProgress = race.progress
  state.lastCheckpointProgress = race.checkpointIndex >= 0 ? race.progress : state.lastCheckpointProgress
  state.offTrackDistance = race.offTrackDistance
}

export function aiInput(
  state: VehicleState,
  samples: TrackSample[],
  totalLength: number,
  skill: number,
  lookAhead: number,
  simTime: number,
): VehicleInput {
  const look = sampleAtProgress(samples, totalLength, (state.raceDistance % totalLength) + lookAhead)
  const target = look.position
    .clone()
    .add(look.binormal.clone().multiplyScalar(Math.sin(simTime * 0.001 + skill) * 1.2))
  const toTarget = target.clone().sub(state.position)
  const desiredHeading = Math.atan2(toTarget.x, toTarget.z)
  let err = desiredHeading - state.heading
  while (err > Math.PI) err -= Math.PI * 2
  while (err < -Math.PI) err += Math.PI * 2

  const steer = THREE.MathUtils.clamp(err * 1.8, -1, 1)
  const throttle = skill > 0.55 ? 1 : 0.85
  const brake = Math.abs(err) > 0.85 && state.speed > 22 ? 0.45 : 0
  const boost = Math.abs(err) < 0.2 && state.speed > 18 && (simTime * 0.001) % 1 < 0.01 * skill

  return { throttle, steer, brake, boost }
}
