import type { VehicleState } from '@studio/physics'
import * as THREE from 'three'

export type Pose = {
  x: number
  y: number
  z: number
  heading: number
  speed: number
  rotation: THREE.Quaternion
}

export function poseFromVehicle(state: VehicleState): Pose {
  return {
    x: state.position.x,
    y: state.position.y,
    z: state.position.z,
    heading: state.heading,
    speed: state.speed,
    rotation: state.rotation.clone(),
  }
}

export function applyPose(object: THREE.Object3D, pose: Pose): void {
  object.position.set(pose.x, pose.y, pose.z)
  object.quaternion.copy(pose.rotation)
}

export function applyVehicle(object: THREE.Object3D, state: VehicleState): void {
  applyPose(object, poseFromVehicle(state))
}

export function entityPlaceholder(color = 0x88aacc): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color }),
  )
  mesh.castShadow = true
  return mesh
}

export function placeEntities(
  scene: THREE.Scene,
  doc: import('@studio/core').SceneDocument,
  meshes: Map<string, THREE.Object3D>,
): void {
  for (const entity of doc.entities) {
    let obj = meshes.get(entity.id)
    if (!obj) {
      obj = entityPlaceholder()
      meshes.set(entity.id, obj)
      scene.add(obj)
    }
    obj.position.set(...entity.position)
    obj.rotation.y = entity.rotationY
    obj.scale.setScalar(entity.scale)
  }
}

export function createStudioLights(scene: THREE.Scene): void {
  scene.add(new THREE.HemisphereLight(0xb1e1ff, 0xd2a679, 0.85))
  const sun = new THREE.DirectionalLight(0xfff0d0, 1.15)
  sun.position.set(40, 60, 20)
  sun.castShadow = true
  scene.add(sun)
}
