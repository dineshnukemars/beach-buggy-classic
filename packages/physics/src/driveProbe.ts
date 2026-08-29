import * as THREE from 'three'
import { createDefaultBeachScene } from './index'
import { FIXED_TIMESTEP } from './rapierSim'
import { World } from './world'
import { DRIVE_DURATION, DRIVE_SCRIPT, actionAt, type DriveAction } from './driveScript'

export type DriveSample = {
  simClock: number
  action: string
  position: [number, number, number]
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
}

export type ActionSummary = {
  name: string
  samples: number
  meanSpeed: number
  deltaRaceDistance: number
  meanMoveAlongNose: number
  meanMoveAlongTangent: number
  meanMoveAlongHeading: number
  meanRoll: number
  meanPitch: number
  airborneRatio: number
}

export type DriveProbeReport = {
  duration: number
  timestep: number
  start: { position: [number, number, number]; heading: number; raceDistance: number }
  end: { position: [number, number, number]; heading: number; raceDistance: number }
  actions: ActionSummary[]
  findings: string[]
}

export async function runDriveProbe(): Promise<{ report: DriveProbeReport; samples: DriveSample[] }> {
  const world = await World.create(1, { scene: createDefaultBeachScene(), backend: 'rapier' })
  const startBody = world.bodies[0]
  const start = {
    position: vec(startBody.position),
    heading: startBody.heading,
    raceDistance: startBody.raceDistance,
  }
  const ticks: DriveSample[] = []
  const steps = Math.round(DRIVE_DURATION / FIXED_TIMESTEP)
  let prev = startBody.position.clone()

  for (let i = 0; i < steps; i++) {
    const action = actionAt(world.simClock)
    world.step(FIXED_TIMESTEP, [action.input])
    const body = world.bodies[0]
    ticks.push(sampleTick(world, action, prev))
    prev.copy(body.position)
  }

  const endBody = world.bodies[0]
  const end = {
    position: vec(endBody.position),
    heading: endBody.heading,
    raceDistance: endBody.raceDistance,
  }
  const actions = summarize(ticks)
  const findings = interpret(actions)
  world.dispose()
  return { report: { duration: DRIVE_DURATION, timestep: FIXED_TIMESTEP, start, end, actions, findings }, samples: ticks }
}

function sampleTick(world: World, action: DriveAction, prev: THREE.Vector3): DriveSample {
  const body = world.bodies[0]
  const move = body.position.clone().sub(prev)
  const nose = new THREE.Vector3(0, 0, 1).applyQuaternion(body.rotation)
  const headingDir = new THREE.Vector3(Math.sin(body.heading), 0, Math.cos(body.heading))
  const frac = ((body.progress % world.totalLength) + world.totalLength) % world.totalLength
  const index = Math.min(world.samples.length - 1, Math.max(0, Math.floor((frac / world.totalLength) * world.samples.length)))
  const tangent = world.samples[index]!.tangent
  const euler = new THREE.Euler().setFromQuaternion(body.rotation, 'YXZ')
  return {
    simClock: world.simClock,
    action: action.name,
    position: vec(body.position),
    heading: body.heading,
    speed: body.speed,
    raceDistance: body.raceDistance,
    moveAlongNose: move.dot(nose) / FIXED_TIMESTEP,
    moveAlongTangent: move.dot(tangent) / FIXED_TIMESTEP,
    moveAlongHeading: move.dot(headingDir) / FIXED_TIMESTEP,
    roll: Math.abs(euler.z),
    pitch: Math.abs(euler.x),
    airborneTime: body.airborneTime,
    wheelContacts: body.wheelContacts.filter(Boolean).length,
  }
}

function summarize(ticks: DriveSample[]): ActionSummary[] {
  return DRIVE_SCRIPT.map((action) => {
    const slice = ticks.filter((t) => t.action === action.name)
    if (slice.length === 0) {
      return {
        name: action.name,
        samples: 0,
        meanSpeed: 0,
        deltaRaceDistance: 0,
        meanMoveAlongNose: 0,
        meanMoveAlongTangent: 0,
        meanMoveAlongHeading: 0,
        meanRoll: 0,
        meanPitch: 0,
        airborneRatio: 0,
      }
    }
    const n = slice.length
    const mean = (fn: (s: DriveSample) => number) => slice.reduce((a, s) => a + fn(s), 0) / n
    return {
      name: action.name,
      samples: n,
      meanSpeed: mean((s) => s.speed),
      deltaRaceDistance: slice[n - 1]!.raceDistance - slice[0]!.raceDistance,
      meanMoveAlongNose: mean((s) => s.moveAlongNose),
      meanMoveAlongTangent: mean((s) => s.moveAlongTangent),
      meanMoveAlongHeading: mean((s) => s.moveAlongHeading),
      meanRoll: mean((s) => s.roll),
      meanPitch: mean((s) => s.pitch),
      airborneRatio: slice.filter((s) => s.airborneTime > 0).length / n,
    }
  })
}

function interpret(actions: ActionSummary[]): string[] {
  const findings: string[] = []
  const throttle = actions.find((a) => a.name === 'throttle')
  const brake = actions.find((a) => a.name === 'brake')
  if (throttle) {
    if (throttle.meanMoveAlongNose < -1) {
      findings.push('INVERT: throttle motion is opposite the mesh nose (+Z). Camera looks along the nose, so W feels like reverse.')
    } else if (throttle.meanMoveAlongNose > 1) {
      findings.push('Throttle motion aligns with mesh nose (+Z).')
    }
    if (throttle.deltaRaceDistance < -2) {
      findings.push('INVERT: throttle decreases raceDistance (driving against the track).')
    } else if (throttle.deltaRaceDistance > 2) {
      findings.push('Throttle increases raceDistance (along the track).')
    }
    if (throttle.meanRoll > 0.35) findings.push(`Unstable: throttle mean |roll| ${throttle.meanRoll.toFixed(2)} rad.`)
    if (throttle.meanPitch > 0.35) findings.push(`Unstable: throttle mean |pitch| ${throttle.meanPitch.toFixed(2)} rad.`)
    if (throttle.airborneRatio > 0.15) {
      findings.push(`Unstable: airborne ${(throttle.airborneRatio * 100).toFixed(0)}% of the throttle window.`)
    }
  }
  if (brake && throttle && brake.meanSpeed > throttle.meanSpeed + 1) {
    findings.push('Brake segment is faster than throttle — S may be driving instead of slowing.')
  }
  if (!findings.length) findings.push('No polarity or stability flags from the 30s script.')
  return findings
}

function vec(v: THREE.Vector3): [number, number, number] {
  return [v.x, v.y, v.z]
}

if (process.argv[1]?.endsWith('driveProbe.ts')) {
  const { mkdirSync, writeFileSync } = await import('node:fs')
  const { dirname, join } = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const { report, samples } = await runDriveProbe()
  const outDir = join(dirname(fileURLToPath(import.meta.url)), '../.tmp')
  mkdirSync(outDir, { recursive: true })
  const clip = {
    recordedAt: new Date().toISOString(),
    report,
    samples: samples.filter((_, i) => i % 6 === 0),
  }
  writeFileSync(join(outDir, 'drive-probe-clip.json'), JSON.stringify(clip))
  console.log(JSON.stringify(report, null, 2))
  console.log(`wrote ${clip.samples.length} clip frames to ${join(outDir, 'drive-probe-clip.json')}`)
}
