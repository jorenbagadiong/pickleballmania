import { Vector3 } from 'three'

/**
 * Every kind of shot, as what the paddle and the body do. Positions are meters from the
 * player's feet: +x to their left, +y up, +z the way they face (players are right-handed,
 * so a forehand is on the -x side).
 */
export type StrokeName =
  | 'serve'
  | 'forehandDrive'
  | 'backhandDrive'
  | 'forehandVolley'
  | 'backhandVolley'
  | 'forehandDink'
  | 'backhandDink'
  | 'forehandBlock'
  | 'backhandBlock'
  | 'forehandScoop'
  | 'backhandScoop'
  | 'forehandReach'
  | 'backhandReach'
  | 'smash'
  | 'jumpSmash'

/** The paddle and body at one moment. */
export interface Key {
  /** Middle of the paddle face. */
  at: readonly [number, number, number]
  /** From the hand toward the tip of the paddle. */
  shaft: readonly [number, number, number]
  /** Where the palm side of the face looks. */
  face: readonly [number, number, number]
  /** Chest turn (+ to the left) and bend (+ forward). */
  turn: number
  bend: number
  /** How far the hips sink, and shift toward the ball side (share of the way). */
  sink: number
}

export interface Stroke {
  back: Key
  /** Where the paddle is at contact comes from the ball; this gives the rest. */
  contact: Omit<Key, 'at'>
  follow: Key
  /** Seconds: at least this long from the start to contact, after contact, and back to ready. */
  swing: number
  through: number
  recover: number
}

type V = readonly [number, number, number]
const key = (at: V, shaft: V, face: V, turn: number, bend: number, sink: number): Key => ({
  at,
  shaft,
  face,
  turn,
  bend,
  sink,
})

export const READY: Key = key([-0.13, 1.03, 0.5], [0.3, 0.86, 0.42], [0.1, -0.2, 1], -0.06, 0.1, 0)

const forehand = (
  o: Partial<Stroke> & { lift?: number; low?: boolean; short?: number },
): Stroke => {
  const s = o.short ?? 0 // 0 full swing … 1 hardly any
  const b = (full: number, small: number): number => full + (small - full) * s
  const drop = o.low ? 0.35 : 0
  return {
    back: key(
      [b(-0.72, -0.5), b(0.95, 1.0) - drop, b(-0.28, 0.18)],
      [b(-0.85, -0.6), b(0.35, 0.5) - drop, b(-0.4, 0.4)],
      [b(-0.25, -0.1), -0.1 + (o.lift ?? 0), 1],
      b(-0.85, -0.35),
      0.14 + drop * 0.5,
      0.05 + drop * 0.3,
    ),
    contact: {
      shaft: [-0.85, -0.12 - drop, 0.42],
      face: [0.08, (o.lift ?? 0) - 0.02, 1],
      turn: b(0.08, 0),
      bend: 0.16 + drop * 0.5,
      sink: 0.08 + drop * 0.45,
    },
    follow: key(
      [b(0.34, 0.0), b(1.38, 1.2) - drop * 0.3, b(0.52, 0.72)],
      [b(0.45, -0.2), b(0.8, 0.7), b(0.35, 0.6)],
      [b(0.75, 0.2), (o.lift ?? 0) + 0.1, b(0.6, 1)],
      b(0.55, 0.12),
      0.1,
      0.02,
    ),
    swing: 0.09,
    through: b(0.26, 0.16),
    recover: 0.34,
    ...o,
  }
}

const backhand = (
  o: Partial<Stroke> & { lift?: number; low?: boolean; short?: number },
): Stroke => {
  const s = o.short ?? 0
  const b = (full: number, small: number): number => full + (small - full) * s
  const drop = o.low ? 0.35 : 0
  const lift = o.lift ?? 0
  return {
    back: key(
      [b(0.52, 0.34), b(1.0, 1.02) - drop, b(0.06, 0.3)],
      [b(0.8, 0.6), b(0.42, 0.5) - drop, b(-0.35, 0.3)],
      [b(0.35, 0.1), 0.1 - lift, -1],
      b(0.75, 0.32),
      0.16 + drop * 0.5,
      0.05 + drop * 0.3,
    ),
    contact: {
      shaft: [0.85, -0.08 - drop, 0.42],
      face: [0.06, -lift, -1],
      turn: b(0.25, 0.15),
      bend: 0.17 + drop * 0.5,
      sink: 0.08 + drop * 0.45,
    },
    follow: key(
      [b(-0.55, -0.1), b(1.3, 1.18) - drop * 0.3, b(0.5, 0.7)],
      [b(-0.75, 0.1), b(0.62, 0.7), b(0.25, 0.6)],
      [b(-0.55, -0.1), -lift - 0.1, b(-0.8, -1)],
      b(-0.4, -0.05),
      0.1,
      0.02,
    ),
    swing: 0.09,
    through: b(0.26, 0.16),
    recover: 0.34,
    ...o,
  }
}

const overhead = (jump: boolean): Stroke => ({
  back: key(
    [-0.28, jump ? 1.72 : 1.62, -0.36],
    [-0.1, -0.35, -0.9],
    [0.1, 0.9, 0.3],
    jump ? -0.75 : -0.6,
    jump ? -0.3 : -0.2,
    0,
  ),
  contact: {
    shaft: [0.05, 0.96, 0.25],
    face: [0.05, -0.28, 1],
    turn: 0.1,
    bend: 0.14,
    sink: 0,
  },
  follow: key(
    [0.42, 0.6, 0.62],
    [0.35, -0.7, 0.5],
    [0.1, -0.9, -0.35],
    0.5,
    jump ? 0.5 : 0.42,
    0.06,
  ),
  swing: 0.1,
  through: 0.24,
  recover: 0.36,
})

export const STROKES: Record<StrokeName, Stroke> = {
  serve: {
    back: key([-0.42, 0.62, -0.42], [-0.25, -0.75, -0.5], [-0.2, 0.2, 1], -0.55, 0.2, 0.05),
    contact: {
      shaft: [-0.35, -0.85, 0.3],
      face: [0.05, 0.28, 1],
      turn: -0.05,
      bend: 0.22,
      sink: 0.05,
    },
    follow: key([0.05, 1.5, 0.66], [0.15, 0.8, 0.45], [0.1, 0.5, 0.8], 0.4, 0.04, 0),
    swing: 0.1,
    through: 0.3,
    recover: 0.4,
  },
  forehandDrive: forehand({}),
  backhandDrive: backhand({}),
  forehandVolley: forehand({ short: 0.65 }),
  backhandVolley: backhand({ short: 0.65 }),
  forehandDink: forehand({ short: 0.85, lift: 0.4, low: true, recover: 0.42 }),
  backhandDink: backhand({ short: 0.85, lift: 0.4, low: true, recover: 0.42 }),
  forehandBlock: forehand({ short: 1, through: 0.1, recover: 0.26 }),
  backhandBlock: backhand({ short: 1, through: 0.1, recover: 0.26 }),
  forehandScoop: forehand({ short: 0.4, lift: 0.55, low: true }),
  backhandScoop: backhand({ short: 0.4, lift: 0.55, low: true }),
  forehandReach: forehand({ short: 0.55, lift: 0.15, recover: 0.46 }),
  backhandReach: backhand({ short: 0.55, lift: 0.15, recover: 0.46 }),
  smash: overhead(false),
  jumpSmash: overhead(true),
}

export interface ShotInfo {
  power: number
  serve: boolean
  jump: boolean
  /** Contact, relative to the player's feet and facing. */
  contact: { x: number; y: number; z: number }
  /** The ball had not bounced. */
  volley: boolean
  /** Incoming ball speed (m/s). */
  pace: number
  /** Distance of the player from the net, and of the target beyond it. */
  depth: number
  aimDepth: number
}

/** Which shot this is. */
export function chooseStroke(s: ShotInfo): StrokeName {
  if (s.serve) return 'serve'
  if (s.jump) return 'jumpSmash'
  const smash = s.power >= 0.9
  if (smash && s.contact.y > 1.5) return 'smash'
  const hand = s.contact.x > 0.06 ? 'backhand' : 'forehand'
  if (Math.hypot(s.contact.x, s.contact.z) > 1.05) return `${hand}Reach`
  if (smash) return `${hand}Drive`
  if (s.volley && s.pace > 9.5) return `${hand}Block`
  if (s.depth < 3.2 && s.aimDepth < 2.6) return `${hand}Dink`
  if (s.contact.y < 0.38) return `${hand}Scoop`
  if (s.volley) return `${hand}Volley`
  return `${hand}Drive`
}

/** The paddle and body, mixed between keys. */
export class PaddleState {
  readonly at = new Vector3(...READY.at)
  readonly shaft = new Vector3(...READY.shaft).normalize()
  readonly face = new Vector3(...READY.face).normalize()
  turn = READY.turn
  bend = READY.bend
  sink = READY.sink

  copy(o: PaddleState): this {
    this.at.copy(o.at)
    this.shaft.copy(o.shaft)
    this.face.copy(o.face)
    this.turn = o.turn
    this.bend = o.bend
    this.sink = o.sink
    return this
  }

  set(k: Key): this {
    this.at.set(...k.at)
    this.shaft.set(...k.shaft).normalize()
    this.face.set(...k.face).normalize()
    this.turn = k.turn
    this.bend = k.bend
    this.sink = k.sink
    return this
  }

  /** Toward another state, by a share. */
  mix(o: PaddleState, t: number): this {
    this.at.lerp(o.at, t)
    this.shaft.lerp(o.shaft, t).normalize()
    this.face.lerp(o.face, t).normalize()
    this.turn += (o.turn - this.turn) * t
    this.bend += (o.bend - this.bend) * t
    this.sink += (o.sink - this.sink) * t
    return this
  }
}

const smooth = (t: number): number => t * t * (3 - 2 * t)
const easeIn = (t: number): number => t * t
const easeOut = (t: number): number => 1 - (1 - t) ** 2.4

const back = new PaddleState()
const hit = new PaddleState()
const end = new PaddleState()
const arm = new Vector3()
const ready = new PaddleState()

export interface Swing {
  stroke: Stroke
  /** Where the paddle was when it started. */
  from: PaddleState
  start: number
  /** When, and where (feet frame), it meets the ball. */
  contactAt: number
  contact: Vector3
  jump: boolean
  /** Where the shoulder of the paddle arm is, standing. */
  shoulder: Vector3
}

/** Where in a swing `now` is: 0 back … contact … follow … 1 ready again. */
export function swingOver(s: Swing, now: number): boolean {
  return now > s.contactAt + s.stroke.through + s.stroke.recover
}

/** 1 around contact, fading on both sides (for leaning and lunging into it). */
export function effort(s: Swing, now: number): number {
  const before = Math.max(0.08, s.contactAt - s.start)
  if (now < s.start) return 0
  if (now <= s.contactAt) return smooth(Math.min(1, (now - s.start) / before))
  const after = s.stroke.through * 0.5 + s.stroke.recover
  return 1 - smooth(Math.min(1, (now - s.contactAt) / after))
}

/** The paddle at a moment of a swing. */
export function swingState(s: Swing, now: number, out: PaddleState): PaddleState {
  const { stroke } = s
  back.set(stroke.back)
  hit.set({ ...stroke.contact, at: [s.contact.x, s.contact.y, s.contact.z] })
  // At contact the paddle carries on the line of the arm, as far as the stroke allows.
  arm.copy(s.contact).sub(s.shoulder)
  arm.y = Math.max(-0.5, Math.min(1.2, arm.y))
  if (stroke === STROKES.serve) arm.set(-0.3, -0.75, 0.4)
  hit.shaft.multiplyScalar(0.55).addScaledVector(arm.normalize(), 0.75).normalize()
  end.set(stroke.follow)
  // A ball far from where the stroke would go: the follow-through starts from there.
  end.at.lerp(hit.at, 0.25)
  const total = s.contactAt - s.start
  if (now <= s.contactAt) {
    // Back, then through: the less time there is, the less backswing.
    const room = Math.max(0, Math.min(1, (total - stroke.swing) / 0.16))
    const turnAt = s.contactAt - Math.max(0.06, Math.min(0.14, total * 0.5))
    if (now < turnAt && total > 0.1) {
      const t = smooth(Math.max(0, (now - s.start) / Math.max(0.03, turnAt - s.start)))
      return out.copy(s.from).mix(back, t * (0.35 + 0.65 * room))
    }
    const t = easeIn(
      Math.max(0, Math.min(1, (now - turnAt) / Math.max(0.02, s.contactAt - turnAt))),
    )
    out.copy(s.from)
    if (total > 0.1) out.mix(back, 0.35 + 0.65 * room)
    return out.mix(hit, t)
  }
  const past = now - s.contactAt
  if (past < stroke.through) {
    const t = easeOut(past / stroke.through)
    out.copy(hit).mix(end, t)
    // Out through the ball first, then round.
    const reachOut = stroke === STROKES.smash || stroke === STROKES.jumpSmash ? 0.46 : 0.16
    out.at.z += Math.sin(Math.PI * t) * reachOut
    return out
  }
  const t = Math.min(1, (past - stroke.through) / stroke.recover)
  return out.copy(end).mix(ready.set(READY), smooth(t))
}
