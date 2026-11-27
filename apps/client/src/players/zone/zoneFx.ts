/**
 * TEZUKA ZONE, as drawn (Phases D1 and D2): which presentation state the field under the
 * secret athlete is in, how strongly it and the attraction ribbons show, and how much
 * detail they get. Purely visual: it reads replicated state and never changes the ability
 * (apps/server/src/simulation/zone.ts).
 */
import { type Phase, SECRET_LOOK } from '@pickleball/shared'

/** What the field shows. */
export type ZoneState = 'inactive' | 'available' | 'attracting'
export type ZoneTier = 'high' | 'medium' | 'low'

/** Everything the presentation depends on, all of it from the server's replicated state. */
export interface ZoneInput {
  /** The player's session id. */
  id: string
  /** The player's look as the server set it. Only `x1` has the ability. */
  look: string
  connected: boolean
  /** Drawn on the court in focus (not another tournament court). */
  focused: boolean
  phase: Phase | string
  /**
   * The ball as drawn this frame: the server's pull on it, and whom the server computed
   * that pull for (`BallState.steerTarget`, '' when there is none).
   */
  ball: {
    visible: boolean
    held: boolean
    steerX: number
    steerZ: number
    steerTarget: string
  } | null
}

export interface ZoneTarget {
  state: ZoneState
  /** 0..1: how strongly the attraction shows (follows the replicated pull). */
  pull: number
  /** Direction of the replicated pull on the ground (unit; 0, 0 when there is none). */
  dirX: number
  dirZ: number
}

/** A pull this strong (m/s²) shows at full strength; weaker ones show partly. */
const FULL_PULL = 12
/** Smaller than the wire's resolution (1 cm/s²): any replicated pull counts. */
const MIN_PULL = 0.005

const INACTIVE: ZoneTarget = { state: 'inactive', pull: 0, dirX: 0, dirZ: 0 }
const AVAILABLE: ZoneTarget = { state: 'available', pull: 0, dirX: 0, dirZ: 0 }

/**
 * The presentation state. The ability is the server's: a look of `x1` exists only for a
 * player the server granted the athlete to, in a room that allows it, so the nickname
 * never matters here. Attraction shows only on the player the server's pull is for
 * (`steerTarget`), during a rally, while the drawn ball carries that pull: with two
 * secret athletes on a team, only the one actually pulled for lights up.
 */
export function zoneTarget(i: ZoneInput): ZoneTarget {
  if (i.look !== SECRET_LOOK || !i.focused || !i.connected) return INACTIVE
  const b = i.ball
  const pull = b && b.visible && !b.held ? Math.hypot(b.steerX, b.steerZ) : 0
  if (i.phase === 'rally' && b && b.steerTarget === i.id && pull > MIN_PULL)
    return {
      state: 'attracting',
      pull: 0.55 + 0.45 * Math.min(1, pull / FULL_PULL),
      dirX: b.steerX / pull,
      dirZ: b.steerZ / pull,
    }
  return AVAILABLE
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

/**
 * Fade rates (1/s): the field appears in about half a second; the pull rises fast and
 * eases off. The ribbons (D2) follow the pull up but let go faster, so none linger after a
 * hit or a rally end.
 */
export const RATES = {
  presenceIn: 6,
  presenceOut: 4,
  pullIn: 9,
  pullOut: 3.5,
  ribbonIn: 9,
  ribbonOut: 10,
}

/**
 * How strongly a field shows: `presence` (is it there), `pull` (is it attracting) and
 * `ribbon` (the D2 attraction ribbons), with the pull direction they were last given.
 */
export interface ZoneLevels {
  presence: number
  pull: number
  ribbon: number
  dirX: number
  dirZ: number
}

export function zoneLevels(): ZoneLevels {
  return { presence: 0, pull: 0, ribbon: 0, dirX: 0, dirZ: 0 }
}

/**
 * One frame of easing toward the target, in place. `cut` drops the ribbons at once: the
 * ball was reset or jumped (a teleport), so there is nothing to draw them to.
 */
export function stepZone(l: ZoneLevels, target: ZoneTarget, dt: number, cut = false): ZoneLevels {
  const on = target.state === 'inactive' ? 0 : 1
  l.presence = approach(l.presence, on, on ? RATES.presenceIn : RATES.presenceOut, dt)
  const pull = target.state === 'inactive' ? 0 : target.pull
  l.pull = approach(l.pull, pull, pull > l.pull ? RATES.pullIn : RATES.pullOut, dt)
  const ribbon = target.state === 'attracting' ? target.pull : 0
  l.ribbon = cut
    ? 0
    : approach(l.ribbon, ribbon, ribbon > l.ribbon ? RATES.ribbonIn : RATES.ribbonOut, dt)
  if (target.state === 'attracting') {
    l.dirX = target.dirX
    l.dirZ = target.dirZ
  }
  return l
}

/** A drawn ball moving this far between two frames was reset, not hit... */
export const BALL_JUMP = 1.5
/** ...unless frames are so slow that a real shot covers that much (m/s, above any shot). */
const FASTEST_BALL = 40

/** Whether the drawn ball moved `distance` in `dt` seconds by being reset rather than flying. */
export function ballJumped(distance: number, dt: number): boolean {
  return distance > Math.max(BALL_JUMP, FASTEST_BALL * dt)
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
  /** D2: attraction ribbons from the ball to the field (one instanced draw). */
  ribbons: 1 | 2 | 3
  /** D2: motes flowing along them (0 = no draw at all). */
  streamMotes: number
  /** D2: travelling streaks along the ribbons (off: a still, even ribbon). */
  flow: boolean
  /** D2: the ribbons' extra shimmer (shader variant). */
  shimmer: boolean
}

export const TIERS: Record<ZoneTier, TierConfig> = {
  high: {
    secondaryRings: 2,
    markings: true,
    pulse: true,
    particles: 24,
    ribbons: 3,
    streamMotes: 32,
    flow: true,
    shimmer: true,
  },
  medium: {
    secondaryRings: 1,
    markings: true,
    pulse: true,
    particles: 10,
    ribbons: 2,
    streamMotes: 14,
    flow: true,
    shimmer: false,
  },
  low: {
    secondaryRings: 0,
    markings: false,
    pulse: false,
    particles: 0,
    ribbons: 1,
    streamMotes: 0,
    flow: true,
    shimmer: false,
  },
}

/**
 * With reduced motion asked for, nothing turns, pulses, drifts or travels: the field is
 * still, and attraction shows as one still ribbon and a steady change of brightness.
 */
export function tierConfig(tier: ZoneTier, reducedMotion: boolean): TierConfig {
  const c = TIERS[tier]
  return reducedMotion
    ? { ...c, pulse: false, particles: 0, ribbons: 1, streamMotes: 0, flow: false, shimmer: false }
    : c
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
  /** Draw calls the field makes this frame (attraction included). */
  draws: number
  particles: number
  /** D2: how strongly the ribbons show, and how many ribbons and flowing motes are drawn. */
  ribbon: number
  ribbons: number
  streamMotes: number
  /** D2: where the ribbons started at the last frame drawn (the drawn ball, world m). */
  ribbonFrom: { x: number; y: number; z: number } | null
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
