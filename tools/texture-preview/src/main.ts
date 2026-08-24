import * as THREE from 'three'

const canvas = document.querySelector<HTMLCanvasElement>('#c')!
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
renderer.setSize(window.innerWidth, window.innerHeight)
const scene = new THREE.Scene()
scene.background = new THREE.Color(0x111111)
const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100)
camera.position.z = 2
const mat = new THREE.MeshBasicMaterial({ color: 0x666666 })
const plane = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.5), mat)
scene.add(plane)

document.querySelector<HTMLInputElement>('#file')!.addEventListener('change', (e) => {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  const url = URL.createObjectURL(file)
  const tex = new THREE.TextureLoader().load(url)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  mat.map = tex
  mat.color.set(0xffffff)
  mat.needsUpdate = true
})

function frame(): void {
  renderer.render(scene, camera)
  requestAnimationFrame(frame)
}
frame()
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
})
