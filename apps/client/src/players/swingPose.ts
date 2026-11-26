import { SMASH_MIN_POWER, SWING_DURATION } from '@pickleball/shared'

/** A smash is drawn slightly longer than a normal swing so the follow-through reads. */
export const SMASH_ANIM_SECONDS = 0.45
/** A jump smash: leap, hang, slam, land. */
export const JUMP_ANIM_SECONDS = 0.75

export interface SwingPose {
  /** Paddle arm: 0 hangs down, -PI/2 points forward, -PI straight up, beyond that behind the head. */
  armPitch: number
  armYaw: number
  /** Elbow bend (0 = straight). */
  elbow: number
  /** Paddle bent at the wrist (negative tips it up). */
  wrist: number
  /** Paddle turned in the hand so its face, not its edge, meets the ball. */
  roll: number
  /** Chest turn; negative winds up toward the paddle side. */
  twist: number
  /** Jump height in meters. */
  lift: number
  /** Torso lean in radians; positive leans toward the net. */
  lean: number
  /** 1 while swinging, 0 in the ready position. */
  active: number
  /** 1 while flying through a jump smash (legs kick back). */
  air: number
}

const IDLE: Readonly<SwingPose> = {
  armPitch: -0.45,
  armYaw: -0.3,
  elbow: 1,
  wrist: -0.95,
  roll: 0.35,
  twist: 0,
  lift: 0,
  lean: 0,
  active: 0,
  air: 0,
}
const WINDUP: Readonly<SwingPose> = {
  armPitch: -3.6,
  armYaw: -0.1,
  elbow: 0.7,
  wrist: 0.25,
  roll: 0,
  twist: -0.45,
  lift: 0.3,
  lean: -0.22,
  active: 1,
  air: 0,
}
const SLAM: Readonly<SwingPose> = {
  armPitch: -0.45,
  armYaw: 0.35,
  elbow: 0.1,
  wrist: -0.1,
  roll: 0,
  twist: 0.4,
  lift: 0.1,
  lean: 0.4,
  active: 1,
  air: 0,
}
/** Bow-shaped at the top of the leap, then folding forward into the ball. */
const JUMP_WINDUP: Readonly<SwingPose> = {
  armPitch: -3.9,
  armYaw: -0.15,
  elbow: 1.1,
  wrist: 0.4,
  roll: 0,
  twist: -0.7,
  lift: 0,
  lean: -0.4,
  active: 1,
  air: 1,
}
const JUMP_SLAM: Readonly<SwingPose> = {
  armPitch: -0.5,
  armYaw: 0.45,
  elbow: 0.05,
  wrist: -0.25,
  roll: 0,
  twist: 0.6,
  lift: 0,
  lean: 0.55,
  active: 1,
  air: 0.35,
}
const JUMP_HEIGHT = 0.75
/** In the air from the start until this fraction; the rest is the landing. */
const JUMP_LANDED = 0.72
const JUMP_WINDUP_END = 0.18
const JUMP_SLAM_END = 0.42
/** Fractions of the smash at which the wind-up and the slam are complete. */
const WINDUP_END = 0.2
const SLAM_END = 0.5
/** Fraction of a normal swing spent in the stroke; the rest returns to ready. */
const STROKE_END = 0.75

export function isSmash(power: number): boolean {
  return power >= SMASH_MIN_POWER
}

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t)
}

function mix(a: SwingPose, b: SwingPose, t: number): SwingPose {
  const l = (x: number, y: number): number => x + (y - x) * t
  return {
    armPitch: l(a.armPitch, b.armPitch),
    armYaw: l(a.armYaw, b.armYaw),
    elbow: l(a.elbow, b.elbow),
    wrist: l(a.wrist, b.wrist),
    roll: l(a.roll, b.roll),
    twist: l(a.twist, b.twist),
    lift: l(a.lift, b.lift),
    lean: l(a.lean, b.lean),
    active: l(a.active, b.active),
    air: l(a.air, b.air),
  }
}

/** Sideways stroke; the arm aims low or high to meet the ball. */
function stroke(t: number, power: number, backhand: boolean, height: number): SwingPose {
  const u = easeOutCubic(t)
  const pitch = Math.max(-2, Math.min(-0.7, -0.55 - height * 0.6))
  return {
    armPitch: pitch,
    armYaw: backhand ? 1.3 - u * (2 + power * 0.3) : -1.3 + u * (2.2 + power * 0.4),
    elbow: 0.35 - u * 0.2,
    wrist: -0.15,
    roll: Math.PI / 2,
    twist: backhand ? 0.6 - u * 1 : -0.5 + u * 1.1,
    lift: 0,
    lean: 0,
    active: 1,
    air: 0,
  }
}

function jumpPose(t: number): SwingPose {
  if (t < 0 || t > 1) return { ...IDLE }
  const pose =
    t <= JUMP_WINDUP_END
      ? mix(IDLE, JUMP_WINDUP, easeOutCubic(t / JUMP_WINDUP_END))
      : t <= JUMP_SLAM_END
        ? mix(
            JUMP_WINDUP,
            JUMP_SLAM,
            smooth((t - JUMP_WINDUP_END) / (JUMP_SLAM_END - JUMP_WINDUP_END)),
          )
        : mix(JUMP_SLAM, IDLE, smooth((t - JUMP_SLAM_END) / (1 - JUMP_SLAM_END)))
  // Off the ground at once, then a dip of the knees on landing.
  pose.lift =
    t < JUMP_LANDED
      ? JUMP_HEIGHT * Math.sin((Math.PI * t) / JUMP_LANDED) ** 0.8
      : -0.1 * Math.sin((Math.PI * (t - JUMP_LANDED)) / (1 - JUMP_LANDED))
  return pose
}

/** Pose `seconds` after a swing of the given power started. Visual only. */
export function swingPose(
  seconds: number,
  power: number,
  backhand = false,
  height = 1.1,
  jump = false,
): SwingPose {
  if (jump) return jumpPose(seconds / JUMP_ANIM_SECONDS)
  if (isSmash(power)) {
    const t = seconds / SMASH_ANIM_SECONDS
    if (t < 0 || t > 1) return { ...IDLE }
    if (t <= WINDUP_END) return mix(IDLE, WINDUP, easeOutCubic(t / WINDUP_END))
    if (t <= SLAM_END) return mix(WINDUP, SLAM, smooth((t - WINDUP_END) / (SLAM_END - WINDUP_END)))
    return mix(SLAM, IDLE, smooth((t - SLAM_END) / (1 - SLAM_END)))
  }
  const t = seconds / SWING_DURATION
  if (t < 0 || t > 1) return { ...IDLE }
  if (t <= STROKE_END) return stroke(t / STROKE_END, power, backhand, height)
  return mix(stroke(1, power, backhand, height), IDLE, smooth((t - STROKE_END) / (1 - STROKE_END)))
}
