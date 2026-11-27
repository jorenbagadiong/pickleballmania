/**
 * TEZUKA ZONE, as drawn (Phase D1): which presentation state the field under the secret
 * athlete is in, how strongly it shows, and how much detail it gets. Purely visual: it
 * reads replicated state and never changes the ability (apps/server/src/simulation/zone.ts).
 */
import { type Phase, SECRET_LOOK, type Slot } from '@pickleball/shared'

/** What the field shows. */
export type ZoneState = 'inactive' | 'available' | 'attracting'
export type ZoneTier = 'high' | 'medium' | 'low'

/** Everything the presentation depends on, all of it from the server's replicated state. */
export interface ZoneInput {
  /** The player's look as the server set it. Only `x1` has the ability. */
  look: string
  connected: boolean
  /** Drawn on the court in focus (not another tournament court). */
  focused: boolean
  slot: Slot
  phase: Phase | string
  /** Slot of the team that hit the ball last (-1 = nobody yet). */
  lastHitSlot: number
  /** The ball as drawn this frame. */
  ball: { visible: boolean; held: boolean; steerX: number; steerZ: number } | null
}

export interface ZoneTarget {
  state: ZoneState
  /** 0..1: how strongly the attraction shows (follows the replicated pull). */
  pull: number
}

/** A pull this strong (m/s²) shows at full strength; weaker ones show partly. */
const FULL_PULL = 12
/** Smaller than the wire's resolution (1 cm/s²): any replicated pull counts. */
const MIN_PULL = 0.005

/**
 * The presentation state. The ability is the server's: a look of `x1` exists only for a
 * player the server granted the athlete to, in a room that allows it, so the nickname
 * never matters here. The pull shows only while the replicated ball is being steered
 * during a rally and was last hit by this player's opponents (the zone pulls nothing
 * else), so in doubles it lights the secret athlete's field, not the partner's.
 */
export function zoneTarget(i: ZoneInput): ZoneTarget {
  if (i.look !== SECRET_LOOK || !i.focused || !i.connected) return { state: 'inactive', pull: 0 }
  const b = i.ball
  const pull = b && b.visible && !b.held ? Math.hypot(b.steerX, b.steerZ) : 0
  const opponentsShot = i.lastHitSlot >= 0 && i.lastHitSlot !== i.slot
  if (i.phase === 'rally' && opponentsShot && pull > MIN_PULL)
    return { state: 'attracting', pull: 0.55 + 0.45 * Math.min(1, pull / FULL_PULL) }
  return { state: 'available', pull: 0 }
}

/**
 * Moves `current` toward `target` exponentially, the same over any frame rate: one
 * step of 2·dt lands where two steps of dt do.
 */
export function approach(current: number, target: number, rate: number, dt: number): number {
  if (!(dt > 0)) return current
  const next = target + (current - target) * Math.exp(-rate * dt)
  return Math.abs(next - target) < 1e-4 ? target : next
}

/** Fade rates (1/s): the field appears in about half a second; the pull rises fast, eases off. */
export const RATES = { presenceIn: 6, presenceOut: 4, pullIn: 9, pullOut: 3.5 }

/** How strongly a field shows: `presence` (is it there) and `pull` (is it attracting). */
export interface ZoneLevels {
  presence: number
  pull: number
}

/** One frame of easing toward the target, in place. */
export function stepZone(l: ZoneLevels, target: ZoneTarget, dt: number): ZoneLevels {
  const on = target.state === 'inactive' ? 0 : 1
  l.presence = approach(l.presence, on, on ? RATES.presenceIn : RATES.presenceOut, dt)
  const pull = target.state === 'inactive' ? 0 : target.pull
  l.pull = approach(l.pull, pull, pull > l.pull ? RATES.pullIn : RATES.pullOut, dt)
  return l
}

/** Below this the field is gone: nothing is drawn and no uniforms are written. */
export const VISIBLE_PRESENCE = 0.003

/** The game's own quality steps (game/quality.ts) decide the detail; nothing else does. */
export function zoneTier(q: { shadows: boolean; crowd: boolean }): ZoneTier {
  if (q.shadows) return 'high'
  return q.crowd ? 'medium' : 'low'
}

export interface TierConfig {
  /** Counter-rotating rings besides the main one. */
  secondaryRings: 0 | 1 | 2
  /** Segmented markings round the main ring, and the travelling pulse. */
  markings: boolean
  pulse: boolean
  /** Floating motes (0 = no particle draw at all). */
  particles: number
}

export const TIERS: Record<ZoneTier, TierConfig> = {
  high: { secondaryRings: 2, markings: true, pulse: true, particles: 24 },
  medium: { secondaryRings: 1, markings: true, pulse: true, particles: 10 },
  low: { secondaryRings: 0, markings: false, pulse: false, particles: 0 },
}

/**
 * With reduced motion asked for, nothing turns, pulses or drifts: the field is still,
 * and attraction shows only as a steady change of brightness and colour.
 */
export function tierConfig(tier: ZoneTier, reducedMotion: boolean): TierConfig {
  const c = TIERS[tier]
  return reducedMotion ? { ...c, pulse: false, particles: 0 } : c
}

/** Starting palette from the brief, tuned on the court (see docs/tezuka-zone-fx.md). */
export const ZONE_COLORS = {
  deep: '#081C3A',
  blue: '#2456FF',
  cyan: '#00C8FF',
  highlight: '#8CEAFF',
  white: '#F4FCFF',
} as const

/** Decorative size (m). Deliberately inside the 1.4 m hit circle: it is not a range. */
export const FIELD_RADIUS = 1.0

/** What each drawn field is doing, for the `?e2e` debug hook and measurements. */
export interface ZoneFxInfo {
  id: string
  state: ZoneState
  presence: number
  pull: number
  tier: ZoneTier
  reducedMotion: boolean
  visible: boolean
  /** Draw calls the field makes this frame. */
  draws: number
  particles: number
  /** State changes, oldest first (bounded). */
  log: { state: ZoneState; at: number }[]
}

export const zoneFields = new Map<string, ZoneFxInfo>()
export const zoneFxCounts = { mounted: 0, disposed: 0 }
const LOG_LIMIT = 64

export function logState(info: ZoneFxInfo, state: ZoneState, at: number): void {
  if (info.state === state && info.log.length) return
  info.state = state
  info.log.push({ state, at })
  if (info.log.length > LOG_LIMIT) info.log.shift()
}
