import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createDefaultBeachScene } from './index'
import { initPhysics } from './init'
import { FIXED_TIMESTEP } from './rapierSim'
import { World } from './world'

test('Rapier world moves forward with throttle', async () => {
  await initPhysics()
  const scene = createDefaultBeachScene()
  const world = await World.create(1, { scene, backend: 'rapier' })
  const start = world.bodies[0].position.clone()
  const throttle = { throttle: 1, steer: 0, brake: 0, boost: false }
  for (let i = 0; i < 120; i++) world.step(FIXED_TIMESTEP, [throttle])
  const end = world.bodies[0].position
  assert.ok(Number.isFinite(end.x) && Number.isFinite(end.y) && Number.isFinite(end.z))
  assert.ok(end.distanceTo(start) > 1)
  assert.ok(world.bodies[0].speed > 1)
  world.dispose()
})

test('Rapier world keeps finite state without spline Y snap constant', async () => {
  await initPhysics()
  const scene = createDefaultBeachScene()
  const world = await World.create(1, { scene, backend: 'rapier' })
  const throttle = { throttle: 1, steer: 0, brake: 0, boost: false }
  for (let i = 0; i < 60; i++) world.step(FIXED_TIMESTEP, [throttle])
  const yValues = new Set<number>()
  for (let i = 0; i < 30; i++) {
    world.step(FIXED_TIMESTEP, [throttle])
    yValues.add(Number(world.bodies[0].position.y.toFixed(3)))
  }
  assert.ok(yValues.size > 1)
  world.dispose()
})

test('arcade backend still supports checkpoint progression', async () => {
  const world = await World.create(1, { backend: 'arcade', totalLaps: 3 })
  const body = world.bodies[0]
  body.lastProgress = world.totalLength - 0.01
  body.progress = body.lastProgress
  body.checkpointIndex = 11
  const start = world.samples[0].position.clone()
  body.position.copy(start)
  world.step(1 / 60, [{ throttle: 0, steer: 0, brake: 0, boost: false }])
  assert.ok(body.lap >= 1)
  world.dispose()
})

test('teleport API resets motion state', async () => {
  await initPhysics()
  const scene = createDefaultBeachScene()
  const world = await World.create(1, { scene, backend: 'rapier' })
  for (let i = 0; i < 30; i++) {
    world.step(FIXED_TIMESTEP, [{ throttle: 1, steer: 0, brake: 0, boost: false }])
  }
  const target = world.bodies[0].position.clone()
  target.x += 5
  world.teleport(0, target, world.bodies[0].rotation)
  assert.ok(world.bodies[0].speed < 1)
  world.dispose()
})
