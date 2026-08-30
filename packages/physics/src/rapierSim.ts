import RAPIER, {
  ActiveEvents,
  ColliderDesc,
  EventQueue,
  QueryFilterFlags,
  RigidBodyDesc,
} from '@dimforge/rapier3d-compat'
import type { InputFrame, SceneDocument } from '@studio/core'
import { rotatedColliderOffset } from '@studio/core'
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
import {
  CHASSIS_SPAWN_CLEARANCE,
  DEFAULT_VEHICLE_TUNING,
  wheelConnectionY,
  type VehicleTuning,
} from './tuning'
import type {
  PhysicsDebugBuffers,
  RacerDebug,
  RecoveryReason,
  SimEvent,
  WheelDebug,
  WheelHubDebug,
} from './simTelemetry'
import { createVehicleState, syncDerivedMotion, type VehicleState } from './vehicle'

export const FIXED_TIMESTEP = 1 / 60

const GROUP_ROAD = 0x0001
const GROUP_SAND = 0x0002
const GROUP_CHASSIS = 0x0004
const GROUP_PROP = 0x0008

function collisionGroups(membership: number, filter: number): number {
  return ((membership & 0xffff) << 16) | (filter & 0xffff)
}

function applyGroups(desc: ColliderDesc, membership: number, filter: number): ColliderDesc {
  const groups = collisionGroups(membership, filter)
  return desc.setCollisionGroups(groups).setSolverGroups(groups)
}

const WHEEL_QUERY_GROUPS = collisionGroups(GROUP_ROAD, GROUP_ROAD)

type ColliderTag = {
  kind: 'road' | 'sand' | 'boost' | 'prop'
  skipWheel?: boolean
}

type RapierRacer = {
  index: number
  body: RAPIER.RigidBody
  controller: RAPIER.DynamicRayCastVehicleController
  chassisCollider: RAPIER.Collider
  handling: HandlingState
  state: VehicleState
  onBoostPad: boolean
  lowSpeedTime: number
  invertedTime: number
  offTrackTime: number
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
  private readonly chassisHandles = new Set<number>()
  private readonly colliderTags = new Map<number, ColliderTag>()
  private events: SimEvent[] = []
  private simTime = 0
  private readonly flatGround: boolean

  constructor(
    bodyCount: number,
    scene: SceneDocument,
    totalLaps: number,
    laterals: number[],
    tuning: VehicleTuning,
    flatGround: boolean,
  ) {
    this.tuning = tuning
    this.flatGround = flatGround
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

    if (flatGround) {
      const halfY = 0.4
      const half = 25000
      const groundDesc = applyGroups(
        ColliderDesc.cuboid(half, halfY, half)
          .setTranslation(0, -halfY, 0)
          .setFriction(1.1)
          .setRestitution(0),
        GROUP_ROAD,
        GROUP_ROAD | GROUP_CHASSIS,
      )
      this.colliderTags.set(this.world.createCollider(groundDesc).handle, { kind: 'road' })
    } else {
      const ribbon = buildTrackRibbon(this.samples, this.totalLength, this.halfWidth, this.boostPads)
      const ribbonDesc = applyGroups(
        ColliderDesc.trimesh(ribbon.positions, ribbon.indices).setFriction(1.1).setRestitution(0),
        GROUP_ROAD,
        GROUP_ROAD,
      )
      this.colliderTags.set(this.world.createCollider(ribbonDesc).handle, { kind: 'road' })

      const sandDesc = applyGroups(
        ColliderDesc.cuboid(180, 0.2, 180).setTranslation(0, -0.35, 0).setFriction(0.85),
        GROUP_SAND,
        GROUP_CHASSIS | GROUP_SAND,
      )
      const sand = this.world.createCollider(sandDesc)
      this.colliderTags.set(sand.handle, { kind: 'sand' })

      for (const pad of ribbon.boostPads) {
        const halfX = 2.25
        const halfY = 0.08
        const halfZ = 1.6
        const chassisY = this.tuning.chassisOffset[1]
        const desc = ColliderDesc.cuboid(halfX, halfY, halfZ)
          .setTranslation(pad.position.x, pad.position.y + chassisY, pad.position.z)
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
        const [tx, ty, tz] = rotatedColliderOffset(entity.collider.offset, entity.rotationY, entity.scale)
        const desc = applyGroups(
          ColliderDesc.cuboid(hx * entity.scale, hy * entity.scale, hz * entity.scale)
            .setTranslation(entity.position[0] + tx, entity.position[1] + ty, entity.position[2] + tz)
            .setFriction(0.9),
          GROUP_PROP,
          GROUP_CHASSIS,
        )
        const collider = this.world.createCollider(desc)
        this.colliderTags.set(collider.handle, { kind: 'prop' })
      }
    }

    const start = this.spawnSample()
    this.bodies = []
    for (let i = 0; i < bodyCount; i++) {
      const state = createVehicleState(start, laterals[i] ?? 0)
      state.lastProgress = projectOntoTrack(this.samples, state.position, this.totalLength).progress
      state.progress = state.lastProgress
      state.checkpointIndex = initialCheckpointIndex(state.lastProgress, this.checkpointProgresses)
      state.raceDistance = state.lastProgress
      this.bodies.push(state)
      this.racers.push(this.spawnRacer(state, i))
    }
  }

  private spawnRacer(state: VehicleState, index: number): RapierRacer {
    const bodyDesc = RigidBodyDesc.dynamic()
      .setTranslation(state.position.x, state.position.y, state.position.z)
      .setRotation({ x: state.rotation.x, y: state.rotation.y, z: state.rotation.z, w: state.rotation.w })
      .setLinearDamping(this.tuning.linearDamping)
      .setAngularDamping(this.tuning.angularDamping)
    const body = this.world.createRigidBody(bodyDesc)

    const [hx, hy, hz] = this.tuning.chassisHalfExtents
    const [cx, cy, cz] = this.tuning.chassisOffset
    const chassisFilter = this.flatGround
      ? GROUP_SAND | GROUP_PROP | GROUP_CHASSIS | GROUP_ROAD
      : GROUP_SAND | GROUP_PROP | GROUP_CHASSIS
    const chassisDesc = applyGroups(
      ColliderDesc.cuboid(hx, hy, hz)
        .setTranslation(cx, cy, cz)
        .setMassProperties(
          this.tuning.mass,
          { x: 0, y: 0.28, z: 0 },
          { x: 150, y: 200, z: 70 },
          { x: 0, y: 0, z: 0, w: 1 },
        )
        .setFriction(0.25)
        .setRestitution(0)
        .setActiveEvents(ActiveEvents.COLLISION_EVENTS),
      GROUP_CHASSIS,
      chassisFilter,
    )
    const chassisCollider = this.world.createCollider(chassisDesc, body)
    this.chassisHandles.add(chassisCollider.handle)
    if (body.mass() < this.tuning.mass * 0.5) {
      throw new Error(`Chassis mass ${body.mass()} is far below tuning ${this.tuning.mass}`)
    }

    const controller = this.world.createVehicleController(body)
    this.configureWheels(controller)

    return {
      index,
      body,
      controller,
      chassisCollider,
      handling: createHandlingState(),
      state,
      onBoostPad: false,
      lowSpeedTime: 0,
      invertedTime: 0,
      offTrackTime: 0,
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
      const grounded = racer.state.wheelContacts.filter(Boolean).length

      for (let wheelIndex = 0; wheelIndex < 4; wheelIndex++) {
        // Rapier wheel forward is -Z; the mesh nose, heading, and camera look along +Z.
        const driven = grounded >= 2
        racer.controller.setWheelEngineForce(wheelIndex, driven ? -commands.engineForce : 0)
        racer.controller.setWheelBrake(
          wheelIndex,
          grounded >= 3 ? commands.brake * (wheelIndex >= 2 ? 1 : 0.2) : 0,
        )
        const steer = wheelIndex < 2 ? commands.steerAngle : 0
        racer.controller.setWheelSteering(wheelIndex, steer)
      }

      if (commands.boostImpulse > 0 && grounded >= 3) {
        const rot = racer.body.rotation()
        const quat = new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w)
        const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(quat)
        const lv = racer.body.linvel()
        const add = commands.boostImpulse * dt
        racer.body.setLinvel(
          {
            x: lv.x + forward.x * add,
            y: lv.y,
            z: lv.z + forward.z * add,
          },
          true,
        )
      }

      const boostCutoff = this.tuning.maxSpeed * 0.85
      const downScale =
        racer.handling.boostTimer > 0 && speed > boostCutoff
          ? Math.max(0, 1 - (speed - boostCutoff) / (this.tuning.maxSpeed * 0.15))
          : 1
      const down = (4 + this.tuning.downforce * speed * 0.02) * dt * downScale
      const lv = racer.body.linvel()
      racer.body.setLinvel({ x: lv.x, y: lv.y - down, z: lv.z }, true)
      this.keepUpright(racer, dt)

      racer.controller.updateVehicle(dt, QueryFilterFlags.EXCLUDE_SENSORS, WHEEL_QUERY_GROUPS, (collider) => {
        if (this.chassisHandles.has(collider.handle)) return false
        const tag = this.colliderTags.get(collider.handle)
        if (!tag || tag.skipWheel || tag.kind === 'sand') return false
        return tag.kind === 'road'
      })
      this.clampMotion(racer)
    }

    this.world.step(this.eventQueue)
    this.drainCollisionEvents()

    for (let i = 0; i < this.racers.length; i++) {
      this.syncRacer(this.racers[i]!)
      this.bodies[i] = this.racers[i]!.state
    }

    this.simTime += dt
    this.updatePlaces()
  }

  private syncRacer(racer: RapierRacer): void {
    this.clampMotion(racer)
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

    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(racer.state.rotation)
    racer.invertedTime = up.y < 0.25 ? racer.invertedTime + this.timestep : 0

    const proj = projectOntoTrack(this.samples, racer.state.position, this.totalLength)
    if (racer.state.offTrackDistance > 0) racer.offTrackTime += this.timestep
    else racer.offTrackTime = 0
    const offTrack = !this.flatGround && racer.offTrackTime > 0.45
    const stuck =
      !this.flatGround &&
      racer.lowSpeedTime > this.tuning.recoveryStuckSeconds &&
      Math.abs(proj.lateral) > this.halfWidth
    const airborne = racer.state.airborneTime > 2.5
    const inverted = racer.invertedTime > 1.1
    if (offTrack || stuck || airborne || inverted) {
      const reason: RecoveryReason = inverted ? 'inverted' : airborne ? 'airborne' : offTrack ? 'offTrack' : 'stuck'
      const reset = proj.nearest
        .clone()
        .add(this.samples[proj.sampleIndex].binormal.clone().multiplyScalar(Math.sign(proj.lateral || 1) * 0.5))
      reset.y += CHASSIS_SPAWN_CLEARANCE
      const heading = Math.atan2(this.samples[proj.sampleIndex].tangent.x, this.samples[proj.sampleIndex].tangent.z)
      const rot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), heading)
      this.teleportInternal(racer, reset, rot, reason)
    }
  }

  private drainCollisionEvents(): void {
    const clock = this.simTime + this.timestep
    this.eventQueue.drainCollisionEvents((a, b, started) => {
      if (!started) return
      for (const racer of this.racers) {
        const other = a === racer.chassisCollider.handle ? b : b === racer.chassisCollider.handle ? a : null
        if (other == null) continue
        if (this.boostColliderHandles.has(other)) {
          racer.onBoostPad = true
          this.events.push({ simClock: clock, racer: racer.index, type: 'boost' })
        } else {
          racer.state.collisionCount += 1
          this.events.push({ simClock: clock, racer: racer.index, type: 'collision' })
        }
      }
    })
  }

  private spawnSample(): TrackSample {
    if (this.flatGround) {
      return {
        position: new THREE.Vector3(0, 0, 0),
        tangent: new THREE.Vector3(0, 0, 1),
        normal: new THREE.Vector3(0, 1, 0),
        binormal: new THREE.Vector3(1, 0, 0),
      }
    }
    return sampleAtProgress(this.samples, this.totalLength, 2)
  }

  plantOnStartGrid(laterals: number[]): void {
    const start = this.spawnSample()
    for (let i = 0; i < this.racers.length; i++) {
      const pos = start.position
        .clone()
        .add(start.binormal.clone().multiplyScalar(laterals[i] ?? 0))
        .add(new THREE.Vector3(0, CHASSIS_SPAWN_CLEARANCE, 0))
      const heading = Math.atan2(start.tangent.x, start.tangent.z)
      const rot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), heading)
      this.teleportInternal(this.racers[i]!, pos, rot)
      this.syncRacer(this.racers[i]!)
      this.bodies[i] = this.racers[i]!.state
    }
  }

  holdForCountdown(): void {
    for (const racer of this.racers) {
      const euler = new THREE.Euler().setFromQuaternion(
        new THREE.Quaternion(
          racer.body.rotation().x,
          racer.body.rotation().y,
          racer.body.rotation().z,
          racer.body.rotation().w,
        ),
        'YXZ',
      )
      const rot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), euler.y)
      racer.body.setRotation({ x: rot.x, y: rot.y, z: rot.z, w: rot.w }, true)
      const av = racer.body.angvel()
      racer.body.setAngvel({ x: 0, y: av.y * 0.4, z: 0 }, true)
      const lv = racer.body.linvel()
      racer.body.setLinvel({ x: lv.x * 0.7, y: Math.min(lv.y, 0.4), z: lv.z * 0.7 }, true)
    }
  }

  teleport(index: number, position: THREE.Vector3, rotation: THREE.Quaternion): void {
    const racer = this.racers[index]
    if (!racer) return
    this.teleportInternal(racer, position, rotation)
    this.syncRacer(racer)
    this.bodies[index] = racer.state
  }

  debugRender(): PhysicsDebugBuffers {
    const buffers = this.world.debugRender()
    return { vertices: buffers.vertices, colors: buffers.colors }
  }

  debugWheelHubs(): WheelHubDebug[] {
    const hubs: WheelHubDebug[] = []
    for (const racer of this.racers) {
      const t = racer.body.translation()
      const r = racer.body.rotation()
      const quat = new THREE.Quaternion(r.x, r.y, r.z, r.w)
      const bodyPos = new THREE.Vector3(t.x, t.y, t.z)
      for (let i = 0; i < racer.controller.numWheels(); i++) {
        const wheel = this.tuning.wheels[i]!
        const hub = new THREE.Vector3(wheel.offsetX, wheelConnectionY(wheel), wheel.offsetZ)
          .applyQuaternion(quat)
          .add(bodyPos)
        hubs.push({
          racerIndex: racer.index,
          wheelIndex: i,
          position: [hub.x, hub.y, hub.z],
          radius: wheel.radius,
          contact: racer.controller.wheelIsInContact(i),
        })
      }
    }
    return hubs
  }

  debugRacer(index: number): RacerDebug | undefined {
    const racer = this.racers[index]
    if (!racer) return undefined
    const t = racer.body.translation()
    const lv = racer.body.linvel()
    const av = racer.body.angvel()
    const euler = new THREE.Euler().setFromQuaternion(racer.state.rotation, 'YXZ')
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(racer.state.rotation)
    const wheels: WheelDebug[] = []
    for (let i = 0; i < racer.controller.numWheels(); i++) {
      const normal = racer.controller.wheelContactNormal(i)
      const point = racer.controller.wheelContactPoint(i)
      wheels.push({
        contact: racer.controller.wheelIsInContact(i),
        suspensionForce: racer.controller.wheelSuspensionForce(i) ?? 0,
        suspensionLength: racer.controller.wheelSuspensionLength(i) ?? 0,
        forwardImpulse: racer.controller.wheelForwardImpulse(i) ?? 0,
        sideImpulse: racer.controller.wheelSideImpulse(i) ?? 0,
        contactNormal: normal ? [normal.x, normal.y, normal.z] : null,
        contactPoint: point ? [point.x, point.y, point.z] : null,
      })
    }
    return {
      index,
      position: [t.x, t.y, t.z],
      linvel: [lv.x, lv.y, lv.z],
      angvel: [av.x, av.y, av.z],
      heading: racer.state.heading,
      speed: racer.state.speed,
      raceDistance: racer.state.raceDistance,
      airborneTime: racer.state.airborneTime,
      offTrackDistance: racer.state.offTrackDistance,
      collisionCount: racer.state.collisionCount,
      onBoostPad: racer.onBoostPad,
      boostTimer: racer.state.boostTimer,
      roll: Math.abs(euler.z),
      pitch: Math.abs(euler.x),
      upY: up.y,
      wheels,
    }
  }

  drainEvents(): SimEvent[] {
    const out = this.events
    this.events = []
    return out
  }

  private teleportInternal(
    racer: RapierRacer,
    position: THREE.Vector3,
    rotation: THREE.Quaternion,
    reason?: RecoveryReason,
  ): void {
    if (reason) {
      this.events.push({
        simClock: this.simTime + this.timestep,
        racer: racer.index,
        type: 'recovery',
        reason,
      })
    }
    racer.body.setTranslation({ x: position.x, y: position.y, z: position.z }, true)
    racer.body.setRotation({ x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w }, true)
    racer.body.setLinvel({ x: 0, y: 0, z: 0 }, true)
    racer.body.setAngvel({ x: 0, y: 0, z: 0 }, true)
    racer.lowSpeedTime = 0
    racer.invertedTime = 0
    racer.offTrackTime = 0
    racer.state.airborneTime = 0
    racer.state.wheelContacts = [false, false, false, false]
    racer.state.speed = 0
    this.world.removeVehicleController(racer.controller)
    racer.controller = this.world.createVehicleController(racer.body)
    this.configureWheels(racer.controller)
  }

  private configureWheels(controller: RAPIER.DynamicRayCastVehicleController): void {
    for (let i = 0; i < this.tuning.wheels.length; i++) {
      const wheel = this.tuning.wheels[i]!
      controller.addWheel(
        { x: wheel.offsetX, y: wheelConnectionY(wheel), z: wheel.offsetZ },
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
  }

  private clampMotion(racer: RapierRacer): void {
    const cap = this.tuning.maxSpeed
    const lv = racer.body.linvel()
    const horizontal = Math.hypot(lv.x, lv.z)
    const vy = Math.max(-18, Math.min(18, lv.y))
    if (horizontal > cap) {
      const scale = cap / horizontal
      racer.body.setLinvel({ x: lv.x * scale, y: vy, z: lv.z * scale }, true)
    } else if (vy !== lv.y) {
      racer.body.setLinvel({ x: lv.x, y: vy, z: lv.z }, true)
    }
    const av = racer.body.angvel()
    const spin = Math.hypot(av.x, av.y, av.z)
    if (spin > 10) {
      const scale = 10 / spin
      racer.body.setAngvel({ x: av.x * scale, y: av.y * scale, z: av.z * scale }, true)
    }
  }

  private keepUpright(racer: RapierRacer, dt: number): void {
    const rot = racer.body.rotation()
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(
      new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w),
    )
    if (up.y >= 0.94) return
    const axis = new THREE.Vector3().crossVectors(up, new THREE.Vector3(0, 1, 0))
    if (axis.lengthSq() < 1e-6) return
    axis.normalize()
    const grounded = racer.state.wheelContacts.filter(Boolean).length
    const strength = grounded > 0 ? 22 : 10
    const av = racer.body.angvel()
    racer.body.setAngvel(
      {
        x: av.x + axis.x * (1 - up.y) * strength * dt,
        y: av.y,
        z: av.z + axis.z * (1 - up.y) * strength * dt,
      },
      true,
    )
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
    flatGround?: boolean
  } = {},
): RapierSimulation {
  const laterals = options.laterals ?? [1.8, -1.8, 4.2, -4.2]
  return new RapierSimulation(
    bodyCount,
    scene,
    options.totalLaps ?? 3,
    laterals,
    options.tuning ?? DEFAULT_VEHICLE_TUNING,
    options.flatGround ?? false,
  )
}
