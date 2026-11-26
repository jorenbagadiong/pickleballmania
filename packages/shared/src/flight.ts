import { BALL_RADIUS, GRAVITY } from './ball'
import { COURT, netHeightAt } from './court'

/*
 * Ball flight. The server's simulation decides every game; clients run the same
 * steps only to draw the ball through a gap in the connection.
 */

export interface BallBody {
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  /** Sideways (x) acceleration from sidespin, in m/s². */
  curve?: number
}

export type BallEvent =
  { type: 'bounce'; x: number; z: number } | { type: 'net'; x: number; y: number; z: number }

/** Fraction of vertical speed kept on a bounce (pickleballs are fairly dead). */
export const BOUNCE_RESTITUTION = 0.66
/** Fraction of horizontal speed kept on a bounce. */
export const BOUNCE_FRICTION = 0.84
/** Sidespin grips the floor: the ball kicks sideways, and keeps some of its spin. */
const SPIN_KICK_SECONDS = 0.2
const MAX_SPIN_KICK = 2
const SPIN_KEPT = 0.35
/** Rolling friction per second once the ball stops bouncing. */
const ROLL_DAMPING = 1.5
/** Below this impact speed the ball stops bouncing and rolls. */
const MIN_BOUNCE_SPEED = 0.5

/** How much speed survives hitting the net. */
const NET_DAMPING = 0.15

/**
 * Advances the ball one fixed step: gravity and spin (integrated exactly for
 * constant acceleration), net collision, then ground contact. Events are appended to
 * `events` for the rules layer.
 */
export function stepBall(b: BallBody, dt: number, events: BallEvent[]): void {
  const px = b.x
  const py = b.y
  const pz = b.z
  // A resting or rolling ball has no vertical speed. Height alone can't tell: a step
  // may end exactly at contact, with the bounce still to come.
  const airborne = py > BALL_RADIUS + 1e-4 || b.vy !== 0

  const curve = b.curve ?? 0
  b.x += b.vx * dt + 0.5 * curve * dt * dt
  b.vx += curve * dt
  b.z += b.vz * dt
  b.y += b.vy * dt - 0.5 * GRAVITY * dt * dt
  b.vy -= GRAVITY * dt

  // Net: a vertical plane at z = 0 from the ground to netHeightAt(x), between the posts.
  const crossed = (pz > 0 && b.z <= 0) || (pz < 0 && b.z >= 0)
  if (crossed) {
    const t = pz / (pz - b.z)
    const cx = px + (b.x - px) * t
    const cy = py + (b.y - py) * t
    if (Math.abs(cx) <= COURT.netHalfWidth && cy - BALL_RADIUS < netHeightAt(cx)) {
      const side = pz >= 0 ? 1 : -1
      b.x = cx
      b.y = Math.max(cy, BALL_RADIUS)
      b.z = side * (BALL_RADIUS + 0.01)
      b.vz = -b.vz * NET_DAMPING
      b.vx *= 0.4
      b.curve = 0
      b.vy = Math.min(b.vy, 0) * 0.3
      events.push({ type: 'net', x: cx, y: cy, z: 0 })
    }
  }

  // Ground.
  if (b.y <= BALL_RADIUS) {
    if (b.vy < 0 && airborne) {
      // Report the exact contact point inside this step (matters for line calls).
      const t = contactTime(py - BALL_RADIUS, b.vy + GRAVITY * dt, dt)
      const f = dt > 0 ? t / dt : 1
      events.push({ type: 'bounce', x: px + (b.x - px) * f, z: pz + (b.z - pz) * f })
    }
    b.y = BALL_RADIUS
    if (b.vy < 0) {
      const impact = -b.vy
      if (impact >= MIN_BOUNCE_SPEED) {
        b.vy = impact * BOUNCE_RESTITUTION
        b.vx *= BOUNCE_FRICTION
        b.vz *= BOUNCE_FRICTION
        b.vx += Math.max(-MAX_SPIN_KICK, Math.min(MAX_SPIN_KICK, curve * SPIN_KICK_SECONDS))
        b.curve = curve * SPIN_KEPT
      } else {
        b.vy = 0
      }
    }
    if (b.vy === 0) {
      const k = Math.max(0, 1 - ROLL_DAMPING * dt)
      b.curve = 0
      b.vx *= k
      b.vz *= k
    }
  }
}

/** Time within [0, dt] at which height h0 (above contact) with vertical speed vy0 reaches 0. */
function contactTime(h0: number, vy0: number, dt: number): number {
  if (h0 <= 0) return 0
  // h0 + vy0 t - g t^2 / 2 = 0  →  positive root.
  const a = 0.5 * GRAVITY
  const disc = vy0 * vy0 + 4 * a * h0
  const t = (vy0 + Math.sqrt(disc)) / (2 * a)
  return Math.min(Math.max(t, 0), dt)
}

export function isBallLost(b: BallBody): boolean {
  return Math.abs(b.x) > 30 || Math.abs(b.z) > 40 || b.y < -1
}
