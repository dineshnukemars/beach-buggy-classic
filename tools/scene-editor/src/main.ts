import { parseSceneDocument, type SceneDocument } from '@studio/core'
import { createDefaultBeachScene, samplesFromSpec, trackLength } from '@studio/physics'
import { createStudioLights, placeEntities } from '@studio/three-render'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

const textarea = document.querySelector<HTMLTextAreaElement>('#json')!
const canvas = document.querySelector<HTMLCanvasElement>('#c')!
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
const scene = new THREE.Scene()
scene.background = new THREE.Color(0x7ec8ff)
createStudioLights(scene)
const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 400)
camera.position.set(0, 80, 80)
const controls = new OrbitControls(camera, canvas)
const entityMeshes = new Map<string, THREE.Object3D>()
let trackObj: THREE.Object3D | undefined

textarea.value = JSON.stringify(createDefaultBeachScene(), null, 2)

function resize(): void {
  const w = canvas.clientWidth || window.innerWidth - 380
  const h = window.innerHeight
  renderer.setSize(w, h, false)
  camera.aspect = w / h
  camera.updateProjectionMatrix()
}

function drawTrack(doc: SceneDocument): void {
  if (trackObj) scene.remove(trackObj)
  if (!doc.track) return
  const samples = samplesFromSpec(doc.track)
  const len = trackLength(samples)
  void len
  const pts = samples.map((s) => s.position)
  pts.push(pts[0].clone())
  const geo = new THREE.BufferGeometry().setFromPoints(pts)
  trackObj = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffffff }))
  scene.add(trackObj)
}

function apply(): void {
  const doc = parseSceneDocument(JSON.parse(textarea.value))
  drawTrack(doc)
  placeEntities(scene, doc, entityMeshes)
}

document.querySelector('#apply')!.addEventListener('click', apply)
document.querySelector('#download')!.addEventListener('click', () => {
  const blob = new Blob([textarea.value], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = 'scene.json'
  a.click()
})
document.querySelector<HTMLInputElement>('#load')!.addEventListener('change', async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  textarea.value = await file.text()
  apply()
})

apply()
resize()
function frame(): void {
  controls.update()
  renderer.render(scene, camera)
  requestAnimationFrame(frame)
}
frame()
window.addEventListener('resize', resize)
