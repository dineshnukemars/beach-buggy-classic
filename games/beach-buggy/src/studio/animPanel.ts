import type { StudioHost } from './types'

export function createAnimPanel(host: HTMLElement, studio: StudioHost): void {
  const panel = document.createElement('div')
  panel.className = 'studio-tab-panel'
  panel.dataset.tab = 'anim'

  const status = document.createElement('p')
  status.className = 'studio-status'
  const hint = document.createElement('p')
  hint.className = 'studio-note'
  hint.textContent = 'Select an entity, then play its glTF animation clips in-world.'
  const clipList = document.createElement('div')
  clipList.className = 'studio-chips'
  const stopBtn = document.createElement('button')
  stopBtn.type = 'button'
  stopBtn.textContent = 'Stop all'
  stopBtn.className = 'studio-secondary'

  panel.append(status, hint, clipList, stopBtn)
  host.append(panel)

  function setStatus(msg: string): void {
    status.textContent = msg
  }

  function refresh(): void {
    clipList.innerHTML = ''
    const sel = studio.getSelection()
    if (sel?.kind !== 'entity') {
      clipList.innerHTML = '<p class="studio-note">Select an entity in Edit mode.</p>'
      return
    }
    const clips = studio.getEntityClips(sel.id)
    if (!clips.length) {
      clipList.innerHTML = '<p class="studio-note">No clips on this entity.</p>'
      return
    }
    clips.forEach((clip, i) => {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'chip'
      btn.textContent = clip.name || `clip ${i}`
      btn.addEventListener('click', () => {
        studio.playEntityClip(sel.id, i)
        setStatus(`Playing ${clip.name || `clip ${i}`}`)
      })
      clipList.append(btn)
    })
  }

  stopBtn.addEventListener('click', () => {
    studio.stopEntityClips()
    setStatus('Stopped')
  })

  studio.onSelectionChange(refresh)
  studio.onDocChange(refresh)
  refresh()
}
