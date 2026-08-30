import type { FeedbackPlayerContext, PoseHistorySample, QuatTuple } from '@studio/core'
import type { VehicleState } from '@studio/physics'

export const POSE_CAPACITY = 900
export const FRAME_CAPACITY = 16
export const JPEG_INTERVAL_MS = 120

export type LookbackFrame = { simClock: number; blob: Blob }

export class LookbackBuffer {
  private poses: PoseHistorySample[] = []
  private frames: LookbackFrame[] = []
  private jpegInFlight = false
  private lastJpegAt = 0

  constructor(
    readonly poseCapacity = POSE_CAPACITY,
    readonly frameCapacity = FRAME_CAPACITY,
  ) {}

  pushPose(sample: PoseHistorySample): void {
    this.poses.push(sample)
    if (this.poses.length > this.poseCapacity) this.poses.shift()
  }

  pushPlayer(simClock: number, player: VehicleState, targetId?: string): void {
    this.pushPose({
      simClock,
      targetId,
      player: {
        position: [player.position.x, player.position.y, player.position.z],
        quaternion: quatOf(player.rotation),
        speed: player.speed,
        airborneTime: player.airborneTime,
        wheelContacts: player.wheelContacts.slice(),
        collisionCount: player.collisionCount,
        offTrackDistance: player.offTrackDistance,
      },
    })
  }

  maybeCaptureJpeg(canvas: HTMLCanvasElement, nowMs: number, simClock: number): void {
    if (this.jpegInFlight) return
    if (nowMs - this.lastJpegAt < JPEG_INTERVAL_MS) return
    this.jpegInFlight = true
    this.lastJpegAt = nowMs
    canvas.toBlob(
      (blob) => {
        this.jpegInFlight = false
        if (!blob) return
        this.frames.push({ simClock, blob })
        if (this.frames.length > this.frameCapacity) this.frames.shift()
      },
      'image/jpeg',
      0.6,
    )
  }

  snapshot(): { poses: PoseHistorySample[]; frames: LookbackFrame[] } {
    return { poses: this.poses.slice(), frames: this.frames.slice() }
  }

  clear(): void {
    this.poses = []
    this.frames = []
    this.lastJpegAt = 0
  }
}

function quatOf(q: { x: number; y: number; z: number; w: number }): QuatTuple {
  return [q.x, q.y, q.z, q.w]
}

export function playerSlice(player: VehicleState): FeedbackPlayerContext {
  return {
    place: player.place,
    lap: player.lap,
    speed: player.speed,
    airborneTime: player.airborneTime,
    collisionCount: player.collisionCount,
    offTrackDistance: player.offTrackDistance,
    wheelContacts: player.wheelContacts.slice(),
  }
}
