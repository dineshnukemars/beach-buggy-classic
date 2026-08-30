import type { StudioRef } from '@studio/core'
import * as THREE from 'three'
import { findStudioRef } from './tagging'

export type PickHit = {
  object: THREE.Object3D
  ref: StudioRef
}

export function createPicker(scene: THREE.Scene, camera: THREE.Camera) {
  const raycaster = new THREE.Raycaster()
  const pointer = new THREE.Vector2()
  let helper: THREE.BoxHelper | undefined
  let selected: THREE.Object3D | undefined

  function pick(clientX: number, clientY: number, canvas: HTMLCanvasElement): PickHit | undefined {
    const rect = canvas.getBoundingClientRect()
    pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1
    pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1
    raycaster.setFromCamera(pointer, camera)
    const hits = raycaster.intersectObjects(scene.children, true)
    for (const hit of hits) {
      if (hit.object === helper) continue
      const ref = findStudioRef(hit.object)
      if (!ref) continue
      highlight(hit.object)
      return { object: hit.object, ref }
    }
    return undefined
  }

  function highlight(object: THREE.Object3D): void {
    selected = object
    if (!helper) {
      helper = new THREE.BoxHelper(object, 0xff6b2c)
      helper.name = 'dev-pick-helper'
      scene.add(helper)
    } else {
      helper.setFromObject(object)
    }
    helper.visible = true
  }

  function update(): void {
    if (helper && selected) helper.setFromObject(selected)
  }

  function clear(): void {
    selected = undefined
    if (helper) helper.visible = false
  }

  function dispose(): void {
    clear()
    if (helper) scene.remove(helper)
    helper = undefined
  }

  return { pick, highlight, update, clear, dispose }
}

export type Picker = ReturnType<typeof createPicker>
