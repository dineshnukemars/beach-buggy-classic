import * as THREE from 'three'
import {
  TRACK_HALF_WIDTH,
  type TrackSample,
  projectOntoTrack,
  sampleAtProgress,
} from './track'

export type VehicleInput = {
  throttle: number
  steer: number
  brake: number
  boost: boolean
}

export type VehicleState = {
  position: THREE.Vector3
  heading: number
  speed: number
  boostTimer: number
  lap: number
  progress: number
  lastProgress: number
  finished: boolean
  place: number
}

const MAX_SPEED = 42
const ACCEL = 28
const BRAKE = 40
const DRAG = 8
const STEER_RATE = 2.4
const BOOST_FORCE = 55
const BOOST_DURATION = 0.85

export function createVehicleState(spawn: TrackSample, lateral = 0): VehicleState {
  const pos = spawn.position
    .clone()
    .add(spawn.binormal.clone().multiplyScalar(lateral))
    .add(new THREE.Vector3(0, 0.55, 0))
  const heading = Math.atan2(spawn.tangent.x, spawn.tangent.z)
  return {
    position: pos,
    heading,
    speed: 0,
    boostTimer: 0,
    lap: 1,
    progress: 0,
    lastProgress: 0,
    finished: false,
    place: 1,
  }
}

export function createBuggyMesh(color: number): THREE.Group {
  const buggy = new THREE.Group()
  const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.15 })
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.7 })
  const accentMat = new THREE.MeshStandardMaterial({
    color: 0xffdd66,
    emissive: 0xaa6600,
    emissiveIntensity: 0.25,
  })

  const body = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.55, 2.4), bodyMat)
  body.position.y = 0.45
  body.castShadow = true
  buggy.add(body)

  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.4, 1.1), darkMat)
  cabin.position.set(0, 0.85, -0.15)
  cabin.castShadow = true
  buggy.add(cabin)

  const nose = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.35, 0.7), bodyMat)
  nose.position.set(0, 0.4, 1.2)
  buggy.add(nose)

  for (const [x, z] of [
    [-0.85, 0.85],
    [0.85, 0.85],
    [-0.85, -0.95],
    [0.85, -0.95],
  ] as const) {
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.32, 12), darkMat)
    wheel.rotation.z = Math.PI / 2
    wheel.position.set(x, 0.38, z)
    wheel.castShadow = true
    buggy.add(wheel)
  }

  const roll = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.06, 6, 16), accentMat)
  roll.rotation.x = Math.PI / 2
  roll.position.set(0, 1.05, -0.2)
  buggy.add(roll)

  return buggy
}

export function stepVehicle(
  state: VehicleState,
  input: VehicleInput,
  samples: TrackSample[],
  totalLength: number,
  dt: number,
  totalLaps: number,
  onBoostPad: boolean,
): void {
  if (state.finished) return

  if (onBoostPad) {
    state.boostTimer = Math.max(state.boostTimer, BOOST_DURATION * 0.65)
  }
  if (input.boost && state.boostTimer <= 0 && state.speed > 8) {
    state.boostTimer = BOOST_DURATION
  }
  if (state.boostTimer > 0) state.boostTimer -= dt

  const steerScale = THREE.MathUtils.clamp(1 - Math.abs(state.speed) / (MAX_SPEED * 1.4), 0.35, 1)
  state.heading += input.steer * STEER_RATE * steerScale * dt

  const forwardAccel = input.throttle * ACCEL - input.brake * BRAKE
  const boost = state.boostTimer > 0 ? BOOST_FORCE : 0
  state.speed += (forwardAccel + boost - Math.sign(state.speed) * DRAG) * dt
  const cap = state.boostTimer > 0 ? MAX_SPEED * 1.25 : MAX_SPEED
  state.speed = THREE.MathUtils.clamp(state.speed, -12, cap)

  const dir = new THREE.Vector3(Math.sin(state.heading), 0, Math.cos(state.heading))
  state.position.addScaledVector(dir, state.speed * dt)

  const proj = projectOntoTrack(samples, state.position, totalLength)

  // Soft wall: push back inside track
  const limit = TRACK_HALF_WIDTH - 0.9
  if (Math.abs(proj.lateral) > limit) {
    const push = (Math.abs(proj.lateral) - limit) * Math.sign(proj.lateral)
    state.position.addScaledVector(samples[proj.sampleIndex].binormal, -push)
    state.speed *= 0.92
  }

  // Stick to track height
  state.position.y = proj.nearest.y + 0.55

  // Lap detection via progress wrap
  const delta = proj.progress - state.lastProgress
  if (delta < -totalLength * 0.5) {
    state.lap += 1
    if (state.lap > totalLaps) {
      state.finished = true
      state.lap = totalLaps
    }
  }
  state.lastProgress = proj.progress
  state.progress = proj.progress + (state.lap - 1) * totalLength
}

export function syncMesh(mesh: THREE.Object3D, state: VehicleState): void {
  mesh.position.copy(state.position)
  mesh.rotation.order = 'YXZ'
  mesh.rotation.y = state.heading
  mesh.rotation.x = -state.speed * 0.002
  mesh.rotation.z = 0
}

export function aiInput(
  state: VehicleState,
  samples: TrackSample[],
  totalLength: number,
  skill: number,
  lookAhead: number,
): VehicleInput {
  const look = sampleAtProgress(samples, totalLength, state.progress % totalLength + lookAhead)
  const target = look.position.clone().add(look.binormal.clone().multiplyScalar(Math.sin(performance.now() * 0.001 + skill) * 1.2))
  const toTarget = target.clone().sub(state.position)
  const desiredHeading = Math.atan2(toTarget.x, toTarget.z)
  let err = desiredHeading - state.heading
  while (err > Math.PI) err -= Math.PI * 2
  while (err < -Math.PI) err += Math.PI * 2

  const steer = THREE.MathUtils.clamp(err * 1.8, -1, 1)
  const throttle = skill > 0.55 ? 1 : 0.85
  const brake = Math.abs(err) > 0.85 && state.speed > 22 ? 0.45 : 0
  const boost = Math.abs(err) < 0.2 && state.speed > 18 && Math.random() < 0.01 * skill

  return { throttle, steer, brake, boost }
}
