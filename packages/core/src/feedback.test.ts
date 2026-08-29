import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  computeAgentHints,
  makeFeedbackId,
  parseFeedbackReport,
  parsePoseHistory,
  serializePoseHistory,
  type FeedbackReport,
  type PoseHistorySample,
} from './feedback'
import { parseStudioRef } from './studioRef'

function sampleReport(): FeedbackReport {
  return {
    version: 1,
    id: '2026-08-28T143022-environment-env-palm-12',
    createdAt: '2026-08-28T14:30:22.000Z',
    issue: { tags: ['misaligned'], note: 'palm sits in the road' },
    target: {
      kind: 'environment',
      id: 'env:palm-12',
      label: 'Palm tree',
      worldTransform: {
        position: [10, 0, 20],
        quaternion: [0, 0, 0, 1],
        scale: 1,
      },
    },
    context: {
      sceneId: 'beach-default',
      scenePath: '/scenes/default.json',
      phase: 'racing',
      simClock: 12.4,
      player: {
        place: 2,
        lap: 1,
        speed: 18,
        airborneTime: 0,
        collisionCount: 1,
        offTrackDistance: 0.2,
        wheelContacts: [true, true, true, true],
      },
      camera: { position: [0, 5, -10], quaternion: [0, 0, 0, 1] },
      environment: { palmCount: 28, palmRadiusBase: 68, palmRadiusStep: 4, angleOffset: 0.2 },
    },
    attachments: { screenshot: 'screenshot.png', poseHistory: 'pose-history.jsonl' },
    agentHints: { likelyLayer: 'code', files: ['games/beach-buggy/src/visuals.ts'] },
  }
}

test('parseStudioRef accepts a tagged object', () => {
  const ref = parseStudioRef({ kind: 'racer', id: 'racer:0', assetId: 'buggy', label: 'You' })
  assert.equal(ref.kind, 'racer')
  assert.equal(ref.assetId, 'buggy')
})

test('parseStudioRef rejects unknown kind', () => {
  assert.throws(() => parseStudioRef({ kind: 'vehicle-part', id: 'wheel' }))
})

test('parseFeedbackReport accepts a valid report', () => {
  const report = parseFeedbackReport(sampleReport())
  assert.equal(report.target.id, 'env:palm-12')
  assert.equal(report.context.player.collisionCount, 1)
})

test('parseFeedbackReport rejects path-like ids', () => {
  const bad = sampleReport()
  bad.id = '../secret'
  assert.throws(() => parseFeedbackReport(bad))
})

test('parseFeedbackReport rejects bad version', () => {
  assert.throws(() => parseFeedbackReport({ ...sampleReport(), version: 2 }))
})

test('computeAgentHints routes environment to visuals.ts', () => {
  const hints = computeAgentHints({
    kind: 'environment',
    tags: ['misaligned'],
    scenePath: '/scenes/default.json',
  })
  assert.equal(hints.likelyLayer, 'code')
  assert.deepEqual(hints.files, ['games/beach-buggy/src/visuals.ts'])
})

test('computeAgentHints routes jumpy racer to tuning and handling', () => {
  const hints = computeAgentHints({
    kind: 'racer',
    tags: ['jumpy'],
    scenePath: '/scenes/default.json',
  })
  assert.equal(hints.likelyLayer, 'physics')
  assert.ok(hints.files.includes('games/beach-buggy/public/tuning/buggy-default.json'))
})

test('makeFeedbackId is filesystem-safe', () => {
  const id = makeFeedbackId({ kind: 'environment', id: 'env:palm-12' }, new Date('2026-08-28T14:30:22.000Z'))
  assert.equal(id, '2026-08-28T143022-environment-env-palm-12')
})

test('pose history round-trips as JSONL', () => {
  const samples: PoseHistorySample[] = [
    {
      simClock: 1.2,
      player: {
        position: [1, 0.5, 2],
        quaternion: [0, 0, 0, 1],
        speed: 10,
        airborneTime: 0,
        wheelContacts: [true, true, true, true],
        collisionCount: 0,
        offTrackDistance: 0,
      },
    },
  ]
  const text = serializePoseHistory(samples)
  assert.match(text, /\n$/)
  assert.deepEqual(parsePoseHistory(text), samples)
})
