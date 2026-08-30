import { createEntity, getAsset, upsertEntity } from '@studio/core'
import { importAsset } from './api'
import type { StudioHost } from './types'

export function createAssetsPanel(host: HTMLElement, studio: StudioHost, canvas: HTMLCanvasElement): void {
  const panel = document.createElement('div')
  panel.className = 'studio-tab-panel'
  panel.dataset.tab = 'assets'

  const status = document.createElement('p')
  status.className = 'studio-status'
  const hint = document.createElement('p')
  hint.className = 'studio-note'
  hint.textContent = 'Drag a glTF chip onto the canvas to place. Drop .glb/.gltf here to import.'
  const palette = document.createElement('div')
  palette.className = 'studio-chips studio-draggable-palette'

  panel.append(status, hint, palette)
  host.append(panel)

  function setStatus(msg: string, kind: '' | 'ok' | 'err' = ''): void {
    status.textContent = msg
    status.className = `studio-status${kind ? ` ${kind}` : ''}`
  }

  function renderPalette(): void {
    palette.innerHTML = ''
    const manifest = studio.getManifest()
    const assets = manifest.assets.filter((a) => a.kind === 'gltf')
    if (!assets.length) {
      palette.innerHTML = '<p class="studio-note">No glTF assets in manifest.</p>'
      return
    }
    for (const asset of assets) {
      const chip = document.createElement('button')
      chip.type = 'button'
      chip.className = 'chip draggable'
      chip.draggable = true
      chip.textContent = asset.id
      chip.dataset.assetId = asset.id
      chip.addEventListener('dragstart', (e) => {
        e.dataTransfer?.setData('application/x-studio-asset', asset.id)
        e.dataTransfer!.effectAllowed = 'copy'
      })
      palette.append(chip)
    }
  }

  async function handleFileDrop(files: FileList | File[]): Promise<void> {
    for (const file of files) {
      const ext = file.name.split('.').pop()?.toLowerCase()
      if (ext !== 'glb' && ext !== 'gltf') continue
      const id = file.name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 64) || 'asset'
      try {
        await importAsset(file, id, 'gltf')
        await studio.reloadManifest()
        setStatus(`Imported ${id}`, 'ok')
      } catch (err) {
        setStatus(err instanceof Error ? err.message : 'import failed', 'err')
      }
    }
    renderPalette()
  }

  for (const el of [panel, palette]) {
    el.addEventListener('dragover', (e) => {
      e.preventDefault()
    })
    el.addEventListener('drop', (e) => {
      e.preventDefault()
      if (e.dataTransfer?.files.length) void handleFileDrop(e.dataTransfer.files)
    })
  }

  canvas.addEventListener('dragover', (e) => {
    if (e.dataTransfer?.types.includes('application/x-studio-asset')) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    }
  })

  canvas.addEventListener('drop', async (e) => {
    const assetId = e.dataTransfer?.getData('application/x-studio-asset')
    if (!assetId || studio.getMode() !== 'edit') return
    e.preventDefault()
    const ref = getAsset(studio.getManifest(), assetId)
    if (!ref || ref.kind !== 'gltf') return
    const hit = studio.pickGround(e.clientX, e.clientY)
    if (!hit) {
      setStatus('No ground hit', 'err')
      return
    }
    const entity = createEntity(studio.getDoc(), assetId, [hit.x, Math.max(0.5, hit.y + 0.5), hit.z])
    studio.setDoc(upsertEntity(studio.getDoc(), entity))
    studio.setSelection({ kind: 'entity', id: entity.id })
    await studio.applyVisuals()
    setStatus(`Placed ${entity.id}`, 'ok')
  })

  studio.onManifestChange(renderPalette)
  renderPalette()
}
