import { init as initRapier } from '@dimforge/rapier3d-compat'

let ready: Promise<void> | undefined

export async function initPhysics(): Promise<void> {
  if (!ready) ready = initRapier()
  await ready
}
