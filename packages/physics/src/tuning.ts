export type WheelTuning = {
  offsetX: number
  offsetZ: number
  radius: number
  restLength: number
  maxTravel: number
}

export type VehicleTuning = {
  mass: number
  chassisHalfExtents: [number, number, number]
  maxSpeed: number
  reverseSpeed: number
  engineForce: number
  brakeForce: number
  linearDamping: number
  maxSteerAngle: number
  steerSlew: number
  frictionSlip: number
  sideFrictionStiffness: number
  suspensionStiffness: number
  suspensionCompression: number
  suspensionRelaxation: number
  maxSuspensionForce: number
  boostForce: number
  boostDuration: number
  boostSpeedGate: number
  downforce: number
  recoveryOffTrack: number
  recoveryStuckSeconds: number
  wheels: WheelTuning[]
}

export const DEFAULT_VEHICLE_TUNING: VehicleTuning = {
  mass: 420,
  chassisHalfExtents: [0.8, 0.35, 1.2],
  maxSpeed: 42,
  reverseSpeed: 12,
  engineForce: 2800,
  brakeForce: 2600,
  linearDamping: 0.35,
  maxSteerAngle: 0.55,
  steerSlew: 4.5,
  frictionSlip: 10.5,
  sideFrictionStiffness: 1.0,
  suspensionStiffness: 36,
  suspensionCompression: 4.2,
  suspensionRelaxation: 3.8,
  maxSuspensionForce: 6500,
  boostForce: 4200,
  boostDuration: 0.85,
  boostSpeedGate: 8,
  downforce: 18,
  recoveryOffTrack: 18,
  recoveryStuckSeconds: 2.5,
  wheels: [
    { offsetX: -0.85, offsetZ: 0.85, radius: 0.38, restLength: 0.35, maxTravel: 0.25 },
    { offsetX: 0.85, offsetZ: 0.85, radius: 0.38, restLength: 0.35, maxTravel: 0.25 },
    { offsetX: -0.85, offsetZ: -0.95, radius: 0.38, restLength: 0.35, maxTravel: 0.25 },
    { offsetX: 0.85, offsetZ: -0.95, radius: 0.38, restLength: 0.35, maxTravel: 0.25 },
  ],
}

export function parseVehicleTuning(raw: unknown): VehicleTuning {
  if (!raw || typeof raw !== 'object') return DEFAULT_VEHICLE_TUNING
  const src = raw as Partial<VehicleTuning>
  return {
    ...DEFAULT_VEHICLE_TUNING,
    ...src,
    chassisHalfExtents: src.chassisHalfExtents ?? DEFAULT_VEHICLE_TUNING.chassisHalfExtents,
    wheels: src.wheels?.length === 4 ? src.wheels : DEFAULT_VEHICLE_TUNING.wheels,
  }
}
