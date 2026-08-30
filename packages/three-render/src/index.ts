import type { SceneDocument, StudioRef, Vec3Tuple } from '@studio/core'
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

export function applyVehicle(
  object: THREE.Object3D,
  state: VehicleState,
  visual?: { offset?: Vec3Tuple; rotationY?: number },
): void {
  applyPose(object, poseFromVehicle(state))
  const pivot = object.getObjectByName('visualPivot')
  if (!pivot || !visual) return
  if (visual.offset) {
    const autoY = pivot.userData.autoGroundY as number | undefined
    pivot.position.set(visual.offset[0], (autoY ?? 0) + visual.offset[1], visual.offset[2])
  }
  if (visual.rotationY !== undefined) pivot.rotation.y = visual.rotationY
}

export function applyEntityOpacity(object: THREE.Object3D, opacity: number): void {
  const clamped = Math.max(0, Math.min(1, opacity))
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return
    const materials = Array.isArray(child.material) ? child.material : [child.material]
    for (const mat of materials) {
      if (!(mat instanceof THREE.Material)) continue
      mat.transparent = clamped < 1
      mat.opacity = clamped
      mat.depthWrite = clamped >= 0.99
    }
  })
}

export function entityPlaceholder(color = 0x88aacc): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color }),
  )
  mesh.castShadow = true
  return mesh
}

export function tagStudioRef(object: THREE.Object3D, ref: StudioRef): void {
  object.userData.studioRef = ref
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
    tagStudioRef(obj, { kind: 'entity', id: entity.id, assetId: entity.assetId, label: entity.id })
    obj.position.set(...entity.position)
    obj.rotation.y = entity.rotationY
    obj.scale.setScalar(entity.scale)
    applyEntityOpacity(obj, entity.opacity ?? 1)
  }
}

export function createStudioLights(scene: THREE.Scene): void {
  scene.add(new THREE.HemisphereLight(0xb1e1ff, 0xd2a679, 0.85))
  const sun = new THREE.DirectionalLight(0xfff0d0, 1.15)
  sun.position.set(40, 60, 20)
  sun.castShadow = true
  scene.add(sun)
}
