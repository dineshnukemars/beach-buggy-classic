import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as THREE from 'three'
import { createDefaultBeachScene } from './index'
import { FIXED_TIMESTEP } from './rapierSim'
import { World } from './world'

test('idle settle stays planted on the road', async () => {
  const world = await World.create(1, { scene: createDefaultBeachScene(), backend: 'rapier' })
  const idle = { throttle: 0, steer: 0, brake: 0, boost: false }
  for (let i = 0; i < 120; i++) world.step(FIXED_TIMESTEP, [idle])
  const body = world.bodies[0]
  const euler = new THREE.Euler().setFromQuaternion(body.rotation, 'YXZ')
  assert.equal(body.airborneTime, 0, `should be grounded, airborneTime=${body.airborneTime}`)
  assert.ok(body.speed < 6, `settle speed should stay low, got ${body.speed}`)
  assert.ok(Math.abs(euler.z) < 0.35, `roll should be small, got ${euler.z}`)
  assert.ok(Math.abs(euler.x) < 0.35, `pitch should be small, got ${euler.x}`)
  world.dispose()
})

test('throttle moves along the mesh nose and increases raceDistance', async () => {
  const world = await World.create(1, { scene: createDefaultBeachScene(), backend: 'rapier' })
  const idle = { throttle: 0, steer: 0, brake: 0, boost: false }
  const throttle = { throttle: 1, steer: 0, brake: 0, boost: false }
  for (let i = 0; i < 60; i++) world.step(FIXED_TIMESTEP, [idle])
  const start = world.bodies[0].position.clone()
  const startRace = world.bodies[0].raceDistance
  for (let i = 0; i < 180; i++) world.step(FIXED_TIMESTEP, [throttle])
  const body = world.bodies[0]
  const move = body.position.clone().sub(start)
  const nose = new THREE.Vector3(0, 0, 1).applyQuaternion(body.rotation)
  assert.ok(move.dot(nose) > 2, `move along nose should be forward, got ${move.dot(nose)}`)
  assert.ok(body.raceDistance - startRace > 2, `raceDistance should increase, got ${body.raceDistance - startRace}`)
  world.dispose()
})
