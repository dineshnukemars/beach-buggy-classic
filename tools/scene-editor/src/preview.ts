import type { SceneDocument, SceneEntity } from '@studio/core'
import {
  buildTrackRibbon,
  ribbonToThreeGeometry,
  samplesFromSpec,
  trackLength,
} from '@studio/physics'
import { createStudioLights, entityPlaceholder, tagStudioRef } from '@studio/three-render'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js'
import type { Selection } from './document'

export type PreviewHost = {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  renderer: THREE.WebGLRenderer
  orbit: OrbitControls
  transform: TransformControls
  canvas: HTMLCanvasElement
  groundPlane: THREE.Plane
  pointMeshes: THREE.Mesh[]
  entityMeshes: Map<string, THREE.Object3D>
  colliderHelpers: Map<string, THREE.LineSegments>
  trackRoot: THREE.Group
  pointsRoot: THREE.Group
  entitiesRoot: THREE.Group
  helpersRoot: THREE.Group
}

export function createPreview(canvas: HTMLCanvasElement): PreviewHost {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, preserveDrawingBuffer: true })
  renderer.setClearColor(0x7ec8ff, 1)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x7ec8ff)
  createStudioLights(scene)

  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 800)
  camera.position.set(0, 90, 110)

  const orbit = new OrbitControls(camera, canvas)
  orbit.enableDamping = true
  orbit.maxPolarAngle = Math.PI * 0.49
  orbit.target.set(0, 0, 0)

  const transform = new TransformControls(camera, canvas)
  transform.setMode('translate')
  transform.setSpace('world')
  transform.addEventListener('dragging-changed', (e) => {
    orbit.enabled = !(e as { value: boolean }).value
  })
  // three@0.178: TransformControls is not an Object3D; add its helper root.
  const helper = typeof transform.getHelper === 'function' ? transform.getHelper() : transform
  scene.add(helper as THREE.Object3D)

  const sand = new THREE.Mesh(
    new THREE.CircleGeometry(200, 64),
    new THREE.MeshStandardMaterial({ color: 0xb8954a, roughness: 1 }),
  )
  sand.rotation.x = -Math.PI / 2
  sand.position.y = -0.15
  sand.receiveShadow = true
  sand.name = '__sand'
  scene.add(sand)

  const trackRoot = new THREE.Group()
  const pointsRoot = new THREE.Group()
  const entitiesRoot = new THREE.Group()
  const helpersRoot = new THREE.Group()
  scene.add(trackRoot, pointsRoot, entitiesRoot, helpersRoot)

  return {
    scene,
    camera,
    renderer,
    orbit,
    transform,
    canvas,
    groundPlane: new THREE.Plane(new THREE.Vector3(0, 1, 0), 0),
    pointMeshes: [],
    entityMeshes: new Map(),
    colliderHelpers: new Map(),
    trackRoot,
    pointsRoot,
    entitiesRoot,
    helpersRoot,
  }
}

export function resizePreview(host: PreviewHost): void {
  const parent = host.canvas.parentElement
  const w = parent?.clientWidth || window.innerWidth
  const h = parent?.clientHeight || window.innerHeight
  host.renderer.setSize(w, h, false)
  host.camera.aspect = w / Math.max(1, h)
  host.camera.updateProjectionMatrix()
}

export function rebuildTrack(host: PreviewHost, doc: SceneDocument, selection: Selection): void {
  while (host.trackRoot.children.length) {
    const child = host.trackRoot.children[0]!
    host.trackRoot.remove(child)
    disposeObject(child)
  }
  while (host.pointsRoot.children.length) {
    const child = host.pointsRoot.children[0]!
    host.pointsRoot.remove(child)
    disposeObject(child)
  }
  host.pointMeshes = []
  if (!doc.track) return

  const samples = samplesFromSpec(doc.track)
  const len = trackLength(samples)
  const ribbon = buildTrackRibbon(samples, len, doc.track.halfWidth, doc.track.boostPads)
  const road = new THREE.Mesh(
    ribbonToThreeGeometry(ribbon),
    new THREE.MeshStandardMaterial({ color: 0x8b7355, roughness: 0.9 }),
  )
  road.receiveShadow = true
  host.trackRoot.add(road)

  for (const pad of ribbon.boostPads) {
    const padMesh = new THREE.Mesh(
      new THREE.BoxGeometry(4.5, 0.08, 3.2),
      new THREE.MeshStandardMaterial({
        color: 0x33ddff,
        emissive: 0x1188aa,
        emissiveIntensity: 0.5,
      }),
    )
    padMesh.position.copy(pad.position)
    padMesh.quaternion.setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      Math.atan2(pad.tangent.x, pad.tangent.z),
    )
    host.trackRoot.add(padMesh)
  }

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
    host.pointsRoot.add(mesh)
    host.pointMeshes.push(mesh)
  })
}

export function rebuildEntities(host: PreviewHost, doc: SceneDocument, selection: Selection): void {
  const keep = new Set(doc.entities.map((e) => e.id))
  for (const [id, obj] of host.entityMeshes) {
    if (keep.has(id)) continue
    host.entitiesRoot.remove(obj)
    disposeObject(obj)
    host.entityMeshes.delete(id)
    const helper = host.colliderHelpers.get(id)
    if (helper) {
      host.helpersRoot.remove(helper)
      disposeObject(helper)
      host.colliderHelpers.delete(id)
    }
  }

  for (const entity of doc.entities) {
    let obj = host.entityMeshes.get(entity.id)
    if (!obj) {
      obj = entityPlaceholder(0x88aacc)
      host.entityMeshes.set(entity.id, obj)
      host.entitiesRoot.add(obj)
    }
    applyEntityTransform(obj, entity)
    tagStudioRef(obj, { kind: 'entity', id: entity.id, assetId: entity.assetId, label: entity.id })
    syncColliderHelper(host, entity)
  }

  if (selection?.kind === 'entity') {
    const obj = host.entityMeshes.get(selection.id)
    if (obj) host.transform.attach(obj)
    else host.transform.detach()
  } else {
    host.transform.detach()
  }
}

function applyEntityTransform(obj: THREE.Object3D, entity: SceneEntity): void {
  obj.position.set(...entity.position)
  obj.rotation.set(0, entity.rotationY, 0)
  obj.scale.setScalar(entity.scale)
}

function syncColliderHelper(host: PreviewHost, entity: SceneEntity): void {
  let helper = host.colliderHelpers.get(entity.id)
  if (!entity.collider) {
    if (helper) {
      host.helpersRoot.remove(helper)
      disposeObject(helper)
      host.colliderHelpers.delete(entity.id)
    }
    return
  }
  const [hx, hy, hz] = entity.collider.halfExtents
  const geo = new THREE.BoxGeometry(hx * 2 * entity.scale, hy * 2 * entity.scale, hz * 2 * entity.scale)
  const edges = new THREE.EdgesGeometry(geo)
  geo.dispose()
  if (!helper) {
    helper = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0xff66aa }))
    host.colliderHelpers.set(entity.id, helper)
    host.helpersRoot.add(helper)
  } else {
    helper.geometry.dispose()
    helper.geometry = edges
  }
  helper.position.set(...entity.position)
  helper.rotation.set(0, entity.rotationY, 0)
}

export function pickObject(
  host: PreviewHost,
  clientX: number,
  clientY: number,
): THREE.Object3D | null {
  const rect = host.canvas.getBoundingClientRect()
  const ndc = new THREE.Vector2(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1,
  )
  const raycaster = new THREE.Raycaster()
  raycaster.setFromCamera(ndc, host.camera)
  const hits = raycaster.intersectObjects(
    [...host.pointMeshes, ...host.entityMeshes.values()],
    true,
  )
  if (!hits.length) return null
  let obj: THREE.Object3D | null = hits[0]!.object
  while (obj) {
    if (typeof obj.userData.pointIndex === 'number') return obj
    if (obj.userData.studioRef?.kind === 'entity') return obj
    obj = obj.parent
  }
  return null
}

export function groundHit(
  host: PreviewHost,
  clientX: number,
  clientY: number,
): THREE.Vector3 | null {
  const rect = host.canvas.getBoundingClientRect()
  const ndc = new THREE.Vector2(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1,
  )
  const raycaster = new THREE.Raycaster()
  raycaster.setFromCamera(ndc, host.camera)
  const target = new THREE.Vector3()
  const hit = raycaster.ray.intersectPlane(host.groundPlane, target)
  return hit ? target : null
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
