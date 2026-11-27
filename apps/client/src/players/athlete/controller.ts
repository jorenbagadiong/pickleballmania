import { Matrix4, Quaternion, Vector3 } from 'three'
import type { Athlete } from './assets'
import { type Grip, gripFor, poseFingers } from './grip'
import { type Hand, WorldMirror, mirrorGrip, mirrorPose, mirrorRest, sideOf } from './handedness'
import { type Twist, reach, stand } from './ik'
import { type Motions, gaitFor, gaitPose } from './locomotion'
import { BONE, BONES, Figure, Pose, type Rest, UPPER, sample } from './skeleton'
import {
  PaddleState,
  READY,
  STROKES,
  type ShotInfo,
  type StrokeName,
  type Swing,
  chooseStroke,
  effort,
  swingOver,
  swingState,
} from './strokes'

/** What the game says about a player this frame. Positions and directions are the world's. */
export interface Input {
  now: number
  delta: number
  /** Ground velocity (m/s), and where the body faces (yaw). */
  vx: number
  vz: number
  yaw: number
  /** 1 in play (low, ready) … 0 between points. */
  alert: number
  /** Where to look, if anywhere. */
  look: Vector3 | null
  /** Holding the ball to serve: where it is. */
  serveBall: Vector3 | null
  mood: 'none' | 'won' | 'lost'
  /** The player's feet. */
  x: number
  z: number
}

const JUMP_SECONDS = 0.62
const JUMP_HEIGHT = 0.66
/** How far the hips go toward a ball that the arm can't reach, and the body slides. */
const MAX_LUNGE = 0.6
const MOOD_FADE = 0.35
/** How fast a hand turns (radians per second), and how far a wrist bends. */
const HAND_SPEED = 30
const MAX_WRIST_BEND = 1.15
const ELBOW_SPEED = 13
const ARM_SPEED = 66
const ARM = [BONE.upperarm_r, BONE.lowerarm_r, BONE.hand_r] as const
/** How quickly motions blend (1/s), and the fastest a joint turns while moving (radians/s). */
const GAIT_BLEND = 11
const JOINT_SPEED = 24

const UP = new Vector3(0, 1, 0)
const RIGHT = new Vector3(1, 0, 0)
const q1 = new Quaternion()
const q2 = new Quaternion()
const q3 = new Quaternion()
const v1 = new Vector3()
const v2 = new Vector3()
const v3 = new Vector3()
const m1 = new Matrix4()

function wrap(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a))
}

/** Moves a value toward a target at a rate that doesn't depend on the frame rate. */
function ease(from: number, to: number, rate: number, delta: number): number {
  return from + (to - from) * (1 - Math.exp(-rate * delta))
}

/**
 * Animates one athlete: captured motions for the body and legs, mixed by speed and
 * direction; strokes on top, with the arm solved so that the paddle meets the ball; feet
 * kept on the ground when the body sinks or lunges. Reads game state, never changes it.
 *
 * Everything below is written for a right-hander. A left-hander is animated as the
 * right-hander in the mirror (see handedness.ts): the body, the grip and what the game
 * says are mirrored on the way in, and the finished pose on the way out.
 */
export class Controller {
  private readonly fig: Figure
  /** Where the joints are at rest on the body being animated (mirrored for a left-hander). */
  private readonly rest: Rest
  private readonly left: boolean
  private readonly mirror = new WorldMirror()
  private readonly mirrored = new Pose()
  private readonly lookAt = new Vector3()
  private readonly ballAt = new Vector3()
  /** The grip on the real paddle hand, and as the (possibly mirrored) body holds it. */
  private readonly handGrip: Grip
  private readonly base = new Pose()
  private readonly pose = new Pose()
  private readonly mood = new Pose()
  private readonly previous = new Pose()
  private started = false
  private readonly mix = new Map<string, number>()
  private readonly grip: Grip
  private phase = Math.random()
  private hips = 0
  private lean = new Vector3()
  private last = { vx: 0, vz: 0 }
  private alert = 0
  private paddleHold = 1
  private readonly paddle = new PaddleState()
  private readonly want = new PaddleState()
  private readonly ready = new PaddleState()
  private swing: Swing | null = null
  private lastStroke: StrokeName | null = null
  private readonly hand = new Quaternion()
  private readonly lastFore = new Quaternion()
  private readonly twist: Twist = { angle: 0 }
  private readonly leftTwist: Twist = { angle: 0 }
  private readonly armWas = ARM.map(() => new Quaternion())
  private leftHold = 0
  private readonly leftAt = new Vector3(0.2, 1, 0.3)
  private jumpAt = -10
  private landing = 0
  /** How far the last swing fell short of a high ball (meters). */
  private short = 0
  private lunge = new Vector3()
  private headYaw = 0
  private headPitch = 0
  private moodAt = -10
  private moodNow: Input['mood'] = 'none'
  private readonly seed = Math.random() * 10
  /** How high off the ground the body is (the name tag follows). */
  lift = 0
  /** Sideways slide of the whole body into a lunge, in the world. */
  readonly slide = new Vector3()

  constructor(
    private readonly athlete: Athlete,
    private readonly motions: Motions,
    readonly paddleHand: Hand = 'right',
  ) {
    this.left = paddleHand === 'left'
    this.rest = this.left ? mirrorRest(athlete.rest) : athlete.rest
    this.fig = new Figure(this.rest)
    this.handGrip = gripFor(athlete, sideOf(paddleHand))
    this.grip = this.left ? mirrorGrip(this.handGrip) : this.handGrip
    poseFingers(athlete, sideOf(paddleHand))
  }

  /** Where the paddle goes in the paddle hand (`paddleBone`). */
  get paddleGrip(): Grip {
    return this.handGrip
  }

  /** The bone that holds the paddle. */
  get paddleBone(): 'hand_r' | 'hand_l' {
    return this.left ? 'hand_l' : 'hand_r'
  }

  /** The last stroke started, as the player would call it (forehand on their paddle side). */
  get stroke(): StrokeName | null {
    return this.lastStroke
  }

  /** Starts a shot. `contact` is in the feet frame; `contactAt` when it meets the ball. */
  hit(now: number, shot: ShotInfo, contactAt: number): void {
    if (this.left) shot = { ...shot, contact: { ...shot.contact, x: -shot.contact.x } }
    const name = chooseStroke(shot)
    this.lastStroke = name
    const stroke = STROKES[name]
    const from = new PaddleState().copy(this.paddle)
    const c = shot.contact
    this.swing = {
      stroke,
      from,
      start: now,
      contactAt: Math.max(now + stroke.swing * 0.6, contactAt),
      contact: new Vector3(c.x, c.y, c.z),
      jump: shot.jump,
      shoulder: this.rest[BONE.upperarm_r]!,
    }
    if (shot.jump) this.jumpAt = now
  }

  /** The ball was really met there and then (feet frame): finish the swing on it. */
  correct(contact: { x: number; y: number; z: number }, contactAt: number, now: number): void {
    const s = this.swing
    if (!s || swingOver(s, now) || s.contactAt < now - 0.12) return
    s.contact.set(this.left ? -contact.x : contact.x, contact.y, contact.z)
    s.contactAt = Math.max(now, Math.min(contactAt, s.contactAt + 0.25))
  }

  get swinging(): boolean {
    return this.swing !== null
  }

  update(input: Input): void {
    if (this.left) input = this.mirrorInput(input)
    const { now, delta } = input
    const dt = Math.min(delta, 0.1)
    this.locomotion(input, dt)
    this.moods(input)
    if (this.swing && swingOver(this.swing, now)) this.swing = null
    const { swing } = this
    const push = swing ? effort(swing, now) : 0

    // ---- paddle
    if (swing) swingState(swing, now, this.want)
    else this.restingPaddle(input)
    this.paddle.copy(this.want)

    // ---- body
    const { pose, fig } = this
    pose.copy(this.base)
    // Standing tall for a high ball.
    const idle = this.motions.idle
    const high = swing ? Math.max(0, Math.min(1, (swing.contact.y - 1.3) / 0.7)) * push : 0
    if (idle && high > 0.01) pose.blend(sample(idle, 0, this.mood), high * 0.85)
    const breath = Math.sin(now * 1.9 + this.seed) * 0.012
    const jump = this.jump(now, dt)
    const bend = this.paddle.bend * Math.max(push, 0.35) + breath + jump.arch
    const turn = this.paddle.turn * Math.max(push, swing ? 1 : 0.6)
    this.turnSpine(turn, bend)
    this.lookAround(input, dt)

    const sink =
      this.paddle.sink * push +
      this.landing * 0.16 +
      (swing ? Math.max(0, 0.75 - swing.contact.y) * 0.2 * push : 0) +
      (1 - Math.min(1, Math.hypot(input.vx, input.vz))) *
        (Math.sin(now * 2.6 + this.seed) * 0.5 + 0.5) *
        0.012 *
        this.alert

    fig.solve(pose)
    const ankleL = fig.p[BONE.foot_l]!.clone()
    const ankleR = fig.p[BONE.foot_r]!.clone()
    const footL = fig.r[BONE.foot_l]!.clone()
    const footR = fig.r[BONE.foot_r]!.clone()
    this.reachFor(swing, push, dt)

    pose.pelvis.y += jump.lift - sink
    // Up on the toes, if that is what it takes.
    const stretch = swing && !swing.jump ? Math.max(0, Math.min(0.09, this.short)) * push : 0
    pose.pelvis.y += stretch
    ankleL.y += stretch
    ankleR.y += stretch
    pose.pelvis.x += this.lunge.x
    pose.pelvis.z += this.lunge.z
    // Leaning into a change of speed, and into a lunge.
    this.tilt(this.lean.z * 0.5 + this.lunge.z * 0.35, -this.lean.x * 0.5 - this.lunge.x * 0.35)
    fig.solve(pose)
    if (jump.air > 0.02) this.legsInAir(jump.air)
    else {
      // Never below the ground, whatever was blended.
      const floorL = this.rest[BONE.foot_l]!.y
      const floorR = this.rest[BONE.foot_r]!.y
      const under = ankleL.y < floorL - 0.004 || ankleR.y < floorR - 0.004
      ankleL.y = Math.max(ankleL.y, floorL)
      ankleR.y = Math.max(ankleR.y, floorR)
      if (under || sink > 0.004 || this.lunge.lengthSq() > 1e-5)
        this.keepFeet(ankleL, ankleR, footL, footR)
    }

    this.arms(input, push, jump.lift)
    this.lift = jump.lift
    this.write()
  }

  /** What the game says, as the mirrored body sees it. */
  private mirrorInput(input: Input): Input {
    const m = this.mirror.set(input.yaw, input.x, input.z)
    const v = m.direction(input.vx, input.vz)
    return {
      ...input,
      vx: v.x,
      vz: v.z,
      look: input.look && m.point(input.look, this.lookAt),
      serveBall: input.serveBall && m.point(input.serveBall, this.ballAt),
    }
  }

  // ---------------------------------------------------------------- layers

  private locomotion(input: Input, dt: number): void {
    const c = Math.cos(input.yaw)
    const s = Math.sin(input.yaw)
    const forward = input.vx * s + input.vz * c
    const left = input.vx * c - input.vz * s
    this.alert = ease(this.alert, input.alert, 4, dt)
    // The captured stance is a defender's, deeper than a pickleball player's.
    const gait = gaitFor(left, forward, this.motions, this.alert * 0.5)
    this.phase = (this.phase + gait.rate * dt) % 1
    // Motions fade into each other, however suddenly the direction changes.
    const k = 1 - Math.exp(-GAIT_BLEND * dt)
    for (const name of Object.keys(this.motions)) {
      const goal = gait.weights.find((x) => x.name === name)?.w ?? 0
      const now = this.mix.get(name) ?? goal
      this.mix.set(name, now + (goal - now) * k)
    }
    gait.weights = [...this.mix].flatMap(([name, w]) => (w > 0.002 ? [{ name, w }] : []))
    gaitPose(gait, this.phase, this.motions, this.base)
    this.limitSpeed(dt)
    this.hips = ease(this.hips, gait.hips, 9, dt)

    // Hips turn into the run; the chest keeps facing the court.
    this.base.get(BONE.pelvis, q1)
    this.base.set(BONE.pelvis, q2.setFromAxisAngle(UP, this.hips).multiply(q1))
    const sway = v1.copy(this.base.pelvis).applyAxisAngle(UP, this.hips)
    this.base.pelvis.x = sway.x
    this.base.pelvis.z = sway.z
    for (const b of [BONE.spine_01, BONE.spine_02, BONE.spine_03]) {
      this.base.get(b, q1)
      this.base.set(b, q2.setFromAxisAngle(UP, -this.hips / 3).multiply(q1))
    }

    // Weight against a change of speed (in the body's frame).
    const ax = (input.vx - this.last.vx) / Math.max(dt, 1e-3)
    const az = (input.vz - this.last.vz) / Math.max(dt, 1e-3)
    this.last.vx = input.vx
    this.last.vz = input.vz
    const clampA = (x: number): number => Math.max(-14, Math.min(14, x)) * 0.02
    this.lean.x = ease(this.lean.x, clampA(ax * c - az * s), 8, dt)
    this.lean.z = ease(this.lean.z, clampA(ax * s + az * c), 8, dt)
  }

  /** Joints only move so fast: whatever was blended, nothing jumps. */
  private limitSpeed(dt: number): void {
    const most = JOINT_SPEED * dt
    for (let b = 0; b < BONES.length; b++) {
      this.base.get(b, q1)
      if (this.started) {
        this.previous.get(b, q2)
        const turn = q2.angleTo(q1)
        if (turn > most) this.base.set(b, q2.slerp(q1, most / turn))
      }
    }
    this.previous.copy(this.base)
    this.started = true
  }

  /** Between points: pleased or disappointed, while not running or swinging. */
  private moods(input: Input): void {
    if (input.mood !== this.moodNow) {
      this.moodNow = input.mood
      this.moodAt = input.now
    }
    const name = input.mood === 'won' ? 'victory' : input.mood === 'lost' ? 'dejected' : null
    const m = name ? this.motions[name] : undefined
    if (!m) return
    const t = input.now - this.moodAt
    const speed = Math.hypot(input.vx, input.vz)
    const w =
      Math.min(1, t / MOOD_FADE) *
      Math.max(0, Math.min(1, (m.seconds - t) / MOOD_FADE)) *
      Math.max(0, 1 - speed)
    if (w <= 0) return
    sample(m, t / m.seconds, this.mood)
    this.base.blend(this.mood, w, UPPER)
  }

  private restingPaddle(input: Input): void {
    const { want, ready } = this
    ready.set(READY)
    if (input.serveBall) {
      // Ball held out front, paddle back and low, about to swing under it.
      ready.set(STROKES.serve.back)
      ready.turn = -0.3
      ready.bend = 0.12
    }
    want.copy(this.paddle).mix(ready, 1 - Math.exp(-7 * Math.min(input.delta, 0.1)))
  }

  private turnSpine(turn: number, bend: number): void {
    const { pose } = this
    const bones = [BONE.spine_01, BONE.spine_02, BONE.spine_03]
    for (const b of bones) {
      pose.get(b, q1)
      q2.setFromAxisAngle(UP, (turn * 0.75) / 3)
      q3.setFromAxisAngle(RIGHT, bend / 3)
      pose.set(b, q2.multiply(q3).multiply(q1))
    }
    // The hips give a little too.
    pose.get(BONE.pelvis, q1)
    pose.set(BONE.pelvis, q2.setFromAxisAngle(UP, turn * 0.25).multiply(q1))
  }

  private tilt(forward: number, side: number): void {
    const { pose } = this
    pose.get(BONE.pelvis, q1)
    q2.setFromAxisAngle(RIGHT, forward)
    q3.setFromAxisAngle(v1.set(0, 0, 1), side)
    pose.set(BONE.pelvis, q2.multiply(q3).multiply(q1))
  }

  /** Eyes on the ball, as far as a neck turns. */
  private lookAround(input: Input, dt: number): void {
    let yaw = 0
    let pitch = 0
    if (input.look) {
      const dx = input.look.x - input.x
      const dz = input.look.z - input.z
      const far = Math.max(0.6, Math.hypot(dx, dz))
      yaw = Math.max(-1.15, Math.min(1.15, wrap(Math.atan2(dx, dz) - input.yaw)))
      pitch = Math.max(-0.5, Math.min(0.6, Math.atan2(1.55 - input.look.y, far)))
    }
    this.headYaw = ease(this.headYaw, yaw, 9, dt)
    this.headPitch = ease(this.headPitch, pitch, 9, dt)
    this.fig.solve(this.pose)
    // Head level and toward the ball, half of it by the neck.
    for (const [b, share] of [
      [BONE.neck_01, 0.5],
      [BONE.head, 1],
    ] as const) {
      q1.setFromAxisAngle(UP, this.headYaw * share + (1 - share) * 0)
      q2.setFromAxisAngle(RIGHT, this.headPitch * share)
      q3.copy(this.fig.r[b]!).slerp(q1.multiply(q2), 0.85)
      this.fig.turn(this.pose, b, q3)
    }
  }

  private jump(now: number, dt: number): { lift: number; air: number; arch: number } {
    const t = (now - this.jumpAt) / JUMP_SECONDS
    if (t < 0 || t > 1) {
      this.landing = ease(this.landing, 0, 7, dt)
      return { lift: 0, air: 0, arch: 0 }
    }
    // A parabola, and the knees give on landing.
    if (t > 0.9) this.landing = 1
    return {
      lift: JUMP_HEIGHT * 4 * t * (1 - t),
      air: Math.min(1, t / 0.14) * Math.min(1, (1 - t) / 0.2),
      arch: t < 0.35 ? -0.12 * Math.sin((t / 0.35) * Math.PI) : 0,
    }
  }

  /** Takeoff leg back, other knee up: a natural scissor. */
  private legsInAir(air: number): void {
    const { fig, pose } = this
    const bendLeg = (thigh: number, calf: number, foot: number, up: number, knee: number): void => {
      q1.setFromAxisAngle(RIGHT, -up)
      q2.copy(fig.r[BONE.pelvis]!).multiply(q1)
      fig.turn(pose, thigh, q3.copy(fig.r[thigh]!).slerp(q2, air))
      pose.get(calf, q1)
      pose.set(calf, q1.slerp(q2.setFromAxisAngle(RIGHT, knee), air))
      pose.get(foot, q1)
      pose.set(foot, q1.slerp(q2.setFromAxisAngle(RIGHT, 0.5), air))
      fig.place(pose, calf)
      fig.place(pose, foot)
    }
    bendLeg(BONE.thigh_l, BONE.calf_l, BONE.foot_l, 0.75, 1.05)
    bendLeg(BONE.thigh_r, BONE.calf_r, BONE.foot_r, -0.2, 0.95)
  }

  /** Hips go toward a ball the arm alone can't reach. */
  private reachFor(swing: Swing | null, push: number, dt: number): void {
    v1.set(0, 0, 0)
    if (swing) {
      const shoulder = this.fig.p[BONE.upperarm_r]!
      const arm =
        this.rest[BONE.upperarm_r]!.distanceTo(this.rest[BONE.lowerarm_r]!) +
        this.rest[BONE.lowerarm_r]!.distanceTo(this.rest[BONE.hand_r]!) +
        this.grip.center.length() * 0.85
      v2.copy(swing.contact).sub(shoulder)
      const flat = Math.hypot(v2.x, v2.z)
      const free = Math.sqrt(Math.max(0.04, arm * arm - v2.y * v2.y))
      const over = Math.max(0, flat - free)
      if (over > 0 && flat > 0.01) {
        const step = Math.min(MAX_LUNGE, over) * push
        v1.set((v2.x / flat) * step, 0, (v2.z / flat) * step)
      }
    }
    this.lunge.lerp(v1, 1 - Math.exp(-28 * dt))
  }

  /** Feet stay where they were; one steps out under a lunge. */
  private keepFeet(ankleL: Vector3, ankleR: Vector3, footL: Quaternion, footR: Quaternion): void {
    const out = this.lunge.x > 0 ? ankleL : ankleR
    const step = Math.min(1, this.lunge.length() / 0.2)
    out.x += this.lunge.x * 0.9 * step
    out.z += this.lunge.z * 0.9 * step
    stand(this.fig, this.pose, 'l', ankleL, footL)
    stand(this.fig, this.pose, 'r', ankleR, footR)
  }

  private arms(input: Input, push: number, lift: number): void {
    const { fig, pose, paddle } = this
    const speed = Math.hypot(input.vx, input.vz)
    // Running hard and not hitting, the paddle arm pumps along; otherwise it's kept ready.
    const hold = this.swing ? 1 : 1 - 0.72 * Math.max(0, Math.min(1, (speed - 2.6) / 2.2))
    const moodHold = input.mood !== 'none' && !this.swing ? 0.15 : 1
    this.paddleHold = this.swing
      ? Math.max(this.paddleHold, 0.6 + push * 0.4)
      : ease(this.paddleHold, hold * moodHold, 6, input.delta)

    // The paddle's orientation, then the hand that holds it so.
    const shaft = v1.copy(paddle.shaft)
    const face = v2.copy(paddle.face)
    face.addScaledVector(shaft, -face.dot(shaft)).normalize()
    v3.copy(shaft).negate()
    m1.makeBasis(v3.clone().cross(face), v3, face)
    const hand = new Quaternion()
      .setFromRotationMatrix(m1)
      .multiply(q1.copy(this.grip.rotation).invert())
    this.holdable(hand)
    // Hands turn fast, but not from one frame to the next.
    const turn = this.hand.angleTo(hand)
    const handMost = HAND_SPEED * Math.min(input.delta, 0.1)
    this.hand.slerp(hand, turn > handMost ? handMost / turn : 1)
    hand.copy(this.hand)

    // Strokes are laid out around someone of average height, standing.
    const tall = this.rest[BONE.upperarm_r]!.y / 1.5
    const loose = this.swing ? 1 - push : 1
    const at = paddle.at.clone()
    at.y += ((tall - 1) * at.y + (this.base.pelvis.y + pose.pelvis.y) * 0.35) * loose
    // In the air the stroke goes up with the body; only the ball stays where it is.
    const meeting = this.swing
      ? Math.max(0, 1 - Math.abs(input.now - this.swing.contactAt) / 0.12)
      : 0
    at.y += lift * (1 - meeting)
    const wrist = at.sub(v3.copy(this.grip.center).applyQuaternion(hand))

    const free = this.paddleHold < 0.999 ? pose.q.slice() : null
    this.twist.give = this.leftTwist.give = ELBOW_SPEED * Math.min(input.delta, 0.1)
    const short = reach(fig, pose, 'r', wrist, hand, 0.45, this.twist)
    this.short = this.swing && this.swing.contact.y > 1.6 ? Math.max(this.short, short) : 0
    if (free) {
      // Part way between the captured arm and the solved one.
      for (const b of [BONE.upperarm_r, BONE.lowerarm_r, BONE.hand_r]) {
        q1.fromArray(free, b * 4)
        pose.get(b, q2)
        pose.set(b, q1.slerp(q2, this.paddleHold))
        fig.place(pose, b)
      }
    }
    // Even a smash takes an arm a few frames.
    const most = ARM_SPEED * Math.min(input.delta, 0.1)
    ARM.forEach((b, i) => {
      const was = this.armWas[i]!
      pose.get(b, q2)
      const turn = was.angleTo(q2)
      if (turn > most) {
        pose.set(b, q2.copy(was).slerp(pose.get(b, q1), most / turn))
        fig.place(pose, b)
      }
      pose.get(b, was)
    })
    this.freeArm(input, push)
  }

  /** The other arm: holds the ball to serve, steadies the paddle, or balances a swing. */
  /** A wrist only bends so far: keeps a hand within reach of where the forearm points. */
  private holdable(hand: Quaternion): void {
    const fore = this.fig.r[BONE.lowerarm_r]!
    const axis = v1.copy(this.rest[BONE.hand_r]!).sub(this.rest[BONE.lowerarm_r]!).normalize()
    // Without the turn along the forearm, what is left is the bend.
    const now = v2.copy(axis).applyQuaternion(this.lastFore)
    const then = v3.copy(axis).applyQuaternion(hand)
    const bend = now.angleTo(then)
    if (bend > MAX_WRIST_BEND && bend < 3.1) {
      const around = then.clone().cross(now).normalize()
      hand.premultiply(q1.setFromAxisAngle(around, bend - MAX_WRIST_BEND))
    }
    this.lastFore.copy(fore)
  }

  private freeArm(input: Input, push: number): void {
    const { fig, pose } = this
    const keep = pose.q.slice()
    let w: number
    if (input.serveBall && !this.swing) {
      const c = Math.cos(input.yaw)
      const s = Math.sin(input.yaw)
      const dx = input.serveBall.x - input.x
      const dz = input.serveBall.z - input.z
      v1.set(dx * c - dz * s, input.serveBall.y - 0.07, dx * s + dz * c)
      // The wrist is a hand's length short of the ball.
      v2.copy(v1).sub(fig.p[BONE.upperarm_l]!).normalize()
      v1.addScaledVector(v2, -0.1)
      w = 1
    } else if (this.swing) {
      // Out to the side, against the turn of the chest.
      v1.set(0.5, -0.12, 0.28).applyQuaternion(fig.r[BONE.spine_03]!).add(fig.p[BONE.upperarm_l]!)
      w = 0.75 * push
    } else {
      // Near the throat of the paddle.
      v1.set(0.12, 1.02 * (this.rest[BONE.upperarm_r]!.y / 1.5), 0.36)
      v1.y += pose.pelvis.y * 0.5
      w = this.paddleHold * this.alert * 0.9
    }
    const k = 1 - Math.exp(-11 * Math.min(input.delta, 0.1))
    this.leftAt.lerp(v1, k)
    this.leftHold += (w - this.leftHold) * k
    if (this.leftHold < 0.01) return
    reach(fig, pose, 'l', this.leftAt, null, 0.4, this.leftTwist)
    for (const b of [BONE.upperarm_l, BONE.lowerarm_l]) {
      q1.fromArray(keep, b * 4)
      pose.get(b, q2)
      pose.set(b, q1.slerp(q2, this.leftHold))
      fig.place(pose, b)
    }
  }

  private write(): void {
    const { bones, rest } = this.athlete
    const pose = this.left ? mirrorPose(this.pose, this.mirrored) : this.pose
    for (let i = 0; i < BONES.length; i++) bones[i]!.quaternion.fromArray(pose.q, i * 4)
    bones[BONE.pelvis]!.position.copy(rest[BONE.pelvis]!).add(pose.pelvis)
  }
}
