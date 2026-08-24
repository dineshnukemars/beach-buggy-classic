import * as THREE from 'three'
import type { TrackSpec, Vec3Tuple } from '@studio/core'

export type TrackSample = {
  position: THREE.Vector3
  tangent: THREE.Vector3
  normal: THREE.Vector3
  binormal: THREE.Vector3
}

export const DEFAULT_HALF_WIDTH = 7.5

export function createTrackCenterline(pointCount = 240): THREE.Vector3[] {
  const points: THREE.Vector3[] = []
  for (let i = 0; i < pointCount; i++) {
    const t = (i / pointCount) * Math.PI * 2
    const radius = 52 + Math.sin(t * 2) * 8 + Math.cos(t * 3) * 4
    const x = Math.cos(t) * radius
    const z = Math.sin(t) * radius * 0.72
    const y = 0.2 + Math.sin(t * 3) * 0.35
    points.push(new THREE.Vector3(x, y, z))
  }
  return points
}

export function tuplesToVectors(tuples: Vec3Tuple[]): THREE.Vector3[] {
  return tuples.map(([x, y, z]) => new THREE.Vector3(x, y, z))
}

export function vectorsToTuples(vectors: THREE.Vector3[]): Vec3Tuple[] {
  return vectors.map((v) => [v.x, v.y, v.z])
}

export function buildTrackSamples(centerline: THREE.Vector3[]): TrackSample[] {
  const samples: TrackSample[] = []
  const n = centerline.length
  for (let i = 0; i < n; i++) {
    const prev = centerline[(i - 1 + n) % n]
    const curr = centerline[i]
    const next = centerline[(i + 1) % n]
    const tangent = next.clone().sub(prev).normalize()
    const up = new THREE.Vector3(0, 1, 0)
    const binormal = new THREE.Vector3().crossVectors(up, tangent).normalize()
    const normal = new THREE.Vector3().crossVectors(tangent, binormal).normalize()
    samples.push({
      position: curr.clone(),
      tangent,
      normal,
      binormal,
    })
  }
  return samples
}

export function samplesFromSpec(track: TrackSpec): TrackSample[] {
  return buildTrackSamples(tuplesToVectors(track.centerline))
}

export function trackLength(samples: TrackSample[]): number {
  let len = 0
  for (let i = 0; i < samples.length; i++) {
    const a = samples[i].position
    const b = samples[(i + 1) % samples.length].position
    len += a.distanceTo(b)
  }
  return len
}

export function projectOntoTrack(
  samples: TrackSample[],
  worldPos: THREE.Vector3,
  totalLength: number,
): { progress: number; sampleIndex: number; lateral: number; nearest: THREE.Vector3 } {
  let bestDist = Infinity
  let bestIndex = 0
  let bestNearest = samples[0].position.clone()
  let bestLateral = 0

  for (let i = 0; i < samples.length; i++) {
    const a = samples[i].position
    const b = samples[(i + 1) % samples.length].position
    const ab = b.clone().sub(a)
    const ap = worldPos.clone().sub(a)
    const t = THREE.MathUtils.clamp(ap.dot(ab) / ab.lengthSq(), 0, 1)
    const nearest = a.clone().add(ab.multiplyScalar(t))
    const dist = worldPos.distanceTo(nearest)
    if (dist < bestDist) {
      bestDist = dist
      bestIndex = i
      bestNearest = nearest
      const side = samples[i].binormal
      bestLateral = worldPos.clone().sub(nearest).dot(side)
    }
  }

  let progress = 0
  for (let i = 0; i < bestIndex; i++) {
    progress += samples[i].position.distanceTo(samples[(i + 1) % samples.length].position)
  }
  const a = samples[bestIndex].position
  progress += a.distanceTo(bestNearest)
  progress = ((progress % totalLength) + totalLength) % totalLength

  return { progress, sampleIndex: bestIndex, lateral: bestLateral, nearest: bestNearest }
}

export function sampleAtProgress(
  samples: TrackSample[],
  totalLength: number,
  progress: number,
): TrackSample {
  const target = ((progress % totalLength) + totalLength) % totalLength
  let acc = 0
  for (let i = 0; i < samples.length; i++) {
    const a = samples[i]
    const b = samples[(i + 1) % samples.length]
    const seg = a.position.distanceTo(b.position)
    if (acc + seg >= target || i === samples.length - 1) {
      const t = seg > 0 ? (target - acc) / seg : 0
      return {
        position: a.position.clone().lerp(b.position, t),
        tangent: a.tangent.clone().lerp(b.tangent, t).normalize(),
        normal: a.normal.clone().lerp(b.normal, t).normalize(),
        binormal: a.binormal.clone().lerp(b.binormal, t).normalize(),
      }
    }
    acc += seg
  }
  return samples[0]
}

export function defaultBeachTrackSpec(pointCount = 64): TrackSpec {
  return {
    halfWidth: DEFAULT_HALF_WIDTH,
    centerline: vectorsToTuples(createTrackCenterline(pointCount)),
    boostPads: [0, 0.25, 0.5, 0.75],
  }
}
