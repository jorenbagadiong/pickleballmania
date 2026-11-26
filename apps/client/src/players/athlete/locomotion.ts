import { Pose, type Motion, sample } from './skeleton'

export type Motions = Record<string, Motion>

/** Faster sideways than this, people turn their hips and run instead of shuffling. */
const SHUFFLE_LIMIT = 3.1
const RUN_FULL = 4.3
/** How far the hips turn from where the body faces, at most. */
const MAX_HIP_TURN = 1.25

export interface Gait {
  /** Share of each motion, adding up to 1. */
  weights: { name: string; w: number }[]
  /** How much the hips turn away from where the chest faces (radians, + = to the left). */
  hips: number
  /** Cycles per second. */
  rate: number
  /** 0 standing … 1 moving. */
  moving: number
}

function ramp(x: number, from: number, to: number): number {
  const t = Math.max(0, Math.min(1, (x - from) / (to - from)))
  return t * t * (3 - 2 * t)
}

/** Between neighbors on a speed scale: the share of the faster one. */
function ladder(
  speed: number,
  steps: readonly (readonly [name: string, speed: number])[],
): { name: string; w: number }[] {
  const first = steps[0]!
  if (speed <= first[1]) return [{ name: first[0], w: 1 }]
  for (let i = 0; i + 1 < steps.length; i++) {
    const [a, sa] = steps[i]!
    const [b, sb] = steps[i + 1]!
    if (speed <= sb) {
      const t = (speed - sa) / (sb - sa)
      return [
        { name: a, w: 1 - t },
        { name: b, w: t },
      ]
    }
  }
  return [{ name: steps[steps.length - 1]![0], w: 1 }]
}

/**
 * How to move at a velocity relative to where the chest faces (left, forward; m/s):
 * which captured motions, in what mix, how fast. Feet cover exactly the ground covered.
 */
export function gaitFor(left: number, forward: number, motions: Motions, alert: number): Gait {
  const speed = Math.hypot(left, forward)
  const moving = ramp(speed, 0.12, 0.7)
  const direction = Math.atan2(left, forward) // 0 forward, + left, ±PI back
  const aside = Math.abs(direction)

  // Turn the hips into the run: always a little, fully when going fast to the side.
  const fast = ramp(speed, SHUFFLE_LIMIT - 0.8, RUN_FULL)
  const runTurn = aside < 2.2 ? Math.max(-MAX_HIP_TURN, Math.min(MAX_HIP_TURN, direction)) : 0
  const hips = runTurn * fast
  const rest = direction - hips

  const c = Math.cos(rest)
  const s = Math.sin(rest)
  // Shares of forward, backward and sideways, for the direction the hips still see.
  const f = Math.max(0, c) ** 2
  const b = Math.max(0, -c) ** 2
  const side = s * s
  const parts: { name: string; w: number }[] = []
  const put = (list: { name: string; w: number }[], w: number): void => {
    for (const x of list) if (x.w * w > 0.001) parts.push({ name: x.name, w: x.w * w })
  }
  put(
    ladder(speed, [
      ['walk', 1.4],
      ['jog', 2.9],
      ['run', 3.9],
      ['sprint', 6.6],
    ]),
    f,
  )
  put(
    ladder(speed, [
      ['walkBack', 1.7],
      ['backpedal', 2.6],
    ]),
    b,
  )
  const to = s > 0 ? 'Left' : 'Right'
  put(
    ladder(speed, [
      [`side${to}`, 1.2],
      [`shuffle${to}`, 2.3],
      [`fastShuffle${to}`, 3],
    ]),
    side,
  )

  // Cycle rate so that the mix covers `speed`.
  let stride = 0
  for (const p of parts) {
    const m = motions[p.name]
    if (m) stride += p.w * Math.hypot(m.velocity.x, m.velocity.z) * m.seconds
  }
  const rate = stride > 0.05 ? Math.min(3.2, speed / stride) : 0
  const weights = parts.map((p) => ({ name: p.name, w: p.w * moving }))
  weights.push(
    { name: 'ready', w: (1 - moving) * alert },
    { name: 'idle', w: (1 - moving) * (1 - alert) },
  )
  return { weights: weights.filter((x) => x.w > 0.001), hips, rate, moving }
}

const scratch = new Pose()

/** The mixed pose at a point in the stride (0–1). Standing poses don't cycle. */
export function gaitPose(gait: Gait, phase: number, motions: Motions, out: Pose): Pose {
  let total = 0
  for (const { name, w } of gait.weights) {
    const m = motions[name]
    if (!m) continue
    const still = name === 'ready' || name === 'idle'
    sample(m, still ? 0 : phase, scratch)
    total += w
    if (total === w) out.copy(scratch)
    else out.blend(scratch, w / total)
  }
  return out
}
