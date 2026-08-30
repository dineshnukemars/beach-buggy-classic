export type StudioShell = {
  stage: HTMLElement
  left: HTMLElement
  right: HTMLElement
  leftPanel: HTMLElement
  rightPanel: HTMLElement
  toggleRails: () => void
  observeStage: (onResize: (w: number, h: number) => void) => () => void
}

const STORAGE_KEY = 'studio-rails-open'

export function mountStudioShell(): StudioShell | null {
  if (!import.meta.env.DEV) return null

  const app = document.querySelector<HTMLElement>('#app')!
  app.classList.add('studio-shell')

  const left = document.createElement('aside')
  left.id = 'studio-left'
  left.setAttribute('aria-label', 'Studio tools')

  const leftTabs = document.createElement('nav')
  leftTabs.id = 'studio-left-tabs'
  leftTabs.className = 'studio-tabs'
  for (const tab of ['Map', 'Assets', 'Texture', 'Anim'] as const) {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'studio-tab'
    btn.dataset.tab = tab.toLowerCase()
    btn.textContent = tab
    leftTabs.append(btn)
  }

  const leftPanel = document.createElement('div')
  leftPanel.id = 'studio-left-panel'
  leftPanel.className = 'studio-panel-body'
  left.append(leftTabs, leftPanel)

  const stage = document.createElement('div')
  stage.id = 'studio-stage'

  const right = document.createElement('aside')
  right.id = 'studio-right'
  right.setAttribute('aria-label', 'Studio inspector')

  const rightTabs = document.createElement('nav')
  rightTabs.id = 'studio-right-tabs'
  rightTabs.className = 'studio-tabs'
  for (const tab of ['Inspect', 'Tune'] as const) {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'studio-tab'
    btn.dataset.tab = tab.toLowerCase()
    btn.textContent = tab
    rightTabs.append(btn)
  }

  const rightPanel = document.createElement('div')
  rightPanel.id = 'studio-right-panel'
  rightPanel.className = 'studio-panel-body'
  right.append(rightTabs, rightPanel)

  while (app.firstChild) stage.append(app.firstChild!)
  app.append(left, stage, right)

  const studioToggle = document.querySelector<HTMLButtonElement>('#studio-rails-toggle')!
  studioToggle.textContent = 'Studio'

  let railsOpen = localStorage.getItem(STORAGE_KEY) !== 'false'
  function applyRails(): void {
    app.classList.toggle('studio-rails-hidden', !railsOpen)
    studioToggle.setAttribute('aria-expanded', railsOpen ? 'true' : 'false')
    studioToggle.textContent = railsOpen ? 'Hide studio' : 'Show studio'
  }
  applyRails()

  studioToggle.addEventListener('click', () => {
    railsOpen = !railsOpen
    localStorage.setItem(STORAGE_KEY, String(railsOpen))
    applyRails()
  })

  function activateTab(nav: HTMLElement, name: string): void {
    for (const btn of nav.querySelectorAll<HTMLButtonElement>('.studio-tab')) {
      btn.classList.toggle('active', btn.dataset.tab === name)
    }
  }
  activateTab(leftTabs, 'map')
  activateTab(rightTabs, 'inspect')

  leftTabs.addEventListener('click', (e) => {
    const btn = (e.target as Element).closest<HTMLButtonElement>('.studio-tab')
    if (!btn?.dataset.tab) return
    activateTab(leftTabs, btn.dataset.tab)
    leftPanel.dataset.activeTab = btn.dataset.tab
    leftPanel.dispatchEvent(new CustomEvent('studio-tab', { detail: btn.dataset.tab }))
  })

  rightTabs.addEventListener('click', (e) => {
    const btn = (e.target as Element).closest<HTMLButtonElement>('.studio-tab')
    if (!btn?.dataset.tab) return
    activateTab(rightTabs, btn.dataset.tab)
    rightPanel.dataset.activeTab = btn.dataset.tab
    rightPanel.dispatchEvent(new CustomEvent('studio-tab', { detail: btn.dataset.tab }))
  })

  leftPanel.dataset.activeTab = 'map'
  rightPanel.dataset.activeTab = 'inspect'

  return {
    stage,
    left,
    right,
    leftPanel,
    rightPanel,
    toggleRails: () => {
      railsOpen = !railsOpen
      localStorage.setItem(STORAGE_KEY, String(railsOpen))
      applyRails()
    },
    observeStage: (onResize) => {
      const ro = new ResizeObserver((entries) => {
        const entry = entries[0]
        if (!entry) return
        onResize(entry.contentRect.width, entry.contentRect.height)
      })
      ro.observe(stage)
      onResize(stage.clientWidth, stage.clientHeight)
      return () => ro.disconnect()
    },
  }
}
