import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

const canvas = document.querySelector<HTMLCanvasElement>('#c')!
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.05

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x87b8d4)
scene.add(new THREE.HemisphereLight(0xe8f4ff, 0x445566, 0.9))
const sun = new THREE.DirectionalLight(0xfff5e6, 1.4)
sun.position.set(8, 12, 6)
scene.add(sun)
scene.add(new THREE.AmbientLight(0xffffff, 0.25))

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 5000)
camera.position.set(40, 18, 50)
const controls = new OrbitControls(camera, canvas)
controls.enableDamping = true

const loader = new GLTFLoader()
let model: THREE.Object3D | undefined

function frameModel(root: THREE.Object3D): void {
  const box = new THREE.Box3().setFromObject(root)
  const size = box.getSize(new THREE.Vector3()).length()
  const center = box.getCenter(new THREE.Vector3())
  controls.target.copy(center)
  camera.near = Math.max(size / 200, 0.05)
  camera.far = size * 20
  camera.updateProjectionMatrix()
  camera.position.copy(center).add(new THREE.Vector3(size * 0.55, size * 0.28, size * 0.7))
  controls.update()
}

async function showGltf(url: string): Promise<void> {
  const gltf = await loader.loadAsync(url)
  if (model) scene.remove(model)
  model = gltf.scene
  scene.add(model)
  frameModel(model)
}

document.querySelector('#dc8')!.addEventListener('click', () => {
  document.querySelector('#dc8')!.classList.add('active')
  void showGltf('/samples/nasa-dc8.glb')
})

document.querySelector<HTMLInputElement>('#file')!.addEventListener('change', async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  document.querySelector('#dc8')!.classList.remove('active')
  await showGltf(URL.createObjectURL(file))
})

void showGltf('/samples/nasa-dc8.glb')

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
