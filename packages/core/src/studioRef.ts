export const STUDIO_REF_KINDS = ['entity', 'racer', 'track', 'environment'] as const

export type StudioRefKind = (typeof STUDIO_REF_KINDS)[number]

export type StudioRef = {
  kind: StudioRefKind
  id: string
  assetId?: string
  label?: string
}

export function isStudioRefKind(value: string): value is StudioRefKind {
  return (STUDIO_REF_KINDS as readonly string[]).includes(value)
}

export function parseStudioRef(raw: unknown): StudioRef {
  if (!raw || typeof raw !== 'object') throw new Error('StudioRef must be an object')
  const rec = raw as Record<string, unknown>
  if (typeof rec.kind !== 'string' || !isStudioRefKind(rec.kind)) {
    throw new Error('StudioRef.kind must be entity | racer | track | environment')
  }
  if (typeof rec.id !== 'string' || !rec.id) throw new Error('StudioRef.id required')
  const ref: StudioRef = { kind: rec.kind, id: rec.id }
  if (rec.assetId !== undefined) {
    if (typeof rec.assetId !== 'string' || !rec.assetId) throw new Error('StudioRef.assetId must be a string')
    ref.assetId = rec.assetId
  }
  if (rec.label !== undefined) {
    if (typeof rec.label !== 'string') throw new Error('StudioRef.label must be a string')
    ref.label = rec.label
  }
  return ref
}
