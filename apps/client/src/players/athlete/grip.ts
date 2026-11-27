import { Matrix4, Quaternion, Vector3 } from 'three'
import type { Athlete } from './assets'

/** The paddle's own axes: its shaft runs down -y, its face looks along z. */
export const PADDLE_SCALE = 0.8
/** Middle of the face, from the hand, at scale 1 (in the paddle's frame: (0, -FACE_CENTER, 0)). */
export const FACE_CENTER = 0.37

/**
 * How the paddle sits in the paddle hand: a handshake grip, the handle across the palm
 * and the face lined up with it. Positions are in the hand's rest frame.
 */
export interface Grip {
  position: Vector3
  rotation: Quaternion
  /** Middle of the paddle face from the wrist. */
  center: Vector3
}

function palm(a: Athlete, side: 'l' | 'r') {
  const at = (n: string): Vector3 => {
    const b = a.all.get(`${n}_${side}`)
    return b ? b.getWorldPosition(new Vector3()) : new Vector3()
  }
  a.root.updateMatrixWorld(true)
  const wrist = at('hand')
  const index = at('index_01')
  const pinky = at('pinky_01')
  const fingers = at('middle_01').sub(wrist).normalize()
  const across = index.clone().sub(pinky)
  across.addScaledVector(fingers, -across.dot(fingers)).normalize()
  // Out of the palm: the thumb hangs on that side.
  const normal = fingers.clone().cross(across).normalize()
  const thumb = at('thumb_03').sub(wrist)
  if (normal.dot(thumb) < 0) normal.negate()
  const length = at('middle_01').distanceTo(wrist)
  return { wrist, fingers, across, normal, length }
}

/** The grip in one hand ('r' unless the player is left-handed), from that hand's bones. */
export function gripFor(a: Athlete, side: 'l' | 'r' = 'r'): Grip {
  const { fingers, across, normal, length } = palm(a, side)
  // The handle lies on a slant, so the paddle continues the line of a relaxed arm.
  const shaft = across.clone().multiplyScalar(0.78).addScaledVector(fingers, 0.62).normalize()
  const face = normal.clone().addScaledVector(shaft, -normal.dot(shaft)).normalize()
  const y = shaft.clone().negate()
  const x = y.clone().cross(face)
  const rotation = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x, y, face))
  const position = fingers
    .clone()
    .multiplyScalar(length * 0.92)
    .addScaledVector(normal, 0.026)
  const center = position.clone().addScaledVector(shaft, FACE_CENTER * PADDLE_SCALE)
  return { position, rotation, center }
}

/**
 * Curls the fingers: around the handle in the paddle hand ('r' unless left-handed),
 * relaxed in the other.
 */
export function poseFingers(a: Athlete, paddleSide: 'l' | 'r' = 'r'): void {
  for (const side of ['l', 'r'] as const) {
    const holds = side === paddleSide
    const { across, normal, fingers } = palm(a, side)
    // Turning around the knuckles, so that the tips go toward the palm.
    const axis = across.clone()
    if (axis.clone().cross(fingers).dot(normal) < 0) axis.negate()
    const bend = holds ? [1.0, 1.25, 0.75] : [0.28, 0.4, 0.28]
    const q = new Quaternion()
    for (const finger of ['index', 'middle', 'ring', 'pinky']) {
      for (let k = 1; k <= 3; k++) {
        const bone = a.all.get(`${finger}_0${k}_${side}`)
        const loose = holds ? 1 : 1 + ['index', 'middle', 'ring', 'pinky'].indexOf(finger) * 0.12
        if (bone) bone.quaternion.copy(q.setFromAxisAngle(axis, (bend[k - 1] ?? 0) * loose))
      }
    }
    // The thumb closes over the handle.
    const close = fingers.clone()
    if (close.clone().cross(across).dot(normal) < 0) close.negate()
    const thumb = holds ? [0.15, 0.4, 0.5] : [0, 0.15, 0.2]
    for (let k = 1; k <= 3; k++) {
      const bone = a.all.get(`thumb_0${k}_${side}`)
      if (bone) bone.quaternion.copy(q.setFromAxisAngle(close, thumb[k - 1] ?? 0))
    }
  }
}
