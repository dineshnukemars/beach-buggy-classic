import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const FEEDBACK_ID = /^[A-Za-z0-9._-]+$/
const FRAME_NAME = /^[0-9]{2}\.jpe?g$/

export type FeedbackWriteBody = {
  report: unknown
  screenshotPngBase64: string
  poseHistoryJsonl: string
  frames?: { filename: string; jpegBase64: string }[]
}

export function writeFeedbackBundle(
  feedbackRoot: string,
  body: FeedbackWriteBody,
): { id: string; path: string } {
  if (typeof body.screenshotPngBase64 !== 'string' || !body.screenshotPngBase64) {
    throw new Error('screenshotPngBase64 required')
  }
  if (typeof body.poseHistoryJsonl !== 'string') throw new Error('poseHistoryJsonl required')
  if (!body.report || typeof body.report !== 'object') throw new Error('report must be an object')
  const rec = body.report as Record<string, unknown>
  if (typeof rec.id !== 'string' || !FEEDBACK_ID.test(rec.id)) {
    throw new Error('report.id must match [A-Za-z0-9._-]+')
  }
  const dir = join(feedbackRoot, rec.id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'report.json'), JSON.stringify(body.report, null, 2) + '\n')
  writeFileSync(join(dir, 'screenshot.png'), decodeBase64(body.screenshotPngBase64))
  const jsonl = body.poseHistoryJsonl.endsWith('\n') ? body.poseHistoryJsonl : `${body.poseHistoryJsonl}\n`
  writeFileSync(join(dir, 'pose-history.jsonl'), jsonl)
  if (body.frames?.length) {
    const framesDir = join(dir, 'frames')
    mkdirSync(framesDir, { recursive: true })
    for (const frame of body.frames) {
      if (!FRAME_NAME.test(frame.filename)) throw new Error(`invalid frame name: ${frame.filename}`)
      writeFileSync(join(framesDir, frame.filename), decodeBase64(frame.jpegBase64))
    }
  }
  return { id: rec.id, path: `games/beach-buggy/feedback/${rec.id}` }
}

function decodeBase64(value: string): Buffer {
  const payload = value.includes(',') ? value.slice(value.indexOf(',') + 1) : value
  return Buffer.from(payload, 'base64')
}
