import {
  type BallBody,
  type BallEvent,
  COURT,
  FIXED_DT,
  REACH_MAX_HEIGHT,
  REACH_RADIUS,
  type Side,
  type Slot,
  isInKitchen,
  isInServiceBox,
  isInsideCourt,
  sideOf,
  stepBall,
} from '@pickleball/shared'

/*
 * TEZUKA ZONE: the secret developer athlete's passive (docs/tezuka.md). Every eligible
 * incoming shot bends toward a point where they can hit it. The ball is only steered —
 * a bounded, smoothly changing pull along the ground (BallBody.steerX/steerZ, never the
 * spin in `curve`); it is never moved, and nothing is hit for the player.
 */

export interface ZonePreset {
  name: ZonePresetName
  /** Strongest pull (m/s², ground plane). */
  maxAccel: number
  /** Most speed the pull may add or take away over one flight (m/s). */
  maxExtraSpeed: number
  /** How quickly the pull follows the plan (1/s). */
  smoothing: number
  /** How far ahead the flight is predicted (s). */
  horizon: number
  /** Ticks between new plans. */
  retargetTicks: number
  /**
   * Where the ball is brought: the nearest point of a disk of `contactRadius` (the
   * preferred contact distance, m) around a spot `contactSide` toward the paddle hand
   * and `contactAhead` toward the net. Well inside the reach radius (REACH_RADIUS).
   */
  contactSide: number
  contactAhead: number
  contactRadius: number
  /** Only a ball within this ground distance of the player is pulled (m). */
  activationRange: number
  /** Closer to contact than this (s), the plan is kept as it is. */
  lockTime: number
  /** How far ahead a moving player's position is predicted, at most (s). */
  leadTime: number
}

export type ZonePresetName = 'normal' | 'strong' | 'anime'

export const ZONE_PRESETS: Record<ZonePresetName, ZonePreset> = {
  /** Subtle: helps a little with balls that come near anyway. */
  normal: {
    name: 'normal',
    maxAccel: 4,
    maxExtraSpeed: 3,
    smoothing: 6,
    horizon: 2.5,
    retargetTicks: 6,
    contactSide: 0.35,
    contactAhead: 0.15,
    contactRadius: 0.6,
    activationRange: 9,
    lockTime: 0.25,
    leadTime: 0.4,
  },
  /** Reliable: most ordinary returns come to the player; fast smashes mostly don't. */
  strong: {
    name: 'strong',
    maxAccel: 18,
    maxExtraSpeed: 12,
    smoothing: 14,
    horizon: 2.5,
    retargetTicks: 3,
    contactSide: 0.35,
    contactAhead: 0.15,
    contactRadius: 0.6,
    activationRange: 20,
    lockTime: 0.12,
    leadTime: 0.5,
  },
  /** Anime: nearly everything that can be brought is brought (tuned by measurement). */
  anime: {
    name: 'anime',
    maxAccel: 60,
    maxExtraSpeed: 40,
    smoothing: 22,
    horizon: 3,
    retargetTicks: 3,
    contactSide: 0.35,
    contactAhead: 0.15,
    contactRadius: 0.6,
    activationRange: 40,
    lockTime: 0.1,
    leadTime: 0.6,
  },
}

export function parseZonePreset(input: unknown): ZonePreset {
  return ZONE_PRESETS[input as ZonePresetName] ?? ZONE_PRESETS.anime
}

/** Below this speed toward the player's baseline, the pull may not slow the ball further. */
const MIN_FORWARD_SPEED = 1.2
/** The ball is only steered along the court once it is this far past the net. */
const PAST_NET = 0.05
/** Contact points closer to the net than this are not aimed for. */
const MIN_CONTACT_DEPTH = 0.3
/** Comfortable contact heights: outside them a point costs more. */
const COMFORT_LOW = 0.45
const COMFORT_HIGH = 1.5
/**
 * How much more a pull along the court counts than one across it, choosing contact:
 * braking a ball counts most (it looks unnatural), carrying it on toward the player less.
 */
const BRAKE_COST = 3
const CARRY_COST = 1.2
/** A plan needs at least this long before contact (s). */
const MIN_LEAD = 4 * FIXED_DT
/** Inside the court by this much counts as safely in. */
const LINE_MARGIN = 0.1

/** What the zone needs to know about the rally. */
export interface ZoneRally {
  lastHitter: Slot | null
  isServe: boolean
  receiverId: string | null
  mustBounce: boolean
  bounced: boolean
  touchedNet: boolean
  serverSlot: Slot
  serveParity: number
}

export interface ZonePlayer {
  id: string
  slot: Slot
  x: number
  z: number
  vx: number
  vz: number
  connected: boolean
}

export interface ZoneDiagnostics {
  /** Pulling this tick. */
  active: boolean
  /** Why it is (not) pulling. */
  reason: string
  /** Where the ball is being brought, and how long until then (s). */
  target: { x: number; z: number; y: number } | null
  timeToContact: number
  steerX: number
  steerZ: number
  /** The pull the plan wanted (m/s²), before limits: above maxAccel it can't be fully done. */
  wanted: number
  /** Speed added or taken so far this flight (m/s). */
  spent: number
  /** Rally shot being steered (-1 = none). */
  shot: number
}

interface Plan {
  ax: number
  az: number
  /** Tick of contact. */
  tick: number
  x: number
  y: number
  z: number
  wanted: number
}

interface Flight {
  shot: number
  plan: Plan | null
  plannedAt: number
  spent: number
  done: boolean
  reason: string
  /** Ever pulled (for the "redirected" pulse). */
  pulled: boolean
}

/**
 * Whether this player is the one an incoming shot is for: receiving eligibility, not
 * whether they may hit it yet (the two-bounce rule and the kitchen still decide that
 * at contact, in GameSimulation.tryHit).
 */
export function zoneEligible(p: ZonePlayer, rally: ZoneRally): boolean {
  if (!p.connected || rally.lastHitter === null || rally.lastHitter === p.slot) return false
  // A serve is for its receiver alone; every other shot is for the whole receiving team.
  if (rally.isServe && rally.receiverId !== null && rally.receiverId !== p.id) return false
  // Into the net: that shot is over.
  return !rally.touchedNet
}

/** One sample of a predicted flight. */
interface Sample {
  tick: number
  t: number
  x: number
  y: number
  z: number
  /** Speed along the court. */
  vz: number
  /** Bounces on the receiving side so far. */
  bounces: number
}

interface Prediction {
  samples: Sample[]
  /** Time the ball crosses the net (0 = already across). */
  tNet: number
  /** First bounce on the receiving side. */
  bounce: { x: number; z: number } | null
  /** Hit the net, or bounced on its own side. */
  blocked: boolean
}

/**
 * The ball's flight with a constant pull (`az` only once past the net), until it bounces
 * a second time on the receiving side, is lost, or the horizon runs out. `bounced`: it
 * has bounced there once already.
 */
function predict(
  ball: BallBody,
  side: Side,
  ax: number,
  az: number,
  horizon: number,
  tick: number,
  bounced: boolean,
): Prediction {
  const b: BallBody = { ...ball, steerX: ax, steerZ: 0 }
  const events: BallEvent[] = []
  const samples: Sample[] = []
  let bounces = bounced ? 1 : 0
  let bounce: Prediction['bounce'] = null
  let blocked = false
  let tNet = ball.z * side > 0 ? 0 : -1
  const steps = Math.ceil(horizon / FIXED_DT)
  for (let i = 1; i <= steps; i++) {
    const past = b.z * side > PAST_NET
    b.steerZ = past ? az : 0
    b.steerX = ax
    stepBall(b, FIXED_DT, events)
    if (tNet < 0 && b.z * side > 0) tNet = i * FIXED_DT
    for (const e of events) {
      if (e.type === 'net') blocked = true
      else if (e.z * side > 0) {
        bounces += 1
        if (bounces === 1) bounce = { x: e.x, z: e.z }
      } else blocked = true
    }
    events.length = 0
    if (blocked || bounces >= 2 || Math.abs(b.x) > 30 || Math.abs(b.z) > 40) break
    samples.push({ tick: tick + i, t: i * FIXED_DT, x: b.x, y: b.y, z: b.z, vz: b.vz, bounces })
  }
  return { samples, tNet: Math.max(tNet, 0), bounce, blocked }
}

/** Speed along the court at the net crossing (or now), from which a pull along it starts. */
function sampleVz(pred: Prediction, s: Sample): number {
  const atNet = pred.samples.find((q) => q.t >= pred.tNet)
  return (atNet ?? s).vz
}

/** Where the player will be in `t` seconds, if they keep moving (within reason). */
function playerAt(p: ZonePlayer, t: number, preset: ZonePreset): { x: number; z: number } {
  const lead = Math.min(t, preset.leadTime)
  const side = sideOf(p.slot)
  const x = Math.max(-COURT.halfWidth - 1.5, Math.min(COURT.halfWidth + 1.5, p.x + p.vx * lead))
  const depth = Math.max(0.2, Math.min(COURT.halfLength + 2.5, (p.z + p.vz * lead) * side))
  return { x, z: depth * side }
}

/**
 * Where to meet a ball that would otherwise be at `ball`: the nearest point of the
 * comfortable contact disk beside the player's paddle hand (see ZonePreset).
 */
function contactPoint(
  p: { x: number; z: number },
  ball: { x: number; z: number },
  side: Side,
  preset: ZonePreset,
) {
  // Facing the net, the left hand is toward -x on the +z half (side 1) and +x on the other.
  // The secret athlete plays left-handed.
  const left = -side
  const cx = p.x + left * preset.contactSide
  const cz = p.z - side * preset.contactAhead
  const dx = ball.x - cx
  const dz = ball.z - cz
  const d = Math.hypot(dx, dz)
  const k = d > preset.contactRadius ? preset.contactRadius / d : 1
  return {
    x: cx + dx * k,
    z: side * Math.max(MIN_CONTACT_DEPTH, (cz + dz * k) * side),
  }
}

function bounceLegal(b: { x: number; z: number }, side: Side, rally: ZoneRally): boolean {
  if (rally.isServe) return isInServiceBox(b.x, b.z, rally.serverSlot, rally.serveParity)
  return (
    isInsideCourt(b.x, b.z, side) &&
    Math.abs(b.x) <= COURT.halfWidth - LINE_MARGIN &&
    Math.abs(b.z) <= COURT.halfLength - LINE_MARGIN
  )
}

/**
 * Plans the pull: picks the legal contact moment needing the least pull, then corrects
 * it against the real flight (bounces slow the ball, so a constant pull is only a guess).
 */
function makePlan(
  ball: BallBody,
  p: ZonePlayer,
  rally: ZoneRally,
  preset: ZonePreset,
  tick: number,
): Plan | null {
  const side = sideOf(p.slot)
  const free = predict(ball, side, 0, 0, preset.horizon, tick, rally.bounced)
  if (free.blocked && free.samples.length === 0) return null
  // The two-bounce rule (and a volley from the kitchen being a fault) means meeting it
  // after its bounce; the pull can still bend it before.
  const afterBounce = rally.mustBounce || isInKitchen(p.x, p.z, side)

  let best: { s: Sample; aim: { x: number; z: number }; cost: number } | null = null
  for (const s of free.samples) {
    if (s.t < MIN_LEAD || s.y > REACH_MAX_HEIGHT - 0.05 || s.y < 0.12) continue
    if (afterBounce && s.bounces === 0) continue
    if (s.z * side < MIN_CONTACT_DEPTH) continue
    const aim = contactPoint(playerAt(p, s.t, preset), s, side, preset)
    const ax = (2 * (aim.x - s.x)) / (s.t * s.t)
    const tz = s.t - free.tNet
    const dz = aim.z - s.z
    if (tz < MIN_LEAD && Math.abs(dz) > REACH_RADIUS * 0.5) continue
    const az = tz >= MIN_LEAD ? (2 * dz) / (tz * tz) : 0
    // Braking along the court may not stall the ball (see MIN_FORWARD_SPEED).
    const vzEnd = sampleVz(free, s) + az * tz
    if (vzEnd * side < MIN_FORWARD_SPEED && az * side < 0) continue
    // Bending sideways is what the zone looks like; changing the depth is a last resort,
    // so contact is met about where the ball reaches the player's depth on its own.
    let cost = Math.hypot(ax, (az * side < 0 ? BRAKE_COST : CARRY_COST) * az)
    if (s.y < COMFORT_LOW || s.y > COMFORT_HIGH) cost = cost * 1.5 + 3
    if (!best || cost < best.cost) best = { s, aim, cost }
  }
  if (!best) return null

  const { s, aim } = best
  const tz = Math.max(s.t - free.tNet, MIN_LEAD)
  let ax = (2 * (aim.x - s.x)) / (s.t * s.t)
  let az = s.t - free.tNet >= MIN_LEAD ? (2 * (aim.z - s.z)) / (tz * tz) : 0
  const at = (pred: Prediction): Sample | undefined =>
    pred.samples.find((q) => q.tick === s.tick) ?? pred.samples[pred.samples.length - 1]
  for (let k = 0; k < 3; k++) {
    const q = at(predict(ball, side, ax, az, s.t + FIXED_DT, tick, rally.bounced))
    if (!q) break
    ax += (2 * (aim.x - q.x)) / (s.t * s.t)
    if (s.t - free.tNet >= MIN_LEAD) az += (2 * (aim.z - q.z)) / (tz * tz)
  }
  const wanted = Math.hypot(ax, az)

  // Never make an in ball land out (or a good serve miss its box), nor hit the net.
  const wasLegal = free.bounce !== null && bounceLegal(free.bounce, side, rally)
  const ok = (scale: number): boolean => {
    const pred = predict(ball, side, ax * scale, az * scale, s.t + FIXED_DT, tick, rally.bounced)
    if (pred.blocked) return false
    if (!wasLegal && !rally.isServe) return true
    // A serve must still find its box; a shot that was in must stay in.
    return pred.bounce === null || bounceLegal(pred.bounce, side, rally)
  }
  let scale = 1
  if (!ok(1)) {
    let lo = 0
    let hi = 1
    for (let k = 0; k < 6; k++) {
      const mid = (lo + hi) / 2
      if (ok(mid)) lo = mid
      else hi = mid
    }
    scale = lo
  }
  return { ax: ax * scale, az: az * scale, tick: s.tick, x: aim.x, y: s.y, z: aim.z, wanted }
}

const idle = (reason: string, shot = -1): ZoneDiagnostics => ({
  active: false,
  reason,
  target: null,
  timeToContact: 0,
  steerX: 0,
  steerZ: 0,
  wanted: 0,
  spent: 0,
  shot,
})

/** One court's zone: what the current flight is being steered toward. */
export class TezukaZone {
  private flight: Flight | null = null
  diagnostics: ZoneDiagnostics = idle('off')

  constructor(public preset: ZonePreset = ZONE_PRESETS.anime) {}

  /** Lets go of the ball over a few ticks, at the same rate the pull may build up. */
  private fade(ball: BallBody): void {
    const step = this.preset.maxAccel * (1 - Math.exp(-this.preset.smoothing * FIXED_DT))
    const sx = ball.steerX ?? 0
    const sz = ball.steerZ ?? 0
    const m = Math.hypot(sx, sz)
    const k = m > step ? (m - step) / m : 0
    ball.steerX = sx * k
    ball.steerZ = sz * k
  }

  /** Forgets the flight and stops pulling at once (a new shot, or the rally is over). */
  reset(ball: BallBody, reason: string): void {
    this.flight = null
    ball.steerX = 0
    ball.steerZ = 0
    this.diagnostics = idle(reason)
  }

  /**
   * Sets the pull for the next step. `player` is the eligible zone player (null: none),
   * `shot` the rally's shot count, so a new shot starts a new flight.
   * Returns true the first tick a shot starts being pulled.
   */
  step(ball: BallBody, player: ZonePlayer | null, rally: ZoneRally, shot: number, tick: number) {
    if (!player || !zoneEligible(player, rally)) {
      if (this.flight || ball.steerX || ball.steerZ) this.reset(ball, 'not eligible')
      return false
    }
    if (!this.flight || this.flight.shot !== shot) {
      this.flight = {
        shot,
        plan: null,
        plannedAt: -Infinity,
        spent: 0,
        done: false,
        reason: 'new shot',
        pulled: false,
      }
      ball.steerX = 0
      ball.steerZ = 0
    }
    const f = this.flight
    const preset = this.preset
    const side = sideOf(player.slot)
    const stop = (reason: string): false => {
      f.done = true
      f.reason = reason
      this.fade(ball)
      this.diagnostics = { ...idle(reason, shot), spent: f.spent }
      return false
    }
    if (f.done) {
      this.fade(ball)
      return false
    }
    // Coming back toward the net (it hit something), or gone past the player: finished.
    if (ball.vz * side <= 0) return stop('moving away')
    if ((ball.z - player.z) * side > REACH_RADIUS) return stop('passed the player')
    if (f.spent >= preset.maxExtraSpeed) return stop('speed budget used')
    if (f.plan && tick > f.plan.tick + 2) return stop('contact time passed')
    if (Math.hypot(ball.x - player.x, ball.z - player.z) > preset.activationRange) {
      this.fade(ball)
      this.diagnostics = { ...idle('out of range', shot), spent: f.spent }
      return false
    }

    const locked = f.plan !== null && (f.plan.tick - tick) * FIXED_DT < preset.lockTime
    if (!locked && tick - f.plannedAt >= preset.retargetTicks) {
      f.plan = makePlan(ball, player, rally, preset, tick)
      f.plannedAt = tick
    }
    const plan = f.plan
    if (!plan) {
      // Nothing reachable for now: let go gently, and look again at the next plan.
      this.fade(ball)
      this.diagnostics = { ...idle('nothing to aim for', shot), spent: f.spent }
      return false
    }

    // Follow the plan smoothly, within the limits: the pull changes by at most
    // maxAccel * k per tick (it takes ~1/k ticks to build up), and never exceeds maxAccel.
    const k = 1 - Math.exp(-preset.smoothing * FIXED_DT)
    const pastNet = ball.z * side > PAST_NET
    const fromX = ball.steerX ?? 0
    const fromZ = ball.steerZ ?? 0
    // Never stall the ball or turn it back toward the hitter: stop braking in good time
    // (the pull can only let go at the rate it builds up).
    let wantZ = pastNet ? plan.az : 0
    const letGo = (Math.abs(fromZ) / (preset.maxAccel * k)) * FIXED_DT
    const forwardSoon = (ball.vz + fromZ * (letGo + 2 * FIXED_DT)) * side
    if (wantZ * side < 0 && forwardSoon < MIN_FORWARD_SPEED) wantZ = 0
    let dx = (plan.ax - fromX) * k
    let dz = (wantZ - fromZ) * k
    const change = Math.hypot(dx, dz)
    if (change > preset.maxAccel * k) {
      dx *= (preset.maxAccel * k) / change
      dz *= (preset.maxAccel * k) / change
    }
    let sx = fromX + dx
    let sz = fromZ + dz
    const mag = Math.hypot(sx, sz)
    if (mag > preset.maxAccel) {
      sx *= preset.maxAccel / mag
      sz *= preset.maxAccel / mag
    }
    // Last resort, should braking still go too far: no braking at all this tick.
    if (sz * side < 0 && (ball.vz + sz * FIXED_DT) * side < MIN_FORWARD_SPEED * 0.5) sz = 0
    ball.steerX = sx
    ball.steerZ = sz
    f.spent += Math.hypot(sx, sz) * FIXED_DT
    const first = !f.pulled && (sx !== 0 || sz !== 0)
    if (first) f.pulled = true
    this.diagnostics = {
      active: true,
      reason: locked ? 'locked on' : 'steering',
      target: { x: plan.x, y: plan.y, z: plan.z },
      timeToContact: Math.max(0, (plan.tick - tick) * FIXED_DT),
      steerX: sx,
      steerZ: sz,
      wanted: plan.wanted,
      spent: f.spent,
      shot,
    }
    return first
  }
}
