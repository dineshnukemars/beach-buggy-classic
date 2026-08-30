import type { FeedbackReport } from '@studio/core'
import { parseFeedbackReport } from '@studio/core'

export type FeedbackSubmitBody = {
  report: FeedbackReport
  screenshotPngBase64: string
  poseHistoryJsonl: string
  frames?: { filename: string; jpegBase64: string }[]
}

export type FeedbackSubmitResult = { ok: true; id: string; path: string }

export async function submitFeedback(body: FeedbackSubmitBody): Promise<FeedbackSubmitResult> {
  parseFeedbackReport(body.report)
  const res = await fetch('/api/studio/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const raw: unknown = await res.json().catch(() => ({}))
  if (!res.ok) {
    const message =
      raw && typeof raw === 'object' && 'error' in raw && typeof raw.error === 'string'
        ? raw.error
        : `feedback save failed (${res.status})`
    throw new Error(message)
  }
  if (!raw || typeof raw !== 'object') throw new Error('feedback save returned empty body')
  const rec = raw as Record<string, unknown>
  if (rec.ok !== true || typeof rec.id !== 'string' || typeof rec.path !== 'string') {
    throw new Error('feedback save returned an unexpected payload')
  }
  return { ok: true, id: rec.id, path: rec.path }
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

