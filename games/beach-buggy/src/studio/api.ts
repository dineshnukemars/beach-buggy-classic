import type { SceneDocument } from '@studio/core'

export type SceneListResponse = { ok: true; scenes: string[] } | { ok: false; error: string }
export type SceneGetResponse = { ok: true; scene: SceneDocument } | { ok: false; error: string }
export type ScenePutResponse = { ok: true; id: string; path: string } | { ok: false; error: string }
export type AssetImportResponse = { ok: true; id: string; path: string } | { ok: false; error: string }

const API_UNAVAILABLE =
  'Studio API unavailable (got HTML instead of JSON). Stop other dev servers and restart with npm run dev.'

async function readJson<T>(res: Response): Promise<T> {
  const ct = res.headers.get('content-type') ?? ''
  if (!ct.includes('application/json')) {
    throw new Error(API_UNAVAILABLE)
  }
  return (await res.json()) as T
}

export async function listScenes(): Promise<string[]> {
  const res = await fetch('/api/scenes')
  const body = await readJson<SceneListResponse>(res)
  if (!body.ok) throw new Error(body.error)
  return body.scenes
}

export async function loadScene(id: string): Promise<SceneDocument> {
  const res = await fetch(`/api/scenes/${encodeURIComponent(id)}`)
  const body = await readJson<SceneGetResponse>(res)
  if (!body.ok) throw new Error(body.error)
  return body.scene
}

export async function saveScene(doc: SceneDocument): Promise<void> {
  const res = await fetch(`/api/scenes/${encodeURIComponent(doc.id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(doc),
  })
  const body = await readJson<ScenePutResponse>(res)
  if (!body.ok) throw new Error(body.error)
}

export function downloadScene(doc: SceneDocument): void {
  const blob = new Blob([`${JSON.stringify(doc, null, 2)}\n`], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${doc.id}.json`
  a.click()
  URL.revokeObjectURL(a.href)
}

export async function importAsset(file: File, id: string, kind?: string): Promise<void> {
  const form = new FormData()
  form.append('file', file)
  form.append('id', id)
  if (kind) form.append('kind', kind)
  const res = await fetch('/api/assets', { method: 'POST', body: form })
  const body = await readJson<AssetImportResponse>(res)
  if (!body.ok) throw new Error(body.error)
}
