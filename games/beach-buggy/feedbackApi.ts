import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import { writeFeedbackBundle } from './feedbackWrite.ts'

const MAX_BODY_BYTES = 16 * 1024 * 1024

export { writeFeedbackBundle } from './feedbackWrite.ts'

export function feedbackApiPlugin(feedbackRoot: string): Plugin {
  return {
    name: 'studio-feedback-api',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split('?')[0]
        if (req.method !== 'POST' || url !== '/api/studio/feedback') {
          next()
          return
        }
        void handleFeedbackPost(req, res, feedbackRoot)
      })
    },
  }
}

async function handleFeedbackPost(req: IncomingMessage, res: ServerResponse, feedbackRoot: string): Promise<void> {
  try {
    const raw = await readBody(req, MAX_BODY_BYTES)
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') throw new Error('body must be a JSON object')
    const rec = parsed as Record<string, unknown>
    const frames = rec.frames
    const written = writeFeedbackBundle(feedbackRoot, {
      report: rec.report,
      screenshotPngBase64: String(rec.screenshotPngBase64 ?? ''),
      poseHistoryJsonl: String(rec.poseHistoryJsonl ?? ''),
      frames: Array.isArray(frames) ? frames.map(parseFrame) : undefined,
    })
    json(res, 200, { ok: true, id: written.id, path: written.path })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'feedback write failed'
    json(res, 400, { ok: false, error: message })
  }
}

function parseFrame(raw: unknown): { filename: string; jpegBase64: string } {
  if (!raw || typeof raw !== 'object') throw new Error('frame must be an object')
  const rec = raw as Record<string, unknown>
  if (typeof rec.filename !== 'string' || typeof rec.jpegBase64 !== 'string') {
    throw new Error('frame needs filename and jpegBase64')
  }
  return { filename: rec.filename, jpegBase64: rec.jpegBase64 }
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
