import fs from 'node:fs'
import path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import { parseSceneDocument } from '../../packages/core/src/scene.ts'

const MAX_BODY_BYTES = 4 * 1024 * 1024
const ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/

export function sanitizeSceneId(id: string): string {
  const trimmed = id.trim()
  if (!ID_PATTERN.test(trimmed)) {
    throw new Error('scene id must be alphanumeric with optional -/_ (max 64)')
  }
  return trimmed
}

export function scenesApiPlugin(scenesRoot: string): Plugin {
  return {
    name: 'studio-scenes-api',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split('?')[0] ?? ''
        if (!url.startsWith('/api/scenes')) {
          next()
          return
        }
        void handleScenesApi(req, res, scenesRoot, url)
      })
    },
  }
}

async function handleScenesApi(
  req: IncomingMessage,
  res: ServerResponse,
  scenesRoot: string,
  url: string,
): Promise<void> {
  try {
    fs.mkdirSync(scenesRoot, { recursive: true })
    if (req.method === 'GET' && url === '/api/scenes') {
      const ids = fs
        .readdirSync(scenesRoot)
        .filter((f) => f.endsWith('.json'))
        .map((f) => f.replace(/\.json$/, ''))
        .sort()
      json(res, 200, { ok: true, scenes: ids })
      return
    }

    const match = url.match(/^\/api\/scenes\/([^/]+)$/)
    if (!match) {
      json(res, 404, { ok: false, error: 'not found' })
      return
    }
    const id = sanitizeSceneId(decodeURIComponent(match[1]!))
    const file = path.join(scenesRoot, `${id}.json`)

    if (req.method === 'GET') {
      if (!fs.existsSync(file)) {
        json(res, 404, { ok: false, error: `scene '${id}' not found` })
        return
      }
      const doc = parseSceneDocument(JSON.parse(fs.readFileSync(file, 'utf8')))
      json(res, 200, { ok: true, scene: doc })
      return
    }

    if (req.method === 'PUT') {
      const raw = await readBody(req, MAX_BODY_BYTES)
      const parsed: unknown = JSON.parse(raw)
      const doc = parseSceneDocument(parsed)
      if (doc.id !== id) {
        throw new Error(`body.id '${doc.id}' must match path id '${id}'`)
      }
      fs.writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`, 'utf8')
      json(res, 200, { ok: true, id, path: `scenes/${id}.json` })
      return
    }

    json(res, 405, { ok: false, error: 'method not allowed' })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'scenes api failed'
    json(res, 400, { ok: false, error: message })
  }
}

function readBody(req: IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > maxBytes) {
        reject(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}
