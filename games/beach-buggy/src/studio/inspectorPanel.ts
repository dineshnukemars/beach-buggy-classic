import { removeEntity, setCenterlinePoint, upsertEntity } from '@studio/core'
import { renderEntityInspector, renderPointInspector } from './mapPanel'
import type { StudioHost } from './types'

export function createInspectorPanel(host: HTMLElement, studio: StudioHost): void {
  const inspectPanel = document.createElement('div')
  inspectPanel.className = 'studio-right-tab'
  inspectPanel.dataset.tab = 'inspect'
  const body = document.createElement('div')
  body.className = 'studio-inspector-body'
  inspectPanel.append(body)

  const tuneMount = document.createElement('div')
  tuneMount.className = 'studio-right-tab hidden'
  tuneMount.dataset.tab = 'tune'
  tuneMount.id = 'studio-tune-mount'
  tuneMount.innerHTML = `
    <section class="studio-section">
      <h3 id="studio-tune-title">Physics tuning</h3>
      <p class="studio-note" id="studio-vehicle-note">Edit mode or pause physics to tune.</p>
      <div id="studio-vehicle"></div>
      <div id="studio-entity-tune" class="hidden"></div>
    </section>
  `

  host.append(inspectPanel, tuneMount)

  host.addEventListener('studio-tab', (e) => {
    const tab = (e as CustomEvent<string>).detail
    inspectPanel.classList.toggle('hidden', tab !== 'inspect')
    tuneMount.classList.toggle('hidden', tab !== 'tune')
  })

  function refresh(): void {
    const sel = studio.getSelection()
    const doc = studio.getDoc()
    if (sel?.kind === 'point' && doc.track) {
      const pt = doc.track.centerline[sel.index]
      if (!pt) {
        body.innerHTML = '<p class="studio-note">Point missing.</p>'
        return
      }
      renderPointInspector(body, sel.index, pt, studio)
      return
    }
    if (sel?.kind === 'entity') {
      const entity = doc.entities.find((e) => e.id === sel.id)
      if (!entity) {
        body.innerHTML = '<p class="studio-note">Entity missing.</p>'
        return
      }
      renderEntityInspector(body, entity, studio)
      bindTransformButtons(body, studio)
      return
    }
    if (sel?.kind === 'player') {
      body.innerHTML =
        '<h2>Player vehicle</h2><p class="studio-note">Use the Tune tab for mesh opacity, visual offset, and chassis offset. Collider wireframes are shown when Physics colliders is enabled.</p>'
      return
    }
    body.innerHTML = '<p class="studio-note">Select a track point, entity, or the player car in Edit mode.</p>'
  }

  studio.onSelectionChange(refresh)
  studio.onDocChange(refresh)
  refresh()
}

function bindTransformButtons(body: HTMLElement, studio: StudioHost): void {
  const t = body.querySelector('#insp-mode-t')
  const r = body.querySelector('#insp-mode-r')
  const s = body.querySelector('#insp-mode-s')
  t?.addEventListener('click', () => {
    const overlay = (studio as StudioHost & { _transformMode?: (m: string) => void })._transformMode
    overlay?.('translate')
  })
  r?.addEventListener('click', () => {
    const overlay = (studio as StudioHost & { _transformMode?: (m: string) => void })._transformMode
    overlay?.('rotate')
  })
  s?.addEventListener('click', () => {
    const overlay = (studio as StudioHost & { _transformMode?: (m: string) => void })._transformMode
    overlay?.('scale')
  })
}

export { removeEntity, setCenterlinePoint, upsertEntity }
