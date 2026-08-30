import * as THREE from 'three'

const canvas = document.querySelector<HTMLCanvasElement>('#c')!
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
renderer.setSize(window.innerWidth, window.innerHeight)
const scene = new THREE.Scene()
scene.background = new THREE.Color(0x111111)
const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100)
camera.position.z = 2
const mat = new THREE.MeshBasicMaterial({ color: 0xffffff })
const plane = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.5), mat)
scene.add(plane)

const loader = new THREE.TextureLoader()

function applyTexture(url: string): void {
  loader.load(url, (tex) => {
    tex.colorSpace = THREE.SRGBColorSpace
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping
    tex.repeat.set(2, 2)
    mat.map = tex
    mat.needsUpdate = true
  })
}

function setActive(src: string | null): void {
  document.querySelectorAll<HTMLButtonElement>('#ui button[data-src]').forEach((b) => {
    b.classList.toggle('active', b.dataset.src === src)
  })
}

document.querySelectorAll<HTMLButtonElement>('#ui button[data-src]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const src = btn.dataset.src
    if (!src) return
    applyTexture(src)
    setActive(src)
  })
})

document.querySelector<HTMLInputElement>('#file')!.addEventListener('change', (e) => {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  applyTexture(URL.createObjectURL(file))
  setActive(null)
})

applyTexture('/samples/sand.png')
setActive('/samples/sand.png')

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
