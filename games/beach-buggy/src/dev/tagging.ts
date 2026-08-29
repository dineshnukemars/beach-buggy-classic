import { parseStudioRef, type QuatTuple, type StudioRef, type Vec3Tuple, type WorldTransform } from '@studio/core'
import * as THREE from 'three'

export function findStudioRef(object: THREE.Object3D): StudioRef | undefined {
  let current: THREE.Object3D | null = object
  while (current) {
    const raw = current.userData.studioRef
    if (raw) {
      try {
        return parseStudioRef(raw)
      } catch {
        /* keep walking */
      }
    }
    current = current.parent
  }
  return undefined
}

export function worldTransformOf(object: THREE.Object3D): WorldTransform {
  object.updateWorldMatrix(true, false)
  const pos = new THREE.Vector3()
  const quat = new THREE.Quaternion()
  const scale = new THREE.Vector3()
  object.matrixWorld.decompose(pos, quat, scale)
  const heading = Math.atan2(
    2 * (quat.w * quat.y + quat.x * quat.z),
    1 - 2 * (quat.y * quat.y + quat.z * quat.z),
  )
  return {
    position: [pos.x, pos.y, pos.z],
    quaternion: [quat.x, quat.y, quat.z, quat.w],
    heading,
    rotationY: object.rotation.y,
    scale: [scale.x, scale.y, scale.z],
  }
}

export function worldBoxOf(object: THREE.Object3D): { min: Vec3Tuple; max: Vec3Tuple } | undefined {
  const box = new THREE.Box3().setFromObject(object)
  if (box.isEmpty()) return undefined
  return {
    min: [box.min.x, box.min.y, box.min.z],
    max: [box.max.x, box.max.y, box.max.z],
  }
}

export function quatTuple(q: THREE.Quaternion): QuatTuple {
  return [q.x, q.y, q.z, q.w]
}

export function vec3Tuple(v: THREE.Vector3): Vec3Tuple {
  return [v.x, v.y, v.z]
}
