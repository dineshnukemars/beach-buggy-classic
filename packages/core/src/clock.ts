export function clampDt(seconds: number, max = 0.05): number {
  if (!Number.isFinite(seconds) || seconds < 0) return 0
  return Math.min(seconds, max)
}

export function fixedSteps(accumulator: number, dt: number, step = 1 / 30): { steps: number; rest: number } {
  let acc = accumulator + dt
  let steps = 0
  while (acc >= step) {
    acc -= step
    steps += 1
    if (steps > 8) break
  }
  return { steps, rest: acc }
}
