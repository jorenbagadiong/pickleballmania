import { describe, expect, it } from 'vitest'
import { SwipeTracker } from '../src/input/swipe'

/** Plays mouse events (none while it rests) and reads the swipe at the end. */
function play(path: (t: number) => number, seconds: number, rate = 60, lag = 0.008) {
  const s = new SwipeTracker()
  let x = Number.NaN
  for (let i = 0; i <= Math.round(seconds * rate); i++) {
    const t = i / rate
    if (path(t) === x) continue
    x = path(t)
    s.move(t, x, 0.2)
  }
  return s.read(Math.round(seconds * rate) / rate + lag)
}

/** Rests at `from`, then moves at `speed` half-screens per second from t = 0.3 on. */
const restThenSwipe = (from: number, speed: number) => (t: number) =>
  from + Math.max(0, t - 0.3) * speed

describe('curving with a mouse swipe', () => {
  it('a resting mouse, or none at all, hits straight', () => {
    expect(play(() => 0.4, 0.5)).toBeNull()
    expect(new SwipeTracker().read(1)).toBeNull()
  })

  it('a slow aiming move hits straight', () => {
    expect(play(restThenSwipe(0, 1), 0.6)).toBeNull()
  })

  it('swiping right or left curves that way, fully when fast', () => {
    expect(play(restThenSwipe(0, 5), 0.42)?.spin).toBe(1)
    expect(play(restThenSwipe(0, -5), 0.42)?.spin).toBe(-1)
  })

  it('curves more the faster the swipe', () => {
    const gentle = play(restThenSwipe(0, 2), 0.45)!.spin
    const harder = play(restThenSwipe(0, 3), 0.45)!.spin
    expect(gentle).toBeGreaterThan(0.1)
    expect(harder).toBeGreaterThan(gentle)
    expect(harder).toBeLessThan(1)
  })

  it('keeps the aim where the swipe began', () => {
    const r = play(restThenSwipe(-0.3, 5), 0.42)!
    expect(r.pointer.x).toBeCloseTo(-0.3)
    expect(r.pointer.y).toBeCloseTo(0.2)
  })

  for (const rate of [20, 30, 144, 1000]) {
    it(`reads the same swipe at ${rate} mouse events per second`, () => {
      const r = play(restThenSwipe(-0.3, 5), 0.5, rate)!
      expect(r.spin).toBe(1)
      expect(r.pointer.x).toBeCloseTo(-0.3, 1)
    })
  }

  it('moving quickly to a new target and stopping there is aiming, not a swipe', () => {
    const path = (t: number) => Math.min(0.8, Math.max(0, t - 0.1) * 5)
    expect(play(path, 0.36)).toBeNull() // stopped for 100 ms
  })

  it('only the last part counts when the mouse turns around', () => {
    const path = (t: number) => (t < 0.3 ? t * 4 : 1.2 - (t - 0.3) * 5)
    const r = play(path, 0.42)!
    expect(r.spin).toBe(-1)
    expect(r.pointer.x).toBeCloseTo(1.2, 1)
  })

  it('a swipe that is over no longer counts', () => {
    expect(play(restThenSwipe(0, 5), 0.42, 60, 0.15)).toBeNull()
  })
})
