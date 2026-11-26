import { BALL_RADIUS, GRAVITY, netHeightAt } from '@pickleball/shared'

export interface Vec3 {
  x: number
  y: number
  z: number
}

/** Horizontal ball speed range (m/s) from a soft dink (power 0) to a drive (power 1). */
export const SHOT_MIN_SPEED = 5.5
export const SHOT_MAX_SPEED = 12.5
/** What only real smashes add: almost nothing at ordinary power, all of it at full power. */
const SMASH_EXTRA_SPEED = 4
const SMASH_CURVE = 6
/** Extra height the trajectory must have over the net tape. */
const NET_MARGIN = 0.12
const MIN_FLIGHT_TIME = 0.3
/**
 * A soft shot over a long distance would hang: staying up 1.8 s means climbing to
 * 4.4 m and taking a second to come down. Air time past this is cut to a fraction,
 * so long shots fly lower and faster while short ones keep their touch.
 */
const HANG_START = 1
const HANG_KEPT = 0.4
/** Peak height of any shot, or this much above the paddle for a ball hit overhead. */
const MAX_APEX = 2.7
const APEX_ABOVE_CONTACT = 0.8
/**
 * Getting over the net from (or to) a spot right beside it takes a towering lob, so
 * such targets are moved: no shorter than the first, no deeper than the second.
 */
const MIN_DEPTH = 0.5
const MAX_SHIFTED_DEPTH = 3
const SHIFT = 0.08
/** How far full sidespin bends a shot off the straight line: a share of its length, capped. */
const BEND_PER_METER = 0.12
const MAX_BEND = 1.4
/** Hard shots bend less: a curving smash would leave no time to run after it. */
const SOFT_POWER = 0.4
const SMASH_BEND_LOSS = 0.38

export interface Shot extends Vec3 {
  /** Sideways (x) acceleration from spin. */
  curve: number
}

/** Air time of a shot from height y0 that peaks at the highest allowed point. */
function longestFlight(y0: number): number {
  const apex = Math.max(MAX_APEX, y0 + APEX_ABOVE_CONTACT)
  return Math.sqrt((2 * (apex - y0)) / GRAVITY) + Math.sqrt((2 * (apex - BALL_RADIUS)) / GRAVITY)
}

/** Height of a ballistic trajectory (no drag) at time t. */
function heightAt(y0: number, vy: number, t: number): number {
  return y0 + vy * t - 0.5 * GRAVITY * t * t
}

/**
 * Solves for a launch velocity that lands the ball at `target` (on the ground),
 * clearing the net. Higher power means a faster, flatter shot; if that flat
 * path would hit the net the flight time is lengthened until it clears. Balls
 * never hang: a target that would need a towering lob is moved instead.
 *
 * `spin` (-1 to 1) bends the path toward -x or +x: the ball starts out to the other
 * side and swings back, still landing on the target.
 */
export function solveShot(
  from: Vec3,
  target: { x: number; z: number },
  power: number,
  boost = 0,
  spin = 0,
): Shot {
  const p = Math.min(1, Math.max(0, power))
  let dx = target.x - from.x
  let dz = target.z - from.z
  const speed =
    SHOT_MIN_SPEED + (SHOT_MAX_SPEED - SHOT_MIN_SPEED) * p + SMASH_EXTRA_SPEED * p ** SMASH_CURVE
  let flight = Math.hypot(dx, dz) / speed
  if (flight > HANG_START) flight = HANG_START + (flight - HANG_START) * HANG_KEPT
  const longest = longestFlight(from.y)
  flight = Math.max(Math.min(flight, longest) / (1 + boost), MIN_FLIGHT_TIME)

  const crossesNet = from.z !== 0 && Math.sign(from.z) !== Math.sign(target.z)
  let vy = 0
  for (let i = 0; i < 48; i++) {
    vy = (BALL_RADIUS - from.y + 0.5 * GRAVITY * flight * flight) / flight
    if (!crossesNet || dz === 0) break
    const tNet = (-from.z / dz) * flight
    const xNet = from.x + (dx / flight) * tNet
    if (heightAt(from.y, vy, tNet) - BALL_RADIUS >= netHeightAt(xNet) + NET_MARGIN) break
    if (flight < longest) {
      flight = Math.min(flight * 1.1, longest)
      continue
    }
    // Already as high as a shot may go: move the target away from the tight spot.
    const depth = Math.abs(from.z + dz)
    const scale = Math.abs(from.z) < depth ? 1 - SHIFT : 1 + SHIFT
    const shifted = Math.abs(from.z + dz * scale)
    if (scale < 1 ? shifted < MIN_DEPTH : shifted > MAX_SHIFTED_DEPTH) flight *= 1.1
    else {
      dx *= scale
      dz *= scale
    }
  }

  // Only the part of the shot that goes up or down the court can bend sideways.
  const dist = Math.hypot(dx, dz)
  const along = dist > 0 ? Math.abs(dz) / dist : 0
  const hard = Math.max(0, (p - SOFT_POWER) / (1 - SOFT_POWER))
  const bend =
    Math.min(MAX_BEND, dist * BEND_PER_METER) * along * spin * (1 - SMASH_BEND_LOSS * hard)
  const curve = (8 * bend) / (flight * flight)
  return { x: dx / flight - (curve * flight) / 2, y: vy, z: dz / flight, curve }
}
