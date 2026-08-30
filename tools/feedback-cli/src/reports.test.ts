import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { writeFeedbackBundle } from '../../../games/beach-buggy/feedbackWrite.ts'
import { latestReport, listReports, showReport } from './reports.ts'

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), '../fixtures')
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

test('listReports reads the example fixture', () => {
  const rows = listReports(fixtureDir)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].id, '2026-08-28T143022-environment-env-palm-12')
})

test('latestReport and showReport return the fixture', () => {
  const latest = latestReport(fixtureDir)
  const shown = showReport(fixtureDir, latest.id)
  assert.equal(shown.report.target.id, 'env:palm-12')
  assert.equal(shown.report.agentHints.likelyLayer, 'code')
})

test('writeFeedbackBundle writes a parseable report folder', () => {
  const root = mkdtempSync(join(tmpdir(), 'feedback-'))
  const report = JSON.parse(readFileSync(join(fixtureDir, 'example/report.json'), 'utf8'))
  const written = writeFeedbackBundle(root, {
    report,
    screenshotPngBase64: PNG,
    poseHistoryJsonl: '{"simClock":1,"player":{"position":[0,0,0],"quaternion":[0,0,0,1],"speed":0,"airborneTime":0,"wheelContacts":[true,true,true,true],"collisionCount":0,"offTrackDistance":0}}\n',
  })
  const listed = listReports(root)
  assert.equal(listed[0]?.id, written.id)
  assert.ok(readFileSync(join(root, written.id, 'screenshot.png')).length > 0)
})
