import RAPIER, {
  ActiveEvents,
  ColliderDesc,
  EventQueue,
  QueryFilterFlags,
  RigidBodyDesc,
} from '@dimforge/rapier3d-compat'
import type { InputFrame, SceneDocument } from '@studio/core'
import * as THREE from 'three'
import { applyHandling, createHandlingState, type HandlingState } from './handling'
import { advanceRaceState, checkpointProgresses, defaultCheckpointFractions, initialCheckpointIndex } from './race'
import { buildTrackRibbon } from './trackGeometry'
import {
  projectOntoTrack,
  sampleAtProgress,
  samplesFromSpec,
  trackLength,
  type TrackSample,
} from './track'
import { DEFAULT_VEHICLE_TUNING, type VehicleTuning } from './tuning'
import { createVehicleState, syncDerivedMotion, type VehicleState } from './vehicle'

export const FIXED_TIMESTEP = 1 / 60

type ColliderTag = {
  kind: 'road' | 'sand' | 'boost' | 'prop'
  skipWheel?: boolean
}

type RapierRacer = {
  body: RAPIER.RigidBody
  controller: RAPIER.DynamicRayCastVehicleController
  chassisCollider: RAPIER.Collider
  handling: HandlingState
  state: VehicleState
  onBoostPad: boolean
  lowSpeedTime: number
}

export class RapierSimulation {
  readonly samples: TrackSample[]
  readonly totalLength: number
  readonly halfWidth: number
  readonly boostPads: number[]
  readonly totalLaps: number
  readonly bodies: VehicleState[]
  readonly timestep = FIXED_TIMESTEP
  readonly checkpointFractions: number[]
  readonly checkpointProgresses: number[]

  private readonly world: RAPIER.World
  private readonly eventQueue: EventQueue
  private readonly tuning: VehicleTuning
  private readonly racers: RapierRacer[] = []
  private readonly boostColliderHandles = new Set<number>()
  private readonly skipWheelHandles = new Set<number>()
  private readonly colliderTags = new Map<number, ColliderTag>()
  private simTime = 0

  constructor(
    bodyCount: number,
    scene: SceneDocument,
    totalLaps: number,
    laterals: number[],
    tuning: VehicleTuning,
  ) {
    this.tuning = tuning
    const track = scene.track!
    this.samples = samplesFromSpec(track)
    this.totalLength = trackLength(this.samples)
    this.halfWidth = track.halfWidth
    this.boostPads = track.boostPads
    this.totalLaps = totalLaps
    this.checkpointFractions = defaultCheckpointFractions()
    this.checkpointProgresses = checkpointProgresses(this.checkpointFractions, this.totalLength)

    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 })
    this.world.timestep = FIXED_TIMESTEP
    this.eventQueue = new EventQueue(true)

    const ribbon = buildTrackRibbon(this.samples, this.totalLength, this.halfWidth, this.boostPads)
    const roadDesc = ColliderDesc.trimesh(ribbon.positions, ribbon.indices)
      .setFriction(1.1)
      .setRestitution(0.05)
    const road = this.world.createCollider(roadDesc)
    this.colliderTags.set(road.handle, { kind: 'road' })

    const sandDesc = ColliderDesc.cuboid(180, 0.2, 180)
      .setTranslation(0, -0.35, 0)
      .setFriction(0.85)
    const sand = this.world.createCollider(sandDesc)
    this.colliderTags.set(sand.handle, { kind: 'sand' })

    for (const pad of ribbon.boostPads) {
      const halfX = 2.25
      const halfY = 0.35
      const halfZ = 1.6
      const desc = ColliderDesc.cuboid(halfX, halfY, halfZ)
        .setTranslation(pad.position.x, pad.position.y + halfY, pad.position.z)
        .setSensor(true)
        .setActiveEvents(ActiveEvents.COLLISION_EVENTS)
      const yaw = Math.atan2(pad.tangent.x, pad.tangent.z)
      desc.setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) })
      const collider = this.world.createCollider(desc)
      this.colliderTags.set(collider.handle, { kind: 'boost', skipWheel: true })
      this.boostColliderHandles.add(collider.handle)
      this.skipWheelHandles.add(collider.handle)
    }

    for (const entity of scene.entities) {
      if (!entity.collider) continue
      const [hx, hy, hz] = entity.collider.halfExtents
      const desc = ColliderDesc.cuboid(hx * entity.scale, hy * entity.scale, hz * entity.scale)
        .setTranslation(entity.position[0], entity.position[1], entity.position[2])
        .setFriction(0.9)
      const collider = this.world.createCollider(desc)
      this.colliderTags.set(collider.handle, { kind: 'prop' })
    }

    const start = sampleAtProgress(this.samples, this.totalLength, 2)
    this.bodies = []
    for (let i = 0; i < bodyCount; i++) {
      const state = createVehicleState(start, laterals[i] ?? 0)
      state.lastProgress = projectOntoTrack(this.samples, state.position, this.totalLength).progress
      state.progress = state.lastProgress
      state.checkpointIndex = initialCheckpointIndex(state.lastProgress, this.checkpointProgresses)
      state.raceDistance = state.lastProgress
      this.bodies.push(state)
      this.racers.push(this.spawnRacer(state))
    }
  }

  private spawnRacer(state: VehicleState): RapierRacer {
    const bodyDesc = RigidBodyDesc.dynamic()
      .setTranslation(state.position.x, state.position.y, state.position.z)
      .setRotation({ x: state.rotation.x, y: state.rotation.y, z: state.rotation.z, w: state.rotation.w })
      .setLinearDamping(this.tuning.linearDamping)
      .setAdditionalMass(this.tuning.mass)
    const body = this.world.createRigidBody(bodyDesc)
    body.enableCcd(true)

    const [hx, hy, hz] = this.tuning.chassisHalfExtents
    const chassisDesc = ColliderDesc.cuboid(hx, hy, hz).setTranslation(0, 0.1, 0).setFriction(0.8)
    const chassisCollider = this.world.createCollider(chassisDesc, body)

    const controller = this.world.createVehicleController(body)

    for (let i = 0; i < this.tuning.wheels.length; i++) {
      const wheel = this.tuning.wheels[i]!
      controller.addWheel(
        { x: wheel.offsetX, y: 0.05, z: wheel.offsetZ },
        { x: 0, y: -1, z: 0 },
        { x: 1, y: 0, z: 0 },
        wheel.restLength,
        wheel.radius,
      )
      controller.setWheelSuspensionStiffness(i, this.tuning.suspensionStiffness)
      controller.setWheelSuspensionCompression(i, this.tuning.suspensionCompression)
      controller.setWheelSuspensionRelaxation(i, this.tuning.suspensionRelaxation)
      controller.setWheelMaxSuspensionTravel(i, wheel.maxTravel)
      controller.setWheelMaxSuspensionForce(i, this.tuning.maxSuspensionForce)
      controller.setWheelFrictionSlip(i, this.tuning.frictionSlip)
      controller.setWheelSideFrictionStiffness(i, this.tuning.sideFrictionStiffness)
    }

    return {
      body,
      controller,
      chassisCollider,
      handling: createHandlingState(),
      state,
      onBoostPad: false,
      lowSpeedTime: 0,
    }
  }

  step(dt: number, inputs: InputFrame[]): void {
    if (Math.abs(dt - this.timestep) > 1e-6) {
      throw new Error(`RapierSimulation expects dt=${this.timestep}, received ${dt}`)
    }

    for (let i = 0; i < this.racers.length; i++) {
      const racer = this.racers[i]!
      const input = inputs[i] ?? { throttle: 0, steer: 0, brake: 0, boost: false }
      if (racer.state.finished) {
        racer.body.setLinvel({ x: 0, y: 0, z: 0 }, true)
        racer.body.setAngvel({ x: 0, y: 0, z: 0 }, true)
        continue
      }

      const speed = Math.hypot(racer.body.linvel().x, racer.body.linvel().z)
      const commands = applyHandling(
        racer.handling,
        input,
        speed,
        racer.onBoostPad,
        this.tuning,
        dt,
      )
      racer.state.boostTimer = racer.handling.boostTimer
      racer.onBoostPad = false

      const driveWheels = [0, 1, 2, 3]
      for (const wheelIndex of driveWheels) {
        racer.controller.setWheelEngineForce(wheelIndex, commands.engineForce)
        racer.controller.setWheelBrake(wheelIndex, commands.brake)
        const steer = wheelIndex < 2 ? commands.steerAngle : 0
        racer.controller.setWheelSteering(wheelIndex, steer)
      }

      if (commands.boostImpulse > 0) {
        const rot = racer.body.rotation()
        const quat = new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w)
        const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(quat)
        const lv = racer.body.linvel()
        racer.body.setLinvel(
          {
            x: lv.x + forward.x * commands.boostImpulse * dt,
            y: lv.y,
            z: lv.z + forward.z * commands.boostImpulse * dt,
          },
          true,
        )
      }

      if (speed > 8) {
        const down = this.tuning.downforce * speed * dt
        const lv = racer.body.linvel()
        racer.body.setLinvel({ x: lv.x, y: lv.y - down, z: lv.z }, true)
      }

      racer.controller.updateVehicle(dt, QueryFilterFlags.EXCLUDE_SENSORS, undefined, (collider) => {
        const tag = this.colliderTags.get(collider.handle)
        return !tag?.skipWheel
      })
    }

    this.world.step(this.eventQueue)

    for (const racer of this.racers) {
      const chassisHandle = racer.chassisCollider.handle
      this.eventQueue.drainCollisionEvents((a, b, started) => {
        if (!started) return
        const other = a === chassisHandle ? b : b === chassisHandle ? a : null
        if (other == null) return
        if (this.boostColliderHandles.has(other)) racer.onBoostPad = true
        else racer.state.collisionCount += 1
      })
    }

    for (let i = 0; i < this.racers.length; i++) {
      this.syncRacer(this.racers[i]!)
      this.bodies[i] = this.racers[i]!.state
    }

    this.simTime += dt
    this.updatePlaces()
  }

  private syncRacer(racer: RapierRacer): void {
    const t = racer.body.translation()
    const r = racer.body.rotation()
    const lv = racer.body.linvel()
    racer.state.position.set(t.x, t.y, t.z)
    racer.state.rotation.set(r.x, r.y, r.z, r.w)
    syncDerivedMotion(racer.state)
    racer.state.speed = Math.hypot(lv.x, lv.z)

    racer.state.wheelContacts = []
    let grounded = 0
    for (let i = 0; i < racer.controller.numWheels(); i++) {
      const contact = racer.controller.wheelIsInContact(i)
      racer.state.wheelContacts.push(contact)
      if (contact) grounded += 1
    }
    racer.state.airborneTime = grounded === 0 ? racer.state.airborneTime + this.timestep : 0

    const race = advanceRaceState(
      racer.state,
      this.samples,
      this.totalLength,
      racer.state.position,
      this.checkpointProgresses,
      this.totalLaps,
      this.tuning.recoveryOffTrack,
    )
    racer.state.checkpointIndex = race.checkpointIndex
    racer.state.lap = race.lap
    racer.state.finished = race.finished
    racer.state.raceDistance = race.raceDistance
    racer.state.progress = race.progress
    racer.state.lastProgress = race.progress
    racer.state.lastCheckpointProgress = race.progress
    racer.state.offTrackDistance = race.offTrackDistance

    if (Math.abs(racer.state.speed) < 0.4) racer.lowSpeedTime += this.timestep
    else racer.lowSpeedTime = 0

    if (
      racer.state.offTrackDistance > 0 ||
      racer.lowSpeedTime > this.tuning.recoveryStuckSeconds ||
      racer.state.airborneTime > 2.5
    ) {
      const proj = projectOntoTrack(this.samples, racer.state.position, this.totalLength)
      const reset = proj.nearest
        .clone()
        .add(this.samples[proj.sampleIndex].binormal.clone().multiplyScalar(Math.sign(proj.lateral || 1) * 0.5))
      reset.y += 0.55
      const heading = Math.atan2(this.samples[proj.sampleIndex].tangent.x, this.samples[proj.sampleIndex].tangent.z)
      const rot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), heading)
      this.teleportInternal(racer, reset, rot)
    }
  }

  teleport(index: number, position: THREE.Vector3, rotation: THREE.Quaternion): void {
    const racer = this.racers[index]
    if (!racer) return
    this.teleportInternal(racer, position, rotation)
    this.syncRacer(racer)
    this.bodies[index] = racer.state
  }

  private teleportInternal(racer: RapierRacer, position: THREE.Vector3, rotation: THREE.Quaternion): void {
    racer.body.setTranslation({ x: position.x, y: position.y, z: position.z }, true)
    racer.body.setRotation({ x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w }, true)
    racer.body.setLinvel({ x: 0, y: 0, z: 0 }, true)
    racer.body.setAngvel({ x: 0, y: 0, z: 0 }, true)
    racer.lowSpeedTime = 0
    racer.state.airborneTime = 0
  }

  onBoostPad(state: VehicleState): boolean {
    const racer = this.racers.find((r) => r.state === state)
    return racer?.onBoostPad ?? false
  }

  get simClock(): number {
    return this.simTime
  }

  private updatePlaces(): void {
    const sorted = [...this.bodies].sort((a, b) => b.raceDistance - a.raceDistance)
    sorted.forEach((body, i) => {
      body.place = i + 1
    })
  }

  dispose(): void {
    this.eventQueue.free()
    this.world.free()
  }
}

export function createRapierSimulation(
  bodyCount: number,
  scene: SceneDocument,
  options: {
    totalLaps?: number
    laterals?: number[]
    tuning?: VehicleTuning
  } = {},
): RapierSimulation {
  const laterals = options.laterals ?? [1.8, -1.8, 4.2, -4.2]
  return new RapierSimulation(
    bodyCount,
    scene,
    options.totalLaps ?? 3,
    laterals,
    options.tuning ?? DEFAULT_VEHICLE_TUNING,
  )
}
