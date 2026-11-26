import type { SwingPose } from './swingPose'

export interface RunInput {
  /** Stride cycle in radians. */
  phase: number
  /** Ground speed in m/s. */
  speed: number
  /** Direction of travel relative to where the chest faces (0 = forward, + = toward local +x). */
  heading: number
}

export interface RunPose {
  /** 0 standing … 1 full sprint. */
  run: number
  thighL: number
  thighR: number
  /** Knee bend; never negative (knees only bend backwards). */
  kneeL: number
  kneeR: number
  /** Hips turn toward the run while the chest keeps facing the aim. */
  hipTurn: number
  leanX: number
  leanZ: number
  bob: number
  /** Counter-swing of the arms. */
  armSwing: number
}

const FULL_SPEED = 5
const MAX_HIP_TURN = 1.15

export function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a))
}

/** Legs, hips and body lean for running in any direction. Visual only. */
export function runPose({ phase, speed, heading }: RunInput): RunPose {
  const run = Math.min(Math.max(speed, 0) / FULL_SPEED, 1)
  const h = wrapAngle(heading)
  // Moving away from where they face: run backwards instead of turning the hips around.
  const backwards = Math.abs(h) > Math.PI * 0.6
  const legHeading = backwards ? wrapAngle(h + Math.PI) : h
  const dir = backwards ? -1 : 1
  const s = Math.sin(phase)
  const thigh = -s * 0.85 * run * dir
  const knee = (p: number): number => (0.2 + 0.95 * Math.max(0, Math.cos(p))) * run
  return {
    run,
    thighL: thigh,
    thighR: -thigh,
    kneeL: knee(phase - 0.3),
    kneeR: knee(phase - 0.3 + Math.PI),
    hipTurn: Math.max(-MAX_HIP_TURN, Math.min(MAX_HIP_TURN, legHeading)) * run,
    leanX: Math.cos(h) * 0.16 * run,
    leanZ: -Math.sin(h) * 0.14 * run,
    bob: Math.abs(Math.cos(phase)) * 0.06 * run,
    armSwing: s * 0.6 * run,
  }
}

/** Paddle arm: pumps with the run while ready, and follows the swing exactly while swinging. */
export function blendArm(
  swing: SwingPose,
  run: RunPose,
): Pick<SwingPose, 'armPitch' | 'armYaw' | 'elbow'> {
  const pump = run.armSwing * 0.55 * (1 - swing.active)
  return { armPitch: swing.armPitch + pump, armYaw: swing.armYaw, elbow: swing.elbow }
}
