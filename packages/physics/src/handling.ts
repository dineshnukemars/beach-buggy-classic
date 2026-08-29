import type { InputFrame } from '@studio/core'
import type { VehicleTuning } from './tuning'

export type HandlingState = {
  steerAngle: number
  boostTimer: number
}

export type WheelCommands = {
  engineForce: number
  brake: number
  steerAngle: number
  boostImpulse: number
}

export function createHandlingState(): HandlingState {
  return { steerAngle: 0, boostTimer: 0 }
}

export function applyHandling(
  state: HandlingState,
  input: InputFrame,
  speed: number,
  onBoostPad: boolean,
  tuning: VehicleTuning,
  dt: number,
): WheelCommands {
  if (onBoostPad) state.boostTimer = Math.max(state.boostTimer, tuning.boostDuration * 0.65)
  if (input.boost && state.boostTimer <= 0 && speed > tuning.boostSpeedGate) {
    state.boostTimer = tuning.boostDuration
  }
  if (state.boostTimer > 0) state.boostTimer -= dt

  const steerScale = Math.max(0.35, 1 - Math.abs(speed) / (tuning.maxSpeed * 1.35))
  const targetSteer = input.steer * tuning.maxSteerAngle * steerScale
  const steerDelta = targetSteer - state.steerAngle
  const maxDelta = tuning.steerSlew * dt
  state.steerAngle += Math.max(-maxDelta, Math.min(maxDelta, steerDelta))

  const forward = input.throttle - input.brake
  let engineForce = 0
  let brake = 0

  if (forward > 0 && speed < tuning.maxSpeed * (state.boostTimer > 0 ? 1.25 : 1)) {
    engineForce = forward * tuning.engineForce
  } else if (forward < 0 && speed > 1.2) {
    brake = input.brake * tuning.brakeForce
  } else if (forward < 0 && speed > -tuning.reverseSpeed) {
    engineForce = forward * tuning.engineForce * 0.65
  }

  const boostImpulse = state.boostTimer > 0 ? tuning.boostForce : 0

  return {
    engineForce,
    brake,
    steerAngle: state.steerAngle,
    boostImpulse,
  }
}
