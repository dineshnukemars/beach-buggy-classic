import { FEEDBACK_TAGS, type FeedbackTag, type StudioRef } from '@studio/core'

export type PanelElements = {
  root: HTMLElement
  target: HTMLElement
  tags: HTMLElement
  note: HTMLTextAreaElement
  submit: HTMLButtonElement
  resume: HTMLButtonElement
  cancel: HTMLButtonElement
  status: HTMLElement
}

export function bindPanel(): PanelElements {
  const root = document.querySelector<HTMLElement>('#dev-panel')!
  const target = document.querySelector<HTMLElement>('#dev-target')!
  const tags = document.querySelector<HTMLElement>('#dev-tags')!
  const note = document.querySelector<HTMLTextAreaElement>('#dev-note')!
  const submit = document.querySelector<HTMLButtonElement>('#dev-submit')!
  const resume = document.querySelector<HTMLButtonElement>('#dev-resume')!
  const cancel = document.querySelector<HTMLButtonElement>('#dev-cancel')!
  const status = document.querySelector<HTMLElement>('#dev-status')!
  tags.replaceChildren()
  for (const tag of FEEDBACK_TAGS) {
    const label = document.createElement('label')
    const input = document.createElement('input')
    input.type = 'checkbox'
    input.value = tag
    input.name = 'dev-tag'
    label.append(input, ` ${tag}`)
    tags.append(label)
  }
  return { root, target, tags, note, submit, resume, cancel, status }
}

export function selectedTags(panel: PanelElements): FeedbackTag[] {
  const inputs = panel.tags.querySelectorAll<HTMLInputElement>('input[name="dev-tag"]')
  const tags: FeedbackTag[] = []
  for (const input of inputs) {
    if (input.checked) tags.push(input.value as FeedbackTag)
  }
  return tags
}

export function setPanelOpen(panel: PanelElements, open: boolean): void {
  panel.root.classList.toggle('hidden', !open)
}

export function setTargetLabel(panel: PanelElements, ref: StudioRef | undefined): void {
  panel.target.textContent = ref ? `${ref.label ?? ref.id} (${ref.kind})` : 'Click an object'
}

export function resetPanel(panel: PanelElements): void {
  panel.note.value = ''
  panel.status.textContent = ''
  for (const input of panel.tags.querySelectorAll<HTMLInputElement>('input')) input.checked = false
  setTargetLabel(panel, undefined)
}

export function isPanelField(el: EventTarget | null): boolean {
  if (!(el instanceof Element)) return false
  if (el.closest('#studio-drawer')) return true
  if (el.closest('#studio-left')) return true
  if (el.closest('#studio-right')) return true
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement
}
