import type { AssetManifest, SceneEntity, Vec3Tuple } from '@studio/core'
import {
  ensureTrack,
  insertCenterlinePoint,
  parseSceneDocument,
  removeCenterlinePoint,
  removeEntity,
  setCenterlinePoint,
  setHalfWidth,
  setSceneId,
} from '@studio/core'
import { downloadScene, listScenes, loadScene, saveScene } from './api'
import type { StudioHost } from './types'

export function createMapPanel(host: HTMLElement, studio: StudioHost): void {
  host.innerHTML = ''
  host.dataset.activeTab = 'map'

  const status = document.createElement('p')
  status.className = 'studio-status'
  const modeRow = document.createElement('div')
  modeRow.className = 'studio-actions'
  const editBtn = document.createElement('button')
  editBtn.type = 'button'
  editBtn.textContent = 'Edit'
  const playBtn = document.createElement('button')
  playBtn.type = 'button'
  playBtn.textContent = 'Play'
  modeRow.append(editBtn, playBtn)

  const sceneIdLabel = document.createElement('label')
  sceneIdLabel.className = 'studio-field'
  sceneIdLabel.textContent = 'Scene id '
  const sceneIdInput = document.createElement('input')
  sceneIdInput.type = 'text'
  sceneIdLabel.append(sceneIdInput)

  const sceneList = document.createElement('div')
  sceneList.className = 'studio-chips'

  const actions = document.createElement('div')
  actions.className = 'studio-actions'
  const saveBtn = document.createElement('button')
  saveBtn.type = 'button'
  saveBtn.textContent = 'Save'
  const downloadBtn = document.createElement('button')
  downloadBtn.type = 'button'
  downloadBtn.textContent = 'Download'
  const reloadBtn = document.createElement('button')
  reloadBtn.type = 'button'
  reloadBtn.textContent = 'Reload list'
  actions.append(saveBtn, downloadBtn, reloadBtn)

  const trackSection = document.createElement('section')
  trackSection.className = 'studio-section-inline'
  trackSection.innerHTML = '<h3>Track</h3>'
  const halfWidthLabel = document.createElement('label')
  halfWidthLabel.className = 'studio-field'
  halfWidthLabel.innerHTML = 'Half width <input type="range" min="3" max="20" step="0.5" /> <span class="studio-val"></span>'
  const halfWidthInput = halfWidthLabel.querySelector('input')!
  const halfWidthVal = halfWidthLabel.querySelector('.studio-val')!
  const pointActions = document.createElement('div')
  pointActions.className = 'studio-actions'
  const addPointBtn = document.createElement('button')
  addPointBtn.type = 'button'
  addPointBtn.textContent = 'Add point'
  const delPointBtn = document.createElement('button')
  delPointBtn.type = 'button'
  delPointBtn.textContent = 'Delete point'
  pointActions.append(addPointBtn, delPointBtn)
  trackSection.append(halfWidthLabel, pointActions)

  const entitySection = document.createElement('section')
  entitySection.className = 'studio-section-inline'
  entitySection.innerHTML = '<h3>Entities</h3>'
  const entityList = document.createElement('div')
  entityList.className = 'studio-chips'
  const delEntityBtn = document.createElement('button')
  delEntityBtn.type = 'button'
  delEntityBtn.textContent = 'Delete entity'
  entitySection.append(entityList, delEntityBtn)

  const jsonLabel = document.createElement('label')
  jsonLabel.className = 'studio-field studio-field-col'
  jsonLabel.textContent = 'JSON'
  const jsonArea = document.createElement('textarea')
  jsonArea.rows = 8
  jsonLabel.append(jsonArea)
  const applyJsonBtn = document.createElement('button')
  applyJsonBtn.type = 'button'
  applyJsonBtn.textContent = 'Apply JSON'
  applyJsonBtn.className = 'studio-secondary'

  host.append(status, modeRow, sceneIdLabel, sceneList, actions, trackSection, entitySection, jsonLabel, applyJsonBtn)

  let dirty = false
  let suppressJson = false

  function setStatus(msg: string, kind: '' | 'ok' | 'err' = ''): void {
    status.textContent = dirty && !msg ? 'Unsaved changes' : msg
    status.className = `studio-status${kind ? ` ${kind}` : ''}`
  }

  function markDirty(): void {
    dirty = true
  }

  function syncJson(): void {
    if (suppressJson) return
    jsonArea.value = JSON.stringify(studio.getDoc(), null, 2)
  }

  function refresh(): void {
    const doc = studio.getDoc()
    sceneIdInput.value = doc.id
    if (doc.track) {
      halfWidthInput.value = String(doc.track.halfWidth)
      halfWidthVal.textContent = String(doc.track.halfWidth)
    }
    syncJson()
    renderSceneList()
    renderEntityList()
    syncModeButtons()
  }

  function syncModeButtons(): void {
    const edit = studio.getMode() === 'edit'
    editBtn.classList.toggle('active', edit)
    playBtn.classList.toggle('active', !edit)
  }

  function renderSceneList(): void {
    const doc = studio.getDoc()
    for (const btn of sceneList.querySelectorAll<HTMLButtonElement>('.chip')) {
      btn.classList.toggle('active', btn.dataset.id === doc.id)
    }
  }

  async function refreshSceneList(): Promise<void> {
    try {
      const ids = await listScenes()
      sceneList.innerHTML = ''
      const doc = studio.getDoc()
      for (const id of ids) {
        const btn = document.createElement('button')
        btn.type = 'button'
        btn.className = 'chip'
        btn.dataset.id = id
        btn.textContent = id
        btn.classList.toggle('active', id === doc.id)
        btn.addEventListener('click', () => void openScene(id))
        sceneList.append(btn)
      }
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'list failed', 'err')
    }
  }

  function renderEntityList(): void {
    entityList.innerHTML = ''
    const sel = studio.getSelection()
    for (const entity of studio.getDoc().entities) {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'chip'
      btn.textContent = `${entity.id} · ${entity.assetId}`
      btn.classList.toggle('active', sel?.kind === 'entity' && sel.id === entity.id)
      btn.addEventListener('click', () => {
        studio.setSelection({ kind: 'entity', id: entity.id })
      })
      entityList.append(btn)
    }
  }

  async function openScene(id: string): Promise<void> {
    try {
      const loaded = ensureTrack(await loadScene(id))
      studio.setDoc(loaded, { clearSelection: true })
      dirty = false
      localStorage.setItem('studio-last-scene', id)
      setStatus(`Loaded ${id}`, 'ok')
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'load failed', 'err')
    }
  }

  async function doSave(): Promise<boolean> {
    try {
      let doc = setSceneId(parseSceneDocument(studio.getDoc()), sceneIdInput.value)
      studio.setDoc(doc)
      doc = studio.getDoc()
      await saveScene(doc)
      dirty = false
      await refreshSceneList()
      setStatus(`Saved scenes/${doc.id}.json`, 'ok')
      return true
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'save failed', 'err')
      return false
    }
  }

  editBtn.addEventListener('click', () => void studio.setMode('edit'))
  playBtn.addEventListener('click', () => void studio.setMode('play'))
  saveBtn.addEventListener('click', () => void doSave())
  downloadBtn.addEventListener('click', () => {
    try {
      downloadScene(parseSceneDocument(studio.getDoc()))
      setStatus('Downloaded JSON', 'ok')
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'download failed', 'err')
    }
  })
  reloadBtn.addEventListener('click', () => void refreshSceneList())
  applyJsonBtn.addEventListener('click', () => {
    try {
      suppressJson = true
      studio.setDoc(ensureTrack(parseSceneDocument(JSON.parse(jsonArea.value))), { clearSelection: true })
      markDirty()
      setStatus('Applied JSON', 'ok')
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'invalid JSON', 'err')
    } finally {
      suppressJson = false
      syncJson()
    }
  })
  addPointBtn.addEventListener('click', () => {
    try {
      const sel = studio.getSelection()
      const doc = studio.getDoc()
      const after = sel?.kind === 'point' ? sel.index : (doc.track?.centerline.length ?? 1) - 1
      const next = insertCenterlinePoint(doc, Math.max(0, after))
      studio.setSelection({ kind: 'point', index: after + 1 })
      studio.setDoc(next)
      markDirty()
      setStatus('Inserted centerline point', 'ok')
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'add point failed', 'err')
    }
  })
  delPointBtn.addEventListener('click', () => {
    const sel = studio.getSelection()
    if (sel?.kind !== 'point') {
      setStatus('Select a track point first', 'err')
      return
    }
    try {
      const idx = sel.index
      const next = removeCenterlinePoint(studio.getDoc(), idx)
      studio.setSelection(
        next.track && next.track.centerline.length
          ? { kind: 'point', index: Math.min(idx, next.track.centerline.length - 1) }
          : null,
      )
      studio.setDoc(next)
      markDirty()
      setStatus('Deleted centerline point', 'ok')
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'delete failed', 'err')
    }
  })
  delEntityBtn.addEventListener('click', () => {
    const sel = studio.getSelection()
    if (sel?.kind !== 'entity') {
      setStatus('Select an entity first', 'err')
      return
    }
    studio.setDoc(removeEntity(studio.getDoc(), sel.id), { clearSelection: true })
    markDirty()
    setStatus('Deleted entity', 'ok')
  })
  halfWidthInput.addEventListener('input', () => {
    const v = Number(halfWidthInput.value)
    halfWidthVal.textContent = String(v)
    studio.setDoc(setHalfWidth(studio.getDoc(), v))
    markDirty()
  })
  sceneIdInput.addEventListener('change', () => {
    studio.setDoc(setSceneId(studio.getDoc(), sceneIdInput.value))
    markDirty()
  })

  studio.onDocChange(refresh)
  studio.onSelectionChange(renderEntityList)

  void refreshSceneList()
  refresh()
}

export function renderEntityInspector(body: HTMLElement, entity: SceneEntity, studio: StudioHost): void {
  const c = entity.collider
  const playMode = studio.getMode() === 'play'
  const disabled = playMode ? 'disabled' : ''
  const off = entity.collider?.offset ?? [0, 0, 0]
  const opacityPct = Math.round((entity.opacity ?? 1) * 100)
  body.innerHTML = `
    <h2>Entity</h2>
    ${playMode ? '<p class="studio-note">Switch to Edit. Colliders update on Play.</p>' : ''}
    <label class="studio-field">Id <input id="insp-id" type="text" value="${entity.id}" ${disabled} /></label>
    <label class="studio-field">Asset <input id="insp-asset" type="text" value="${entity.assetId}" ${disabled} /></label>
    <label class="studio-field">Pos X <input id="insp-px" type="number" step="0.1" value="${entity.position[0]}" ${disabled} /></label>
    <label class="studio-field">Pos Y <input id="insp-py" type="number" step="0.1" value="${entity.position[1]}" ${disabled} /></label>
    <label class="studio-field">Pos Z <input id="insp-pz" type="number" step="0.1" value="${entity.position[2]}" ${disabled} /></label>
    <label class="studio-field">Rotation Y <input id="insp-ry" type="number" step="0.01" value="${entity.rotationY}" ${disabled} /></label>
    <label class="studio-field">Scale <input id="insp-scale" type="number" step="0.05" min="0.05" value="${entity.scale}" ${disabled} /></label>
    <h3>Render</h3>
    <label class="studio-field">Opacity % <input id="insp-opacity" type="range" min="0" max="100" step="1" value="${opacityPct}" ${disabled} /></label>
    <h3>Box collider</h3>
    <p class="studio-note">Rotation Y does not rotate the Rapier box yet.</p>
    <label class="studio-field"><span><input id="insp-col" type="checkbox" ${c ? 'checked' : ''} ${disabled} /> Enabled</span></label>
    <label class="studio-field">Offset X <input id="insp-ox" type="number" step="0.05" value="${off[0]}" ${disabled} /></label>
    <label class="studio-field">Offset Y <input id="insp-oy" type="number" step="0.05" value="${off[1]}" ${disabled} /></label>
    <label class="studio-field">Offset Z <input id="insp-oz" type="number" step="0.05" value="${off[2]}" ${disabled} /></label>
    <label class="studio-field">Half X <input id="insp-hx" type="number" step="0.05" min="0.05" value="${c?.halfExtents[0] ?? 0.5}" ${disabled} /></label>
    <label class="studio-field">Half Y <input id="insp-hy" type="number" step="0.05" min="0.05" value="${c?.halfExtents[1] ?? 0.5}" ${disabled} /></label>
    <label class="studio-field">Half Z <input id="insp-hz" type="number" step="0.05" min="0.05" value="${c?.halfExtents[2] ?? 0.5}" ${disabled} /></label>
    <div class="studio-actions">
      <button id="insp-mode-t" type="button" ${disabled}>Translate</button>
      <button id="insp-mode-r" type="button" ${disabled}>Rotate</button>
      <button id="insp-mode-s" type="button" ${disabled}>Scale</button>
    </div>
  `
  if (playMode) return
  const readEntity = (): SceneEntity | null => {
    const id = body.querySelector<HTMLInputElement>('#insp-id')!.value.trim()
    const assetId = body.querySelector<HTMLInputElement>('#insp-asset')!.value.trim()
    const px = Number(body.querySelector<HTMLInputElement>('#insp-px')!.value)
    const py = Number(body.querySelector<HTMLInputElement>('#insp-py')!.value)
    const pz = Number(body.querySelector<HTMLInputElement>('#insp-pz')!.value)
    const ry = Number(body.querySelector<HTMLInputElement>('#insp-ry')!.value)
    const scale = Number(body.querySelector<HTMLInputElement>('#insp-scale')!.value)
    const enabled = body.querySelector<HTMLInputElement>('#insp-col')!.checked
    const opacityPct = Number(body.querySelector<HTMLInputElement>('#insp-opacity')!.value)
    const ox = Number(body.querySelector<HTMLInputElement>('#insp-ox')!.value)
    const oy = Number(body.querySelector<HTMLInputElement>('#insp-oy')!.value)
    const oz = Number(body.querySelector<HTMLInputElement>('#insp-oz')!.value)
    const hx = Number(body.querySelector<HTMLInputElement>('#insp-hx')!.value)
    const hy = Number(body.querySelector<HTMLInputElement>('#insp-hy')!.value)
    const hz = Number(body.querySelector<HTMLInputElement>('#insp-hz')!.value)
    if (!id || !assetId) return null
    if (![px, py, pz, ry, scale, opacityPct, ox, oy, oz].every(Number.isFinite) || scale <= 0) return null
    const next: SceneEntity = {
      id,
      assetId,
      position: [px, py, pz],
      rotationY: ry,
      scale,
      opacity: Math.max(0, Math.min(1, opacityPct / 100)),
    }
    if (enabled && [hx, hy, hz].every((n) => Number.isFinite(n) && n > 0)) {
      next.collider = {
        type: 'box',
        halfExtents: [hx, hy, hz],
        ...([ox, oy, oz].some((n) => n !== 0) ? { offset: [ox, oy, oz] as Vec3Tuple } : {}),
      }
    }
    return next
  }
  const applyEntityFields = () => {
    const sel = studio.getSelection()
    const next = readEntity()
    if (!next || sel?.kind !== 'entity') return
    let doc = studio.getDoc()
    doc = { ...doc, entities: doc.entities.filter((e) => e.id !== sel.id) }
    doc = { ...doc, entities: [...doc.entities, next] }
    studio.setSelection({ kind: 'entity', id: next.id })
    studio.setDoc(doc)
  }
  for (const id of [
    '#insp-id',
    '#insp-asset',
    '#insp-px',
    '#insp-py',
    '#insp-pz',
    '#insp-ry',
    '#insp-scale',
    '#insp-opacity',
    '#insp-ox',
    '#insp-oy',
    '#insp-oz',
    '#insp-hx',
    '#insp-hy',
    '#insp-hz',
    '#insp-col',
  ]) {
    body.querySelector(id)!.addEventListener('change', applyEntityFields)
  }
  body.querySelector('#insp-opacity')!.addEventListener('input', applyEntityFields)
}

export function renderPointInspector(body: HTMLElement, index: number, pt: Vec3Tuple, studio: StudioHost): void {
  body.innerHTML = `
    <h2>Track point ${index}</h2>
    <label class="studio-field">X <input id="insp-x" type="number" step="0.1" value="${pt[0]}" /></label>
    <label class="studio-field">Y <input id="insp-y" type="number" step="0.1" value="${pt[1]}" /></label>
    <label class="studio-field">Z <input id="insp-z" type="number" step="0.1" value="${pt[2]}" /></label>
  `
  const bind = (id: string, axis: 0 | 1 | 2) => {
    body.querySelector<HTMLInputElement>(id)!.addEventListener('change', (e) => {
      const v = Number((e.target as HTMLInputElement).value)
      const sel = studio.getSelection()
      const doc = studio.getDoc()
      if (!Number.isFinite(v) || !doc.track || sel?.kind !== 'point') return
      const next: Vec3Tuple = [...doc.track.centerline[sel.index]!]
      next[axis] = v
      studio.setDoc(setCenterlinePoint(doc, sel.index, next))
    })
  }
  bind('#insp-x', 0)
  bind('#insp-y', 1)
  bind('#insp-z', 2)
}
