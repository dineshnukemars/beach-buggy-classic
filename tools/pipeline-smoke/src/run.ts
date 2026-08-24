import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseSceneDocument } from '@studio/core'
import { importFile, studioRoot } from '@studio/import-cli'
import { World, createDefaultBeachScene } from '@studio/physics'
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
  position: [0, 1, 0],
  rotationY: 0,
  scale: 2,
})
parseSceneDocument(scene)
const sceneDir = join(root, 'games/beach-buggy/public/scenes')
mkdirSync(sceneDir, { recursive: true })
writeFileSync(join(sceneDir, 'pipeline.json'), JSON.stringify(scene, null, 2) + '\n')
writeFileSync(join(sceneDir, 'default.json'), JSON.stringify(createDefaultBeachScene(), null, 2) + '\n')

const world = new World(1, { scene })
for (let i = 0; i < 60; i++) {
  world.step(1 / 30, [{ throttle: 1, steer: 0, brake: 0, boost: false }])
}
const p = world.bodies[0].position
if (![p.x, p.y, p.z].every(Number.isFinite)) {
  throw new Error('physics produced non-finite position')
}
console.log('physics ok', { x: p.x, speed: world.bodies[0].speed })

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
await browser.close()
await vite.close()

console.log('game boot ok')

async function assertHttp(port: number, folder: string): Promise<void> {
  const dir = join(root, 'tools', folder)
  const child = spawn(
    process.execPath,
    [join(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] },
  )
  const ready = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${folder} vite timeout`)), 20000)
    const onData = (buf: Buffer) => {
      const s = buf.toString()
      if (s.includes('Local:') || s.includes('localhost')) {
        clearTimeout(timer)
        resolve()
      }
    }
    child.stdout?.on('data', onData)
    child.stderr?.on('data', onData)
    child.on('exit', (code) => {
      if (code && code !== 0) reject(new Error(`${folder} vite exited ${code}`))
    })
  })
  await ready
  const res = await fetch(`http://127.0.0.1:${port}/`)
  if (!res.ok) throw new Error(`${folder} HTTP ${res.status}`)
  console.log(`${folder} http ${res.status}`)
  child.kill('SIGTERM')
  await new Promise((r) => setTimeout(r, 300))
}

await assertHttp(5274, 'gltf-preview')
await assertHttp(5275, 'texture-preview')
await assertHttp(5276, 'animation-preview')
await assertHttp(5277, 'scene-editor')

console.log('pipeline-smoke passed')
