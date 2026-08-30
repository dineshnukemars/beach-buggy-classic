import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as THREE from 'three'
import { createDefaultBeachScene, createSandboxScene } from './index'
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

test('plantOnStartGrid leaves the field upright and still', async () => {
  await initPhysics()
  const world = await World.create(4, { scene: createDefaultBeachScene(), backend: 'rapier' })
  for (let i = 0; i < 90; i++) {
    world.step(FIXED_TIMESTEP, Array.from({ length: 4 }, () => ({ throttle: 0, steer: 0, brake: 1, boost: false })))
  }
  world.plantOnStartGrid()
  world.holdForCountdown()
  for (const body of world.bodies) {
    const euler = new THREE.Euler().setFromQuaternion(body.rotation, 'YXZ')
    assert.ok(Math.abs(euler.x) < 0.2, `pitch ${euler.x}`)
    assert.ok(Math.abs(euler.z) < 0.2, `roll ${euler.z}`)
    assert.ok(body.speed < 4, `speed ${body.speed}`)
  }
  world.dispose()
})

test('flat sandbox stays on the plane under throttle', async () => {
  await initPhysics()
  const world = await World.create(1, {
    scene: createSandboxScene(),
    backend: 'rapier',
    flatGround: true,
    laterals: [0],
  })
  for (let i = 0; i < 90; i++) {
    world.step(FIXED_TIMESTEP, [{ throttle: 0, steer: 0, brake: 1, boost: false }])
  }
  world.plantOnStartGrid()
  const start = world.bodies[0].position.clone()
  for (let i = 0; i < 600; i++) {
    world.step(FIXED_TIMESTEP, [{ throttle: 1, steer: 0, brake: 0, boost: false }])
  }
  const end = world.bodies[0].position
  assert.ok(Number.isFinite(end.x) && Number.isFinite(end.y) && Number.isFinite(end.z))
  assert.ok(end.distanceTo(start) > 150, `only moved ${end.distanceTo(start)}`)
  assert.ok(end.y > -0.5 && end.y < 2.5, `chassis y ${end.y}`)
  assert.ok(world.bodies[0].speed > 1)
  world.dispose()
})

test('debugRender exposes Rapier collider wireframe buffers', async () => {
  await initPhysics()
  const world = await World.create(1, { scene: createDefaultBeachScene(), backend: 'rapier' })
  const buffers = world.debugRender()
  assert.ok(buffers)
  assert.ok(buffers!.vertices.length > 0)
  assert.ok(buffers!.colors.length > 0)
  const hubs = world.debugWheelHubs()
  assert.equal(hubs.length, 4)
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
