import * as THREE from 'three'
import type { TrackSample } from './track'
import { sampleAtProgress } from './track'

export type TrackRibbon = {
  positions: Float32Array
  indices: Uint32Array
  boostPads: BoostPadSpec[]
}

export type BoostPadSpec = {
  progress: number
  position: THREE.Vector3
  tangent: THREE.Vector3
  binormal: THREE.Vector3
}

export function buildTrackRibbon(
  samples: TrackSample[],
  totalLength: number,
  halfWidth: number,
  boostFractions: number[],
  yOffset = 0.05,
): TrackRibbon {
  const positions: number[] = []
  const indices: number[] = []

  for (let i = 0; i < samples.length; i++) {
    const s = samples[i]
    const left = s.position.clone().add(s.binormal.clone().multiplyScalar(halfWidth))
    const right = s.position.clone().add(s.binormal.clone().multiplyScalar(-halfWidth))
    left.y += yOffset
    right.y += yOffset
    positions.push(left.x, left.y, left.z, right.x, right.y, right.z)
  }

  for (let i = 0; i < samples.length; i++) {
    const i0 = i * 2
    const i1 = i0 + 1
    const i2 = ((i + 1) % samples.length) * 2
    const i3 = i2 + 1
    // CCW when viewed from +Y so Rapier contact normals push the chassis up.
    indices.push(i0, i1, i2, i1, i3, i2)
  }

  const boostPads = boostFractions.map((frac) => {
    const sample = sampleAtProgress(samples, totalLength, frac * totalLength)
    return {
      progress: frac,
      position: sample.position.clone().add(new THREE.Vector3(0, yOffset, 0)),
      tangent: sample.tangent.clone(),
      binormal: sample.binormal.clone(),
    }
  })

  return {
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
    boostPads,
  }
}

export type TrackBox = {
  position: THREE.Vector3
  rotation: THREE.Quaternion
  halfExtents: [number, number, number]
}

/** Solid road segments for Rapier. The visual ribbon stays a thin strip. */
export function buildTrackBoxes(
  samples: TrackSample[],
  halfWidth: number,
  yOffset = 0.05,
  thickness = 0.35,
): TrackBox[] {
  const boxes: TrackBox[] = []
  const halfY = thickness / 2
  for (let i = 0; i < samples.length; i++) {
    const a = samples[i]!
    const b = samples[(i + 1) % samples.length]!
    const mid = a.position.clone().lerp(b.position, 0.5)
    const delta = b.position.clone().sub(a.position)
    const len = delta.length()
    if (len < 1e-4) continue
    const tangent = delta.divideScalar(len)
    const yaw = Math.atan2(tangent.x, tangent.z)
    const pitch = Math.asin(THREE.MathUtils.clamp(tangent.y, -1, 1))
    const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'))
    boxes.push({
      position: new THREE.Vector3(mid.x, mid.y + yOffset - halfY, mid.z),
      rotation,
      halfExtents: [halfWidth, halfY, len / 2 + 0.22],
    })
  }
  return boxes
}

export function ribbonToThreeGeometry(ribbon: TrackRibbon): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(ribbon.positions, 3))
  geo.setIndex(Array.from(ribbon.indices))
  geo.computeVertexNormals()
  return geo
}
