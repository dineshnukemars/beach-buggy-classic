import type { SceneDocument, Selection } from '@studio/core'
import { rotatedColliderOffset, upsertEntity } from '@studio/core'
import { tagStudioRef } from '@studio/three-render'
import {
  buildTrackRibbon,
  ribbonToThreeGeometry,
  samplesFromSpec,
  trackLength,
} from '@studio/physics'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js'
import type { StudioHost } from './types'

export type EditOverlay = {
  update: (doc: SceneDocument, selection: Selection, visible: boolean) => void
  updateControls: (dt: number) => void
  pickObject: (clientX: number, clientY: number) => THREE.Object3D | null
  groundHit: (clientX: number, clientY: number) => THREE.Vector3 | null
  getTransform: () => TransformControls
  setOrbitEnabled: (enabled: boolean) => void
  setVisible: (visible: boolean) => void
  focusSelection: (doc: SceneDocument, selection: Selection | null) => void
  syncOrbitFromCamera: () => void
  dispose: () => void
}

export function createEditOverlay(
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  canvas: HTMLCanvasElement,
  host: StudioHost,
): EditOverlay {
  const orbit = new OrbitControls(camera, canvas)
  orbit.enableDamping = false
  orbit.rotateSpeed = 0.85
  orbit.panSpeed = 1.25
  orbit.zoomSpeed = 1.75
  orbit.zoomToCursor = true
  orbit.screenSpacePanning = true
  orbit.minDistance = 0.75
  orbit.maxDistance = 4000
  orbit.enabled = false
  orbit.mouseButtons = {
    LEFT: THREE.MOUSE.ROTATE,
    MIDDLE: THREE.MOUSE.DOLLY,
    RIGHT: THREE.MOUSE.PAN,
  }

  const flyForward = new THREE.Vector3()
  const flyRight = new THREE.Vector3()
  const flyUp = new THREE.Vector3()
  const flyMove = new THREE.Vector3()
  const flyOffset = new THREE.Vector3()
  const focusPoint = new THREE.Vector3()
  const focusViewDir = new THREE.Vector3()
  const focusBoundsSize = new THREE.Vector3()

  function applyKeyboardFly(dt: number): void {
    if (!orbit.enabled) return

    flyMove.set(0, 0, 0)
    if (host.isKeyDown('KeyW')) flyMove.z -= 1
    if (host.isKeyDown('KeyS')) flyMove.z += 1
    if (host.isKeyDown('KeyA')) flyMove.x -= 1
    if (host.isKeyDown('KeyD')) flyMove.x += 1
    if (host.isKeyDown('KeyE')) flyMove.y += 1
    if (host.isKeyDown('KeyQ')) flyMove.y -= 1

    if (flyMove.lengthSq() === 0) return

    flyForward.subVectors(orbit.target, camera.position)
    if (flyForward.lengthSq() < 1e-8) camera.getWorldDirection(flyForward)
    flyForward.normalize()

    flyRight.crossVectors(flyForward, camera.up)
    if (flyRight.lengthSq() < 1e-8) flyRight.set(1, 0, 0)
    else flyRight.normalize()

    flyUp.crossVectors(flyRight, flyForward).normalize()

    const dist = camera.position.distanceTo(orbit.target)
    const sprint = host.isKeyDown('ShiftLeft') || host.isKeyDown('ShiftRight')
    const speed = (sprint ? 48 : 18) + dist * 0.35

    const delta = flyMove.normalize().multiplyScalar(speed * dt)
    flyOffset
      .set(0, 0, 0)
      .addScaledVector(flyRight, delta.x)
      .addScaledVector(flyUp, delta.y)
      .addScaledVector(flyForward, -delta.z)

    camera.position.add(flyOffset)
    orbit.target.add(flyOffset)
  }

  const transform = new TransformControls(camera, canvas)
  transform.setMode('translate')
  transform.setSpace('world')
  transform.addEventListener('dragging-changed', (e) => {
    const dragging = (e as { value: boolean }).value
    if (dragging) {
      orbit.enabled = false
      return
    }
    orbit.enabled = host.getMode() === 'edit' || host.isOrbitFree()
  })
  const helper = typeof transform.getHelper === 'function' ? transform.getHelper() : transform
  scene.add(helper as THREE.Object3D)

  const trackRoot = new THREE.Group()
  trackRoot.name = '__studio-track'
  const pointsRoot = new THREE.Group()
  pointsRoot.name = '__studio-points'
  const helpersRoot = new THREE.Group()
  helpersRoot.name = '__studio-helpers'
  scene.add(trackRoot, pointsRoot, helpersRoot)

  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
  const pointMeshes: THREE.Mesh[] = []
  const colliderHelpers = new Map<string, THREE.LineSegments>()
  const colliderPickMeshes = new Map<string, THREE.Mesh>()
  const colliderPickMat = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    depthWrite: false,
  })
  let visible = false

  transform.addEventListener('objectChange', () => {
    const sel = host.getSelection()
    if (sel?.kind !== 'entity' || !transform.object) return
    const entity = host.getDoc().entities.find((e) => e.id === sel.id)
    if (!entity) return
    const mode = transform.getMode()
    const scale =
      mode === 'scale'
        ? (transform.object.scale.x + transform.object.scale.y + transform.object.scale.z) / 3
        : entity.scale
    if (mode === 'scale') transform.object.scale.setScalar(scale)
    const next = {
      ...entity,
      position: [transform.object.position.x, transform.object.position.y, transform.object.position.z] as [
        number,
        number,
        number,
      ],
      rotationY: transform.object.rotation.y,
      scale,
    }
    host.setDoc(upsertEntity(host.getDoc(), next), { skipVisuals: true })
  })

  function setVisible(next: boolean): void {
    visible = next
    trackRoot.visible = next
    pointsRoot.visible = next
    helpersRoot.visible = next
    if (!next) {
      transform.detach()
      ;(helper as THREE.Object3D).visible = false
      if (!host.isOrbitFree()) orbit.enabled = false
    } else {
      ;(helper as THREE.Object3D).visible = true
      orbit.enabled = true
      const doc = host.getDoc()
      const sel = host.getSelection()
      update(doc, sel, true)
      syncOrbitFromCamera()
      if (sel) focusSelection(doc, sel)
    }
  }

  function syncOrbitFromCamera(): void {
    camera.getWorldDirection(focusViewDir)
    orbit.target.copy(camera.position).addScaledVector(focusViewDir, 40)
    orbit.update()
  }

  function rebuildTrack(doc: SceneDocument, selection: Selection): void {
    while (trackRoot.children.length) {
      const child = trackRoot.children[0]!
      trackRoot.remove(child)
      disposeObject(child)
    }
    while (pointsRoot.children.length) {
      const child = pointsRoot.children[0]!
      pointsRoot.remove(child)
      disposeObject(child)
    }
    pointMeshes.length = 0
    if (!doc.track) return

    const samples = samplesFromSpec(doc.track)
    const len = trackLength(samples)
    const ribbon = buildTrackRibbon(samples, len, doc.track.halfWidth, doc.track.boostPads)
    const road = new THREE.Mesh(
      ribbonToThreeGeometry(ribbon),
      new THREE.MeshStandardMaterial({ color: 0x8b7355, roughness: 0.9, transparent: true, opacity: 0.35 }),
    )
    road.receiveShadow = false
    trackRoot.add(road)

    const selectedIndex = selection?.kind === 'point' ? selection.index : -1
    doc.track.centerline.forEach((pt, i) => {
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.85, 16, 12),
        new THREE.MeshStandardMaterial({
          color: i === selectedIndex ? 0xffcc33 : 0xffffff,
          emissive: i === selectedIndex ? 0x664400 : 0x222222,
          emissiveIntensity: 0.35,
        }),
      )
      mesh.position.set(pt[0], pt[1] + 0.4, pt[2])
      mesh.userData.pointIndex = i
      tagStudioRef(mesh, { kind: 'track', id: `point:${i}`, label: `Point ${i}` })
      pointsRoot.add(mesh)
      pointMeshes.push(mesh)
    })
  }

  function removeColliderHelper(entityId: string): void {
    const helper = colliderHelpers.get(entityId)
    if (helper) {
      helpersRoot.remove(helper)
      disposeObject(helper)
      colliderHelpers.delete(entityId)
    }
    const pick = colliderPickMeshes.get(entityId)
    if (pick) {
      helpersRoot.remove(pick)
      pick.geometry.dispose()
      colliderPickMeshes.delete(entityId)
    }
  }

  function applyColliderTransform(
    obj: THREE.Object3D,
    entity: SceneDocument['entities'][number],
    visualObj: THREE.Object3D | undefined,
  ): void {
    if (visualObj) {
      obj.position.copy(visualObj.position)
      obj.rotation.copy(visualObj.rotation)
    } else {
      obj.position.set(...entity.position)
      obj.rotation.set(0, entity.rotationY, 0)
    }
    const [tx, ty, tz] = rotatedColliderOffset(entity.collider!.offset, entity.rotationY, entity.scale)
    obj.position.x += tx
    obj.position.y += ty
    obj.position.z += tz
  }

  function syncColliderHelper(entity: SceneDocument['entities'][number], obj: THREE.Object3D | undefined): void {
    if (!entity.collider) {
      removeColliderHelper(entity.id)
      return
    }
    const [hx, hy, hz] = entity.collider.halfExtents
    const sx = hx * 2 * entity.scale
    const sy = hy * 2 * entity.scale
    const sz = hz * 2 * entity.scale
    const boxGeo = new THREE.BoxGeometry(sx, sy, sz)

    let helper = colliderHelpers.get(entity.id)
    const edges = new THREE.EdgesGeometry(boxGeo)
    if (!helper) {
      helper = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0xff66aa }))
      colliderHelpers.set(entity.id, helper)
      helpersRoot.add(helper)
    } else {
      helper.geometry.dispose()
      helper.geometry = edges
    }

    let pickMesh = colliderPickMeshes.get(entity.id)
    if (!pickMesh) {
      pickMesh = new THREE.Mesh(boxGeo.clone(), colliderPickMat)
      pickMesh.name = `collider-pick:${entity.id}`
      tagStudioRef(pickMesh, { kind: 'entity', id: entity.id, assetId: entity.assetId, label: entity.id })
      colliderPickMeshes.set(entity.id, pickMesh)
      helpersRoot.add(pickMesh)
    } else {
      pickMesh.geometry.dispose()
      pickMesh.geometry = boxGeo
    }
    boxGeo.dispose()

    applyColliderTransform(helper, entity, obj)
    applyColliderTransform(pickMesh, entity, obj)
  }

  function update(doc: SceneDocument, selection: Selection, show: boolean): void {
    if (!show) return
    rebuildTrack(doc, selection)
    for (const entity of doc.entities) {
      syncColliderHelper(entity, scene.getObjectByName(`entity:${entity.id}`) ?? undefined)
    }
    if (selection?.kind === 'entity') {
      const obj = scene.getObjectByName(`entity:${selection.id}`)
      if (obj) transform.attach(obj)
      else transform.detach()
    } else {
      transform.detach()
    }
  }

  function pickObject(clientX: number, clientY: number): THREE.Object3D | null {
    const rect = canvas.getBoundingClientRect()
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    )
    const raycaster = new THREE.Raycaster()
    raycaster.params.Line = { threshold: 1.25 }
    raycaster.setFromCamera(ndc, camera)
    const entityObjs: THREE.Object3D[] = []
    scene.traverse((obj) => {
      if (obj.name.startsWith('entity:')) entityObjs.push(obj)
    })
    const hits = raycaster.intersectObjects(
      [...pointMeshes, ...entityObjs, ...colliderPickMeshes.values()],
      true,
    )
    if (!hits.length) return null
    let obj: THREE.Object3D | null = hits[0]!.object
    while (obj) {
      if (typeof obj.userData.pointIndex === 'number') return obj
      if (obj.userData.studioRef?.kind === 'entity') return obj
      if (obj.name.startsWith('entity:') || obj.name.startsWith('collider-pick:')) return obj
      obj = obj.parent
    }
    return null
  }

  function groundHit(clientX: number, clientY: number): THREE.Vector3 | null {
    const rect = canvas.getBoundingClientRect()
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    )
    const raycaster = new THREE.Raycaster()
    raycaster.setFromCamera(ndc, camera)
    const target = new THREE.Vector3()
    const hit = raycaster.ray.intersectPlane(groundPlane, target)
    return hit ? target : null
  }

  function focusSelection(doc: SceneDocument, selection: Selection | null): void {
    if (!selection) return

    let focusObj: THREE.Object3D | undefined
    if (selection.kind === 'entity') {
      focusObj = scene.getObjectByName(`entity:${selection.id}`) ?? undefined
      if (focusObj) {
        const bounds = new THREE.Box3().setFromObject(focusObj)
        if (bounds.isEmpty()) focusObj.getWorldPosition(focusPoint)
        else bounds.getCenter(focusPoint)
      } else {
        const entity = doc.entities.find((e) => e.id === selection.id)
        if (!entity) return
        focusPoint.set(entity.position[0], entity.position[1], entity.position[2])
      }
    } else if (selection.kind === 'point') {
      const pt = doc.track?.centerline[selection.index]
      if (!pt) return
      focusPoint.set(pt[0], pt[1] + 0.4, pt[2])
    }

    camera.getWorldDirection(focusViewDir)
    let distance = Math.max(camera.position.distanceTo(focusPoint), 2)
    if (focusObj) {
      const bounds = new THREE.Box3().setFromObject(focusObj)
      bounds.getSize(focusBoundsSize)
      const radius = focusBoundsSize.length() * 0.5
      if (radius > 0.01) {
        const minDist =
          radius / Math.tan(((camera.fov * Math.PI) / 180) * 0.5) * 1.25
        distance = Math.max(distance, minDist)
      }
    }

    orbit.target.copy(focusPoint)
    camera.position.copy(focusPoint).addScaledVector(focusViewDir, -distance)
    orbit.update()
  }

  function setOrbitEnabled(enabled: boolean): void {
    orbit.enabled = enabled
  }

  return {
    update: (doc, selection, show) => update(doc, selection, show && visible),
    updateControls: (dt) => {
      if (!orbit.enabled) return
      applyKeyboardFly(dt)
      orbit.update(dt)
    },
    pickObject,
    groundHit,
    getTransform: () => transform,
    setOrbitEnabled,
    setVisible,
    focusSelection,
    syncOrbitFromCamera,
    dispose: () => {
      transform.dispose()
      orbit.dispose()
      colliderPickMat.dispose()
      for (const id of [...colliderHelpers.keys()]) removeColliderHelper(id)
      scene.remove(trackRoot, pointsRoot, helpersRoot)
    },
  }
}

function disposeObject(obj: THREE.Object3D): void {
  obj.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (mesh.geometry) mesh.geometry.dispose()
    const mat = mesh.material
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose())
    else if (mat) mat.dispose()
  })
}
