import type { SceneDocument } from '@studio/core'
import type { VehicleState } from '@studio/physics'
import * as THREE from 'three'

export type Pose = {
  x: number
  y: number
  z: number
  heading: number
  speed: number
}

export function poseFromVehicle(state: VehicleState): Pose {
  return {
    x: state.position.x,
    y: state.position.y,
    z: state.position.z,
    heading: state.heading,
    speed: state.speed,
  }
}

export function applyPose(object: THREE.Object3D, pose: Pose): void {
  object.position.set(pose.x, pose.y, pose.z)
  object.rotation.order = 'YXZ'
  object.rotation.y = pose.heading
  object.rotation.x = -pose.speed * 0.002
  object.rotation.z = 0
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
  doc: SceneDocument,
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
