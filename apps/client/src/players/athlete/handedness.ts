import { SECRET_LOOK } from '@pickleball/shared'
import { Quaternion, Vector3 } from 'three'
import type { Grip } from './grip'
import { BONES, type BoneName, type Pose, type Rest } from './skeleton'

/**
 * Left-handed play, by mirroring. Every bone rests with the identity rotation and the
 * model's axes (+x the body's left), so a body mirrored across its middle (x → -x) is
 * the same skeleton with left and right swapped. A left-hander is animated as a
 * right-hander in that mirror world, with the same motions, strokes and IK, and the
 * result mirrored back: left and right bones swap, each rotation (x, y, z, w) becomes
 * (x, -y, -z, w), and the hips' sideways offset changes sign. The mesh itself is never
 * scaled by -1, so skinning, normals and shadows are untouched.
 */
export type Hand = 'right' | 'left'

/** Which hand holds the paddle: the secret athlete is left-handed, everyone else right. */
export function handFor(look: string): Hand {
  return look === SECRET_LOOK ? 'left' : 'right'
}

/** The bone name for a side of the body: 'r' or 'l'. */
export function sideOf(hand: Hand): 'r' | 'l' {
  return hand === 'left' ? 'l' : 'r'
}

/** For each bone, its counterpart on the other side (itself in the middle). */
export const MIRROR_BONE: readonly number[] = BONES.map((b) => {
  const other = b.endsWith('_l')
    ? `${b.slice(0, -2)}_r`
    : b.endsWith('_r')
      ? `${b.slice(0, -2)}_l`
      : b
  return BONES.indexOf(other as BoneName)
})

/** A rotation as seen in the mirror. */
export function mirrorQuaternion(q: Quaternion, out = new Quaternion()): Quaternion {
  return out.set(q.x, -q.y, -q.z, q.w)
}

/** A point or direction (in the body's frame) as seen in the mirror. */
export function mirrorVector(v: Vector3, out = new Vector3()): Vector3 {
  return out.set(-v.x, v.y, v.z)
}

/** A pose in the mirror. `out` must not be `pose`. */
export function mirrorPose(pose: Pose, out: Pose): Pose {
  const { q } = pose
  for (let b = 0; b < BONES.length; b++) {
    const i = MIRROR_BONE[b]! * 4
    const o = b * 4
    out.q[o] = q[i]!
    out.q[o + 1] = -q[i + 1]!
    out.q[o + 2] = -q[i + 2]!
    out.q[o + 3] = q[i + 3]!
  }
  out.pelvis.set(-pose.pelvis.x, pose.pelvis.y, pose.pelvis.z)
  return out
}

/** Where every joint would be at rest on the mirrored body. */
export function mirrorRest(rest: Rest): Rest {
  return BONES.map((_, b) => mirrorVector(rest[MIRROR_BONE[b]!]!))
}

/**
 * A grip as seen in the mirror: the paddle is the same on both sides of its face, so a
 * left-hand grip mirrored is a right-hand grip of the mirrored body.
 */
export function mirrorGrip(g: Grip): Grip {
  return {
    position: mirrorVector(g.position),
    rotation: mirrorQuaternion(g.rotation),
    center: mirrorVector(g.center),
  }
}

/**
 * The world as a left-hander's mirror body sees it: points and directions on the
 * ground reflected across the line the player faces along, through the player.
 * `yaw` is where they face; (x, z) where they stand.
 */
export class WorldMirror {
  /** The body's left, in the world. */
  private lx = 1
  private lz = 0
  private x = 0
  private z = 0

  set(yaw: number, x: number, z: number): this {
    this.lx = Math.cos(yaw)
    this.lz = -Math.sin(yaw)
    this.x = x
    this.z = z
    return this
  }

  /** A direction on the ground (a velocity). */
  direction(vx: number, vz: number): { x: number; z: number } {
    const d = 2 * (vx * this.lx + vz * this.lz)
    return { x: vx - d * this.lx, z: vz - d * this.lz }
  }

  /** A point in the world. */
  point(p: Vector3, out: Vector3): Vector3 {
    const d = this.direction(p.x - this.x, p.z - this.z)
    return out.set(this.x + d.x, p.y, this.z + d.z)
  }
}
