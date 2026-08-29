import type { InputFrame } from '@studio/core'
import type { RacerDebug, SimEvent, Vec3, WheelDebug } from '../simTelemetry'
import type { World } from '../world'

export type ProbeTick = {
  simClock: number
  racer: number
  action: string
  position: Vec3
  heading: number
  speed: number
  raceDistance: number
  moveAlongNose: number
  moveAlongTangent: number
  moveAlongHeading: number
  roll: number
  pitch: number
  airborneTime: number
  wheelContacts: number
  linvel: Vec3
  angvel: Vec3
  upY: number
  onBoostPad: boolean
  boostTimer: number
  collisionCount: number
  offTrackDistance: number
  wheels: WheelDebug[]
}

export type ScenarioSpec = {
  name: string
  duration: number
  racers: number
  laterals?: number[]
  /** Raw spawn when false. Default plants after a short idle+brake, matching race start. */
  plant?: boolean
  setup?: (world: World) => void
  phaseAt?: (t: number) => string
  inputAt: (t: number, world: World) => InputFrame[]
}

export type ScenarioResult = {
  name: string
  duration: number
  timestep: number
  racerCount: number
  ticks: ProbeTick[]
  events: SimEvent[]
}

export type Violation = {
  scenario: string
  severity: 'fail' | 'warn'
  metric: string
  value: number
  message: string
  hintFiles: string[]
}

export type ScenarioSummary = {
  name: string
  duration: number
  pass: boolean
  eventCounts: Record<string, number>
  metrics: Record<string, number>
  violations: Violation[]
}

export type SimReport = {
  recordedAt: string
  durationTotal: number
  scenarios: ScenarioSummary[]
  violations: Violation[]
}

export type { RacerDebug, SimEvent }