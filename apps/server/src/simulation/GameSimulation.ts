import {
  BALL_RADIUS,
  type BallBody,
  type BallEvent,
  COURT,
  FIRE_STREAK,
  FIXED_DT,
  GRAVITY,
  JUMP_BOOST,
  JUMP_MIN_FORWARD,
  JUMP_MIN_HEIGHT,
  JUMP_REACH_HEIGHT,
  MAX_BOOST,
  MAX_SWING_REWIND_SECONDS,
  NET_REACH_TOLERANCE,
  PERFECT_BOOST,
  PERFECT_MAX_DISTANCE,
  PERFECT_TIMING_SECONDS,
  REACH_MAX_HEIGHT,
  REACH_RADIUS,
  SMASH_MIN_POWER,
  SERVE_HOLD_FORWARD,
  SERVE_HOLD_HEIGHT,
  SWING_ACTIVE_WINDOW,
  SWING_COOLDOWN,
  SWING_DURATION,
  type FxEvent,
  type InputFrame,
  type Phase,
  type Side,
  type Slot,
  type Spot,
  WINNING_SCORE,
  WIN_BY,
  canSwing,
  clampToBounds,
  forwardShare,
  isBallLost,
  isInKitchen,
  movementBounds,
  otherSlot,
  rallyHeat,
  reachDistance,
  sanitizeIntent,
  serveCourtXSign,
  serveParityFor,
  sideOf,
  stepBall,
  stepPlayer,
  yawToward,
} from '@pickleball/shared'
import { RallyTracker, type RallyOutcome, explain } from '../rules/rally'
import { type Shot, type Vec3, solveShot } from './shot'
import { TezukaZone, type ZonePlayer, zoneEligible } from './zone'

export interface Swing {
  /** Seconds since the swing started. */
  t: number
  power: number
  /** Sidespin toward +x (1) or -x (-1). */
  spin: number
  aimX: number
  aimZ: number
  hit: boolean
  jump: boolean
  /** Server tick the player was looking at when they clicked. */
  viewTick: number
}

export interface SimPlayer {
  id: string
  /** Team (= side of the net). */
  slot: Slot
  /** Position within the team; partners alternate serving by spot. */
  spot: Spot
  nickname: string
  x: number
  z: number
  vx: number
  vz: number
  yaw: number
  aimX: number
  aimZ: number
  connected: boolean
  ready: boolean
  /** Highest input sequence number applied (sent back for client reconciliation). */
  lastSeq: number
  queue: InputFrame[]
  lastQueuedSeq: number
  /** Token bucket limiting how many inputs may be applied over time. */
  inputBudget: number
  swing: Swing | null
  /** Seconds since the last swing, and the rally shot it was aimed at. */
  sinceSwing: number
  swingShot: number
  /** Swings made at that shot. */
  shotSwings: number
  swingSeq: number
  /** The last swing was a jump smash. */
  swingJump: boolean
  /** Latest movement toward the net (-1 to 1), as sent. */
  forward: number
  /** Counts down after a volley; stepping into the kitchen meanwhile is a fault. */
  volleyTimer: number
  /** Rallies in a row won with this player's shot; ends when their side loses one. */
  streak: number
}

/** Why the last rally ended and what it was worth, for the players to read. */
export interface RallyResult {
  winner: Slot
  reason: string
  detail: string
  result: string
  /** Who caught fire by winning this rally ('' = nobody). */
  ignited: string
}

export interface SimBall extends BallBody {
  visible: boolean
  held: boolean
}

interface HistoryEntry extends Vec3 {
  tick: number
  /** Whether the ball had already bounced at this moment. */
  bounced: boolean
}

/** Long enough to read why the rally ended. */
const POINT_OVER_SECONDS = 3.5
/** How long after a volley momentum into the kitchen still counts against you. */
const KITCHEN_MOMENTUM_SECONDS = 0.3
const MAX_QUEUED_INPUTS = 30
/** Enough saved-up credit to absorb a full queue after a ~0.5 s stall. */
const MAX_INPUT_BUDGET = MAX_QUEUED_INPUTS
/**
 * Clients produce one input per tick. Refilling at exactly that rate would mean
 * inputs queued by a stall, a lost server tick or clock drift never drain, and
 * the server would judge swings from where the player *was* for the rest of the
 * match. The small surplus lets it catch up; it is also the most extra speed a
 * flooding client could gain.
 */
const INPUT_BUDGET_PER_TICK = 1.1
/** Spreads catching up over a few ticks so opponents don't see a teleport. */
const MAX_INPUTS_PER_TICK = 4
const MAX_FRAMES_PER_MESSAGE = 20
/** Ball positions kept for checking swings against what the player saw. */
const HISTORY_TICKS = Math.ceil(MAX_SWING_REWIND_SECONDS / FIXED_DT) + 2
/** Used when a swing arrives without a usable view tick (~150 ms back). */
const DEFAULT_REWIND_TICKS = 9
/** A click this late (as the player saw it) still meets the ball (~100 ms). */
const LATE_GRACE_TICKS = 6
const ACTIVE_WINDOW_TICKS = Math.round(SWING_ACTIVE_WINDOW / FIXED_DT)
/** How much closer together than allowed two swings may arrive. */
const SWING_JITTER_SECONDS = 0.06
const SERVE_POWER = 0.3
const MIN_LAUNCH_DEPTH = 0.25
/** Spin costs a little accuracy. */
const SPIN_SCATTER = 0.15

function finite(n: unknown, fallback = 0): number {
  return typeof n === 'number' && Number.isFinite(n) ? n : fallback
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}

/** Spin as sent (the player's left/right) to world x; players face the net. */
function worldSpin(spin: unknown, side: Side): number {
  return clamp(finite(spin), -1, 1) * side
}

/** Clamps an aim point into (or just beyond) the target half of the court. */
export function clampAim(ax: number, az: number, targetSide: Side): { x: number; z: number } {
  const x = clamp(finite(ax), -COURT.halfWidth - 1.5, COURT.halfWidth + 1.5)
  const depth = clamp(finite(az) * targetSide, 0.6, COURT.halfLength + 1.5)
  return { x, z: depth * targetSide }
}

/**
 * Authoritative game simulation. Knows nothing about networking: the room
 * feeds it validated-at-the-edge commands and copies its state to the wire.
 */
export class GameSimulation {
  readonly players = new Map<string, SimPlayer>()
  readonly ball: SimBall = {
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    curve: 0,
    visible: false,
    held: false,
  }
  phase: Phase = 'waiting'
  /** Team serving the next/current rally. */
  servingSlot: Slot = 0
  /** The player serving the next/current rally (null outside a match). */
  serverId: string | null = null
  /** Server 1 or 2 of the serving team (doubles; always 1 in singles). */
  serverNumber: 1 | 2 = 1
  protected serverSpot: Spot = 0
  /** The player who must return the next serve. */
  receiverId: string | null = null
  /** Set once a team has won the game. */
  gameWinner: Slot | null = null
  private firstServer: Slot = 0
  lastRally: RallyResult | null = null
  protected lastHitId = ''
  /** Who last hit the ball for each team this rally ('' = nobody). */
  protected readonly teamHitId: [string, string] = ['', '']
  /** Points per team; only the serving team can score. */
  readonly scores: [number, number] = [0, 0]
  message = 'Waiting for players to join'
  lastHitSlot = -1
  tick = 0
  rallyShots = 0
  protected phaseTimer = 0
  protected readonly rally = new RallyTracker()
  private readonly history: HistoryEntry[] = []
  /**
   * Players with the TEZUKA ZONE (the room's authorized secret athletes; empty unless the
   * room allows them). Only those seated, connected and receiving the shot count.
   */
  zoneIds: ReadonlySet<string> = new Set()
  readonly zone = new TezukaZone()
  protected readonly fx: FxEvent[] = []
  private readonly ballEvents: BallEvent[] = []

  /**
   * @param teamSize 1 for singles (1v1), 2 for doubles (2v2).
   * @param rng random source for shot scatter (injectable for tests).
   */
  constructor(
    readonly teamSize: 1 | 2 = 1,
    protected readonly rng: () => number = Math.random,
  ) {}

  // ---------------------------------------------------------------- roster

  /** Players on a team, ordered by spot. */
  team(slot: Slot): SimPlayer[] {
    return [...this.players.values()].filter((p) => p.slot === slot).sort((a, b) => a.spot - b.spot)
  }

  get capacity(): number {
    return this.teamSize * 2
  }

  get isFull(): boolean {
    return this.players.size >= this.capacity
  }

  /** A game is under way (including a pause for a reconnect). */
  get inGame(): boolean {
    return this.phase !== 'waiting' && this.phase !== 'lobby' && this.phase !== 'gameOver'
  }

  /** "Alice" or "Alice & Carol". */
  teamName(slot: Slot): string {
    const names = this.team(slot).map((p) => p.nickname)
    return names.length > 0 ? names.join(' & ') : 'the other team'
  }

  private freeSpot(slot: Slot): Spot | null {
    const taken = new Set(this.team(slot).map((p) => p.spot))
    for (const spot of [0, 1] as const) {
      if (spot < this.teamSize && !taken.has(spot)) return spot
    }
    return null
  }

  private placeAtHome(p: SimPlayer): void {
    const side = sideOf(p.slot)
    // Partners stand side by side; a lone player stands in the middle.
    p.x = this.teamSize === 1 ? 0 : (p.spot === 0 ? 1 : -1) * side * COURT.halfWidth * 0.5
    p.z = side * (COURT.halfLength - 1)
    p.vx = 0
    p.vz = 0
    p.yaw = side === 1 ? Math.PI : 0
    p.aimX = 0
    p.aimZ = -side * COURT.halfLength * 0.5
  }

  addPlayer(id: string, nickname: string): SimPlayer | null {
    if (this.isFull || this.players.has(id)) return null
    // Fill the smaller team first (team 0 on a tie).
    const slot: Slot = this.team(1).length < this.team(0).length ? 1 : 0
    const spot = this.freeSpot(slot)
    if (spot === null) return null
    const p: SimPlayer = {
      id,
      slot,
      spot,
      nickname,
      x: 0,
      z: 0,
      vx: 0,
      vz: 0,
      yaw: 0,
      aimX: 0,
      aimZ: 0,
      connected: true,
      ready: false,
      lastSeq: 0,
      queue: [],
      lastQueuedSeq: 0,
      inputBudget: MAX_INPUT_BUDGET,
      swing: null,
      sinceSwing: 10,
      swingShot: -1,
      shotSwings: 0,
      swingSeq: 0,
      swingJump: false,
      forward: 0,
      volleyTimer: 0,
      streak: 0,
    }
    this.placeAtHome(p)
    this.players.set(id, p)
    this.refreshPhase()
    return p
  }

  removePlayer(id: string): void {
    if (!this.players.delete(id)) return
    for (const p of this.players.values()) p.ready = false
    this.scores[0] = 0
    this.scores[1] = 0
    this.refreshPhase()
  }

  /** Empties the court. */
  clearSeats(): void {
    this.players.clear()
    this.refreshPhase()
  }

  /** Seats the players of a match at once, filling the teams in turn (0, 1, 0, 1). */
  seatMatch(list: { id: string; nickname: string; connected: boolean }[]): void {
    this.players.clear()
    this.refreshPhase()
    for (const { id, nickname } of list) this.addPlayer(id, nickname)
    for (const { id, connected } of list) if (!connected) this.setConnected(id, false)
  }

  /** The next game of the same match, without everyone having to be ready again. */
  nextGame(): void {
    if (this.phase !== 'gameOver') return
    for (const p of this.players.values()) p.ready = true
    this.startGame()
    this.refreshPhase()
  }

  /** Move to the other team (only before a match starts, and only if there's room). */
  switchTeam(id: string, msg: unknown): void {
    const p = this.players.get(id)
    const team = (msg as { team?: unknown } | null)?.team
    if (!p || (team !== 0 && team !== 1) || team === p.slot) return
    if (this.phase !== 'waiting' && this.phase !== 'lobby') return
    const spot = this.freeSpot(team)
    if (spot === null) return
    p.slot = team
    p.spot = spot
    p.ready = false
    this.placeAtHome(p)
    this.refreshPhase()
  }

  setConnected(id: string, connected: boolean): void {
    const p = this.players.get(id)
    if (!p) return
    p.connected = connected
    // The rally stops here (paused, then a fresh serve): nothing goes on pulling the ball.
    if (!connected) this.zone.reset(this.ball, 'disconnected')
    p.queue.length = 0
    // A reconnecting client resumes numbering from the last *applied* input.
    p.lastQueuedSeq = p.lastSeq
    p.forward = 0
    p.swing = null
    this.refreshPhase()
  }

  setReady(id: string, ready: unknown): void {
    const p = this.players.get(id)
    if (!p || typeof ready !== 'boolean') return
    p.ready = ready
    this.refreshPhase()
  }

  // -------------------------------------------------------------- commands

  queueInputs(id: string, msg: unknown): void {
    const p = this.players.get(id)
    if (!p || !p.connected) return
    const frames = (msg as { frames?: unknown } | null)?.frames
    if (!Array.isArray(frames)) return
    for (const raw of frames.slice(0, MAX_FRAMES_PER_MESSAGE)) {
      const f = raw as Partial<InputFrame> | null
      const seq = f?.seq
      if (typeof seq !== 'number' || !Number.isInteger(seq) || seq <= p.lastQueuedSeq) continue
      p.lastQueuedSeq = seq
      p.queue.push({
        seq,
        mx: finite(f?.mx),
        mz: finite(f?.mz),
        ax: clamp(finite(f?.ax, p.aimX), -40, 40),
        az: clamp(finite(f?.az, p.aimZ), -40, 40),
      })
      p.forward = forwardShare(sanitizeIntent(finite(f?.mx), finite(f?.mz)).mz, sideOf(p.slot))
    }
    if (p.queue.length > MAX_QUEUED_INPUTS) p.queue.splice(0, p.queue.length - MAX_QUEUED_INPUTS)
  }

  requestSwing(id: string, msg: unknown): void {
    const p = this.players.get(id)
    if (!p || !p.connected || this.phase === 'paused') return
    const allowed = canSwing({
      // Network jitter can make two well-spaced clicks arrive closer together.
      sinceLast: p.sinceSwing + SWING_JITTER_SECONDS,
      inRally: this.phase === 'rally',
      ownTeamHitLast: this.lastHitSlot === p.slot,
      swingsThisShot: p.swingShot === this.rallyShots ? p.shotSwings : 0,
    })
    if (!allowed) return
    const m = (msg ?? {}) as Record<string, unknown>
    // The client draws the ball slightly in the past and the click takes time to
    // arrive, so check the swing against what the player was actually seeing —
    // bounded so nobody can claim to have swung long ago.
    const oldest = this.tick - Math.round(MAX_SWING_REWIND_SECONDS / FIXED_DT)
    const claimed = finite(m.viewTick, Number.NaN)
    const viewTick = Number.isFinite(claimed)
      ? clamp(Math.round(claimed), oldest, this.tick)
      : this.tick - DEFAULT_REWIND_TICKS
    const power = clamp(finite(m.power), 0, 1)
    // Asking for a jump isn't enough: it takes a smash, on the move toward the net.
    const jump = m.jump === true && power >= SMASH_MIN_POWER && p.forward >= JUMP_MIN_FORWARD
    p.swingJump = jump
    p.swing = {
      t: 0,
      power,
      jump,
      spin: worldSpin(m.spin, sideOf(p.slot)),
      aimX: finite(m.ax, p.aimX),
      aimZ: finite(m.az, p.aimZ),
      hit: false,
      viewTick,
    }
    this.countSwing(p)
    p.swingSeq = (p.swingSeq + 1) % 65536
    this.tryHit(p, true)
  }

  private countSwing(p: SimPlayer): void {
    const shot = this.phase === 'rally' ? this.rallyShots : -1
    p.shotSwings = shot >= 0 && p.swingShot === shot ? p.shotSwings + 1 : 1
    p.swingShot = shot
    p.sinceSwing = 0
  }

  requestServe(id: string, msg: unknown): void {
    const p = this.players.get(id)
    if (!p || this.phase !== 'serving' || p.id !== this.serverId) return
    if (p.sinceSwing + SWING_JITTER_SECONDS < SWING_COOLDOWN) return
    const m = (msg ?? {}) as Record<string, unknown>
    const receiverSide = sideOf(otherSlot(p.slot))
    const aim = clampAim(finite(m.ax, p.aimX), finite(m.az, p.aimZ), receiverSide)
    const spin = worldSpin(m.spin, sideOf(p.slot))
    const target = this.scatter(aim, 0.2 + SPIN_SCATTER * Math.abs(spin))
    const from = { x: this.ball.x, y: this.ball.y, z: this.ball.z }
    const v = solveShot(from, target, SERVE_POWER, 0, spin)
    this.launch(from, v)
    this.rally.startServe(p.slot, this.serveParity, this.receiverId)
    this.lastHitId = p.id
    this.teamHitId[p.slot] = p.id
    this.teamHitId[otherSlot(p.slot)] = ''
    this.rallyShots = 1
    this.lastHitSlot = p.slot
    p.swing = {
      t: 0,
      power: SERVE_POWER,
      spin,
      aimX: aim.x,
      aimZ: aim.z,
      hit: true,
      jump: false,
      viewTick: this.tick,
    }
    p.swingJump = false
    this.countSwing(p)
    p.swingSeq = (p.swingSeq + 1) % 65536
    this.phase = 'rally'
    this.message = `${p.nickname} serves`
    this.fx.push({
      kind: 'hit',
      slot: p.slot,
      id: p.id,
      ...from,
      power: SERVE_POWER,
      spin,
      perfect: false,
      timing: 0,
      jump: false,
    })
  }

  // ------------------------------------------------------------------ tick

  /** Advances the simulation one fixed step and returns the visual events it produced. */
  step(dt: number): FxEvent[] {
    this.tick += 1
    for (const p of this.players.values()) this.stepPlayerState(p, dt)

    if (this.phase === 'serving') this.holdBallForServe()
    else if (this.phase === 'rally') this.stepRally(dt)
    else if (this.phase === 'pointOver') {
      // Let the ball finish its flight for visuals; rules are no longer applied.
      stepBall(this.ball, dt, this.ballEvents)
      this.ballEvents.length = 0
      this.phaseTimer -= dt
      if (this.phaseTimer <= 0) {
        if (this.gameWinner === null) this.enterServing()
        else this.enterGameOver()
      }
    }

    return this.fx.splice(0, this.fx.length)
  }

  private stepPlayerState(p: SimPlayer, dt: number): void {
    p.inputBudget = Math.min(p.inputBudget + INPUT_BUDGET_PER_TICK, MAX_INPUT_BUDGET)
    const bounds = movementBounds(p.slot, this.phase, p.id === this.serverId, this.serveParity)
    let applied = 0
    while (applied < MAX_INPUTS_PER_TICK && p.inputBudget >= 1 && p.queue.length > 0) {
      applied += 1
      const f = p.queue.shift() as InputFrame
      p.inputBudget -= 1
      if (bounds) stepPlayer(p, sanitizeIntent(f.mx, f.mz), FIXED_DT, bounds)
      p.aimX = f.ax
      p.aimZ = f.az
      p.lastSeq = f.seq
    }
    if (bounds) clampToBounds(p, bounds)
    p.yaw = yawToward(p, p.aimX, p.aimZ, p.yaw)

    if (p.volleyTimer > 0) p.volleyTimer = Math.max(0, p.volleyTimer - dt)
    p.sinceSwing += dt
    if (p.swing) {
      p.swing.t += dt
      if (p.swing.t > SWING_DURATION) p.swing = null
    }
  }

  private holdBallForServe(): void {
    const server = this.serverId ? this.players.get(this.serverId) : undefined
    if (!server) return
    this.ball.held = true
    this.ball.visible = true
    this.ball.x = server.x + Math.sin(server.yaw) * SERVE_HOLD_FORWARD
    this.ball.z = server.z + Math.cos(server.yaw) * SERVE_HOLD_FORWARD
    this.ball.y = SERVE_HOLD_HEIGHT
    this.ball.vx = 0
    this.ball.vy = 0
    this.ball.vz = 0
    this.ball.curve = 0
    this.zone.reset(this.ball, 'serving')
  }

  /** The zone player the ball in flight is for, if any (the nearest, should there be two). */
  private zonePlayer(): ZonePlayer | null {
    let best: SimPlayer | null = null
    let nearest = Infinity
    for (const id of this.zoneIds) {
      const p = this.players.get(id)
      if (!p || !zoneEligible(p, this.rally)) continue
      const d = Math.hypot(p.x - this.ball.x, p.z - this.ball.z)
      if (d < nearest) {
        nearest = d
        best = p
      }
    }
    return best
  }

  private stepRally(dt: number): void {
    if (this.zoneIds.size > 0) {
      this.zone.step(this.ball, this.zonePlayer(), this.rally, this.rallyShots, this.tick)
    }
    stepBall(this.ball, dt, this.ballEvents)

    for (const e of this.ballEvents) {
      if (this.phase !== 'rally') break
      if (e.type === 'net') {
        this.rally.onNet()
        this.fx.push({ kind: 'net', x: e.x, y: e.y, z: e.z })
      } else {
        const outcome = this.rally.onBounce(e.x, e.z)
        this.fx.push({
          kind: 'bounce',
          x: e.x,
          z: e.z,
          inBounds: outcome === null || outcome.code === 'double-bounce',
        })
        const end = outcome ?? this.afterGoodBounce()
        if (end) this.endRally(end)
      }
    }
    this.ballEvents.length = 0
    if (this.phase !== 'rally') return

    this.history.unshift({
      tick: this.tick,
      x: this.ball.x,
      y: this.ball.y,
      z: this.ball.z,
      bounced: this.rally.bounced,
    })
    if (this.history.length > HISTORY_TICKS) this.history.length = HISTORY_TICKS

    for (const p of this.players.values()) {
      if (p.volleyTimer > 0 && isInKitchen(p.x, p.z, sideOf(p.slot))) {
        this.kitchenFault(p, 'kitchen-momentum')
      }
      if (this.phase !== 'rally') return
      this.tryHit(p, false)
      if (this.phase !== 'rally') return
    }

    if (isBallLost(this.ball)) {
      const outcome = this.rally.onBallLost()
      if (outcome) this.endRally(outcome)
    }
  }

  /** A shot just landed in. Training drills may end the rally there. */
  protected afterGoodBounce(): RallyOutcome | null {
    return null
  }

  private inReach(p: SimPlayer, pos: Vec3): number | null {
    const height = p.swing?.jump ? JUMP_REACH_HEIGHT : REACH_MAX_HEIGHT
    return reachDistance(p, sideOf(p.slot), pos, height)
  }

  /** The ball is still coming closer and can safely be hit one step later. */
  private gettingCloser(p: SimPlayer, distance: number, swingTime: number): boolean {
    if (swingTime + FIXED_DT > SWING_ACTIVE_WINDOW) return false
    const b = this.ball
    const ax = (b.curve ?? 0) + (b.steerX ?? 0)
    const next = {
      x: b.x + b.vx * FIXED_DT + 0.5 * ax * FIXED_DT * FIXED_DT,
      y: b.y + b.vy * FIXED_DT - 0.5 * GRAVITY * FIXED_DT * FIXED_DT,
      z: b.z + b.vz * FIXED_DT + 0.5 * (b.steerZ ?? 0) * FIXED_DT * FIXED_DT,
    }
    if (this.rally.bounced && next.y <= BALL_RADIUS) return false // about to bounce twice
    const d = this.inReach(p, next)
    return d !== null && d < distance
  }

  /** How long after the ball's closest point they clicked, as they saw it (seconds). */
  private clickTiming(p: SimPlayer, swing: Swing): number {
    let bestTick = this.tick
    let best = Math.hypot(this.ball.x - p.x, this.ball.z - p.z)
    for (const h of this.history) {
      const d = Math.hypot(h.x - p.x, h.z - p.z)
      if (d < best) {
        best = d
        bestTick = h.tick
      }
    }
    return (swing.viewTick - bestTick) * FIXED_DT
  }

  private tryHit(p: SimPlayer, includeHistory: boolean): boolean {
    const swing = p.swing
    if (this.phase !== 'rally' || !swing || swing.hit || swing.t > SWING_ACTIVE_WINDOW) return false
    if (!p.connected || !this.rally.canHit(p.slot, p.id)) return false
    const side = sideOf(p.slot)
    if (this.ball.z * side < -NET_REACH_TOLERANCE) return false

    // The closest reachable moment before (air) and after (ground) the ball's
    // bounce. Under the two-bounce rule the swing simply waits for the bounce.
    interface Contact extends Vec3 {
      distance: number
      live: boolean
    }
    const closest: { air: Contact | null; ground: Contact | null } = { air: null, ground: null }
    const consider = (pos: Vec3, bounced: boolean, live: boolean): void => {
      if (!bounced && this.rally.mustBounce) return
      const distance = this.inReach(p, pos)
      if (distance === null) return
      const kind = bounced ? 'ground' : 'air'
      const best = closest[kind]
      if (best === null || distance < best.distance) {
        closest[kind] = { x: pos.x, y: pos.y, z: pos.z, distance, live }
      }
    }
    consider(this.ball, this.rally.bounced, true)
    if (includeHistory) {
      // Ball positions from the moment the player saw through the swing's active window.
      const from = swing.viewTick - LATE_GRACE_TICKS
      const to = swing.viewTick + ACTIVE_WINDOW_TICKS
      for (const h of this.history) {
        if (h.tick >= from && h.tick <= to) consider(h, h.bounced, false)
      }
    }
    // Take the closer of the two, unless hitting it in the air would be a kitchen
    // fault and a groundstroke is possible.
    const { air, ground } = closest
    const airIsFault = isInKitchen(p.x, p.z, side)
    const useGround =
      ground !== null && (air === null || airIsFault || ground.distance <= air.distance)
    const contact = useGround ? ground : air
    if (contact === null) return false
    // Meet the ball at its closest point, not at the edge of the hit box.
    if (contact.live && this.gettingCloser(p, contact.distance, swing.t)) return false
    const volley = !useGround
    if (volley && airIsFault) {
      // An early click on a ball about to bounce waits for it instead of faulting.
      if (this.bouncesSoon(p, SWING_ACTIVE_WINDOW - swing.t)) return false
      swing.hit = true
      this.kitchenFault(p, 'kitchen-volley')
      return false
    }

    const timing = this.clickTiming(p, swing)
    const perfect =
      contact.distance <= PERFECT_MAX_DISTANCE && Math.abs(timing) <= PERFECT_TIMING_SECONDS
    const quality = 1 - contact.distance / REACH_RADIUS
    const aim = clampAim(swing.aimX, swing.aimZ, -side as Side)
    const target = this.scatter(
      aim,
      (perfect ? 0.08 : 0.15 + (1 - quality) * 0.55 + swing.power * 0.35) +
        SPIN_SCATTER * Math.abs(swing.spin),
    )
    // The shot leaves from where the ball met the paddle (for a lagged click,
    // where the player saw it), never from a spot it has since flown on to.
    const from = { x: contact.x, y: Math.max(contact.y, 0.12), z: contact.z }
    // Never launch from the far side of the net plane, or so close to it that the
    // only way over is straight up.
    if (from.z * side < MIN_LAUNCH_DEPTH) from.z = MIN_LAUNCH_DEPTH * side
    const jumped = swing.jump && contact.y >= JUMP_MIN_HEIGHT
    const boost = Math.min(
      MAX_BOOST,
      rallyHeat(this.rallyShots + 1) + (perfect ? PERFECT_BOOST : 0) + (jumped ? JUMP_BOOST : 0),
    )
    this.launch(from, solveShot(from, target, swing.power, boost, swing.spin))

    swing.hit = true
    this.rally.onHit(p.slot)
    this.lastHitId = p.id
    this.teamHitId[p.slot] = p.id
    p.volleyTimer = volley ? KITCHEN_MOMENTUM_SECONDS : 0
    this.rallyShots += 1
    this.lastHitSlot = p.slot
    this.message = `Rally: ${this.rallyShots} shots`
    this.fx.push({
      kind: 'hit',
      slot: p.slot,
      id: p.id,
      ...from,
      power: swing.power,
      spin: swing.spin,
      perfect,
      timing,
      jump: jumped,
    })
    return true
  }

  private scatter(aim: { x: number; z: number }, radius: number): { x: number; z: number } {
    const angle = this.rng() * Math.PI * 2
    const r = Math.sqrt(this.rng()) * radius
    return { x: aim.x + Math.cos(angle) * r, z: aim.z + Math.sin(angle) * r }
  }

  protected launch(from: Vec3, v: Shot): void {
    Object.assign(this.ball, from)
    this.ball.vx = v.x
    this.ball.vy = v.y
    this.ball.vz = v.z
    this.ball.curve = v.curve
    this.ball.held = false
    this.ball.visible = true
    this.history.length = 0
    // A new shot: nothing pulled toward whoever just hit it.
    this.zone.reset(this.ball, 'new shot')
  }

  /** Whether the ball will bounce within the player's reach in the next few moments. */
  private bouncesSoon(p: SimPlayer, seconds: number): boolean {
    const b = this.ball
    const h = Math.max(0, b.y - BALL_RADIUS)
    const t = (b.vy + Math.sqrt(b.vy * b.vy + 2 * GRAVITY * h)) / GRAVITY
    return (
      t <= seconds &&
      this.inReach(p, {
        x: b.x + b.vx * t + 0.5 * ((b.curve ?? 0) + (b.steerX ?? 0)) * t * t,
        y: BALL_RADIUS,
        z: b.z + b.vz * t + 0.5 * (b.steerZ ?? 0) * t * t,
      }) !== null
    )
  }

  private kitchenFault(p: SimPlayer, code: 'kitchen-volley' | 'kitchen-momentum'): void {
    this.lastHitId = p.id
    this.endRally({ winner: otherSlot(p.slot), code })
  }

  /** Which court the current server serves from (see serveParityFor). */
  get serveParity(): number {
    return serveParityFor(this.scores[this.servingSlot], this.serverSpot)
  }

  get ballBounced(): boolean {
    return this.rally.bounced
  }

  get mustBounce(): boolean {
    return this.phase === 'rally' && this.rally.mustBounce
  }

  /** How long the result of a rally is shown (seconds). */
  protected get pauseAfterRally(): number {
    return POINT_OVER_SECONDS
  }

  private endRally(outcome: RallyOutcome): void {
    const { winner } = outcome
    const hitter = this.players.get(this.lastHitId)?.nickname ?? 'A player'
    const text = explain(outcome.code, hitter, this.teamName(otherSlot(winner)))
    // The point is decided: the ball just falls as it would.
    this.zone.reset(this.ball, 'rally over')
    this.phase = 'pointOver'
    this.phaseTimer = this.pauseAfterRally
    let ignited = ''
    for (const p of this.players.values()) {
      if (p.slot !== winner) p.streak = 0
      else if (p.id === this.teamHitId[winner]) {
        p.streak += 1
        if (p.streak === FIRE_STREAK) ignited = p.nickname
      }
    }
    const result = this.settle(winner)
    this.lastRally = { winner, ...text, result, ignited }
    this.message = `${text.reason} — ${result}`
  }

  /**
   * Side-out scoring: only the serving team scores. In doubles both partners
   * serve before the serve passes over, except that the team starting the game
   * gets a single server. Returns what the rally was worth.
   */
  protected settle(winner: Slot): string {
    if (winner === this.servingSlot) {
      const score = (this.scores[winner] += 1)
      const lead = score - this.scores[otherSlot(winner)]
      if (score >= WINNING_SCORE && lead >= WIN_BY) {
        this.gameWinner = winner
        return `Game won by ${this.teamName(winner)}`
      }
      return `Point to ${this.teamName(winner)}`
    }
    if (this.teamSize === 2 && this.serverNumber === 1) {
      this.serverNumber = 2
      this.serverSpot = this.serverSpot === 0 ? 1 : 0
      return `No point — second serve: ${this.serverName()}`
    }
    this.servingSlot = winner
    this.serverNumber = 1
    // Doubles: whoever is on the right-hand court serves first.
    this.serverSpot = this.teamSize === 2 && this.scores[winner] % 2 === 1 ? 1 : 0
    return `Side out, no point — ${this.serverName()} serves next`
  }

  private serverName(): string {
    const p = this.team(this.servingSlot).find((q) => q.spot === this.serverSpot)
    return p?.nickname ?? this.teamName(this.servingSlot)
  }

  // ---------------------------------------------------------------- phases

  private refreshPhase(): void {
    const list = [...this.players.values()]
    if (list.length < this.capacity) {
      const missing = this.capacity - list.length
      this.phase = 'waiting'
      this.resetGame()
      this.firstServer = 0
      this.message = `Waiting for ${missing} more player${missing === 1 ? '' : 's'} to join`
      return
    }
    const dropped = list.find((p) => !p.connected)
    const allReady = list.every((p) => p.ready)
    if (this.phase === 'gameOver') {
      // The result stays up until everyone (connected) wants a rematch.
      if (!dropped && allReady) this.startGame()
      return
    }
    if (dropped) {
      this.phase = 'paused'
      this.message = `${dropped.nickname} disconnected — waiting for them to reconnect`
      return
    }
    if (this.phase === 'paused' && this.gameWinner !== null) {
      this.enterGameOver()
      return
    }
    if (!allReady) {
      this.phase = 'lobby'
      this.resetGame()
      this.message = 'Waiting for everyone to be ready'
      return
    }
    if (this.phase === 'lobby' || this.phase === 'waiting') this.startGame()
    else if (this.phase === 'paused') {
      // Resume with a fresh serve; scores are kept.
      this.enterServing()
    }
  }

  private resetGame(): void {
    for (const p of this.players.values()) p.streak = 0
    this.scores[0] = 0
    this.scores[1] = 0
    this.gameWinner = null
    this.lastRally = null
    this.serverId = null
    this.receiverId = null
    this.ball.visible = false
    this.ball.held = false
    this.zone.reset(this.ball, 'new game')
  }

  private startGame(): void {
    this.resetGame()
    this.servingSlot = this.firstServer
    this.serverSpot = 0
    // Doubles: the team that starts the game only gets one server ("0–0–2").
    this.serverNumber = this.teamSize === 2 ? 2 : 1
    this.enterServing()
  }

  private enterGameOver(): void {
    const winner = this.gameWinner ?? 0
    this.phase = 'gameOver'
    this.firstServer = otherSlot(winner)
    this.serverId = null
    this.receiverId = null
    this.ball.visible = false
    this.ball.held = false
    for (const p of this.players.values()) p.ready = false
    this.message = `${this.teamName(winner)} won ${this.scores[winner]}–${this.scores[otherSlot(winner)]}`
  }

  protected enterServing(): void {
    const servingTeam = this.team(this.servingSlot)
    const receivingTeam = this.team(otherSlot(this.servingSlot))
    const server = servingTeam.find((p) => p.spot === this.serverSpot) ?? servingTeam[0]
    if (!server || receivingTeam.length === 0) return
    const teamScore = this.scores[this.servingSlot]
    const otherScore = this.scores[otherSlot(this.servingSlot)]
    const serverPartner = servingTeam.find((p) => p !== server)
    const parity = this.serveParity
    const xSign = serveCourtXSign(this.servingSlot, parity)
    const sSide = sideOf(this.servingSlot)
    const rSide = -sSide
    const quarter = COURT.halfWidth * 0.5

    server.x = xSign * quarter
    server.z = sSide * (COURT.halfLength + 0.6)
    if (serverPartner) {
      serverPartner.x = -xSign * quarter
      serverPartner.z = sSide * (COURT.halfLength - 0.3)
    }
    // The receiver is whoever is on the diagonal court; their partner waits at the kitchen.
    const receiver =
      receivingTeam.find((p) => (otherScore + p.spot) % 2 === parity % 2 && this.teamSize === 2) ??
      (receivingTeam[0] as SimPlayer)
    receiver.x = -xSign * quarter
    receiver.z = rSide * (COURT.halfLength - 0.3)
    const receiverPartner = receivingTeam.find((p) => p !== receiver)
    if (receiverPartner) {
      receiverPartner.x = xSign * quarter
      receiverPartner.z = rSide * (COURT.kitchenDepth + 0.6)
    }

    for (const p of this.players.values()) {
      p.vx = 0
      p.vz = 0
      p.swing = null
      p.volleyTimer = 0
      p.swingShot = -1
      p.aimX = -p.x
      p.aimZ = -sideOf(p.slot) * COURT.halfLength * 0.6
      p.yaw = yawToward(p, p.aimX, p.aimZ, p.yaw)
    }
    this.serverId = server.id
    this.receiverId = receiver.id
    this.phase = 'serving'
    this.lastHitSlot = -1
    this.rallyShots = 0
    this.rally.lastHitter = null
    this.holdBallForServe()
    // Called the way players call it: server's score, receiver's score, server number.
    const call =
      this.teamSize === 2
        ? `${teamScore}–${otherScore}–${this.serverNumber}`
        : `${teamScore}–${otherScore}`
    this.message = `${server.nickname} to serve (${call})`
  }
}
