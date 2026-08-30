import type { SceneDocument } from '@studio/core'

export type SceneListResponse = { ok: true; scenes: string[] } | { ok: false; error: string }
export type SceneGetResponse = { ok: true; scene: SceneDocument } | { ok: false; error: string }
export type ScenePutResponse = { ok: true; id: string; path: string } | { ok: false; error: string }

export async function listScenes(): Promise<string[]> {
  const res = await fetch('/api/scenes')
  const body = (await res.json()) as SceneListResponse
  if (!body.ok) throw new Error(body.error)
  return body.scenes
}

export async function loadScene(id: string): Promise<SceneDocument> {
  const res = await fetch(`/api/scenes/${encodeURIComponent(id)}`)
  const body = (await res.json()) as SceneGetResponse
  if (!body.ok) throw new Error(body.error)
  return body.scene
}

export async function saveScene(doc: SceneDocument): Promise<void> {
  const res = await fetch(`/api/scenes/${encodeURIComponent(doc.id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(doc),
  })
  const body = (await res.json()) as ScenePutResponse
  if (!body.ok) throw new Error(body.error)
}

export function gamePlayUrl(sceneId: string): string {
  return `http://localhost:5173/?scene=/scenes/${encodeURIComponent(sceneId)}.json`
}

export function downloadScene(doc: SceneDocument): void {
  const blob = new Blob([`${JSON.stringify(doc, null, 2)}\n`], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${doc.id}.json`
  a.click()
  URL.revokeObjectURL(a.href)
}
