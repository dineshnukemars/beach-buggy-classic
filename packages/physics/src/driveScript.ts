import type { InputFrame } from '@studio/core'

export type DriveAction = {
  name: string
  start: number
  end: number
  input: InputFrame
}

/** 30s labeled drive. Times are simulation seconds. */
export const DRIVE_SCRIPT: DriveAction[] = [
  { name: 'settle', start: 0, end: 2, input: { throttle: 0, steer: 0, brake: 0, boost: false } },
  { name: 'throttle', start: 2, end: 8, input: { throttle: 1, steer: 0, brake: 0, boost: false } },
  { name: 'coast', start: 8, end: 10, input: { throttle: 0, steer: 0, brake: 0, boost: false } },
  { name: 'brake', start: 10, end: 14, input: { throttle: 0, steer: 0, brake: 1, boost: false } },
  { name: 'coast-2', start: 14, end: 16, input: { throttle: 0, steer: 0, brake: 0, boost: false } },
  { name: 'throttle-left', start: 16, end: 20, input: { throttle: 1, steer: 1, brake: 0, boost: false } },
  { name: 'throttle-right', start: 20, end: 24, input: { throttle: 1, steer: -1, brake: 0, boost: false } },
  { name: 'throttle-2', start: 24, end: 27, input: { throttle: 1, steer: 0, brake: 0, boost: false } },
  { name: 'coast-3', start: 27, end: 30, input: { throttle: 0, steer: 0, brake: 0, boost: false } },
]

export const DRIVE_DURATION = 30

export function actionAt(simClock: number): DriveAction {
  for (const action of DRIVE_SCRIPT) {
    if (simClock >= action.start && simClock < action.end) return action
  }
  return DRIVE_SCRIPT[DRIVE_SCRIPT.length - 1]!
}
