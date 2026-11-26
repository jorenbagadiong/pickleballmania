import {
  type BallBody,
  FIXED_DT,
  JUMP_MIN_FORWARD,
  JUMP_MIN_HEIGHT,
  REACH_RADIUS,
  SMASH_MIN_POWER,
  SWING_ACTIVE_WINDOW,
  stepBall,
} from '@pickleball/shared'

/**
 * Whether a swing is a jump smash: a smash while moving toward the net, unless the
 * ball that is about to be met is too low to jump for.
 */
export function wantsJump(
  power: number,
  forward: number,
  player: { x: number; z: number },
  ball: (BallBody & { visible: boolean; held: boolean }) | null,
): boolean {
  if (power < SMASH_MIN_POWER || forward < JUMP_MIN_FORWARD) return false
  if (!ball || !ball.visible || ball.held) return true
  const body = { ...ball }
  let best = Infinity
  let height = Infinity
  for (let t = 0; t <= SWING_ACTIVE_WINDOW; t += FIXED_DT) {
    const d = Math.hypot(body.x - player.x, body.z - player.z)
    if (d < best) {
      best = d
      height = body.y
    }
    stepBall(body, FIXED_DT, [])
  }
  // Nothing to meet: jump anyway, as the player asked.
  return best > REACH_RADIUS + 0.5 || height >= JUMP_MIN_HEIGHT
}
