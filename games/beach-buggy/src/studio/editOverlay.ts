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
  setVisible: (visible: boolean) => void
  dispose: () => void
}

export function createEditOverlay(
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  canvas: HTMLCanvasElement,
  host: StudioHost,
): EditOverlay {
  const orbit = new OrbitControls(camera, canvas)
  orbit.enableDamping = true
  orbit.maxPolarAngle = Math.PI * 0.49
  orbit.enabled = false

  const transform = new TransformControls(camera, canvas)
  transform.setMode('translate')
  transform.setSpace('world')
  transform.addEventListener('dragging-changed', (e) => {
    orbit.enabled = !(e as { value: boolean }).value && host.getMode() === 'edit'
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
    orbit.enabled = next
    if (!next) {
      transform.detach()
      ;(helper as THREE.Object3D).visible = false
    } else {
      ;(helper as THREE.Object3D).visible = true
      update(host.getDoc(), host.getSelection(), true)
    }
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

  function syncColliderHelper(entity: SceneDocument['entities'][number], obj: THREE.Object3D | undefined): void {
    let helper = colliderHelpers.get(entity.id)
    if (!entity.collider) {
      if (helper) {
        helpersRoot.remove(helper)
        disposeObject(helper)
        colliderHelpers.delete(entity.id)
      }
      return
    }
    const [hx, hy, hz] = entity.collider.halfExtents
    const geo = new THREE.BoxGeometry(hx * 2 * entity.scale, hy * 2 * entity.scale, hz * 2 * entity.scale)
    const edges = new THREE.EdgesGeometry(geo)
    geo.dispose()
    if (!helper) {
      helper = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0xff66aa }))
      colliderHelpers.set(entity.id, helper)
      helpersRoot.add(helper)
    } else {
      helper.geometry.dispose()
      helper.geometry = edges
    }
    if (obj) {
      helper.position.copy(obj.position)
      helper.rotation.copy(obj.rotation)
    } else {
      helper.position.set(...entity.position)
      helper.rotation.set(0, entity.rotationY, 0)
    }
    const [tx, ty, tz] = rotatedColliderOffset(entity.collider.offset, entity.rotationY, entity.scale)
    helper.position.x += tx
    helper.position.y += ty
    helper.position.z += tz
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
    raycaster.setFromCamera(ndc, camera)
    const entityObjs: THREE.Object3D[] = []
    scene.traverse((obj) => {
      if (obj.name.startsWith('entity:')) entityObjs.push(obj)
    })
    const hits = raycaster.intersectObjects([...pointMeshes, ...entityObjs], true)
    if (!hits.length) return null
    let obj: THREE.Object3D | null = hits[0]!.object
    while (obj) {
      if (typeof obj.userData.pointIndex === 'number') return obj
      if (obj.userData.studioRef?.kind === 'entity') return obj
      if (obj.name.startsWith('entity:')) return obj
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

  return {
    update: (doc, selection, show) => update(doc, selection, show && visible),
    updateControls: () => {
      if (visible && host.getMode() === 'edit') orbit.update()
    },
    pickObject,
    groundHit,
    getTransform: () => transform,
    setVisible,
    dispose: () => {
      transform.dispose()
      orbit.dispose()
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
