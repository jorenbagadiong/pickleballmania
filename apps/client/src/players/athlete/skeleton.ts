import { Quaternion, Vector3 } from 'three'

/**
 * The bones that move. Every bone's rest rotation is the identity (its axes line up with
 * the model: +x is the body's left, +y up, +z forward), so the same motions fit everyone.
 */
export const BONES = [
  'pelvis',
  'spine_01',
  'spine_02',
  'spine_03',
  'neck_01',
  'head',
  'clavicle_l',
  'upperarm_l',
  'lowerarm_l',
  'hand_l',
  'clavicle_r',
  'upperarm_r',
  'lowerarm_r',
  'hand_r',
  'thigh_l',
  'calf_l',
  'foot_l',
  'ball_l',
  'thigh_r',
  'calf_r',
  'foot_r',
  'ball_r',
] as const
export type BoneName = (typeof BONES)[number]

export const BONE = Object.fromEntries(BONES.map((b, i) => [b, i])) as Record<BoneName, number>

export const PARENT: readonly number[] = BONES.map((b) => {
  const parent: Partial<Record<BoneName, BoneName>> = {
    spine_01: 'pelvis',
    spine_02: 'spine_01',
    spine_03: 'spine_02',
    neck_01: 'spine_03',
    head: 'neck_01',
    clavicle_l: 'spine_03',
    upperarm_l: 'clavicle_l',
    lowerarm_l: 'upperarm_l',
    hand_l: 'lowerarm_l',
    clavicle_r: 'spine_03',
    upperarm_r: 'clavicle_r',
    lowerarm_r: 'upperarm_r',
    hand_r: 'lowerarm_r',
    thigh_l: 'pelvis',
    calf_l: 'thigh_l',
    foot_l: 'calf_l',
    ball_l: 'foot_l',
    thigh_r: 'pelvis',
    calf_r: 'thigh_r',
    foot_r: 'calf_r',
    ball_r: 'foot_r',
  }
  const p = parent[b]
  return p ? BONE[p] : -1
})

/** Bones of the upper body, which strokes take over from running. */
export const UPPER: readonly boolean[] = BONES.map((b) =>
  /spine|neck|head|clavicle|arm|hand/.test(b),
)

/** One pose: local rotations, and where the pelvis is relative to its rest position. */
export class Pose {
  readonly q = new Float32Array(BONES.length * 4)
  readonly pelvis = new Vector3()

  constructor() {
    for (let i = 0; i < BONES.length; i++) this.q[i * 4 + 3] = 1
  }

  copy(o: Pose): this {
    this.q.set(o.q)
    this.pelvis.copy(o.pelvis)
    return this
  }

  /** Blends toward another pose (all bones, or only those in `mask`). */
  blend(o: Pose, w: number, mask?: readonly boolean[]): this {
    if (w <= 0) return this
    for (let b = 0; b < BONES.length; b++) if (!mask || mask[b]) blendQuat(this.q, o.q, b * 4, w)
    if (!mask || mask[0]) this.pelvis.lerp(o.pelvis, w)
    return this
  }

  get(b: number, out: Quaternion): Quaternion {
    return out.fromArray(this.q, b * 4)
  }

  set(b: number, q: Quaternion): void {
    q.toArray(this.q, b * 4)
  }
}

function blendQuat(a: Float32Array, b: Float32Array, i: number, w: number): void {
  const [ax, ay, az, aw] = [a[i]!, a[i + 1]!, a[i + 2]!, a[i + 3]!]
  const [bx, by, bz, bw] = [b[i]!, b[i + 1]!, b[i + 2]!, b[i + 3]!]
  const s = ax * bx + ay * by + az * bz + aw * bw < 0 ? -w : w
  const x = ax * (1 - w) + bx * s
  const y = ay * (1 - w) + by * s
  const z = az * (1 - w) + bz * s
  const u = aw * (1 - w) + bw * s
  const n = 1 / Math.max(1e-9, Math.hypot(x, y, z, u))
  a[i] = x * n
  a[i + 1] = y * n
  a[i + 2] = z * n
  a[i + 3] = u * n
}

/** A captured movement. */
export interface Motion {
  name: string
  frames: number
  seconds: number
  loop: boolean
  /** Meters per second covered: +x to the body's left, +z forward. */
  velocity: { x: number; z: number }
  /** frames x bones x 4. */
  q: Float32Array
  /** frames x 3: pelvis relative to its rest position. */
  pelvis: Float32Array
}

/** The pose `t` (0–1 of its length) into a motion. */
export function sample(m: Motion, t: number, out: Pose): Pose {
  const last = m.frames - 1
  const u = m.loop ? t - Math.floor(t) : Math.max(0, Math.min(1, t))
  const f = u * last
  const i = Math.min(last, Math.floor(f))
  const j = Math.min(last, i + 1)
  const k = f - i
  const n = BONES.length * 4
  const a = i * n
  const b = j * n
  for (let c = 0; c < n; c += 4) {
    let dot = 0
    for (let e = 0; e < 4; e++) dot += m.q[a + c + e]! * m.q[b + c + e]!
    const s = dot < 0 ? -k : k
    let len = 0
    for (let e = 0; e < 4; e++) {
      const v = m.q[a + c + e]! * (1 - k) + m.q[b + c + e]! * s
      out.q[c + e] = v
      len += v * v
    }
    len = 1 / Math.sqrt(Math.max(1e-12, len))
    for (let e = 0; e < 4; e++) out.q[c + e]! *= len
  }
  out.pelvis.set(
    m.pelvis[i * 3]! * (1 - k) + m.pelvis[j * 3]! * k,
    m.pelvis[i * 3 + 1]! * (1 - k) + m.pelvis[j * 3 + 1]! * k,
    m.pelvis[i * 3 + 2]! * (1 - k) + m.pelvis[j * 3 + 2]! * k,
  )
  return out
}

/** One person's proportions: where every joint is at rest. */
export type Rest = readonly Vector3[]

const q = new Quaternion()
const v = new Vector3()

/** Joint positions and rotations in the model, for a pose on a body. */
export class Figure {
  readonly p: Vector3[] = BONES.map(() => new Vector3())
  readonly r: Quaternion[] = BONES.map(() => new Quaternion())

  constructor(readonly rest: Rest) {}

  solve(pose: Pose): this {
    for (let b = 0; b < BONES.length; b++) this.place(pose, b)
    return this
  }

  /** One bone, its parent being done. */
  place(pose: Pose, b: number): void {
    const parent = PARENT[b]!
    const rest = this.rest[b]!
    pose.get(b, q)
    if (parent < 0) {
      this.r[b]!.copy(q)
      this.p[b]!.copy(rest).add(pose.pelvis)
    } else {
      this.r[b]!.copy(this.r[parent]!).multiply(q)
      this.p[b]!.copy(v.copy(rest).sub(this.rest[parent]!).applyQuaternion(this.r[parent]!)).add(
        this.p[parent]!,
      )
    }
  }

  /** Sets a bone's rotation in the model, and the pose to match. */
  turn(pose: Pose, b: number, world: Quaternion): void {
    const parent = PARENT[b]!
    this.r[b]!.copy(world)
    if (parent < 0) pose.set(b, world)
    else pose.set(b, q.copy(this.r[parent]!).invert().multiply(world))
  }
}
