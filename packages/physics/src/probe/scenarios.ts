import * as THREE from 'three'
import { sampleAtProgress } from '../track'
import { CHASSIS_SPAWN_CLEARANCE } from '../tuning'
import { aiInput } from '../vehicle'
import type { World } from '../world'
import type { ScenarioSpec } from './types'

const idle = { throttle: 0, steer: 0, brake: 1, boost: false }
const coast = { throttle: 0, steer: 0, brake: 0, boost: false }

function followTrack(world: World, throttle: number, brake = 0, extraSteer = 0, lookAhead = 14) {
  const body = world.bodies[0]!
  const look = sampleAtProgress(world.samples, world.totalLength, body.raceDistance + lookAhead)
  const desired = Math.atan2(look.position.x - body.position.x, look.position.z - body.position.z)
  let err = desired - body.heading
  while (err > Math.PI) err -= Math.PI * 2
  while (err < -Math.PI) err += Math.PI * 2
  const steer = THREE.MathUtils.clamp(err * 1.4 + extraSteer, -1, 1)
  return { throttle, steer, brake, boost: false }
}

function headingQuat(tangent: THREE.Vector3): THREE.Quaternion {
  const heading = Math.atan2(tangent.x, tangent.z)
  return new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), heading)
}

function teleportAlongTrack(world: World, progress: number, lateral = 0): void {
  const sample = sampleAtProgress(world.samples, world.totalLength, progress)
  const pos = sample.position
    .clone()
    .add(sample.binormal.clone().multiplyScalar(lateral))
    .add(new THREE.Vector3(0, CHASSIS_SPAWN_CLEARANCE, 0))
  world.teleport(0, pos, headingQuat(sample.tangent))
}

function fill(count: number, input: { throttle: number; steer: number; brake: number; boost: boolean }) {
  return Array.from({ length: count }, () => ({ ...input }))
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function soakInput(): ScenarioSpec['inputAt'] {
  const rng = mulberry32(20260828)
  let next = 0
  let current = { ...coast }
  return (t) => {
    if (t >= next) {
      next = t + 0.35 + rng() * 0.5
      current = {
        throttle: rng() > 0.25 ? 1 : 0,
        steer: rng() * 2 - 1,
        brake: rng() > 0.85 ? 1 : 0,
        boost: rng() > 0.92,
      }
    }
    return [current]
  }
}

export const SCENARIOS: ScenarioSpec[] = [
  {
    name: 'grid-settle',
    duration: 4,
    racers: 4,
    plant: false,
    phaseAt: () => 'settle',
    inputAt: (_t, world) => fill(world.bodies.length, idle),
  },
  {
    name: 'launch-straight',
    duration: 6,
    racers: 1,
    phaseAt: () => 'throttle',
    inputAt: (_t, world) => [followTrack(world, 1)],
  },
  {
    name: 'corner-left',
    duration: 6,
    racers: 1,
    phaseAt: (t) => (t < 2 ? 'throttle' : 'throttle-left'),
    inputAt: (t, world) => [followTrack(world, 1, 0, 0, t < 2 ? 14 : 9)],
  },
  {
    name: 'corner-right',
    duration: 6,
    racers: 1,
    phaseAt: (t) => (t < 2 ? 'throttle' : 'throttle-right'),
    inputAt: (t, world) => [followTrack(world, 1, 0, 0, t < 2 ? 14 : 9)],
  },
  {
    name: 'boost-pad',
    duration: 4,
    racers: 1,
    plant: false,
    phaseAt: () => 'throttle',
    setup: (world) => teleportAlongTrack(world, world.boostPads[0]! * world.totalLength - 8, 0),
    inputAt: (_t, world) => [followTrack(world, 1)],
  },
  {
    name: 'sand-excursion',
    duration: 3.5,
    racers: 1,
    plant: false,
    phaseAt: () => 'idle',
    setup: (world) => teleportAlongTrack(world, 2, 12),
    inputAt: () => [idle],
  },
  {
    name: 'brake-reverse',
    duration: 8,
    racers: 1,
    plant: false,
    setup: (world) => teleportAlongTrack(world, world.totalLength * 0.48, 0),
    phaseAt: (t) => (t < 3 ? 'throttle' : t < 5 ? 'brake' : 'reverse'),
    inputAt: (t, world) => {
      if (t < 3) return [followTrack(world, 1)]
      return [{ throttle: 0, steer: 0, brake: 1, boost: false }]
    },
  },
  {
    name: 'ai-pack',
    duration: 20,
    racers: 4,
    phaseAt: () => 'ai',
    inputAt: (_t, world) =>
      world.bodies.map((body, i) =>
        aiInput(body, world.samples, world.totalLength, 0.55 + i * 0.12, 10 + i * 2, world.simClock),
      ),
  },
  {
    name: 'soak',
    duration: 60,
    racers: 1,
    phaseAt: () => 'random',
    inputAt: soakInput(),
  },
]

export function scenarioByName(name: string): ScenarioSpec {
  const found = SCENARIOS.find((s) => s.name === name)
  if (!found) throw new Error(`Unknown scenario: ${name}`)
  return found
}
