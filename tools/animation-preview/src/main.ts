import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

const canvas = document.querySelector<HTMLCanvasElement>('#c')!
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
renderer.setSize(window.innerWidth, window.innerHeight)
const scene = new THREE.Scene()
scene.background = new THREE.Color(0x1b2430)
scene.add(new THREE.HemisphereLight(0xffffff, 0x333333, 1))
const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 200)
camera.position.set(3, 2, 5)
const controls = new OrbitControls(camera, canvas)
const loader = new GLTFLoader()
const clock = new THREE.Clock()
let mixer: THREE.AnimationMixer | undefined
let actions: THREE.AnimationAction[] = []

const select = document.querySelector<HTMLSelectElement>('#clips')!

document.querySelector<HTMLInputElement>('#file')!.addEventListener('change', async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  const gltf = await loader.loadAsync(URL.createObjectURL(file))
  scene.clear()
  scene.add(new THREE.HemisphereLight(0xffffff, 0x333333, 1))
  scene.add(gltf.scene)
  mixer = new THREE.AnimationMixer(gltf.scene)
  actions = gltf.animations.map((clip) => mixer!.clipAction(clip))
  select.innerHTML = gltf.animations.map((c, i) => `<option value="${i}">${c.name || 'clip ' + i}</option>`).join('')
})

document.querySelector('#play')!.addEventListener('click', () => {
  const i = Number(select.value)
  actions.forEach((a) => a.stop())
  actions[i]?.reset().play()
})

function frame(): void {
  const dt = clock.getDelta()
  mixer?.update(dt)
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
