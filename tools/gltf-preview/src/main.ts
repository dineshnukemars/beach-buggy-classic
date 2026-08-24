import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

const canvas = document.querySelector<HTMLCanvasElement>('#c')!
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
renderer.setSize(window.innerWidth, window.innerHeight)
const scene = new THREE.Scene()
scene.background = new THREE.Color(0x223344)
scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1))
const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 200)
camera.position.set(3, 2, 5)
const controls = new OrbitControls(camera, canvas)
const loader = new GLTFLoader()
let model: THREE.Object3D | undefined

document.querySelector<HTMLInputElement>('#file')!.addEventListener('change', async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  const url = URL.createObjectURL(file)
  const gltf = await loader.loadAsync(url)
  if (model) scene.remove(model)
  model = gltf.scene
  scene.add(model)
})

function frame(): void {
  controls.update()
  renderer.render(scene, camera)
  requestAnimationFrame(frame)
}
frame()
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
})
