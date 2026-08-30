import type { SimEvent } from '../simTelemetry'
import type { ProbeTick, ScenarioResult, Violation } from './types'

const TUNING = 'games/beach-buggy/public/tuning/buggy-default.json'
const TUNING_TS = 'packages/physics/src/tuning.ts'
const HANDLING = 'packages/physics/src/handling.ts'
const RAPIER = 'packages/physics/src/rapierSim.ts'
const RACE = 'packages/physics/src/race.ts'
const TRACK_GEO = 'packages/physics/src/trackGeometry.ts'

const HINT = {
  stability: [TUNING, TUNING_TS, RAPIER],
  drive: [HANDLING, TUNING, TUNING_TS],
  recovery: [RAPIER, RACE, TUNING],
  boost: [RAPIER, TRACK_GEO, TUNING],
  integrity: [RAPIER, TUNING],
}

function fail(
  scenario: string,
  metric: string,
  value: number,
  message: string,
  hintFiles: string[],
  severity: Violation['severity'] = 'fail',
): Violation {
  return { scenario, severity, metric, value, message, hintFiles }
}

export function ticksFor(result: ScenarioResult, racer = 0): ProbeTick[] {
  return result.ticks.filter((t) => t.racer === racer)
}

export function after(ticks: ProbeTick[], t0: number): ProbeTick[] {
  return ticks.filter((t) => t.simClock >= t0)
}

export function windowed(ticks: ProbeTick[], start: number, end: number): ProbeTick[] {
  return ticks.filter((t) => t.simClock >= start && t.simClock < end)
}

export function mean(ticks: ProbeTick[], fn: (t: ProbeTick) => number): number {
  if (ticks.length === 0) return 0
  return ticks.reduce((sum, t) => sum + fn(t), 0) / ticks.length
}

export function peak(ticks: ProbeTick[], fn: (t: ProbeTick) => number): number {
  if (ticks.length === 0) return 0
  return ticks.reduce((best, t) => Math.max(best, fn(t)), -Infinity)
}

export function ratio(ticks: ProbeTick[], pred: (t: ProbeTick) => boolean): number {
  if (ticks.length === 0) return 0
  return ticks.filter(pred).length / ticks.length
}

export function eventsFor(events: SimEvent[], type: SimEvent['type'], racer?: number): SimEvent[] {
  return events.filter((e) => e.type === type && (racer == null || e.racer === racer))
}

function finiteViolations(result: ScenarioResult): Violation[] {
  const bad = result.ticks.filter(
    (t) =>
      !t.position.every(Number.isFinite) ||
      !Number.isFinite(t.speed) ||
      !Number.isFinite(t.heading) ||
      !Number.isFinite(t.upY),
  )
  if (bad.length === 0) return []
  return [
    fail(result.name, 'finiteState', bad.length, `${bad.length} ticks had NaN/Inf pose or speed.`, HINT.integrity),
  ]
}

function launchStraight(result: ScenarioResult): Violation[] {
  const ticks = ticksFor(result)
  const out: Violation[] = []
  const alongNose = mean(ticks, (t) => t.moveAlongNose)
  const deltaRace = (ticks.at(-1)?.raceDistance ?? 0) - (ticks[0]?.raceDistance ?? 0)
  const peakSpeed = peak(ticks, (t) => t.speed)
  const cruise = after(ticks, ticks[0]!.simClock + 2)
  if (alongNose < -1) {
    out.push(
      fail(
        result.name,
        'moveAlongNose',
        alongNose,
        `INVERT: throttle motion is opposite the mesh nose (+Z) (${alongNose.toFixed(2)}).`,
        HINT.drive,
      ),
    )
  } else if (alongNose < 1) {
    out.push(fail(result.name, 'moveAlongNose', alongNose, `Throttle along nose is too small (${alongNose.toFixed(2)}).`, HINT.drive))
  }
  if (deltaRace < -2) {
    out.push(fail(result.name, 'raceDistance', deltaRace, `INVERT: throttle decreases raceDistance (${deltaRace.toFixed(1)}).`, HINT.drive))
  } else if (deltaRace < 20) {
    out.push(fail(result.name, 'raceDistance', deltaRace, `Throttle raceDistance gain is too small (${deltaRace.toFixed(1)}).`, HINT.drive))
  }
  if (peakSpeed < 18) {
    out.push(
      fail(
        result.name,
        'peakSpeed',
        peakSpeed,
        `Peak throttle speed ${peakSpeed.toFixed(1)} m/s is far below maxSpeed 42.`,
        HINT.drive,
      ),
    )
  }
  if (mean(cruise, (t) => t.speed) < 6) {
    out.push(
      fail(
        result.name,
        'cruiseSpeed',
        mean(cruise, (t) => t.speed),
        `Cruise speed after 2s is ${mean(cruise, (t) => t.speed).toFixed(1)} m/s.`,
        HINT.drive,
      ),
    )
  }
  const minBodyY = ticks.reduce((min, t) => Math.min(min, t.position[1]), Infinity)
  const floorY = -0.15
  if (minBodyY < floorY) {
    out.push(
      fail(
        result.name,
        'bodyClearance',
        minBodyY,
        `Body Y min ${minBodyY.toFixed(2)} dropped below track floor ${floorY}.`,
        HINT.stability,
      ),
    )
  }
  out.push(...stability(result, ticks, { roll: 0.35, pitch: 0.35, airborne: 0.15 }))
  out.push(...unexpectedRecoveries(result, 0))
  return out
}

function stability(
  result: ScenarioResult,
  ticks: ProbeTick[],
  limits: { roll: number; pitch: number; airborne: number },
): Violation[] {
  const out: Violation[] = []
  const roll = mean(ticks, (t) => t.roll)
  const pitch = mean(ticks, (t) => t.pitch)
  const air = ratio(ticks, (t) => t.airborneTime > 0)
  if (roll > limits.roll) {
    out.push(fail(result.name, 'roll', roll, `Mean |roll| ${roll.toFixed(2)} rad exceeds ${limits.roll}.`, HINT.stability))
  }
  if (pitch > limits.pitch) {
    out.push(fail(result.name, 'pitch', pitch, `Mean |pitch| ${pitch.toFixed(2)} rad exceeds ${limits.pitch}.`, HINT.stability))
  }
  if (air > limits.airborne) {
    out.push(fail(result.name, 'airborneRatio', air, `Airborne ${(air * 100).toFixed(0)}% of the window.`, HINT.stability))
  }
  return out
}

function unexpectedRecoveries(result: ScenarioResult, racer: number, max = 0): Violation[] {
  const n = eventsFor(result.events, 'recovery', racer).length
  if (n <= max) return []
  return [
    fail(result.name, 'recoveries', n, `Uncommanded recovery x${n} (reasons: ${reasons(result, racer)}).`, HINT.recovery),
  ]
}

function reasons(result: ScenarioResult, racer: number): string {
  const list = eventsFor(result.events, 'recovery', racer).map((e) => e.reason ?? '?')
  return list.join(',') || 'none'
}

function gridSettle(result: ScenarioResult): Violation[] {
  const out: Violation[] = []
  const t0 = result.ticks[0]?.simClock ?? 0
  for (let i = 0; i < result.racerCount; i++) {
    const settled = after(ticksFor(result, i), t0 + 1.5)
    if (settled.length === 0) {
      out.push(fail(result.name, 'settledTicks', 0, `Racer ${i} has no ticks after 1.5s.`, HINT.stability))
      continue
    }
    const roll = peak(settled, (t) => t.roll)
    const pitch = peak(settled, (t) => t.pitch)
    const air = ratio(settled, (t) => t.airborneTime > 0)
    const speed = peak(settled, (t) => t.speed)
    const upY = Math.min(...settled.map((t) => t.upY))
    if (roll > 0.4) {
      out.push(fail(result.name, 'roll', roll, `Racer ${i} peak |roll| after settle ${roll.toFixed(2)} rad.`, HINT.stability))
    }
    if (pitch > 0.45) {
      out.push(fail(result.name, 'pitch', pitch, `Racer ${i} peak |pitch| after settle ${pitch.toFixed(2)} rad.`, HINT.stability))
    }
    if (air > 0.12) {
      out.push(fail(result.name, 'airborneRatio', air, `Racer ${i} airborne ${(air * 100).toFixed(0)}% after settle.`, HINT.stability))
    }
    if (speed > 8) {
      out.push(fail(result.name, 'settleSpeed', speed, `Racer ${i} peak speed after settle ${speed.toFixed(1)} m/s.`, HINT.stability))
    }
    if (upY < 0.75) {
      out.push(fail(result.name, 'upY', upY, `Racer ${i} up.y dropped to ${upY.toFixed(2)} after settle.`, HINT.stability))
    }
    out.push(...unexpectedRecoveries(result, i))
  }
  return out
}

function corner(result: ScenarioResult): Violation[] {
  const ticks = ticksFor(result)
  const t0 = ticks[0]?.simClock ?? 0
  const steered = after(ticks, t0 + 2)
  const deltaRace = (ticks.at(-1)?.raceDistance ?? 0) - (ticks[0]?.raceDistance ?? 0)
  const out: Violation[] = []
  if (deltaRace < 5) {
    out.push(fail(result.name, 'raceDistance', deltaRace, `Corner raceDistance gain ${deltaRace.toFixed(1)} is too small.`, HINT.drive))
  }
  if (mean(ticks, (t) => t.moveAlongNose) < 0) {
    out.push(
      fail(
        result.name,
        'moveAlongNose',
        mean(ticks, (t) => t.moveAlongNose),
        'Cornering moved against the mesh nose.',
        HINT.drive,
      ),
    )
  }
  out.push(...stability(result, steered, { roll: 0.55, pitch: 0.45, airborne: 0.22 }))
  out.push(...unexpectedRecoveries(result, 0))
  return out
}

function boostPad(result: ScenarioResult): Violation[] {
  const ticks = ticksFor(result)
  const t0 = ticks[0]?.simClock ?? 0
  const afterLaunch = after(ticks, t0 + 0.5)
  const out: Violation[] = []
  const boosted = eventsFor(result.events, 'boost', 0).length > 0 || ticks.some((t) => t.boostTimer > 0 || t.onBoostPad)
  if (!boosted) {
    out.push(fail(result.name, 'boostTrigger', 0, 'Never entered a boost pad or started a boost timer.', HINT.boost))
  }
  const pitch = peak(afterLaunch, (t) => t.pitch)
  const roll = peak(afterLaunch, (t) => t.roll)
  const launchY = peak(afterLaunch, (t) => Math.abs(t.linvel[1]))
  if (pitch > 0.55) {
    out.push(fail(result.name, 'pitch', pitch, `Boost-pad peak |pitch| ${pitch.toFixed(2)} rad.`, HINT.boost))
  }
  if (roll > 0.45) {
    out.push(fail(result.name, 'roll', roll, `Boost-pad peak |roll| ${roll.toFixed(2)} rad.`, HINT.boost))
  }
  if (launchY > 12) {
    out.push(fail(result.name, 'linvelY', launchY, `Boost pad launched the chassis (vy ${launchY.toFixed(1)}).`, HINT.boost))
  }
  out.push(...unexpectedRecoveries(result, 0))
  return out
}

function sandExcursion(result: ScenarioResult): Violation[] {
  const ticks = ticksFor(result)
  const last = ticks.at(-1)
  const recoveries = eventsFor(result.events, 'recovery', 0)
  const out: Violation[] = []
  if (recoveries.length === 0) {
    out.push(fail(result.name, 'recoveries', 0, 'Sand excursion never recovered the car onto the road.', HINT.recovery))
  }
  if (last && last.upY < 0.8) {
    out.push(fail(result.name, 'upY', last.upY, `After recovery up.y is ${last.upY.toFixed(2)}.`, HINT.recovery))
  }
  if (last && last.roll > 0.35) {
    out.push(fail(result.name, 'roll', last.roll, `After recovery |roll| is ${last.roll.toFixed(2)}.`, HINT.recovery))
  }
  if (last && last.pitch > 0.35) {
    out.push(fail(result.name, 'pitch', last.pitch, `After recovery |pitch| is ${last.pitch.toFixed(2)}.`, HINT.recovery))
  }
  return out
}

function brakeReverse(result: ScenarioResult): Violation[] {
  const ticks = ticksFor(result)
  const t0 = ticks[0]?.simClock ?? 0
  const throttled = windowed(ticks, t0, t0 + 3)
  const braking = windowed(ticks, t0 + 3, t0 + 5)
  const reverse = windowed(ticks, t0 + 5, t0 + 8)
  const out: Violation[] = []
  if (mean(throttled, (t) => t.moveAlongNose) < 1) {
    out.push(
      fail(
        result.name,
        'moveAlongNose',
        mean(throttled, (t) => t.moveAlongNose),
        'Brake-reverse launch window did not move along the nose.',
        HINT.drive,
      ),
    )
  }
  const brakeStart = braking[0]?.speed ?? 0
  const brakeEnd = braking.at(-1)?.speed ?? 0
  if (brakeEnd > Math.max(4, brakeStart * 0.65)) {
    out.push(fail(result.name, 'brakeSpeed', brakeEnd, `Brake window ended at ${brakeEnd.toFixed(1)} m/s.`, HINT.drive))
  }
  if (mean(reverse, (t) => t.moveAlongNose) >= 0) {
    out.push(
      fail(
        result.name,
        'reverseNose',
        mean(reverse, (t) => t.moveAlongNose),
        'Reverse window did not move against the mesh nose.',
        HINT.drive,
      ),
    )
  }
  out.push(...stability(result, ticks, { roll: 0.45, pitch: 0.4, airborne: 0.2 }))
  out.push(...unexpectedRecoveries(result, 0, 1))
  return out
}

function aiPack(result: ScenarioResult): Violation[] {
  const out: Violation[] = []
  for (let i = 0; i < result.racerCount; i++) {
    const recoveries = eventsFor(result.events, 'recovery', i).length
    const collisions = eventsFor(result.events, 'collision', i).length
    const ticks = ticksFor(result, i)
    if (recoveries > 8) {
      out.push(fail(result.name, 'recoveries', recoveries, `AI ${i} recovered ${recoveries} times in 20s.`, HINT.recovery))
    }
    if (collisions > 55) {
      out.push(fail(result.name, 'collisions', collisions, `AI ${i} logged ${collisions} chassis collisions.`, HINT.stability))
    }
    const tail = ticks.slice(-Math.round(3 / result.timestep))
    const stuck = tail.length > 0 && mean(tail, (t) => t.speed) < 0.3 && mean(tail, (t) => t.offTrackDistance) > 0
    if (stuck && recoveries === 0) {
      out.push(fail(result.name, 'stuck', mean(tail, (t) => t.speed), `AI ${i} sat off-track without recovery.`, HINT.recovery))
    }
    out.push(...stability(result, ticks, { roll: 0.6, pitch: 0.5, airborne: 0.35 }))
  }
  return out
}

function soak(result: ScenarioResult): Violation[] {
  const ticks = ticksFor(result)
  const recoveries = eventsFor(result.events, 'recovery', 0)
  const out: Violation[] = []
  if (recoveries.length > 20) {
    out.push(fail(result.name, 'recoveries', recoveries.length, `Soak recovered ${recoveries.length} times in 60s.`, HINT.recovery))
  }
  let invertedRun = 0
  let unrecovered = 0
  for (const tick of ticks) {
    invertedRun = tick.upY < 0.2 ? invertedRun + result.timestep : 0
    if (invertedRun > 1) {
      const later = recoveries.some((e) => e.simClock >= tick.simClock - 1 && e.reason === 'inverted')
      if (!later) unrecovered += 1
    }
  }
  if (unrecovered > 0) {
    out.push(fail(result.name, 'inverted', unrecovered, 'Soak had inverted time that recovery did not clear.', HINT.recovery))
  }
  return out
}

const CHECKS: Record<string, (result: ScenarioResult) => Violation[]> = {
  'grid-settle': gridSettle,
  'launch-straight': launchStraight,
  'corner-left': corner,
  'corner-right': corner,
  'boost-pad': boostPad,
  'sand-excursion': sandExcursion,
  'brake-reverse': brakeReverse,
  'ai-pack': aiPack,
  soak,
}

export function evaluateInvariants(result: ScenarioResult): Violation[] {
  const check = CHECKS[result.name]
  const out = finiteViolations(result)
  if (check) out.push(...check(result))
  return out
}

export function scenarioMetrics(result: ScenarioResult): Record<string, number> {
  const ticks = ticksFor(result)
  return {
    meanSpeed: mean(ticks, (t) => t.speed),
    peakSpeed: peak(ticks, (t) => t.speed),
    meanRoll: mean(ticks, (t) => t.roll),
    meanPitch: mean(ticks, (t) => t.pitch),
    airborneRatio: ratio(ticks, (t) => t.airborneTime > 0),
    deltaRaceDistance: (ticks.at(-1)?.raceDistance ?? 0) - (ticks[0]?.raceDistance ?? 0),
    meanMoveAlongNose: mean(ticks, (t) => t.moveAlongNose),
    recoveries: eventsFor(result.events, 'recovery').length,
    boosts: eventsFor(result.events, 'boost').length,
    collisions: eventsFor(result.events, 'collision').length,
  }
}
