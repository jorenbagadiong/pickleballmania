import {
  COURT,
  type Slot,
  isInServiceBox,
  isInsideCourt,
  otherSlot,
  serveCourtXSign,
  sideOf,
} from '@pickleball/shared'

/** Why a rally ended. Every code has a plain-language explanation in `explain`. */
export type RallyEnd =
  | 'serve-kitchen'
  | 'serve-wrong-box'
  | 'serve-out'
  | 'out-long'
  | 'out-wide'
  | 'net'
  | 'short'
  | 'double-bounce'
  | 'not-returned'
  | 'kitchen-volley'
  | 'kitchen-momentum'
  /** Training only: the shot landed in, which is all the drill asks. */
  | 'landed'

export interface RallyOutcome {
  winner: Slot
  code: RallyEnd
}

/**
 * Tracks one rally and decides when it ends:
 * - the serve must land in the diagonal service box beyond the kitchen line;
 * - two-bounce rule: the serve and the return of serve must each bounce first;
 * - every shot must cross the net and land in (lines are in);
 * - a ball that bounces twice is won by the team that hit it;
 * - a team cannot hit twice in a row; only the correct receiver returns a serve.
 * Kitchen volleys depend on where the player stands, so the simulation calls those.
 */
export class RallyTracker {
  serverSlot: Slot = 0
  serveParity = 0
  /** The only player who may return the serve (null = anyone on the team). */
  receiverId: string | null = null
  lastHitter: Slot | null = null
  isServe = false
  bouncesOnReceiverSide = 0
  touchedNet = false
  shots = 0

  startServe(serverSlot: Slot, serveParity: number, receiverId: string | null = null): void {
    this.serverSlot = serverSlot
    this.serveParity = serveParity
    this.receiverId = receiverId
    this.lastHitter = serverSlot
    this.isServe = true
    this.bouncesOnReceiverSide = 0
    this.touchedNet = false
    this.shots = 1
  }

  /** Two-bounce rule: the serve (shot 1) and its return (shot 2) must bounce first. */
  get mustBounce(): boolean {
    return this.shots <= 2
  }

  get bounced(): boolean {
    return this.bouncesOnReceiverSide > 0
  }

  canHit(slot: Slot, playerId?: string): boolean {
    if (this.lastHitter === null || this.lastHitter === slot) return false
    return !(this.isServe && this.receiverId !== null && playerId !== this.receiverId)
  }

  onHit(slot: Slot): void {
    this.lastHitter = slot
    this.isServe = false
    this.bouncesOnReceiverSide = 0
    this.touchedNet = false
    this.shots += 1
  }

  onNet(): void {
    this.touchedNet = true
  }

  onBounce(x: number, z: number): RallyOutcome | null {
    if (this.lastHitter === null) return null
    const hitter = this.lastHitter
    const opponent = otherSlot(hitter)

    if (this.bouncesOnReceiverSide > 0) return { winner: hitter, code: 'double-bounce' }

    const bounceSide = z >= 0 ? 1 : -1
    if (bounceSide === sideOf(hitter)) {
      return { winner: opponent, code: this.touchedNet ? 'net' : 'short' }
    }

    this.bouncesOnReceiverSide = 1
    const long = Math.abs(z) > COURT.halfLength
    if (this.isServe) {
      if (isInServiceBox(x, z, this.serverSlot, this.serveParity)) return null
      const boxXSign = -serveCourtXSign(this.serverSlot, this.serveParity)
      if (long || Math.abs(x) > COURT.halfWidth) return { winner: opponent, code: 'serve-out' }
      if (x * boxXSign < 0) return { winner: opponent, code: 'serve-wrong-box' }
      return { winner: opponent, code: 'serve-kitchen' }
    }
    if (isInsideCourt(x, z, bounceSide)) return null
    return { winner: opponent, code: long ? 'out-long' : 'out-wide' }
  }

  /** The ball left the playing area without a decisive bounce. */
  onBallLost(): RallyOutcome | null {
    if (this.lastHitter === null) return null
    return this.bounced
      ? { winner: this.lastHitter, code: 'not-returned' }
      : { winner: otherSlot(this.lastHitter), code: 'out-long' }
  }
}

/**
 * Plain-language reason a rally ended.
 * @param hitter nickname of the player who hit the ball last (or committed the fault)
 * @param losers name of the team that lost the rally
 */
export function explain(
  code: RallyEnd,
  hitter: string,
  losers: string,
): { reason: string; detail: string } {
  switch (code) {
    case 'serve-kitchen':
      return {
        reason: 'Serve in the kitchen',
        detail: `${hitter}'s serve must land past the kitchen line`,
      }
    case 'serve-wrong-box':
      return {
        reason: 'Serve in the wrong box',
        detail: `${hitter}'s serve must land in the diagonal service box`,
      }
    case 'serve-out':
      return { reason: 'Serve out', detail: `${hitter}'s serve landed outside the lines` }
    case 'out-long':
      return { reason: 'Out — too long', detail: `${hitter} hit it past the baseline` }
    case 'out-wide':
      return { reason: 'Out — too wide', detail: `${hitter} hit it past the sideline` }
    case 'net':
      return { reason: 'Into the net', detail: `${hitter}'s shot did not clear the net` }
    case 'short':
      return {
        reason: 'Did not cross the net',
        detail: `${hitter}'s shot landed on their own side`,
      }
    case 'double-bounce':
      return { reason: 'Double bounce', detail: `${losers} let the ball bounce twice` }
    case 'not-returned':
      return { reason: 'Not returned', detail: `${losers} did not reach ${hitter}'s shot` }
    case 'landed':
      return { reason: 'In!', detail: `${hitter}'s shot landed in` }
    case 'kitchen-volley':
      return {
        reason: 'Kitchen fault',
        detail: `${hitter} hit the ball out of the air while standing in the kitchen`,
      }
    case 'kitchen-momentum':
      return {
        reason: 'Kitchen fault',
        detail: `${hitter} stepped into the kitchen right after hitting the ball out of the air`,
      }
  }
}
