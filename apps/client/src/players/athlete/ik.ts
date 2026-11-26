import { Matrix4, Quaternion, Vector3 } from 'three'
import { BONE, type Figure, type Pose } from './skeleton'

const a = new Vector3()
const b = new Vector3()
const c = new Vector3()
const d = new Vector3()
const e = new Vector3()
const m1 = new Matrix4()
const m2 = new Matrix4()
const q1 = new Quaternion()
const q2 = new Quaternion()
const q3 = new Quaternion()
const Z = new Vector3(0, 0, 1)
const UP = new Vector3(0, 1, 0)

/** Rotation taking the frame (along, side) at rest to the frame (along2, side2). */
function frameRotation(
  along: Vector3,
  side: Vector3,
  along2: Vector3,
  side2: Vector3,
  out: Quaternion,
): Quaternion {
  basis(along, side, m1)
  basis(along2, side2, m2)
  q1.setFromRotationMatrix(m1).invert()
  return out.setFromRotationMatrix(m2).multiply(q1)
}

const bx = new Vector3()
const by = new Vector3()
const bz = new Vector3()
function basis(along: Vector3, side: Vector3, out: Matrix4): void {
  bx.copy(along).normalize()
  bz.copy(side).addScaledVector(bx, -side.dot(bx)).normalize()
  by.crossVectors(bz, bx)
  out.makeBasis(bx, by, bz)
}

/**
 * Bends a two-bone limb so that its end is at `target`. `pole` is where the elbow or knee
 * should point. `restBend` is the direction the lower bone swings toward when it flexes,
 * at rest. Returns how far short of the target the limb falls.
 */
export function bendLimb(
  fig: Figure,
  pose: Pose,
  upper: number,
  lower: number,
  end: number,
  target: Vector3,
  pole: Vector3,
  restBend: Vector3 = Z,
  memory?: Twist,
): number {
  const root = fig.p[upper]!
  const restUpper = a.copy(fig.rest[lower]!).sub(fig.rest[upper]!)
  const restLower = b.copy(fig.rest[end]!).sub(fig.rest[lower]!)
  const l1 = restUpper.length()
  const l2 = restLower.length()
  const to = c.copy(target).sub(root)
  const wanted = to.length()
  const dist = Math.max(Math.abs(l1 - l2) + 0.01, Math.min((l1 + l2) * 0.998, wanted))
  to.normalize()
  // The joint lies off the straight line, toward the pole.
  const along = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist)
  const off = Math.sqrt(Math.max(0, l1 * l1 - along * along))
  const side = d.copy(pole).sub(root)
  side.addScaledVector(to, -side.dot(to))
  if (side.lengthSq() < 1e-6) side.set(0, 0, -1)
  side.normalize()
  if (memory) {
    // Reaching straight along the pole has no best way to bend: turn there steadily.
    if (memory.side) {
      const was = memory.side.addScaledVector(to, -memory.side.dot(to))
      if (was.lengthSq() > 1e-4) {
        was.normalize()
        const apart = was.angleTo(side)
        const give = memory.give ?? Math.PI
        if (apart > give) {
          const sign = Math.sign(was.clone().cross(side).dot(to)) || 1
          side.copy(was).applyAxisAngle(to, sign * give)
        }
      }
      memory.side.copy(side)
    } else memory.side = side.clone()
  }
  const joint = e.copy(root).addScaledVector(to, along).addScaledVector(side, off)
  const u = joint.clone().sub(root).normalize()
  const tip = root.clone().addScaledVector(to, dist)
  const low = tip.clone().sub(joint).normalize()
  // Flexing happens around this axis, at rest and now. (From the pole, not from the bend
  // itself: that has no direction when the limb is straight.)
  const restAxis = restUpper.clone().cross(restBend).normalize()
  const axis = side.clone().cross(to).normalize()
  fig.turn(pose, upper, frameRotation(restUpper, restAxis, u, axis, q2))
  fig.p[lower]!.copy(joint)
  fig.turn(pose, lower, frameRotation(restLower, restAxis, low, axis, q3))
  fig.p[end]!.copy(tip)
  return Math.max(0, wanted - (l1 + l2))
}

/** How far a forearm is turned; remembered so that it doesn't jump at half a turn. */
export interface Twist {
  angle: number
  /** Which way the elbow pointed, and how far it may swing round now (radians). */
  side?: Vector3
  give?: number
}
const MAX_TWIST = 2.4

/** The part of a rotation that turns around an axis, as the angle nearest to `before`. */
export function twistAbout(q: Quaternion, axis: Vector3, before: number): number {
  const along = q.x * axis.x + q.y * axis.y + q.z * axis.z
  const t = 2 * Math.atan2(along, q.w)
  const turn = Math.PI * 2
  return t + Math.round((before - t) / turn) * turn
}

const elbowPole = new Vector3()

/** The arm to a wrist position, then the hand to its rotation; the forearm turns along. */
export function reach(
  fig: Figure,
  pose: Pose,
  side: 'l' | 'r',
  wrist: Vector3,
  hand: Quaternion | null,
  elbowOut = 0.35,
  twist: Twist = { angle: 0 },
): number {
  const [up, low, end] =
    side === 'r'
      ? [BONE.upperarm_r, BONE.lowerarm_r, BONE.hand_r]
      : [BONE.upperarm_l, BONE.lowerarm_l, BONE.hand_l]
  const out = side === 'r' ? -1 : 1
  // Elbows point down, a little out and back, whichever way the chest leans.
  const chest = elbowPole.set(0, 0, 1).applyQuaternion(fig.r[BONE.spine_03]!)
  const yaw = Math.atan2(chest.x, chest.z)
  elbowPole
    .set(out * elbowOut, -1, -0.25)
    .applyAxisAngle(UP, yaw)
    .add(fig.p[up]!)
  const short = bendLimb(fig, pose, up, low, end, wrist, elbowPole, Z, twist)
  if (hand) {
    // Half of the hand's twist happens in the forearm, as in a real arm.
    const axis = a.copy(fig.rest[end]!).sub(fig.rest[low]!).normalize()
    const rel = q1.copy(fig.r[low]!).invert().multiply(hand)
    twist.angle = twistAbout(rel, axis, twist.angle)
    q3.setFromAxisAngle(axis, Math.max(-MAX_TWIST, Math.min(MAX_TWIST, twist.angle)) * 0.55)
    fig.turn(pose, low, q1.copy(fig.r[low]!).multiply(q3))
    fig.turn(pose, end, hand)
  }
  return short
}

const kneePole = new Vector3()
const back = new Vector3(0, 0, -1)

/** A leg to an ankle position; the knee points where the thigh was pointing. */
export function stand(
  fig: Figure,
  pose: Pose,
  side: 'l' | 'r',
  ankle: Vector3,
  foot: Quaternion,
  out = 0.12,
): void {
  const [up, low, end, ball] =
    side === 'r'
      ? [BONE.thigh_r, BONE.calf_r, BONE.foot_r, BONE.ball_r]
      : [BONE.thigh_l, BONE.calf_l, BONE.foot_l, BONE.ball_l]
  kneePole
    .set((side === 'r' ? -1 : 1) * out, 0, 1)
    .applyQuaternion(fig.r[BONE.pelvis]!)
    .multiplyScalar(0.8)
    .add(fig.p[up]!)
  kneePole.y -= 0.3
  bendLimb(fig, pose, up, low, end, ankle, kneePole, back)
  // The foot stays as it was on the ground.
  fig.turn(pose, end, foot)
  fig.place(pose, ball)
}
