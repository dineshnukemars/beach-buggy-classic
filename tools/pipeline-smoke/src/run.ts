import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseSceneDocument } from '@studio/core'
import { importFile, studioRoot } from '@studio/import-cli'
import { World, createDefaultBeachScene, FIXED_TIMESTEP } from '@studio/physics'
import { chromium } from '@playwright/test'
import { createServer as createVite } from 'vite'
import { writeFixtures } from './fixtures.ts'

const root = studioRoot(fileURLToPath(new URL('.', import.meta.url)))
const tmp = join(root, 'tools/pipeline-smoke/.tmp')
const { gltf, png } = writeFixtures(tmp)

importFile({ file: gltf, game: 'beach-buggy', id: 'ci-cube', kind: 'gltf', ci: true, root })
importFile({ file: png, game: 'beach-buggy', id: 'ci-sand', kind: 'texture', ci: true, root })

const scene = createDefaultBeachScene()
scene.id = 'pipeline'
scene.entities.push({
  id: 'ci-prop',
  assetId: 'ci-cube',
  position: [20, 1, 20],
  rotationY: 0,
  scale: 2,
  collider: { type: 'box', halfExtents: [1, 1, 1] },
})
parseSceneDocument(scene)
const sceneDir = join(root, 'games/beach-buggy/public/scenes')
mkdirSync(sceneDir, { recursive: true })
writeFileSync(join(sceneDir, 'pipeline.json'), JSON.stringify(scene, null, 2) + '\n')

const world = await World.create(1, { scene, backend: 'rapier' })
const start = world.bodies[0].position.clone()
for (let i = 0; i < 120; i++) {
  world.step(FIXED_TIMESTEP, [{ throttle: 1, steer: 0, brake: 0, boost: false }])
}
const p = world.bodies[0].position
if (![p.x, p.y, p.z].every(Number.isFinite)) {
  throw new Error('physics produced non-finite position')
}
if (p.distanceTo(start) < 1) {
  throw new Error('physics did not move the vehicle forward')
}
console.log('physics ok', { distance: p.distanceTo(start), speed: world.bodies[0].speed })
world.dispose()

const gameRoot = join(root, 'games/beach-buggy')
const vite = await createVite({
  root: gameRoot,
  configFile: join(gameRoot, 'vite.config.ts'),
  server: { port: 5190, host: '127.0.0.1', strictPort: true },
})
await vite.listen()

const errors: string[] = []
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()
page.on('pageerror', (err) => errors.push(String(err)))
page.on('console', (msg) => {
  if (msg.type() === 'error') {
    const t = msg.text()
    if (/favicon|sourcemap/i.test(t)) return
    errors.push(t)
  }
})
await page.goto('http://127.0.0.1:5190/?scene=/scenes/pipeline.json', { waitUntil: 'networkidle' })
await page.waitForSelector('canvas#game', { timeout: 15000 })
await page.waitForTimeout(3000)
if (errors.length) throw new Error(errors.join('\n'))
await browser.close()
await vite.close()

console.log('game boot ok')
console.log('pipeline-smoke passed')
