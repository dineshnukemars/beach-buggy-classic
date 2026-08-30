import * as THREE from 'three'
import type { TrackSample } from './track'
import { projectOntoTrack } from './track'

export function defaultCheckpointFractions(count = 12): number[] {
  const out: number[] = []
  for (let i = 0; i < count; i++) out.push(i / count)
  return out
}

export function checkpointProgresses(fractions: number[], totalLength: number): number[] {
  return fractions.map((f) => f * totalLength)
}

export function initialCheckpointIndex(progress: number, checkpointProgresses: number[]): number {
  let last = checkpointProgresses.length - 1
  for (let i = 0; i < checkpointProgresses.length; i++) {
    if (progress + 0.05 >= checkpointProgresses[i]) last = i
  }
  return last
}

export type RaceAdvance = {
  checkpointIndex: number
  lap: number
  finished: boolean
  raceDistance: number
  progress: number
  offTrackDistance: number
}

export function advanceRaceState(
  state: {
    checkpointIndex: number
    lap: number
    finished: boolean
    raceDistance: number
    progress: number
    lastProgress: number
  },
  samples: TrackSample[],
  totalLength: number,
  position: THREE.Vector3,
  checkpointProgresses: number[],
  totalLaps: number,
  recoveryOffTrack: number,
): RaceAdvance {
  const proj = projectOntoTrack(samples, position, totalLength)
  const offTrackDistance = Math.max(0, Math.abs(proj.lateral) - 0.5)

  let { checkpointIndex, lap, finished } = state
  const lastProgress = state.lastProgress

  if (!finished && checkpointProgresses.length > 0) {
    const nextIndex = (checkpointIndex + 1) % checkpointProgresses.length
    const target = checkpointProgresses[nextIndex]!
    const crossedForward = lastProgress < target && proj.progress >= target
    if (crossedForward) {
      checkpointIndex = nextIndex
      if (checkpointIndex === 0) {
        lap += 1
        if (lap > totalLaps) {
          finished = true
          lap = totalLaps
        }
      }
    }
  }

  const raceDistance = (lap - 1) * totalLength + proj.progress

  return {
    checkpointIndex,
    lap,
    finished,
    raceDistance,
    progress: proj.progress,
    offTrackDistance: offTrackDistance > recoveryOffTrack ? offTrackDistance : 0,
  }
}
