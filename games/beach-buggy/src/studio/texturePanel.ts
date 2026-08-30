import { getAsset, setGroundTexture, setTrackTexture } from '@studio/core'
import { importAsset } from './api'
import type { StudioHost } from './types'

export function createTexturePanel(host: HTMLElement, studio: StudioHost, canvas: HTMLCanvasElement): void {
  const panel = document.createElement('div')
  panel.className = 'studio-tab-panel'
  panel.dataset.tab = 'texture'

  const status = document.createElement('p')
  status.className = 'studio-status'
  const hint = document.createElement('p')
  hint.className = 'studio-note'
  hint.textContent = 'Drag a texture onto sand (ground) or track. Drop PNG/JPG here to import.'
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
    const assets = manifest.assets.filter((a) => a.kind === 'texture')
    const doc = studio.getDoc()
    if (!assets.length) {
      palette.innerHTML = '<p class="studio-note">No textures in manifest.</p>'
      return
    }
    for (const asset of assets) {
      const chip = document.createElement('button')
      chip.type = 'button'
      chip.className = 'chip draggable'
      chip.draggable = true
      chip.textContent = asset.id
      chip.dataset.assetId = asset.id
      const active =
        doc.look?.groundTextureId === asset.id || doc.look?.trackTextureId === asset.id
      chip.classList.toggle('active', active)
      chip.addEventListener('dragstart', (e) => {
        e.dataTransfer?.setData('application/x-studio-texture', asset.id)
        e.dataTransfer!.effectAllowed = 'copy'
      })
      palette.append(chip)
    }
  }

  async function handleFileDrop(files: FileList | File[]): Promise<void> {
    for (const file of files) {
      const ext = file.name.split('.').pop()?.toLowerCase()
      if (!ext || !['png', 'jpg', 'jpeg', 'webp'].includes(ext)) continue
      const id = file.name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 64) || 'tex'
      try {
        await importAsset(file, id, 'texture')
        await studio.reloadManifest()
        setStatus(`Imported ${id}`, 'ok')
      } catch (err) {
        setStatus(err instanceof Error ? err.message : 'import failed', 'err')
      }
    }
    renderPalette()
  }

  for (const el of [panel, palette]) {
    el.addEventListener('dragover', (e) => e.preventDefault())
    el.addEventListener('drop', (e) => {
      e.preventDefault()
      if (e.dataTransfer?.files.length) void handleFileDrop(e.dataTransfer.files)
    })
  }

  canvas.addEventListener('dragover', (e) => {
    if (e.dataTransfer?.types.includes('application/x-studio-texture')) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    }
  })

  canvas.addEventListener('drop', async (e) => {
    const textureId = e.dataTransfer?.getData('application/x-studio-texture')
    if (!textureId) return
    e.preventDefault()
    const ref = getAsset(studio.getManifest(), textureId)
    if (!ref || ref.kind !== 'texture') return
    const dt = e.dataTransfer
    if (!dt) return
    const target = dt.getData('application/x-studio-texture-target') || inferTextureTarget(e, canvas)
    let doc = studio.getDoc()
    if (target === 'track') {
      doc = setTrackTexture(doc, textureId)
      setStatus(`Track texture → ${textureId}`, 'ok')
    } else {
      doc = setGroundTexture(doc, textureId)
      setStatus(`Ground texture → ${textureId}`, 'ok')
    }
    studio.setDoc(doc)
    await studio.applyVisuals()
    renderPalette()
  })

  studio.onDocChange(renderPalette)
  studio.onManifestChange(renderPalette)
  renderPalette()
}

function inferTextureTarget(e: DragEvent, canvas: HTMLCanvasElement): 'ground' | 'track' {
  const rect = canvas.getBoundingClientRect()
  const y = (e.clientY - rect.top) / rect.height
  return y < 0.45 ? 'track' : 'ground'
}
