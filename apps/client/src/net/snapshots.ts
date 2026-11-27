import { BALL_RADIUS, FIXED_DT, stepBall } from '@pickleball/shared'

export interface PlayerSnap {
  x: number
  z: number
  yaw: number
  swingSeq: number
  swingPower: number
  /** The last swing was a jump smash. */
  swingJump: boolean
}

export interface BallSnap {
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  /** Sideways acceleration from spin. */
  curve: number
  /** TEZUKA ZONE pull along the ground (server-decided; 0 almost always). */
  steerX: number
  steerZ: number
  /** Whom the server computed that pull for ('' when there is none). */
  steerTarget: string
  visible: boolean
  held: boolean
  /** The shot has bounced on the receiving side. */
  bounced: boolean
  /** Two-bounce rule: this shot may not be volleyed. */
  mustBounce: boolean
}

export interface Snapshot {
  /** Server simulation time in seconds. */
  time: number
  players: Map<string, PlayerSnap>
  ball: BallSnap
}

export interface WorldSample {
  players: Map<string, PlayerSnap>
  ball: BallSnap
}

/**
 * How far behind the newest server state the world is drawn (seconds). A steady
 * connection needs little; an uneven one gets more, so late updates still arrive
 * before they are needed.
 */
export const MIN_DELAY = 0.06
export const MAX_DELAY = 0.15
const INITIAL_DELAY = 0.1
/** Room for the wait until the next update, on top of how late updates run. */
const DELAY_MARGIN = 0.045
/** Share of updates that should arrive in time; the rest are bridged by prediction. */
const ON_TIME_SHARE = 0.9
/** Updates looked at to judge the connection (~4 s). */
const TIMING_WINDOW = 120
/** The delay changes by at most this much per second, so the ball never visibly speeds up. */
const DELAY_RATE = 0.06
/** A clock this far off is corrected at once (a new connection, or a long stall). */
const CLOCK_SNAP = 0.4
const MAX_SNAPSHOTS = 40
/** How far past the newest update the ball and the players are predicted (seconds). */
const MAX_BALL_PREDICTION = 0.35
const MAX_PLAYER_PREDICTION = 0.12
/** How quickly a wrong prediction is blended away (1/s), and when it is too wrong to blend. */
const BLEND_RATE = 10
const MAX_BLEND = 4
const MAX_PLAYER_BLEND = 1.5

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a
  while (d > Math.PI) d -= Math.PI * 2
  while (d < -Math.PI) d += Math.PI * 2
  return a + d * t
}

/** Where a ball in free flight will be `dt` seconds from now. */
function predictBall(b: BallSnap, dt: number): BallSnap {
  if (b.held || !b.visible) return b
  const body = { ...b }
  for (let left = dt; left > 1e-6; left -= FIXED_DT) stepBall(body, Math.min(left, FIXED_DT), [])
  return body
}

/** How a connection is doing, for showing to players. */
export interface LinkStats {
  /** How far behind the server the world is being drawn (seconds), network time excluded. */
  delay: number
  /** How unevenly updates arrive (seconds). */
  jitter: number
}

/**
 * Buffers authoritative server snapshots and samples them slightly in the past
 * so remote players and the ball move smoothly between 30 Hz patches. If updates
 * are late anyway, the ball's flight is predicted until they arrive, and any
 * difference is blended away rather than jumped.
 */
export class SnapshotBuffer {
  private snaps: Snapshot[] = []
  /** (Arrival time - server time) of recent updates. */
  private timings: number[] = []
  /** Local clock minus the server time being drawn; null before the first update. */
  private shift: number | null = null
  private targetShift = 0
  private shiftedAt = 0
  private stats: LinkStats = { delay: INITIAL_DELAY, jitter: 0 }
  private newest: Snapshot | null = null
  private wasPredicting = false
  private sampledAt = 0
  private readonly ballBlend = { x: 0, y: 0, z: 0 }
  private readonly playerBlend = new Map<string, { x: number; z: number }>()

  reset(): void {
    this.snaps = []
    this.timings = []
    this.shift = null
    this.newest = null
    this.wasPredicting = false
    this.clearBlend()
  }

  get link(): LinkStats {
    return this.stats
  }

  push(snap: Snapshot, localNow: number): void {
    const last = this.snaps[this.snaps.length - 1]
    if (last && snap.time <= last.time) {
      // Same tick re-sent (or server restarted the tick counter): replace / reset.
      if (snap.time < last.time - 1) this.reset()
      else {
        this.snaps[this.snaps.length - 1] = snap
        return
      }
    }
    this.snaps.push(snap)
    if (this.snaps.length > MAX_SNAPSHOTS) this.snaps.shift()
    this.measure(localNow - snap.time, localNow)
  }

  /** Works out from recent arrivals how far in the past the world should be drawn. */
  private measure(timing: number, localNow: number): void {
    this.timings.push(timing)
    if (this.timings.length > TIMING_WINDOW) this.timings.shift()
    const sorted = [...this.timings].sort((a, b) => a - b)
    const best = sorted[0] as number
    const index = Math.min(sorted.length - 1, Math.floor(sorted.length * ON_TIME_SHARE))
    const jitter = (sorted[index] as number) - best
    // Too few updates to judge the connection by yet.
    const delay =
      sorted.length < 15
        ? INITIAL_DELAY
        : Math.min(MAX_DELAY, Math.max(MIN_DELAY, jitter + DELAY_MARGIN))
    this.stats = { delay, jitter }
    this.targetShift = best + delay
    this.advance(localNow)
  }

  /** Moves the drawn clock gently toward where it should be. */
  private advance(localNow: number): void {
    if (this.shift === null || Math.abs(this.targetShift - this.shift) > CLOCK_SNAP) {
      this.shift = this.targetShift
    } else {
      const step = Math.max(0, localNow - this.shiftedAt) * DELAY_RATE
      const error = this.targetShift - this.shift
      this.shift += Math.max(-step, Math.min(step, error))
    }
    this.shiftedAt = Math.max(localNow, this.shiftedAt)
  }

  /** Local time (seconds) at which something that happened at `serverTime` should be shown. */
  displayTimeFor(serverTime: number): number | null {
    return this.shift === null ? null : serverTime + this.shift
  }

  /** Server time (seconds) of the world currently being drawn. */
  renderServerTime(localNow: number): number | null {
    return this.shift === null ? null : localNow - this.shift
  }

  sample(localNow: number): WorldSample | null {
    const newest = this.snaps[this.snaps.length - 1]
    if (!newest || this.shift === null) return null
    this.advance(localNow)
    const renderTime = localNow - this.shift
    const raw = this.at(renderTime)

    // The world was being predicted, and now there is news: start from where things
    // were drawn and blend over to where they really are.
    if (this.wasPredicting && this.newest && newest !== this.newest) {
      this.startBlend(this.predict(this.newest, renderTime - this.newest.time), raw)
    }
    this.newest = newest
    this.wasPredicting = renderTime > newest.time
    const fade = Math.exp(-BLEND_RATE * Math.max(0, localNow - this.sampledAt))
    this.sampledAt = localNow
    return this.blended(raw, fade)
  }

  private at(renderTime: number): WorldSample {
    const n = this.snaps.length
    const first = this.snaps[0] as Snapshot
    const last = this.snaps[n - 1] as Snapshot
    if (renderTime <= first.time) return { players: first.players, ball: first.ball }
    if (renderTime >= last.time) return this.predict(last, renderTime - last.time)

    let i = n - 2
    while (i > 0 && (this.snaps[i] as Snapshot).time > renderTime) i--
    const a = this.snaps[i] as Snapshot
    const b = this.snaps[i + 1] as Snapshot
    const t = (renderTime - a.time) / (b.time - a.time)

    const players = new Map<string, PlayerSnap>()
    for (const [id, pb] of b.players) {
      const pa = a.players.get(id)
      players.set(
        id,
        pa
          ? {
              x: lerp(pa.x, pb.x, t),
              z: lerp(pa.z, pb.z, t),
              yaw: lerpAngle(pa.yaw, pb.yaw, t),
              swingSeq: t < 0.5 ? pa.swingSeq : pb.swingSeq,
              swingPower: pb.swingPower,
              swingJump: pb.swingJump,
            }
          : pb,
      )
    }

    const ba = a.ball
    const bb = b.ball
    // A held ball or a reset (teleport) should not be smeared across the court.
    const teleported = ba.held !== bb.held || ba.visible !== bb.visible
    const ball: BallSnap = teleported
      ? t < 0.5
        ? ba
        : bb
      : {
          ...bb,
          x: lerp(ba.x, bb.x, t),
          y: lerp(ba.y, bb.y, t),
          z: lerp(ba.z, bb.z, t),
        }
    return { players, ball }
  }

  /** The world `dt` seconds after a snapshot, if nothing unexpected happens. */
  private predict(from: Snapshot, dt: number): WorldSample {
    const ball = predictBall(from.ball, Math.min(dt, MAX_BALL_PREDICTION))
    const before = this.snaps[this.snaps.indexOf(from) - 1]
    if (!before) return { players: from.players, ball }
    const gap = from.time - before.time
    const ahead = Math.min(dt, MAX_PLAYER_PREDICTION)
    const players = new Map<string, PlayerSnap>()
    for (const [id, p] of from.players) {
      const was = before.players.get(id)
      const dx = was ? p.x - was.x : 0
      const dz = was ? p.z - was.z : 0
      // Standing up for a serve moves players in one go; that is not running.
      const ran = gap > 0 && Math.hypot(dx, dz) / gap < 10
      players.set(id, ran ? { ...p, x: p.x + (dx / gap) * ahead, z: p.z + (dz / gap) * ahead } : p)
    }
    return { players, ball }
  }

  private clearBlend(): void {
    this.ballBlend.x = 0
    this.ballBlend.y = 0
    this.ballBlend.z = 0
    this.playerBlend.clear()
  }

  private startBlend(shown: WorldSample, real: WorldSample): void {
    const blend = this.ballBlend
    const free = (b: BallSnap): boolean => b.visible && !b.held
    const x = blend.x + shown.ball.x - real.ball.x
    const y = blend.y + shown.ball.y - real.ball.y
    const z = blend.z + shown.ball.z - real.ball.z
    const ok = free(shown.ball) && free(real.ball) && Math.hypot(x, y, z) < MAX_BLEND
    blend.x = ok ? x : 0
    blend.y = ok ? y : 0
    blend.z = ok ? z : 0
    for (const [id, p] of real.players) {
      const was = shown.players.get(id)
      if (!was) continue
      const old = this.playerBlend.get(id)
      const px = (old?.x ?? 0) + was.x - p.x
      const pz = (old?.z ?? 0) + was.z - p.z
      if (Math.hypot(px, pz) < MAX_PLAYER_BLEND) this.playerBlend.set(id, { x: px, z: pz })
      else this.playerBlend.delete(id)
    }
  }

  private blended(w: WorldSample, fade: number): WorldSample {
    const b = this.ballBlend
    b.x *= fade
    b.y *= fade
    b.z *= fade
    let { ball, players } = w
    if (ball.held || !ball.visible) {
      b.x = b.y = b.z = 0
    } else if (Math.abs(b.x) + Math.abs(b.y) + Math.abs(b.z) > 0.001) {
      ball = {
        ...ball,
        x: ball.x + b.x,
        y: Math.max(BALL_RADIUS, ball.y + b.y),
        z: ball.z + b.z,
      }
    }
    if (this.playerBlend.size > 0) {
      players = new Map(players)
      for (const [id, offset] of this.playerBlend) {
        offset.x *= fade
        offset.z *= fade
        const p = players.get(id)
        if (!p || Math.hypot(offset.x, offset.z) < 0.001) this.playerBlend.delete(id)
        else players.set(id, { ...p, x: p.x + offset.x, z: p.z + offset.z })
      }
    }
    return { players, ball }
  }
}
