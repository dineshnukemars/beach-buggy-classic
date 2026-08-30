import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import { scenesApiPlugin } from './scenesApi.ts'

const root = path.dirname(fileURLToPath(import.meta.url))
const gamePublic = path.resolve(root, '../../games/beach-buggy/public')
const scenesRoot = path.resolve(gamePublic, 'scenes')

export default defineConfig({
  plugins: [scenesApiPlugin(scenesRoot, gamePublic)],
  server: {
    port: 5177,
    host: true,
    fs: { allow: [path.resolve(root, '../..')] },
  },
  resolve: {
    alias: {
      '@studio/core': path.resolve(root, '../../packages/core/src/index.ts'),
      '@studio/physics': path.resolve(root, '../../packages/physics/src/index.ts'),
      '@studio/assets': path.resolve(root, '../../packages/assets/src/index.ts'),
      '@studio/three-render': path.resolve(root, '../../packages/three-render/src/index.ts'),
    },
  },
})
