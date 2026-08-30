import type { StudioShell } from './shell'
import { mountStudioShell } from './shell'
import { createMapPanel } from './mapPanel'
import { createAssetsPanel } from './assetsPanel'
import { createTexturePanel } from './texturePanel'
import { createAnimPanel } from './animPanel'
import { createInspectorPanel } from './inspectorPanel'
import type { EditOverlay } from './editOverlay'
import type { StudioHost } from './types'

export type StudioUi = {
  shell: StudioShell | null
  showLeftTab: (tab: string) => void
}

export function initStudioUi(host: StudioHost, canvas: HTMLCanvasElement, editOverlay?: EditOverlay): StudioUi {
  const shell = mountStudioShell()
  if (!shell) return { shell: null, showLeftTab: () => {} }

  const mapHost = document.createElement('div')
  mapHost.className = 'studio-tab-panel'
  mapHost.dataset.tab = 'map'
  shell.leftPanel.append(mapHost)

  createMapPanel(mapHost, host)
  createAssetsPanel(shell.leftPanel, host, canvas)
  createTexturePanel(shell.leftPanel, host, canvas)
  createAnimPanel(shell.leftPanel, host)
  createInspectorPanel(shell.rightPanel, host)

  shell.leftPanel.addEventListener('studio-tab', (e) => {
    const tab = (e as CustomEvent<string>).detail
    for (const panel of shell.leftPanel.querySelectorAll<HTMLElement>('.studio-tab-panel')) {
      panel.classList.toggle('hidden', panel.dataset.tab !== tab)
    }
  })

  if (editOverlay) {
    ;(host as StudioHost & { _transformMode?: (m: string) => void })._transformMode = (mode) => {
      const t = editOverlay.getTransform()
      t.setMode(mode as 'translate' | 'rotate' | 'scale')
      if (mode === 'rotate') {
        t.showX = false
        t.showZ = false
        t.showY = true
      } else {
        t.showX = true
        t.showY = true
        t.showZ = true
      }
    }
  }

  const tuneDrawer = document.querySelector<HTMLElement>('#studio-drawer')
  const tuneMount = document.querySelector('#studio-tune-mount')
  if (tuneDrawer && tuneMount) {
    tuneMount.append(tuneDrawer)
    tuneDrawer.classList.remove('hidden')
    tuneDrawer.querySelector('.studio-header')?.remove()
  }

  function showLeftTab(tab: string): void {
    if (!shell) return
    for (const panel of shell.leftPanel.querySelectorAll<HTMLElement>('.studio-tab-panel')) {
      panel.classList.toggle('hidden', panel.dataset.tab !== tab)
    }
    for (const btn of shell.leftPanel.querySelectorAll<HTMLButtonElement>('#studio-left-tabs .studio-tab')) {
      btn.classList.toggle('active', btn.dataset.tab === tab)
    }
  }

  return { shell, showLeftTab }
}
