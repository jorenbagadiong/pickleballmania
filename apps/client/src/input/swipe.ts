/**
 * Curving a shot with the mouse: swipe sideways and swing during the swipe.
 *
 * The mouse also aims, so the two must not get in each other's way. What counts is
 * the speed at the moment of the click: aiming slows to a stop before clicking, a
 * swipe doesn't. And a swipe drags the aim along, so the shot goes to where the
 * mouse was when the swipe began.
 *
 * Works from the mouse's own events and their times, not from rendered frames, so a
 * swipe is judged the same on a slow computer.
 */

/** A mouse position in the view: -1 to 1 from left to right and from bottom to top. */
export interface Pointer {
  x: number
  y: number
}

interface Sample extends Pointer {
  /** Seconds. */
  t: number
}

export interface Swipe {
  /** -1 (hard left) to 1 (hard right). */
  spin: number
  /** Where the mouse should be taken to be aiming. */
  pointer: Pointer
}

/** Half-screens per second: below the first nothing curves, at the second it curves fully. */
export const SWIPE_MIN_SPEED = 1.4
export const SWIPE_FULL_SPEED = 3.8
/** Speed is measured over this long before the click (seconds). */
const SPEED_WINDOW = 0.07
/** The newest event may be this old and the mouse still count as moving (~2 frames). */
const EVENT_LAG = 0.035
/** With no events for this long the mouse was at rest. */
const REST_GAP = 0.1
/** A swipe reaches back while the mouse kept moving this fast, up to this long. */
const START_SPEED = 0.6
const MAX_SWIPE_SECONDS = 0.35
const KEEP_SECONDS = 0.6
/** From this much spin on, the aim stays entirely where the swipe began. */
const AIM_LOCK_SPIN = 0.35

export class SwipeTracker {
  private samples: Sample[] = []

  reset(): void {
    this.samples = []
  }

  /** Records a mouse move. */
  move(t: number, x: number, y: number): void {
    const s = this.samples
    s.push({ t, x, y })
    // Keep one sample from before the period: it says where the mouse was resting.
    while (s.length > 2 && t - (s[1] as Sample).t > KEEP_SECONDS) s.shift()
  }

  /** Horizontal position at time t. */
  private xAt(t: number): number {
    const s = this.samples
    for (let i = s.length - 1; i >= 0; i--) {
      const a = s[i] as Sample
      if (a.t > t) continue
      const b = s[i + 1]
      if (!b || b.t - a.t > REST_GAP) return a.x
      return a.x + ((b.x - a.x) * (t - a.t)) / (b.t - a.t)
    }
    return s[0]?.x ?? 0
  }

  /** Sideways mouse speed at time `now` (half-screens per second; right is positive). */
  speed(now: number): number {
    const last = this.samples.at(-1)
    if (!last) return 0
    const end = now - last.t <= EVENT_LAG ? Math.min(now, last.t) : now
    return (last.x - this.xAt(end - SPEED_WINDOW)) / SPEED_WINDOW
  }

  /** The swipe going on at time `now`, or null if the mouse isn't being swiped. */
  read(now: number): Swipe | null {
    const s = this.samples
    const last = s.at(-1)
    if (!last) return null
    const speed = this.speed(now)
    const size = Math.abs(speed)
    if (size <= SWIPE_MIN_SPEED) return null
    const direction = Math.sign(speed)
    const amount = Math.min(1, (size - SWIPE_MIN_SPEED) / (SWIPE_FULL_SPEED - SWIPE_MIN_SPEED))

    // Back to where this swipe began.
    let origin = last
    for (let i = s.length - 2; i >= 0; i--) {
      const a = s[i] as Sample
      const gap = origin.t - a.t
      const rested = gap > REST_GAP
      const moving = gap <= 0 || ((origin.x - a.x) / gap) * direction >= START_SPEED
      if (!rested && (!moving || last.t - a.t > MAX_SWIPE_SECONDS)) break
      origin = a
      if (rested) break
    }
    // Eased in, so a swing at the edge of "swiping" doesn't jump to another target.
    const lock = Math.min(1, amount / AIM_LOCK_SPIN)
    return {
      spin: direction * amount,
      pointer: {
        x: last.x + (origin.x - last.x) * lock,
        y: last.y + (origin.y - last.y) * lock,
      },
    }
  }
}

export const swipe = new SwipeTracker()
