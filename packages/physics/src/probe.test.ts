import assert from 'node:assert/strict'
import { test } from 'node:test'
import { evaluateInvariants } from './probe/invariants'
import { SCENARIOS } from './probe/scenarios'
import type { ProbeTick, ScenarioResult } from './probe/types'

function tick(partial: Partial<ProbeTick>): ProbeTick {
  return {
    simClock: 0,
    racer: 0,
    action: 'throttle',
    position: [0, 0.2, 0],
    heading: 0,
    speed: 20,
    raceDistance: 10,
    moveAlongNose: 12,
    moveAlongTangent: 12,
    moveAlongHeading: 12,
    roll: 0.05,
    pitch: 0.04,
    airborneTime: 0,
    wheelContacts: 4,
    linvel: [0, 0, 12],
    angvel: [0, 0, 0],
    upY: 0.98,
    onBoostPad: false,
    boostTimer: 0,
    collisionCount: 0,
    offTrackDistance: 0,
    wheels: [],
    ...partial,
  }
}

function result(name: string, ticks: ProbeTick[], events: ScenarioResult['events'] = []): ScenarioResult {
  return { name, duration: 6, timestep: 1 / 60, racerCount: 1, ticks, events }
}

function launchTicks(alongNose: number): ProbeTick[] {
  const out: ProbeTick[] = []
  for (let i = 0; i < 360; i++) {
    const t = i / 60
    out.push(
      tick({
        simClock: t,
        speed: 8 + t * 4,
        raceDistance: 2 + t * 12,
        moveAlongNose: alongNose,
        moveAlongTangent: alongNose,
      }),
    )
  }
  return out
}

test('launch-straight fails inverted nose motion', () => {
  const violations = evaluateInvariants(result('launch-straight', launchTicks(-8)))
  assert.ok(violations.some((v) => v.metric === 'moveAlongNose' && v.message.includes('INVERT')))
  assert.ok(violations[0]?.hintFiles.includes('packages/physics/src/handling.ts'))
})

test('launch-straight passes a clean forward run', () => {
  const violations = evaluateInvariants(result('launch-straight', launchTicks(14)))
  assert.deepEqual(violations, [])
})

test('grid-settle flags a flipped car after the settle window', () => {
  const ticks: ProbeTick[] = []
  for (let i = 0; i < 240; i++) {
    const t = i / 60
    ticks.push(tick({ simClock: t, racer: 0, action: 'settle', speed: 0.1, roll: t > 1.5 ? 1.2 : 0.05, upY: t > 1.5 ? 0.1 : 0.98 }))
  }
  const violations = evaluateInvariants({
    name: 'grid-settle',
    duration: 4,
    timestep: 1 / 60,
    racerCount: 1,
    ticks,
    events: [],
  })
  assert.ok(violations.some((v) => v.metric === 'roll' || v.metric === 'upY'))
})

test('suite lists the planned scenarios', () => {
  assert.deepEqual(
    SCENARIOS.map((s) => s.name),
    [
      'grid-settle',
      'launch-straight',
      'corner-left',
      'corner-right',
      'boost-pad',
      'sand-excursion',
      'brake-reverse',
      'ai-pack',
      'soak',
    ],
  )
})
