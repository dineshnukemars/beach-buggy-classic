import path from 'node:path'
import { defineConfig } from 'vite'

export default defineConfig({
  server: { port: 5173, host: true },
  resolve: {
    alias: {
      '@studio/core': path.resolve(__dirname, '../../packages/core/src/index.ts'),
      '@studio/physics': path.resolve(__dirname, '../../packages/physics/src/index.ts'),
      '@studio/assets': path.resolve(__dirname, '../../packages/assets/src/index.ts'),
      '@studio/three-render': path.resolve(__dirname, '../../packages/three-render/src/index.ts'),
    },
  },
})
