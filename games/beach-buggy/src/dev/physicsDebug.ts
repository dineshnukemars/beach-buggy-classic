import type { World } from '@studio/physics'
import { tagStudioRef } from '@studio/three-render'
import * as THREE from 'three'

function rgbaToRgb(colors: Float32Array): Float32Array {
  const rgb = new Float32Array((colors.length / 4) * 3)
  for (let i = 0, j = 0; i < colors.length; i += 4, j += 3) {
    rgb[j] = colors[i]!
    rgb[j + 1] = colors[i + 1]!
    rgb[j + 2] = colors[i + 2]!
  }
  return rgb
}

export function createPhysicsDebugLayer(scene: THREE.Scene) {
  const root = new THREE.Group()
  root.name = 'physics-debug'
  root.visible = false
  scene.add(root)

  let colliderLines: THREE.LineSegments | undefined
  const wheelPool: THREE.Mesh[] = []
  const wheelPickPool: THREE.Mesh[] = []
  const wheelGeo = new THREE.SphereGeometry(1, 10, 8)
  const wheelMatContact = new THREE.MeshBasicMaterial({ color: 0x55ff88, wireframe: true })
  const wheelMatAir = new THREE.MeshBasicMaterial({ color: 0xffaa44, wireframe: true })
  const wheelMatSelected = new THREE.MeshBasicMaterial({ color: 0xffee33, wireframe: true })
  const wheelPickMat = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    depthWrite: false,
  })

  function setEnabled(on: boolean): void {
    root.visible = on
    if (!on) clearWheelPool()
  }

  function clearWheelPool(): void {
    for (const mesh of wheelPool) root.remove(mesh)
    wheelPool.length = 0
    for (const mesh of wheelPickPool) root.remove(mesh)
    wheelPickPool.length = 0
  }

  function sync(world: World | undefined, selectedWheelIndex?: number): void {
    if (!root.visible) return
    if (!world || world.backend !== 'rapier') {
      colliderLines?.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3))
      clearWheelPool()
      return
    }

    const buffers = world.debugRender()
    if (buffers && buffers.vertices.length > 0) {
      if (!colliderLines) {
        colliderLines = new THREE.LineSegments(
          new THREE.BufferGeometry(),
          new THREE.LineBasicMaterial({ vertexColors: true }),
        )
        root.add(colliderLines)
      }
      const geo = colliderLines.geometry
      geo.setAttribute('position', new THREE.BufferAttribute(buffers.vertices, 3))
      geo.setAttribute('color', new THREE.BufferAttribute(rgbaToRgb(buffers.colors), 3))
      geo.computeBoundingSphere()
    } else if (colliderLines) {
      colliderLines.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3))
    }

    const hubs = world.debugWheelHubs()
    while (wheelPool.length < hubs.length) {
      const mesh = new THREE.Mesh(wheelGeo, wheelMatAir)
      root.add(mesh)
      wheelPool.push(mesh)
    }
    while (wheelPickPool.length < hubs.length) {
      const pick = new THREE.Mesh(wheelGeo, wheelPickMat)
      root.add(pick)
      wheelPickPool.push(pick)
    }
    while (wheelPool.length > hubs.length) {
      const mesh = wheelPool.pop()!
      root.remove(mesh)
    }
    while (wheelPickPool.length > hubs.length) {
      const pick = wheelPickPool.pop()!
      root.remove(pick)
    }
    for (let i = 0; i < hubs.length; i++) {
      const hub = hubs[i]!
      const mesh = wheelPool[i]!
      const pick = wheelPickPool[i]!
      const selected = hub.racerIndex === 0 && hub.wheelIndex === selectedWheelIndex
      mesh.material = selected
        ? wheelMatSelected
        : hub.contact
          ? wheelMatContact
          : wheelMatAir
      mesh.position.set(hub.position[0], hub.position[1], hub.position[2])
      mesh.scale.setScalar(hub.radius)
      mesh.userData.wheelIndex = hub.wheelIndex
      mesh.userData.racerIndex = hub.racerIndex
      pick.position.copy(mesh.position)
      pick.scale.copy(mesh.scale)
      pick.name = `wheel-pick:racer:${hub.racerIndex}:${hub.wheelIndex}`
      pick.userData.wheelIndex = hub.wheelIndex
      pick.userData.racerIndex = hub.racerIndex
      tagStudioRef(pick, {
        kind: 'racer',
        id: `racer:${hub.racerIndex}`,
        assetId: 'buggy',
        label: hub.racerIndex === 0 ? 'Player' : `Racer ${hub.racerIndex}`,
      })
    }
  }

  function getPickMeshes(): THREE.Mesh[] {
    return [...wheelPickPool, ...wheelPool]
  }

  function onWorldReset(): void {
    clearWheelPool()
    if (colliderLines) {
      root.remove(colliderLines)
      colliderLines.geometry.dispose()
      ;(colliderLines.material as THREE.Material).dispose()
      colliderLines = undefined
    }
  }

  function dispose(): void {
    onWorldReset()
    wheelGeo.dispose()
    wheelMatContact.dispose()
    wheelMatAir.dispose()
    wheelMatSelected.dispose()
    wheelPickMat.dispose()
    scene.remove(root)
  }

  return { setEnabled, sync, onWorldReset, dispose, getPickMeshes }
}
