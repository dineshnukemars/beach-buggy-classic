import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'

type AssetKind = 'gltf' | 'texture' | 'audio'

const MAX_BODY_BYTES = 40 * 1024 * 1024
const ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/

export function assetsApiPlugin(gameRoot: string): Plugin {
  return {
    name: 'studio-assets-api',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split('?')[0] ?? ''
        if (url !== '/api/assets') {
          next()
          return
        }
        void handleAssetsApi(req, res, gameRoot)
      })
    },
  }
}

async function handleAssetsApi(req: IncomingMessage, res: ServerResponse, gameRoot: string): Promise<void> {
  try {
    if (req.method !== 'POST') {
      json(res, 405, { ok: false, error: 'method not allowed' })
      return
    }
    const contentType = req.headers['content-type'] ?? ''
    if (contentType.includes('multipart/form-data')) {
      await handleMultipart(req, res, gameRoot)
      return
    }
    await handleRawBody(req, res, gameRoot)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'assets api failed'
    json(res, 400, { ok: false, error: message })
  }
}

async function handleMultipart(req: IncomingMessage, res: ServerResponse, gameRoot: string): Promise<void> {
  const boundary = parseBoundary(req.headers['content-type'] ?? '')
  if (!boundary) throw new Error('missing multipart boundary')
  const buf = await readBinaryBody(req, MAX_BODY_BYTES)
  const { file, id, kind, filename } = parseMultipart(buf, boundary)
  if (!file.length) throw new Error('no file in upload')
  if (!id || !ID_PATTERN.test(id)) throw new Error('id must be alphanumeric with optional -/_ (max 64)')
  const ext = path.extname(filename) || inferExt(kind)
  const tmp = path.join(os.tmpdir(), `studio-import-${Date.now()}${ext}`)
  fs.writeFileSync(tmp, file)
  try {
    const assetKind = kind ?? inferKindFromExt(ext)
    await importAssetFile(gameRoot, tmp, id, assetKind)
    json(res, 200, { ok: true, id, path: `assets/${id}${ext}` })
  } finally {
    try {
      fs.unlinkSync(tmp)
    } catch {
      /* ignore */
    }
  }
}

async function handleRawBody(req: IncomingMessage, res: ServerResponse, gameRoot: string): Promise<void> {
  const url = new URL(req.url ?? '', 'http://localhost')
  const id = url.searchParams.get('id')
  const kindParam = url.searchParams.get('kind') as AssetKind | null
  const filename = url.searchParams.get('filename') ?? 'upload.bin'
  if (!id || !ID_PATTERN.test(id)) throw new Error('id query param required')
  const ext = path.extname(filename) || inferExt(kindParam)
  const buf = await readBinaryBody(req, MAX_BODY_BYTES)
  if (!buf.length) throw new Error('empty body')
  const tmp = path.join(os.tmpdir(), `studio-import-${Date.now()}${ext}`)
  fs.writeFileSync(tmp, buf)
  try {
    const assetKind = kindParam ?? inferKindFromExt(ext)
    await importAssetFile(gameRoot, tmp, id, assetKind)
    json(res, 200, { ok: true, id, path: `assets/${id}${ext}` })
  } finally {
    try {
      fs.unlinkSync(tmp)
    } catch {
      /* ignore */
    }
  }
}

async function importAssetFile(gameRoot: string, src: string, id: string, kind: AssetKind): Promise<void> {
  const { validateAssetFile } = await import('../../tools/import-cli/src/validate.ts')
  validateAssetFile(src, kind)
  const assetsDir = path.join(gameRoot, 'public', 'assets')
  fs.mkdirSync(assetsDir, { recursive: true })
  const ext = path.extname(src) || (kind === 'gltf' ? '.glb' : '.png')
  const destName = `${id}${ext}`
  const dest = path.join(assetsDir, destName)
  fs.copyFileSync(src, dest)
  const manifestPath = path.join(assetsDir, 'manifest.json')
  let manifest: { version: 1; assets: { id: string; kind: AssetKind; path: string; scale: number }[] } = {
    version: 1,
    assets: [],
  }
  if (fs.existsSync(manifestPath)) {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as typeof manifest
  }
  const rel = `assets/${destName}`
  manifest.assets = [...manifest.assets.filter((a) => a.id !== id), { id, kind, path: rel, scale: 1 }]
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
}

function parseBoundary(contentType: string): string | null {
  const m = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i)
  return m ? (m[1] ?? m[2] ?? null) : null
}

function parseMultipart(
  buf: Buffer,
  boundary: string,
): { file: Buffer; id: string; kind?: AssetKind; filename: string } {
  const marker = `--${boundary}`
  const parts = buf.toString('binary').split(marker).slice(1, -1)
  let file = Buffer.alloc(0)
  let id = ''
  let kind: AssetKind | undefined
  let filename = 'upload.bin'
  for (const part of parts) {
    const headerEnd = part.indexOf('\r\n\r\n')
    if (headerEnd < 0) continue
    const headers = part.slice(0, headerEnd)
    const body = part.slice(headerEnd + 4, part.endsWith('\r\n') ? part.length - 2 : part.length)
    const nameMatch = headers.match(/name="([^"]+)"/)
    const filenameMatch = headers.match(/filename="([^"]+)"/)
    const name = nameMatch?.[1]
    if (name === 'file' && filenameMatch) {
      filename = filenameMatch[1]!
      file = Buffer.from(body, 'binary')
    } else if (name === 'id') {
      id = Buffer.from(body, 'binary').toString('utf8').trim()
    } else if (name === 'kind') {
      const k = Buffer.from(body, 'binary').toString('utf8').trim()
      if (k === 'gltf' || k === 'texture' || k === 'audio') kind = k
    }
  }
  return { file, id, kind, filename }
}

function inferKindFromExt(ext: string): AssetKind {
  const e = ext.toLowerCase()
  if (e === '.gltf' || e === '.glb') return 'gltf'
  if (e === '.png' || e === '.jpg' || e === '.jpeg' || e === '.webp') return 'texture'
  if (e === '.mp3' || e === '.ogg' || e === '.wav') return 'audio'
  throw new Error(`Unknown asset kind for ${ext}`)
}

function inferExt(kind: AssetKind | null | undefined): string {
  if (kind === 'gltf') return '.glb'
  if (kind === 'texture') return '.png'
  if (kind === 'audio') return '.mp3'
  return '.bin'
}

function readBinaryBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
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
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}
