import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as THREE from 'three'
import { createDefaultBeachScene } from '../index'
import { FIXED_TIMESTEP } from '../rapierSim'
import { World } from '../world'
import { evaluateInvariants, scenarioMetrics } from './invariants'
import { SCENARIOS } from './scenarios'
import type { ProbeTick, ScenarioResult, ScenarioSpec, ScenarioSummary, SimReport, Violation } from './types'

const SETTLE_STEPS = 90
const CLIP_STRIDE = 6

export async function runScenario(spec: ScenarioSpec): Promise<ScenarioResult> {
  const world = await World.create(spec.racers, {
    scene: createDefaultBeachScene(),
    backend: 'rapier',
    laterals: spec.laterals,
  })
  const idle = { throttle: 0, steer: 0, brake: 1, boost: false }
  if (spec.plant !== false) {
    for (let i = 0; i < SETTLE_STEPS; i++) {
      world.step(FIXED_TIMESTEP, Array.from({ length: spec.racers }, () => ({ ...idle })))
    }
    world.drainEvents()
    world.plantOnStartGrid()
  }
  spec.setup?.(world)

  const ticks: ProbeTick[] = []
  const events = [...world.drainEvents()]
  const prev = world.bodies.map((body) => body.position.clone())
  const steps = Math.round(spec.duration / FIXED_TIMESTEP)
  for (let i = 0; i < steps; i++) {
    const t = i * FIXED_TIMESTEP
    world.step(FIXED_TIMESTEP, spec.inputAt(t, world))
    events.push(...world.drainEvents())
    const action = spec.phaseAt?.(t) ?? spec.name
    for (let racer = 0; racer < world.bodies.length; racer++) {
      ticks.push(sampleTick(world, racer, action, prev[racer]!))
      prev[racer]!.copy(world.bodies[racer]!.position)
    }
  }

  world.dispose()
  return {
    name: spec.name,
    duration: spec.duration,
    timestep: FIXED_TIMESTEP,
    racerCount: spec.racers,
    ticks,
    events,
  }
}

function sampleTick(world: World, racer: number, action: string, prev: THREE.Vector3): ProbeTick {
  const body = world.bodies[racer]!
  const debug = world.debugRacer(racer)
  const move = body.position.clone().sub(prev)
  const nose = new THREE.Vector3(0, 0, 1).applyQuaternion(body.rotation)
  const headingDir = new THREE.Vector3(Math.sin(body.heading), 0, Math.cos(body.heading))
  const frac = ((body.progress % world.totalLength) + world.totalLength) % world.totalLength
  const index = Math.min(
    world.samples.length - 1,
    Math.max(0, Math.floor((frac / world.totalLength) * world.samples.length)),
  )
  const tangent = world.samples[index]!.tangent
  return {
    simClock: world.simClock,
    racer,
    action,
    position: [body.position.x, body.position.y, body.position.z],
    heading: body.heading,
    speed: body.speed,
    raceDistance: body.raceDistance,
    moveAlongNose: move.dot(nose) / FIXED_TIMESTEP,
    moveAlongTangent: move.dot(tangent) / FIXED_TIMESTEP,
    moveAlongHeading: move.dot(headingDir) / FIXED_TIMESTEP,
    roll: debug?.roll ?? 0,
    pitch: debug?.pitch ?? 0,
    airborneTime: body.airborneTime,
    wheelContacts: body.wheelContacts.filter(Boolean).length,
    linvel: debug?.linvel ?? [0, 0, 0],
    angvel: debug?.angvel ?? [0, 0, 0],
    upY: debug?.upY ?? 1,
    onBoostPad: debug?.onBoostPad ?? false,
    boostTimer: body.boostTimer,
    collisionCount: body.collisionCount,
    offTrackDistance: body.offTrackDistance,
    wheels: debug?.wheels ?? [],
  }
}

export function summarizeScenario(result: ScenarioResult, violations: Violation[]): ScenarioSummary {
  const eventCounts: Record<string, number> = {}
  for (const event of result.events) {
    const key = event.reason ? `${event.type}:${event.reason}` : event.type
    eventCounts[key] = (eventCounts[key] ?? 0) + 1
  }
  return {
    name: result.name,
    duration: result.duration,
    pass: violations.every((v) => v.severity !== 'fail'),
    eventCounts,
    metrics: scenarioMetrics(result),
    violations,
  }
}

export async function runSimProbe(options: { writeArtifacts?: boolean } = {}): Promise<{
  report: SimReport
  results: ScenarioResult[]
}> {
  const results: ScenarioResult[] = []
  const summaries: ScenarioSummary[] = []
  const violations: Violation[] = []
  for (const spec of SCENARIOS) {
    const result = await runScenario(spec)
    const found = evaluateInvariants(result)
    results.push(result)
    summaries.push(summarizeScenario(result, found))
    violations.push(...found)
  }
  const report: SimReport = {
    recordedAt: new Date().toISOString(),
    durationTotal: SCENARIOS.reduce((sum, s) => sum + s.duration, 0),
    scenarios: summaries,
    violations,
  }
  if (options.writeArtifacts) writeArtifacts(report, results)
  return { report, results }
}

function writeArtifacts(report: SimReport, results: ScenarioResult[]): void {
  const outDir = join(dirname(fileURLToPath(import.meta.url)), '../../.tmp')
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, 'sim-report.json'), JSON.stringify(report, null, 2))
  for (const result of results) {
    const clip = {
      recordedAt: report.recordedAt,
      report: {
        scenario: result.name,
        duration: result.duration,
        timestep: result.timestep,
        start: pose(result.ticks[0]),
        end: pose(result.ticks.at(-1)),
        findings: result.name,
      },
      samples: result.ticks.filter((t) => t.racer === 0).filter((_, i) => i % CLIP_STRIDE === 0),
    }
    writeFileSync(join(outDir, `${result.name}.clip.json`), JSON.stringify(clip))
  }
}

function pose(tick: ProbeTick | undefined) {
  if (!tick) return { position: [0, 0, 0], heading: 0, raceDistance: 0 }
  return { position: tick.position, heading: tick.heading, raceDistance: tick.raceDistance }
}

export function printReport(report: SimReport): void {
  const width = Math.max(...report.scenarios.map((s) => s.name.length))
  for (const scenario of report.scenarios) {
    const mark = scenario.pass ? 'PASS' : 'FAIL'
    const top = scenario.violations
      .slice(0, 2)
      .map((v) => `${v.metric}=${Number.isFinite(v.value) ? v.value.toFixed(2) : v.value}`)
      .join('  ')
    console.log(`${scenario.name.padEnd(width)}  ${mark}${top ? `  ${top}` : ''}`)
    for (const violation of scenario.violations) {
      console.log(`  - ${violation.message}`)
    }
  }
  const failed = report.scenarios.filter((s) => !s.pass).length
  const passed = report.scenarios.length - failed
  console.log(`${passed} passed, ${failed} failed`)
}

const isMain = process.argv[1]?.endsWith('simProbe.ts')
if (isMain) {
  const { report } = await runSimProbe({ writeArtifacts: true })
  printReport(report)
  const outDir = join(dirname(fileURLToPath(import.meta.url)), '../../.tmp')
  console.log(`wrote ${join(outDir, 'sim-report.json')}`)
  if (report.violations.some((v) => v.severity === 'fail')) process.exit(1)
}
