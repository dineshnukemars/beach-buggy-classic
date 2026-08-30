import type { SceneEntity, Vec3Tuple } from './scene'
import { parseStudioRef, type StudioRef, type StudioRefKind } from './studioRef'

export const FEEDBACK_TAGS = [
  'jumpy',
  'misaligned',
  'floating',
  'sinking',
  'z-fighting',
  'wrong-scale',
  'wrong-rotation',
  'collision-mismatch',
  'performance',
  'other',
] as const

export type FeedbackTag = (typeof FEEDBACK_TAGS)[number]

export const FEEDBACK_LAYERS = ['scene', 'tuning', 'asset', 'render', 'physics', 'code'] as const

export type FeedbackLayer = (typeof FEEDBACK_LAYERS)[number]

export type QuatTuple = [number, number, number, number]

export type WorldTransform = {
  position: Vec3Tuple
  quaternion: QuatTuple
  heading?: number
  rotationY?: number
  scale: Vec3Tuple | number
}

export type FeedbackPlayerContext = {
  place: number
  lap: number
  speed: number
  airborneTime: number
  collisionCount: number
  offTrackDistance: number
  wheelContacts: boolean[]
}

export type EnvironmentGeneration = {
  palmCount: number
  palmRadiusBase: number
  palmRadiusStep: number
  angleOffset: number
}

export type AgentHints = {
  likelyLayer: FeedbackLayer
  files: string[]
}

export type FeedbackReport = {
  version: 1
  id: string
  createdAt: string
  issue: { tags: FeedbackTag[]; note: string }
  target: StudioRef & {
    worldTransform: WorldTransform
    boundingBox?: { min: Vec3Tuple; max: Vec3Tuple }
    sceneEntity?: SceneEntity
  }
  context: {
    sceneId: string
    scenePath: string
    phase: string
    simClock: number
    player: FeedbackPlayerContext
    camera: { position: Vec3Tuple; quaternion: QuatTuple }
    environment?: EnvironmentGeneration
  }
  attachments: {
    screenshot: string
    poseHistory: string
    frames?: string
  }
  agentHints: AgentHints
}

export type PoseHistorySample = {
  simClock: number
  targetId?: string
  player: {
    position: Vec3Tuple
    quaternion: QuatTuple
    speed: number
    airborneTime: number
    wheelContacts: boolean[]
    collisionCount: number
    offTrackDistance: number
  }
}

export const FEEDBACK_ID_PATTERN = /^[A-Za-z0-9._-]+$/

export function isFeedbackTag(value: string): value is FeedbackTag {
  return (FEEDBACK_TAGS as readonly string[]).includes(value)
}

export function isFeedbackLayer(value: string): value is FeedbackLayer {
  return (FEEDBACK_LAYERS as readonly string[]).includes(value)
}

export function makeFeedbackId(ref: Pick<StudioRef, 'kind' | 'id'>, at = new Date()): string {
  const stamp = at.toISOString().replace(/:/g, '').replace(/\.\d+Z$/, '')
  const slug = `${ref.kind}-${ref.id}`.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  return `${stamp}-${slug}`
}

export function sceneFileFromPath(scenePath: string): string {
  const file = scenePath.replace(/^\//, '')
  return `games/beach-buggy/public/${file}`
}

export function computeAgentHints(input: {
  kind: StudioRefKind
  tags: readonly FeedbackTag[]
  scenePath: string
}): AgentHints {
  const sceneFile = sceneFileFromPath(input.scenePath)
  const visuals = 'games/beach-buggy/src/visuals.ts'
  const tuning = 'games/beach-buggy/public/tuning/buggy-default.json'
  const handling = 'packages/physics/src/handling.ts'
  if (input.kind === 'entity') {
    return { likelyLayer: 'scene', files: [sceneFile] }
  }
  if (input.kind === 'environment') {
    return { likelyLayer: 'code', files: [visuals] }
  }
  if (input.kind === 'track') {
    return { likelyLayer: 'scene', files: [sceneFile, visuals] }
  }
  if (input.tags.includes('jumpy') || input.tags.includes('collision-mismatch')) {
    return { likelyLayer: input.tags.includes('jumpy') ? 'physics' : 'tuning', files: [tuning, handling] }
  }
  return { likelyLayer: 'tuning', files: [tuning] }
}

export function parseFeedbackReport(raw: unknown): FeedbackReport {
  if (!raw || typeof raw !== 'object') throw new Error('FeedbackReport must be an object')
  const rec = raw as Record<string, unknown>
  if (rec.version !== 1) throw new Error('FeedbackReport.version must be 1')
  if (typeof rec.id !== 'string' || !FEEDBACK_ID_PATTERN.test(rec.id)) {
    throw new Error('FeedbackReport.id must match [A-Za-z0-9._-]+')
  }
  if (typeof rec.createdAt !== 'string' || !rec.createdAt) throw new Error('FeedbackReport.createdAt required')
  const issue = parseIssue(rec.issue)
  const target = parseTarget(rec.target)
  const context = parseContext(rec.context)
  const attachments = parseAttachments(rec.attachments)
  const agentHints = parseHints(rec.agentHints)
  return {
    version: 1,
    id: rec.id,
    createdAt: rec.createdAt,
    issue,
    target,
    context,
    attachments,
    agentHints,
  }
}

export function serializePoseHistory(samples: readonly PoseHistorySample[]): string {
  if (samples.length === 0) return ''
  return samples.map((s) => JSON.stringify(s)).join('\n') + '\n'
}

export function parsePoseHistory(text: string): PoseHistorySample[] {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
  return lines.map((line, i) => {
    let raw: unknown
    try {
      raw = JSON.parse(line)
    } catch {
      throw new Error(`pose-history.jsonl line ${i + 1} is not JSON`)
    }
    return parsePoseSample(raw)
  })
}

function parseIssue(raw: unknown): FeedbackReport['issue'] {
  if (!raw || typeof raw !== 'object') throw new Error('issue must be an object')
  const rec = raw as Record<string, unknown>
  if (!Array.isArray(rec.tags) || rec.tags.length === 0) throw new Error('issue.tags required')
  const tags: FeedbackTag[] = []
  for (const tag of rec.tags) {
    if (typeof tag !== 'string' || !isFeedbackTag(tag)) throw new Error(`unknown feedback tag: ${String(tag)}`)
    tags.push(tag)
  }
  if (typeof rec.note !== 'string') throw new Error('issue.note must be a string')
  return { tags, note: rec.note }
}

function parseTarget(raw: unknown): FeedbackReport['target'] {
  const ref = parseStudioRef(raw)
  if (!raw || typeof raw !== 'object') throw new Error('target must be an object')
  const rec = raw as Record<string, unknown>
  const worldTransform = parseWorldTransform(rec.worldTransform)
  const target: FeedbackReport['target'] = { ...ref, worldTransform }
  if (rec.boundingBox !== undefined) target.boundingBox = parseBox(rec.boundingBox)
  if (rec.sceneEntity !== undefined) target.sceneEntity = parseSceneEntitySlice(rec.sceneEntity)
  return target
}

function parseWorldTransform(raw: unknown): WorldTransform {
  if (!raw || typeof raw !== 'object') throw new Error('worldTransform must be an object')
  const rec = raw as Record<string, unknown>
  const transform: WorldTransform = {
    position: parseVec3(rec.position, 'worldTransform.position'),
    quaternion: parseQuat(rec.quaternion, 'worldTransform.quaternion'),
    scale: parseScale(rec.scale),
  }
  if (rec.heading !== undefined) {
    if (typeof rec.heading !== 'number' || !Number.isFinite(rec.heading)) {
      throw new Error('worldTransform.heading must be a number')
    }
    transform.heading = rec.heading
  }
  if (rec.rotationY !== undefined) {
    if (typeof rec.rotationY !== 'number' || !Number.isFinite(rec.rotationY)) {
      throw new Error('worldTransform.rotationY must be a number')
    }
    transform.rotationY = rec.rotationY
  }
  return transform
}

function parseContext(raw: unknown): FeedbackReport['context'] {
  if (!raw || typeof raw !== 'object') throw new Error('context must be an object')
  const rec = raw as Record<string, unknown>
  if (typeof rec.sceneId !== 'string' || !rec.sceneId) throw new Error('context.sceneId required')
  if (typeof rec.scenePath !== 'string' || !rec.scenePath) throw new Error('context.scenePath required')
  if (typeof rec.phase !== 'string' || !rec.phase) throw new Error('context.phase required')
  if (typeof rec.simClock !== 'number' || !Number.isFinite(rec.simClock)) {
    throw new Error('context.simClock must be a number')
  }
  const context: FeedbackReport['context'] = {
    sceneId: rec.sceneId,
    scenePath: rec.scenePath,
    phase: rec.phase,
    simClock: rec.simClock,
    player: parsePlayer(rec.player),
    camera: {
      position: parseVec3((rec.camera as Record<string, unknown> | undefined)?.position, 'camera.position'),
      quaternion: parseQuat((rec.camera as Record<string, unknown> | undefined)?.quaternion, 'camera.quaternion'),
    },
  }
  if (rec.environment !== undefined) context.environment = parseEnvironment(rec.environment)
  return context
}

function parsePlayer(raw: unknown): FeedbackPlayerContext {
  if (!raw || typeof raw !== 'object') throw new Error('context.player must be an object')
  const rec = raw as Record<string, unknown>
  const nums = ['place', 'lap', 'speed', 'airborneTime', 'collisionCount', 'offTrackDistance'] as const
  for (const key of nums) {
    if (typeof rec[key] !== 'number' || !Number.isFinite(rec[key])) {
      throw new Error(`context.player.${key} must be a number`)
    }
  }
  if (!Array.isArray(rec.wheelContacts) || !rec.wheelContacts.every((c) => typeof c === 'boolean')) {
    throw new Error('context.player.wheelContacts must be boolean[]')
  }
  return {
    place: rec.place as number,
    lap: rec.lap as number,
    speed: rec.speed as number,
    airborneTime: rec.airborneTime as number,
    collisionCount: rec.collisionCount as number,
    offTrackDistance: rec.offTrackDistance as number,
    wheelContacts: rec.wheelContacts,
  }
}

function parseAttachments(raw: unknown): FeedbackReport['attachments'] {
  if (!raw || typeof raw !== 'object') throw new Error('attachments must be an object')
  const rec = raw as Record<string, unknown>
  if (typeof rec.screenshot !== 'string' || !rec.screenshot) throw new Error('attachments.screenshot required')
  if (typeof rec.poseHistory !== 'string' || !rec.poseHistory) throw new Error('attachments.poseHistory required')
  const attachments: FeedbackReport['attachments'] = {
    screenshot: rec.screenshot,
    poseHistory: rec.poseHistory,
  }
  if (rec.frames !== undefined) {
    if (typeof rec.frames !== 'string' || !rec.frames) throw new Error('attachments.frames must be a string')
    attachments.frames = rec.frames
  }
  return attachments
}

function parseHints(raw: unknown): AgentHints {
  if (!raw || typeof raw !== 'object') throw new Error('agentHints must be an object')
  const rec = raw as Record<string, unknown>
  if (typeof rec.likelyLayer !== 'string' || !isFeedbackLayer(rec.likelyLayer)) {
    throw new Error('agentHints.likelyLayer invalid')
  }
  if (!Array.isArray(rec.files) || !rec.files.every((f) => typeof f === 'string')) {
    throw new Error('agentHints.files must be string[]')
  }
  return { likelyLayer: rec.likelyLayer, files: rec.files }
}

function parseEnvironment(raw: unknown): EnvironmentGeneration {
  if (!raw || typeof raw !== 'object') throw new Error('context.environment must be an object')
  const rec = raw as Record<string, unknown>
  const keys = ['palmCount', 'palmRadiusBase', 'palmRadiusStep', 'angleOffset'] as const
  for (const key of keys) {
    if (typeof rec[key] !== 'number' || !Number.isFinite(rec[key])) {
      throw new Error(`context.environment.${key} must be a number`)
    }
  }
  return {
    palmCount: rec.palmCount as number,
    palmRadiusBase: rec.palmRadiusBase as number,
    palmRadiusStep: rec.palmRadiusStep as number,
    angleOffset: rec.angleOffset as number,
  }
}

function parseSceneEntitySlice(raw: unknown): SceneEntity {
  if (!raw || typeof raw !== 'object') throw new Error('target.sceneEntity must be an object')
  const rec = raw as Record<string, unknown>
  if (typeof rec.id !== 'string' || !rec.id) throw new Error('sceneEntity.id required')
  if (typeof rec.assetId !== 'string' || !rec.assetId) throw new Error('sceneEntity.assetId required')
  if (typeof rec.rotationY !== 'number' || !Number.isFinite(rec.rotationY)) {
    throw new Error('sceneEntity.rotationY must be a number')
  }
  if (typeof rec.scale !== 'number' || !Number.isFinite(rec.scale)) {
    throw new Error('sceneEntity.scale must be a number')
  }
  return {
    id: rec.id,
    assetId: rec.assetId,
    position: parseVec3(rec.position, 'sceneEntity.position'),
    rotationY: rec.rotationY,
    scale: rec.scale,
  }
}

function parseBox(raw: unknown): { min: Vec3Tuple; max: Vec3Tuple } {
  if (!raw || typeof raw !== 'object') throw new Error('boundingBox must be an object')
  const rec = raw as Record<string, unknown>
  return { min: parseVec3(rec.min, 'boundingBox.min'), max: parseVec3(rec.max, 'boundingBox.max') }
}

function parsePoseSample(raw: unknown): PoseHistorySample {
  if (!raw || typeof raw !== 'object') throw new Error('pose sample must be an object')
  const rec = raw as Record<string, unknown>
  if (typeof rec.simClock !== 'number' || !Number.isFinite(rec.simClock)) {
    throw new Error('pose sample simClock must be a number')
  }
  if (!rec.player || typeof rec.player !== 'object') throw new Error('pose sample player required')
  const player = rec.player as Record<string, unknown>
  const sample: PoseHistorySample = {
    simClock: rec.simClock,
    player: {
      position: parseVec3(player.position, 'player.position'),
      quaternion: parseQuat(player.quaternion, 'player.quaternion'),
      speed: num(player.speed, 'player.speed'),
      airborneTime: num(player.airborneTime, 'player.airborneTime'),
      collisionCount: num(player.collisionCount, 'player.collisionCount'),
      offTrackDistance: num(player.offTrackDistance, 'player.offTrackDistance'),
      wheelContacts: bools(player.wheelContacts, 'player.wheelContacts'),
    },
  }
  if (rec.targetId !== undefined) {
    if (typeof rec.targetId !== 'string') throw new Error('pose sample targetId must be a string')
    sample.targetId = rec.targetId
  }
  return sample
}

function parseVec3(raw: unknown, label: string): Vec3Tuple {
  if (!Array.isArray(raw) || raw.length !== 3 || !raw.every((n) => typeof n === 'number' && Number.isFinite(n))) {
    throw new Error(`${label} must be [x, y, z]`)
  }
  return [raw[0], raw[1], raw[2]]
}

function parseQuat(raw: unknown, label: string): QuatTuple {
  if (!Array.isArray(raw) || raw.length !== 4 || !raw.every((n) => typeof n === 'number' && Number.isFinite(n))) {
    throw new Error(`${label} must be [x, y, z, w]`)
  }
  return [raw[0], raw[1], raw[2], raw[3]]
}

function parseScale(raw: unknown): Vec3Tuple | number {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  return parseVec3(raw, 'worldTransform.scale')
}

function num(raw: unknown, label: string): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) throw new Error(`${label} must be a number`)
  return raw
}

function bools(raw: unknown, label: string): boolean[] {
  if (!Array.isArray(raw) || !raw.every((c) => typeof c === 'boolean')) throw new Error(`${label} must be boolean[]`)
  return raw
}
