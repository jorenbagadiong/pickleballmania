/** Ball and paddle constants shared by the simulation and the renderer. */

/** Pickleball diameter is ~74 mm. */
export const BALL_RADIUS = 0.037
export const GRAVITY = 9.81

/** Height at which the ball is held for a serve, and its offset in front of the server. */
export const SERVE_HOLD_HEIGHT = 0.85
export const SERVE_HOLD_FORWARD = 0.45

/** Swing timing (seconds). Hits register during the active window at the start of a swing. */
export const SWING_DURATION = 0.32
export const SWING_ACTIVE_WINDOW = 0.3
export const SWING_COOLDOWN = 0.4
/** After swinging at a ball and missing it, the next swing takes this long. */
export const MISS_RECOVERY = 0.8
/** Tries a player gets at each incoming ball, so mashing the button doesn't pay. */
export const MAX_SWINGS_PER_SHOT = 2

/**
 * Whether a player may start a swing. Used by the client (so a blocked swing is
 * not even animated) and, authoritatively, by the server.
 */
export function canSwing(s: {
  /** Seconds since this player's last swing. */
  sinceLast: number
  inRally: boolean
  /** Their own team hit the ball last, so there is nothing to hit yet. */
  ownTeamHitLast: boolean
  /** Swings already made (and missed) at the ball now in flight. */
  swingsThisShot: number
}): boolean {
  if (s.sinceLast < SWING_COOLDOWN) return false
  if (!s.inRally) return true
  if (s.ownTeamHitLast) return false
  if (s.swingsThisShot >= MAX_SWINGS_PER_SHOT) return false
  return s.swingsThisShot === 0 || s.sinceLast >= MISS_RECOVERY
}

/** Shot power for a normal swing and for a smash (Shift held). */
export const NORMAL_SHOT_POWER = 0.35
export const DRIVE_SHOT_POWER = 1
/** Swings at or above this power are smashes. */
export const SMASH_MIN_POWER = 0.9

/** A smash while moving toward the net this much (share of full speed) is a jump smash. */
export const JUMP_MIN_FORWARD = 0.3
/** Below this height there is nothing to jump for, and no extra power. */
export const JUMP_MIN_HEIGHT = 1
/** Extra speed of a jump smash. */
export const JUMP_BOOST = 0.2
/** Perfect timing, a long rally and a jump together add at most this much speed. */
export const MAX_BOOST = 0.4

/** How much of a movement intent goes toward the net. */
export function forwardShare(mz: number, side: 1 | -1): number {
  return -mz * side
}

/**
 * The server checks a swing against where the ball was at the moment the
 * player was looking at (their interpolated view), up to this far in the past.
 */
export const MAX_SWING_REWIND_SECONDS = 0.5

/**
 * Hit zone: a circle around the player, the same in every direction (including
 * behind their back), up to overhead height. Drawn on the court for its owner.
 */
export const REACH_RADIUS = 1.4
export const REACH_MAX_HEIGHT = 2.5
/** A jump smash reaches higher. */
export const JUMP_REACH_HEIGHT = 3.1
/** The ball may be slightly over the net plane and still be hittable. */
export const NET_REACH_TOLERANCE = 0.15

/**
 * Whether the ball is inside a player's hit zone; returns the ground distance, or
 * null when out of reach. The server's hit check and the on-screen cue both use
 * this, so what lights up is exactly what can be hit.
 */
export function reachDistance(
  player: { x: number; z: number },
  side: 1 | -1,
  ball: { x: number; y: number; z: number },
  maxHeight = REACH_MAX_HEIGHT,
): number | null {
  if (ball.y > maxHeight || ball.z * side < -NET_REACH_TOLERANCE) return null
  const distance = Math.hypot(ball.x - player.x, ball.z - player.z)
  return distance <= REACH_RADIUS ? distance : null
}

/** A click this close (seconds) to the ball's closest point, and this near, is perfect. */
export const PERFECT_TIMING_SECONDS = 0.07
export const PERFECT_MAX_DISTANCE = 1
/** Perfect hits are this much faster, and nearly exact. */
export const PERFECT_BOOST = 0.12

/** Long rallies speed up: from this shot on, a little more each shot, up to a cap. */
export const RALLY_HEAT_START = 6
export const RALLY_HEAT_PER_SHOT = 0.02
export const RALLY_HEAT_MAX = 0.2

/** Extra shot speed (fraction) for the rally's n-th shot. */
export function rallyHeat(shots: number): number {
  return Math.min(RALLY_HEAT_MAX, Math.max(0, shots - RALLY_HEAT_START + 1) * RALLY_HEAT_PER_SHOT)
}
