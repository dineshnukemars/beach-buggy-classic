import type { AssetManifest, SceneDocument, SceneEntity, Vec3Tuple } from '@studio/core'
import { parseSceneDocument } from '@studio/core'
import { loadManifest } from '@studio/assets'
import { createDefaultBeachScene } from '@studio/physics'
import {
  cloneDoc,
  createEntity,
  ensureTrack,
  insertCenterlinePoint,
  removeCenterlinePoint,
  removeEntity,
  setCenterlinePoint,
  setHalfWidth,
  setSceneId,
  upsertEntity,
  type Selection,
} from './document'
import {
  downloadScene,
  gamePlayUrl,
  listScenes,
  loadScene,
  saveScene,
} from './api'
import {
  createPreview,
  groundHit,
  pickObject,
  rebuildEntities,
  rebuildTrack,
  resizePreview,
} from './preview'

const statusEl = document.querySelector('#status')!
const sceneIdEl = document.querySelector<HTMLInputElement>('#scene-id')!
const halfWidthEl = document.querySelector<HTMLInputElement>('#half-width')!
const halfWidthVal = document.querySelector('#half-width-val')!
const jsonEl = document.querySelector<HTMLTextAreaElement>('#json')!
const sceneListEl = document.querySelector('#scene-list')!
const paletteEl = document.querySelector('#palette')!
const entityListEl = document.querySelector('#entity-list')!
const inspectorBody = document.querySelector('#inspector-body')!
const canvas = document.querySelector<HTMLCanvasElement>('#c')!

const host = createPreview(canvas)
;(window as unknown as { __sceneEditor?: unknown }).__sceneEditor = host
let doc: SceneDocument = ensureTrack(createDefaultBeachScene())
let selection: Selection = null
let placeMode = false
let placeAssetId = 'ci-cube'
let draggingPoint: number | null = null
let dirty = false
let manifest: AssetManifest = { version: 1, assets: [] }
let suppressJson = false

function setStatus(msg: string, kind: '' | 'ok' | 'err' = ''): void {
  statusEl.textContent = msg
  statusEl.className = kind
}

function syncJson(): void {
  if (suppressJson) return
  jsonEl.value = JSON.stringify(doc, null, 2)
}

function markDirty(): void {
  dirty = true
}

function refreshPreview(): void {
  rebuildTrack(host, doc, selection)
  rebuildEntities(host, doc, selection)
  syncJson()
  renderSceneListActive()
  renderEntityList()
  renderInspector()
  sceneIdEl.value = doc.id
  if (doc.track) {
    halfWidthEl.value = String(doc.track.halfWidth)
    halfWidthVal.textContent = String(doc.track.halfWidth)
  }
}

function setDoc(next: SceneDocument, opts?: { clearSelection?: boolean }): void {
  doc = next
  if (opts?.clearSelection) selection = null
  markDirty()
  refreshPreview()
}

function renderSceneListActive(): void {
  for (const btn of sceneListEl.querySelectorAll<HTMLButtonElement>('.chip')) {
    btn.classList.toggle('active', btn.dataset.id === doc.id)
  }
}

async function refreshSceneList(): Promise<void> {
  try {
    const ids = await listScenes()
    sceneListEl.innerHTML = ''
    for (const id of ids) {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'chip'
      btn.dataset.id = id
      btn.textContent = id
      btn.classList.toggle('active', id === doc.id)
      btn.addEventListener('click', () => void openScene(id))
      sceneListEl.appendChild(btn)
    }
  } catch (err) {
    setStatus(err instanceof Error ? err.message : 'list failed', 'err')
  }
}

function renderPalette(): void {
  paletteEl.innerHTML = ''
  const assets = manifest.assets.length
    ? manifest.assets
    : [{ id: 'ci-cube', kind: 'gltf' as const, path: '' }]
  for (const asset of assets) {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'chip'
    btn.textContent = `${asset.id} (${asset.kind})`
    btn.classList.toggle('active', asset.id === placeAssetId)
    btn.addEventListener('click', () => {
      placeAssetId = asset.id
      placeMode = true
      document.querySelector('#btn-place')!.textContent = 'Place mode (on)'
      renderPalette()
      setStatus(`Place mode: ${placeAssetId}`)
    })
    paletteEl.appendChild(btn)
  }
}

function renderEntityList(): void {
  entityListEl.innerHTML = ''
  for (const entity of doc.entities) {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'chip'
    btn.textContent = `${entity.id} · ${entity.assetId}`
    btn.classList.toggle('active', selection?.kind === 'entity' && selection.id === entity.id)
    btn.addEventListener('click', () => {
      selection = { kind: 'entity', id: entity.id }
      placeMode = false
      document.querySelector('#btn-place')!.textContent = 'Place mode'
      refreshPreview()
    })
    entityListEl.appendChild(btn)
  }
}

function renderInspector(): void {
  if (selection?.kind === 'point' && doc.track) {
    const pt = doc.track.centerline[selection.index]
    if (!pt) {
      inspectorBody.innerHTML = '<p class="note">Point missing.</p>'
      return
    }
    inspectorBody.innerHTML = `
      <h2>Track point ${selection.index}</h2>
      <label>X <input id="insp-x" type="number" step="0.1" value="${pt[0]}" /></label>
      <label>Y <input id="insp-y" type="number" step="0.1" value="${pt[1]}" /></label>
      <label>Z <input id="insp-z" type="number" step="0.1" value="${pt[2]}" /></label>
    `
    const bind = (id: string, axis: 0 | 1 | 2) => {
      document.querySelector<HTMLInputElement>(id)!.addEventListener('change', (e) => {
        const v = Number((e.target as HTMLInputElement).value)
        if (!Number.isFinite(v) || !doc.track || selection?.kind !== 'point') return
        const next: Vec3Tuple = [...doc.track.centerline[selection.index]!]
        next[axis] = v
        setDoc(setCenterlinePoint(doc, selection.index, next))
      })
    }
    bind('#insp-x', 0)
    bind('#insp-y', 1)
    bind('#insp-z', 2)
    return
  }

  if (selection?.kind === 'entity') {
    const selectedId = selection.id
    const entity = doc.entities.find((e) => e.id === selectedId)
    if (!entity) {
      inspectorBody.innerHTML = '<p class="note">Entity missing.</p>'
      return
    }
    const c = entity.collider
    inspectorBody.innerHTML = `
      <h2>Entity</h2>
      <label>Id <input id="insp-id" type="text" value="${entity.id}" /></label>
      <label>Asset <input id="insp-asset" type="text" value="${entity.assetId}" /></label>
      <label>Pos X <input id="insp-px" type="number" step="0.1" value="${entity.position[0]}" /></label>
      <label>Pos Y <input id="insp-py" type="number" step="0.1" value="${entity.position[1]}" /></label>
      <label>Pos Z <input id="insp-pz" type="number" step="0.1" value="${entity.position[2]}" /></label>
      <label>Rotation Y <input id="insp-ry" type="number" step="0.01" value="${entity.rotationY}" /></label>
      <label>Scale <input id="insp-scale" type="number" step="0.05" min="0.05" value="${entity.scale}" /></label>
      <h2>Box collider</h2>
      <p class="note">Physics only in track mode (not sandbox). Rotation does not rotate the Rapier collider yet.</p>
      <label><span><input id="insp-col" type="checkbox" ${c ? 'checked' : ''} /> Enabled</span></label>
      <label>Half X <input id="insp-hx" type="number" step="0.05" min="0.05" value="${c?.halfExtents[0] ?? 0.5}" /></label>
      <label>Half Y <input id="insp-hy" type="number" step="0.05" min="0.05" value="${c?.halfExtents[1] ?? 0.5}" /></label>
      <label>Half Z <input id="insp-hz" type="number" step="0.05" min="0.05" value="${c?.halfExtents[2] ?? 0.5}" /></label>
      <div class="row" style="margin-top:8px">
        <button id="insp-mode-t" type="button">Translate</button>
        <button id="insp-mode-r" type="button">Rotate</button>
        <button id="insp-mode-s" type="button">Scale</button>
      </div>
    `
    const readEntity = (): SceneEntity | null => {
      const id = document.querySelector<HTMLInputElement>('#insp-id')!.value.trim()
      const assetId = document.querySelector<HTMLInputElement>('#insp-asset')!.value.trim()
      const px = Number(document.querySelector<HTMLInputElement>('#insp-px')!.value)
      const py = Number(document.querySelector<HTMLInputElement>('#insp-py')!.value)
      const pz = Number(document.querySelector<HTMLInputElement>('#insp-pz')!.value)
      const ry = Number(document.querySelector<HTMLInputElement>('#insp-ry')!.value)
      const scale = Number(document.querySelector<HTMLInputElement>('#insp-scale')!.value)
      const enabled = document.querySelector<HTMLInputElement>('#insp-col')!.checked
      const hx = Number(document.querySelector<HTMLInputElement>('#insp-hx')!.value)
      const hy = Number(document.querySelector<HTMLInputElement>('#insp-hy')!.value)
      const hz = Number(document.querySelector<HTMLInputElement>('#insp-hz')!.value)
      if (!id || !assetId) return null
      if (![px, py, pz, ry, scale].every(Number.isFinite) || scale <= 0) return null
      const next: SceneEntity = {
        id,
        assetId,
        position: [px, py, pz],
        rotationY: ry,
        scale,
      }
      if (enabled && [hx, hy, hz].every((n) => Number.isFinite(n) && n > 0)) {
        next.collider = { type: 'box', halfExtents: [hx, hy, hz] }
      }
      return next
    }
    const applyEntityFields = () => {
      const next = readEntity()
      if (!next || selection?.kind !== 'entity') return
      let updated = removeEntity(doc, selection.id)
      updated = upsertEntity(updated, next)
      selection = { kind: 'entity', id: next.id }
      setDoc(updated)
    }
    for (const id of [
      '#insp-id',
      '#insp-asset',
      '#insp-px',
      '#insp-py',
      '#insp-pz',
      '#insp-ry',
      '#insp-scale',
      '#insp-hx',
      '#insp-hy',
      '#insp-hz',
      '#insp-col',
    ]) {
      document.querySelector(id)!.addEventListener('change', applyEntityFields)
    }
    document.querySelector('#insp-mode-t')!.addEventListener('click', () => host.transform.setMode('translate'))
    document.querySelector('#insp-mode-r')!.addEventListener('click', () => {
      host.transform.setMode('rotate')
      host.transform.showX = false
      host.transform.showZ = false
      host.transform.showY = true
    })
    document.querySelector('#insp-mode-s')!.addEventListener('click', () => host.transform.setMode('scale'))
    return
  }

  inspectorBody.innerHTML = '<p class="note">Select a track point or entity.</p>'
}

async function openScene(id: string): Promise<void> {
  try {
    const loaded = ensureTrack(await loadScene(id))
    doc = loaded
    selection = null
    dirty = false
    refreshPreview()
    setStatus(`Loaded ${id}`, 'ok')
  } catch (err) {
    setStatus(err instanceof Error ? err.message : 'load failed', 'err')
  }
}

async function doSave(): Promise<boolean> {
  try {
    doc = setSceneId(parseSceneDocument(doc), sceneIdEl.value)
    await saveScene(doc)
    dirty = false
    await refreshSceneList()
    setStatus(`Saved scenes/${doc.id}.json`, 'ok')
    refreshPreview()
    return true
  } catch (err) {
    setStatus(err instanceof Error ? err.message : 'save failed', 'err')
    return false
  }
}

document.querySelector('#btn-save')!.addEventListener('click', () => void doSave())
document.querySelector('#btn-download')!.addEventListener('click', () => {
  try {
    downloadScene(parseSceneDocument(doc))
    setStatus('Downloaded JSON', 'ok')
  } catch (err) {
    setStatus(err instanceof Error ? err.message : 'download failed', 'err')
  }
})
document.querySelector('#btn-reload')!.addEventListener('click', () => void refreshSceneList())
document.querySelector('#btn-play')!.addEventListener('click', async () => {
  const ok = dirty ? await doSave() : true
  if (!ok) return
  window.open(gamePlayUrl(doc.id), '_blank')
  setStatus('Opened game (needs npm run dev:game on :5173)', 'ok')
})
document.querySelector('#btn-apply-json')!.addEventListener('click', () => {
  try {
    suppressJson = true
    doc = ensureTrack(parseSceneDocument(JSON.parse(jsonEl.value)))
    selection = null
    markDirty()
    refreshPreview()
    setStatus('Applied JSON', 'ok')
  } catch (err) {
    setStatus(err instanceof Error ? err.message : 'invalid JSON', 'err')
  } finally {
    suppressJson = false
    syncJson()
  }
})
document.querySelector('#btn-add-point')!.addEventListener('click', () => {
  try {
    const after = selection?.kind === 'point' ? selection.index : (doc.track?.centerline.length ?? 1) - 1
    const next = insertCenterlinePoint(doc, Math.max(0, after))
    selection = { kind: 'point', index: after + 1 }
    setDoc(next)
    setStatus('Inserted centerline point', 'ok')
  } catch (err) {
    setStatus(err instanceof Error ? err.message : 'add point failed', 'err')
  }
})
document.querySelector('#btn-del-point')!.addEventListener('click', () => {
  if (selection?.kind !== 'point') {
    setStatus('Select a track point first', 'err')
    return
  }
  try {
    const idx = selection.index
    const next = removeCenterlinePoint(doc, idx)
    selection = next.track && next.track.centerline.length ? { kind: 'point', index: Math.min(idx, next.track.centerline.length - 1) } : null
    setDoc(next)
    setStatus('Deleted centerline point', 'ok')
  } catch (err) {
    setStatus(err instanceof Error ? err.message : 'delete failed', 'err')
  }
})
document.querySelector('#btn-place')!.addEventListener('click', () => {
  placeMode = !placeMode
  document.querySelector('#btn-place')!.textContent = placeMode ? 'Place mode (on)' : 'Place mode'
  if (placeMode) {
    selection = null
    host.transform.detach()
    setStatus(`Place mode: ${placeAssetId}`)
  } else {
    setStatus('Place mode off')
  }
  refreshPreview()
})
document.querySelector('#btn-del-entity')!.addEventListener('click', () => {
  if (selection?.kind !== 'entity') {
    setStatus('Select an entity first', 'err')
    return
  }
  setDoc(removeEntity(doc, selection.id), { clearSelection: true })
  setStatus('Deleted entity', 'ok')
})
halfWidthEl.addEventListener('input', () => {
  const v = Number(halfWidthEl.value)
  halfWidthVal.textContent = String(v)
  setDoc(setHalfWidth(doc, v))
})
sceneIdEl.addEventListener('change', () => {
  setDoc(setSceneId(doc, sceneIdEl.value))
})

function commitEntityFromObject(id: string): void {
  const entity = doc.entities.find((e) => e.id === id)
  const obj = host.entityMeshes.get(id)
  if (!entity || !obj) return
  const mode = host.transform.getMode()
  const scale = mode === 'scale' ? (obj.scale.x + obj.scale.y + obj.scale.z) / 3 : entity.scale
  if (mode === 'scale') obj.scale.setScalar(scale)
  const next: SceneEntity = {
    ...entity,
    position: [obj.position.x, obj.position.y, obj.position.z],
    rotationY: obj.rotation.y,
    scale,
  }
  doc = upsertEntity(doc, next)
  markDirty()
  syncJson()
  rebuildEntities(host, doc, selection)
}

host.transform.addEventListener('objectChange', () => {
  if (selection?.kind !== 'entity') return
  commitEntityFromObject(selection.id)
})

canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return
  if (host.transform.dragging) return
  if (placeMode) {
    const hit = groundHit(host, e.clientX, e.clientY)
    if (!hit) return
    const entity = createEntity(doc, placeAssetId, [hit.x, Math.max(0.5, hit.y + 0.5), hit.z])
    selection = { kind: 'entity', id: entity.id }
    placeMode = false
    document.querySelector('#btn-place')!.textContent = 'Place mode'
    setDoc(upsertEntity(doc, entity))
    setStatus(`Placed ${entity.id}`, 'ok')
    return
  }
  const picked = pickObject(host, e.clientX, e.clientY)
  if (!picked) return
  if (typeof picked.userData.pointIndex === 'number') {
    selection = { kind: 'point', index: picked.userData.pointIndex }
    draggingPoint = selection.index
    host.orbit.enabled = false
    refreshPreview()
    e.preventDefault()
    return
  }
  const ref = picked.userData.studioRef
  if (ref?.kind === 'entity') {
    selection = { kind: 'entity', id: ref.id }
    refreshPreview()
  }
})

canvas.addEventListener('pointermove', (e) => {
  if (draggingPoint === null) return
  const hit = groundHit(host, e.clientX, e.clientY)
  if (!hit || !doc.track) return
  const prev = doc.track.centerline[draggingPoint]!
  const nextPt: Vec3Tuple = [hit.x, prev[1], hit.z]
  doc = setCenterlinePoint(doc, draggingPoint, nextPt)
  markDirty()
  const mesh = host.pointMeshes[draggingPoint]
  if (mesh) mesh.position.set(nextPt[0], nextPt[1] + 0.4, nextPt[2])
  rebuildTrack(host, doc, selection)
  syncJson()
  renderInspector()
})

function endPointDrag(): void {
  if (draggingPoint === null) return
  draggingPoint = null
  host.orbit.enabled = true
  refreshPreview()
}

canvas.addEventListener('pointerup', endPointDrag)
canvas.addEventListener('pointercancel', endPointDrag)
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    placeMode = false
    document.querySelector('#btn-place')!.textContent = 'Place mode'
    selection = null
    refreshPreview()
  }
})

function frame(): void {
  host.orbit.update()
  host.renderer.render(host.scene, host.camera)
  requestAnimationFrame(frame)
}

async function boot(): Promise<void> {
  resizePreview(host)
  window.addEventListener('resize', () => resizePreview(host))
  try {
    manifest = await loadManifest('/assets/manifest.json')
  } catch {
    manifest = { version: 1, assets: [] }
  }
  renderPalette()
  await refreshSceneList()
  let loaded = false
  for (const id of ['beach-default', 'default'] as const) {
    try {
      doc = ensureTrack(await loadScene(id))
      dirty = false
      loaded = true
      setStatus(`Loaded ${id}`, 'ok')
      break
    } catch {
      /* try next */
    }
  }
  if (!loaded) {
    doc = ensureTrack(createDefaultBeachScene())
    setStatus('Using procedural default beach scene')
  }
  refreshPreview()
  frame()
}

void boot()
