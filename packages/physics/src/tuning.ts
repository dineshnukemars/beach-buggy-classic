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
  angularDamping: number
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

/** Mesh origin on the centerline. Wheel rays reach the ribbon 5cm above that. */
export const CHASSIS_SPAWN_CLEARANCE = 0

/** Visual buggy wheels sit at y = radius when the mesh origin is on the ground. */
export function wheelConnectionY(wheel: WheelTuning): number {
  return wheel.radius + wheel.restLength
}

export const DEFAULT_VEHICLE_TUNING: VehicleTuning = {
  mass: 420,
  chassisHalfExtents: [0.65, 0.22, 1.0],
  maxSpeed: 42,
  reverseSpeed: 12,
  engineForce: 2000,
  brakeForce: 2600,
  linearDamping: 0.35,
  angularDamping: 1.8,
  maxSteerAngle: 0.42,
  steerSlew: 4.2,
  frictionSlip: 6.5,
  sideFrictionStiffness: 1.15,
  suspensionStiffness: 48,
  suspensionCompression: 4.6,
  suspensionRelaxation: 6.2,
  maxSuspensionForce: 9000,
  boostForce: 1800,
  boostDuration: 0.85,
  boostSpeedGate: 12,
  downforce: 70,
  recoveryOffTrack: 16,
  recoveryStuckSeconds: 2.5,
  wheels: [
    { offsetX: -0.85, offsetZ: 0.85, radius: 0.38, restLength: 0.42, maxTravel: 0.18 },
    { offsetX: 0.85, offsetZ: 0.85, radius: 0.38, restLength: 0.42, maxTravel: 0.18 },
    { offsetX: -0.85, offsetZ: -0.95, radius: 0.38, restLength: 0.42, maxTravel: 0.18 },
    { offsetX: 0.85, offsetZ: -0.95, radius: 0.38, restLength: 0.42, maxTravel: 0.18 },
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
