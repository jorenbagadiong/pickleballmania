import {
  type BallBody,
  type BallEvent,
  COURT,
  FIXED_DT,
  PRACTICE_DRILLS,
  PRACTICE_LEVELS,
  type PracticeDrill,
  type PracticeLevel,
  type Slot,
  isInsideCourt,
  otherSlot,
  reachDistance,
  serveCourtXSign,
  sideOf,
  stepBall,
} from '@pickleball/shared'
import type { RallyOutcome } from '../rules/rally'
import { GameSimulation, type SimPlayer } from './GameSimulation'
import { solveShot } from './shot'

export const COACH_ID = 'coach'
export const COACH_NAME = 'Coach Erwin'
/** Always the same person (see ATHLETES). */
export const COACH_LOOK = 'm2'

/** Time to get ready before the coach serves or the machine feeds (seconds). */
const READY_SECONDS = 1.3
/** The coach swings once the ball is this near. */
const COACH_REACH = 1.2
const COACH_HOME_DEPTH = 5.8
/** Aim no closer to the lines than this. */
const LINE_MARGIN = 0.9
const FEED_HEIGHT = 1

interface Skill {
  /** Fraction of a player's running speed. */
  speed: number
  /** How far to the sides the coach plays (fraction of half the court). */
  spread: number
  power: number
  smash: number
  spin: number
}

const SKILLS: Record<PracticeLevel, Skill> = {
  easy: { speed: 0.7, spread: 0.35, power: 0.25, smash: 0, spin: 0 },
  medium: { speed: 0.85, spread: 0.7, power: 0.4, smash: 0.1, spin: 0 },
  hard: { speed: 1, spread: 1, power: 0.5, smash: 0.3, spin: 0.5 },
}

/**
 * Solo training: one person and a coach, who is an ordinary player steered by the
 * server, so training follows exactly the rules of a game. Nothing is ever won.
 * - machine: the coach feeds one ball after another, to be hit anywhere in;
 * - serve: one serve after another;
 * - rally: the coach plays back, serving every other rally.
 */
export class PracticeSimulation extends GameSimulation {
  drill: PracticeDrill = 'machine'
  level: PracticeLevel = 'easy'
  private readyTimer = 0
  private restart = false
  /** Where the coach is heading, and whether they would let the ball go (it is going out). */
  private plan = { x: 0, z: 0, leave: false }

  constructor(rng: () => number = Math.random) {
    super(1, rng)
  }

  private get coach(): SimPlayer | undefined {
    return this.players.get(COACH_ID)
  }

  /** One trainee; the coach takes the other seat. */
  override addPlayer(id: string, nickname: string): SimPlayer | null {
    const player = super.addPlayer(id, nickname)
    if (!player) return null
    super.addPlayer(COACH_ID, COACH_NAME)
    super.setReady(COACH_ID, true)
    super.setReady(id, true)
    return player
  }

  override removePlayer(id: string): void {
    this.players.delete(COACH_ID)
    super.removePlayer(id)
  }

  /** Training doesn't wait in a lobby. */
  override setReady(): void {}

  setDrill(msg: unknown): void {
    const m = (msg ?? {}) as { drill?: unknown; level?: unknown }
    const drill = PRACTICE_DRILLS.find((d) => d === m.drill)
    const level = PRACTICE_LEVELS.find((l) => l === m.level)
    if (!drill || !level || (drill === this.drill && level === this.level)) return
    if (drill !== this.drill) {
      this.scores[0] = 0
      this.scores[1] = 0
    }
    this.drill = drill
    this.level = level
    this.restart = true
  }

  protected override get pauseAfterRally(): number {
    return this.drill === 'rally' ? 2 : 1.2
  }

  /** Counts successes and misses; the numbers only ever go up. */
  protected override settle(winner: Slot): string {
    this.scores[winner] += 1
    if (this.drill === 'rally') this.servingSlot = otherSlot(this.servingSlot)
    return 'Training'
  }

  /** Machine and serve: landing it in is the whole task. */
  protected override afterGoodBounce(): RallyOutcome | null {
    return this.drill !== 'rally' && this.lastHitSlot === 0 ? { winner: 0, code: 'landed' } : null
  }

  protected override enterServing(): void {
    if (this.drill === 'serve') this.servingSlot = 0
    if (this.drill === 'machine') this.servingSlot = 1
    this.serverSpot = 0
    super.enterServing()
    this.readyTimer = READY_SECONDS
    const coach = this.coach
    if (coach && this.drill === 'machine') {
      coach.x = 0
      coach.z = -COACH_HOME_DEPTH
      this.message = 'Get ready'
    }
    this.plan = { x: coach?.x ?? 0, z: -COACH_HOME_DEPTH, leave: false }
  }

  override step(dt: number) {
    const coach = this.coach
    if (coach && this.restart && this.phase !== 'paused') {
      this.restart = false
      this.servingSlot = 0
      this.enterServing()
    }
    if (coach && this.phase === 'serving' && this.serverId === COACH_ID) {
      this.readyTimer -= dt
      if (this.readyTimer <= 0) this.startBall(coach)
    } else if (coach && this.phase === 'rally' && this.drill === 'rally') this.playBack(coach)
    return super.step(dt)
  }

  private get skill(): Skill {
    return SKILLS[this.level]
  }

  private between(lo: number, hi: number): number {
    return lo + this.rng() * (hi - lo)
  }

  private spinNow(): number {
    if (this.rng() >= this.skill.spin) return 0
    return this.rng() < 0.5 ? -1 : 1
  }

  private startBall(coach: SimPlayer): void {
    if (this.drill !== 'machine') {
      const xSign = -serveCourtXSign(1, this.serveParity)
      const x = xSign * COURT.halfWidth * this.between(0.4, 0.6)
      this.requestServe(COACH_ID, { ax: x, az: 4.6, spin: this.spinNow() })
      return
    }
    const { spread, power, smash } = this.skill
    const trainee = [...this.players.values()].find((p) => p.id !== COACH_ID)
    const wide = (COURT.halfWidth - LINE_MARGIN) * spread
    const x =
      this.level === 'easy' ? (trainee?.x ?? 0) + this.between(-1, 1) : this.between(-wide, wide)
    const limit = COURT.halfWidth - LINE_MARGIN
    const target = { x: Math.max(-limit, Math.min(limit, x)), z: this.between(3.6, 5.6) }
    const from = { x: coach.x, y: FEED_HEIGHT, z: coach.z + 0.4 }
    const hard = this.rng() < smash
    const spin = this.spinNow()
    this.launch(from, solveShot(from, target, hard ? 0.9 : power, 0, spin))
    // An ordinary shot in the middle of a rally: volleys are allowed.
    this.rally.startServe(1, 0)
    this.rally.isServe = false
    this.rally.shots = 3
    this.lastHitId = COACH_ID
    this.teamHitId[0] = ''
    this.teamHitId[1] = COACH_ID
    this.lastHitSlot = 1
    this.rallyShots = 1
    this.phase = 'rally'
    this.message = 'Hit it back'
    coach.swingSeq = (coach.swingSeq + 1) % 65536
    this.fx.push({
      kind: 'hit',
      slot: 1,
      id: COACH_ID,
      ...from,
      power: hard ? 0.9 : power,
      spin,
      perfect: false,
      timing: 0,
      jump: false,
    })
  }

  /** Runs to where the ball can be hit after its bounce, and hits it. */
  private playBack(coach: SimPlayer): void {
    const incoming = this.lastHitSlot === 0
    if (!incoming) this.plan = { x: 0, z: -COACH_HOME_DEPTH, leave: false }
    else if (this.tick % 3 === 0) this.plan = this.readBall()

    const dx = this.plan.x - coach.x
    const dz = this.plan.z - coach.z
    const distance = Math.hypot(dx, dz)
    // Slows down over the last bit instead of jittering around the spot.
    const pace = distance < 0.05 ? 0 : this.skill.speed * Math.min(1, distance / 0.3)
    coach.queue.push({
      seq: ++coach.lastQueuedSeq,
      mx: distance > 0 ? (dx / distance) * pace : 0,
      mz: distance > 0 ? (dz / distance) * pace : 0,
      ax: 0,
      az: 4,
    })

    if (!incoming || this.plan.leave || !this.ballBounced) return
    const reach = reachDistance(coach, sideOf(coach.slot), this.ball)
    if (reach === null || reach > COACH_REACH) return
    const { spread, power, smash } = this.skill
    const wide = (COURT.halfWidth - LINE_MARGIN) * spread
    const hard = this.rng() < smash
    this.requestSwing(COACH_ID, {
      ax: this.between(-wide, wide),
      az: this.between(3.8, 5.4),
      power: hard ? 1 : power,
      spin: this.spinNow(),
      viewTick: this.tick,
    })
  }

  private readBall(): { x: number; z: number; leave: boolean } {
    const ball: BallBody = { ...this.ball }
    const events: BallEvent[] = []
    let bounced = this.ballBounced
    for (let t = 0; t < 3; t += FIXED_DT) {
      stepBall(ball, FIXED_DT, events)
      const bounce = events.find((e) => e.type === 'bounce')
      if (bounce && !bounced) {
        bounced = true
        if (!isInsideCourt(bounce.x, bounce.z, -1)) {
          return { x: this.plan.x, z: this.plan.z, leave: true }
        }
      }
      events.length = 0
      // The top of the bounce: the easiest ball to hit.
      if (bounced && ball.vy <= 0) break
    }
    return { x: ball.x, z: Math.max(-9, Math.min(-1, ball.z)), leave: false }
  }
}
