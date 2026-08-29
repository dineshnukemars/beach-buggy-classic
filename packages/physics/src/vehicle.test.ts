import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as THREE from 'three'
import { syncDerivedMotion, type VehicleState } from './vehicle'

test('heading uses yaw so a pitch-up does not spin the camera', () => {
  const state = {
    rotation: new THREE.Quaternion().setFromEuler(new THREE.Euler(1.1, 0.4, 0, 'YXZ')),
    heading: 0,
  } as VehicleState
  syncDerivedMotion(state)
  assert.ok(Math.abs(state.heading - 0.4) < 0.05, `heading=${state.heading}`)
})
