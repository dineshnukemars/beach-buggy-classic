export type Vec3 = [number, number, number]

export type WheelDebug = {
  contact: boolean
  suspensionForce: number
  suspensionLength: number
  forwardImpulse: number
  sideImpulse: number
  contactNormal: Vec3 | null
  contactPoint: Vec3 | null
}

export type RacerDebug = {
  index: number
  position: Vec3
  linvel: Vec3
  angvel: Vec3
  heading: number
  speed: number
  raceDistance: number
  airborneTime: number
  offTrackDistance: number
  collisionCount: number
  onBoostPad: boolean
  boostTimer: number
  roll: number
  pitch: number
  upY: number
  wheels: WheelDebug[]
}

export type SimEventType = 'recovery' | 'boost' | 'collision'
export type RecoveryReason = 'offTrack' | 'stuck' | 'airborne' | 'inverted'

export type SimEvent = {
  simClock: number
  racer: number
  type: SimEventType
  reason?: RecoveryReason
}
