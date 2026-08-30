import type { AssetManifest, AssetRef } from '@studio/core'
import { emptyManifest } from '@studio/core'
import * as THREE from 'three'
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'

export async function loadManifest(url: string): Promise<AssetManifest> {
  const res = await fetch(url)
  if (!res.ok) return emptyManifest()
  return (await res.json()) as AssetManifest
}

export function publicUrl(path: string): string {
  if (path.startsWith('http') || path.startsWith('/')) return path
  return `/${path.replace(/^\.\//, '')}`
}

const gltfLoader = new GLTFLoader()
const texLoader = new THREE.TextureLoader()

export function loadGltf(path: string): Promise<GLTF> {
  return gltfLoader.loadAsync(publicUrl(path))
}

export function loadTexture(path: string): Promise<THREE.Texture> {
  return texLoader.loadAsync(publicUrl(path))
}

export async function instantiateGltf(ref: AssetRef): Promise<THREE.Group> {
  const gltf = await loadGltf(ref.path)
  const root = gltf.scene.clone(true)
  const scale = ref.scale ?? 1
  root.scale.multiplyScalar(scale)
  return root
}
