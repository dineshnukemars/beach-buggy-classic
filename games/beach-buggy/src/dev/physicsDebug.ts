import type { World } from '@studio/physics'
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
  const wheelGeo = new THREE.SphereGeometry(1, 10, 8)
  const wheelMatContact = new THREE.MeshBasicMaterial({ color: 0x55ff88, wireframe: true })
  const wheelMatAir = new THREE.MeshBasicMaterial({ color: 0xffaa44, wireframe: true })

  function setEnabled(on: boolean): void {
    root.visible = on
    if (!on) clearWheelPool()
  }

  function clearWheelPool(): void {
    for (const mesh of wheelPool) root.remove(mesh)
    wheelPool.length = 0
  }

  function sync(world: World | undefined): void {
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
    while (wheelPool.length > hubs.length) {
      const mesh = wheelPool.pop()!
      root.remove(mesh)
    }
    for (let i = 0; i < hubs.length; i++) {
      const hub = hubs[i]!
      const mesh = wheelPool[i]!
      mesh.material = hub.contact ? wheelMatContact : wheelMatAir
      mesh.position.set(hub.position[0], hub.position[1], hub.position[2])
      mesh.scale.setScalar(hub.radius)
    }
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
    scene.remove(root)
  }

  return { setEnabled, sync, onWorldReset, dispose }
}
