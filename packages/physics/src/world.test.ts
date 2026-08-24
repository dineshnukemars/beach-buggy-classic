import assert from 'node:assert/strict'
import { test } from 'node:test'
import { emptyInput } from '@studio/core'
import { projectOntoTrack } from './track'
import { World } from './world'

test('World keeps vehicles on the track and finite', () => {
  const world = new World(1)
  const throttle = { throttle: 1, steer: 0, brake: 0, boost: false }
  for (let i = 0; i < 60; i++) world.step(1 / 30, [throttle])
  const p = world.bodies[0].position
  assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z))
  assert.ok(world.bodies[0].speed > 1)
})

test('lateral walls push the vehicle back inside halfWidth', () => {
  const world = new World(1)
  const body = world.bodies[0]
  const side = world.samples[0].binormal
  body.position.addScaledVector(side, world.halfWidth + 8)
  world.step(1 / 30, [emptyInput()])
  const { lateral } = projectOntoTrack(world.samples, body.position, world.totalLength)
  assert.ok(Math.abs(lateral) < world.halfWidth)
})

test('progress wrap increments lap', () => {
  const world = new World(1, { totalLaps: 3 })
  const body = world.bodies[0]
  body.lastProgress = world.totalLength - 0.01
  const start = world.samples[0].position.clone()
  body.position.copy(start)
  world.step(1 / 60, [emptyInput()])
  assert.equal(body.lap, 2)
})
