import {
  BALL_RADIUS,
  type BallBody,
  type BallEvent,
  COURT,
  FIXED_DT,
  netHeightAt,
  stepBall,
} from '@pickleball/shared'
import { describe, expect, it } from 'vitest'
import { RallyTracker, explain } from '../src/rules/rally'
import { solveShot } from '../src/simulation/shot'

function simulateUntilBounce(ball: BallBody, maxSteps = 600): BallEvent[] {
  const events: BallEvent[] = []
  for (let i = 0; i < maxSteps; i++) {
    stepBall(ball, FIXED_DT, events)
    if (events.some((e) => e.type === 'bounce')) break
  }
  return events
}

describe('ball physics', () => {
  it('falls under gravity and bounces lower each time', () => {
    const ball: BallBody = { x: 0, y: 2, z: 3, vx: 0, vy: 0, vz: 0 }
    const events = simulateUntilBounce(ball)
    expect(events[0]?.type).toBe('bounce')
    expect(ball.vy).toBeGreaterThan(0)
    let apex = 0
    for (let i = 0; i < 120 && ball.vy >= 0; i++) {
      stepBall(ball, FIXED_DT, [])
      apex = Math.max(apex, ball.y)
    }
    expect(apex).toBeGreaterThan(0.4)
    expect(apex).toBeLessThan(2)
  })

  it('counts the bounce when a step ends exactly at contact, and none while rolling', () => {
    const events: BallEvent[] = []
    const ball: BallBody = { x: 0, y: BALL_RADIUS, z: 3, vx: 0, vy: -5, vz: 1 }
    stepBall(ball, FIXED_DT, events)
    expect(events.map((e) => e.type)).toEqual(['bounce'])
    for (let i = 0; i < 600; i++) stepBall(ball, FIXED_DT, events)
    const settled = events.length
    for (let i = 0; i < 60; i++) stepBall(ball, FIXED_DT, events)
    expect(events.length).toBe(settled)
  })

  it('stops a low ball at the net and reports it', () => {
    const ball: BallBody = { x: 0, y: 0.4, z: 2, vx: 0, vy: 0, vz: -10 }
    const events: BallEvent[] = []
    for (let i = 0; i < 30; i++) stepBall(ball, FIXED_DT, events)
    expect(events.some((e) => e.type === 'net')).toBe(true)
    expect(ball.z).toBeGreaterThan(0)
  })

  it('lets a high ball pass over the net', () => {
    const ball: BallBody = { x: 0, y: 1.6, z: 2, vx: 0, vy: 0, vz: -10 }
    const events: BallEvent[] = []
    for (let i = 0; i < 30; i++) stepBall(ball, FIXED_DT, events)
    expect(events.some((e) => e.type === 'net')).toBe(false)
    expect(ball.z).toBeLessThan(0)
  })
})

describe('shot solver', () => {
  for (const power of [0, 0.5, 1]) {
    it(`lands on target and clears the net (power ${power})`, () => {
      const from = { x: 1, y: 0.8, z: 5 }
      const target = { x: -1.5, z: -4 }
      const v = solveShot(from, target, power)
      const ball: BallBody = { ...from, vx: v.x, vy: v.y, vz: v.z }
      const events: BallEvent[] = []
      let crossedHeight = Number.NaN
      for (let i = 0; i < 600; i++) {
        const prevZ = ball.z
        stepBall(ball, FIXED_DT, events)
        if (prevZ > 0 && ball.z <= 0) crossedHeight = ball.y
        if (events.length > 0) break
      }
      expect(events[0]?.type).toBe('bounce')
      expect(crossedHeight - BALL_RADIUS).toBeGreaterThan(netHeightAt(0))
      const bounce = events[0] as { x: number; z: number }
      expect(Math.hypot(bounce.x - target.x, bounce.z - target.z)).toBeLessThan(0.15)
    })
  }

  it('higher power produces a faster shot', () => {
    const from = { x: 0, y: 1, z: 6 }
    const slow = solveShot(from, { x: 0, z: -5 }, 0)
    const fast = solveShot(from, { x: 0, z: -5 }, 1)
    expect(Math.abs(fast.z)).toBeGreaterThan(Math.abs(slow.z))
  })
})

describe('shots from anywhere on the court', () => {
  it('never hang in the air, and still clear the net and land in', () => {
    let highest = 0
    let slowestFall = 0
    for (const power of [0, 0.3, 0.35, 1]) {
      for (const boost of [0, 0.32]) {
        for (const y of [0.12, 0.5, 1, 2.4]) {
          for (const z of [0.25, 0.6, 1, 2, 4, 6, 8]) {
            for (const tz of [-0.6, -1.5, -3.5, -5, -6.4]) {
              for (const tx of [-4, 0, 4]) {
                const from = { x: 1, y, z }
                const v = solveShot(from, { x: tx, z: tz }, power, boost)
                const ball: BallBody = { ...from, vx: v.x, vy: v.y, vz: v.z }
                const events: BallEvent[] = []
                let apex = y
                let apexTime = 0
                let t = 0
                while (events.length === 0 && t < 5) {
                  stepBall(ball, FIXED_DT, events)
                  t += FIXED_DT
                  if (ball.y > apex) {
                    apex = ball.y
                    apexTime = t
                  }
                }
                const bounce = events[0]
                const label = JSON.stringify({ power, boost, from, tx, tz })
                expect(bounce?.type, label).toBe('bounce')
                expect(bounce?.z, label).toBeLessThan(0)
                expect(bounce?.z, label).toBeGreaterThan(-COURT.halfLength)
                highest = Math.max(highest, apex)
                slowestFall = Math.max(slowestFall, t - apexTime)
              }
            }
          }
        }
      }
    }
    expect(highest).toBeLessThan(3.3)
    expect(slowestFall).toBeLessThan(0.85)
  })
})

describe('sidespin', () => {
  const from = { x: 0, y: 0.7, z: 6.5 }
  const target = { x: 0, z: -5 }
  const fly = (spin: number, power = 0.35) => {
    const v = solveShot(from, target, power, 0, spin)
    const ball: BallBody = { ...from, vx: v.x, vy: v.y, vz: v.z, curve: v.curve }
    const events: BallEvent[] = []
    let bend = 0
    while (events.length === 0) {
      stepBall(ball, FIXED_DT, events)
      if (Math.abs(ball.x) > Math.abs(bend)) bend = ball.x
    }
    return { ball, bend, bounce: events[0] as { type: string; x: number; z: number } }
  }

  for (const power of [0.35, 1]) {
    it(`bends the path a lot, yet lands on the same target (power ${power})`, () => {
      const right = fly(1, power)
      const left = fly(-1, power)
      // Starts out to the left, swings back right; a smash bends less.
      expect(right.bend).toBeLessThan(power === 1 ? -0.75 : -1.2)
      expect(left.bend).toBeCloseTo(-right.bend)
      for (const shot of [right, left]) {
        expect(shot.bounce.type).toBe('bounce')
        expect(shot.bounce.x).toBeCloseTo(target.x, 1)
        expect(Math.abs(shot.bounce.z - target.z)).toBeLessThan(0.15)
      }
    })
  }

  it('kicks sideways off the bounce and then curves less', () => {
    const { ball } = fly(1)
    const { curve } = solveShot(from, target, 0.35, 0, 1)
    expect(ball.vx).toBeGreaterThan(4)
    expect(ball.curve).toBeGreaterThan(0)
    expect(ball.curve).toBeLessThan(curve / 2)
  })

  it('stops curving in the net and once the ball rolls', () => {
    const netted: BallBody = { x: 0, y: 0.4, z: 1, vx: 0, vy: 0, vz: -10, curve: 8 }
    for (let i = 0; i < 10; i++) stepBall(netted, FIXED_DT, [])
    expect(netted.curve).toBe(0)
    const { ball } = fly(1)
    for (let i = 0; i < 900; i++) stepBall(ball, FIXED_DT, [])
    expect(ball.curve).toBe(0)
  })

  it('a straight shot does not curve', () => {
    expect(Math.abs(fly(0).bend)).toBeLessThan(1e-6)
  })
})

describe('rally rules', () => {
  it('serve landing in the diagonal box keeps the rally alive', () => {
    const r = new RallyTracker()
    r.startServe(0, 0)
    expect(r.onBounce(-1.5, -4)).toBeNull()
  })

  it('serve into the wrong box is a fault', () => {
    const r = new RallyTracker()
    r.startServe(0, 0)
    expect(r.onBounce(1.5, -4)).toEqual({ winner: 1, code: 'serve-wrong-box' })
  })

  it('a ball out past the lines loses the point for the hitter', () => {
    const r = new RallyTracker()
    r.startServe(0, 0)
    r.onBounce(-1.5, -4)
    r.onHit(1)
    expect(r.onBounce(0, COURT.halfLength + 0.5)).toEqual({ winner: 0, code: 'out-long' })
  })

  it('a ball into the net loses the point for the hitter', () => {
    const r = new RallyTracker()
    r.startServe(0, 0)
    r.onNet()
    expect(r.onBounce(0, 0.3)?.winner).toBe(1)
  })

  it('two bounces wins the point for the hitter and blocks double hits', () => {
    const r = new RallyTracker()
    r.startServe(1, 0)
    expect(r.canHit(1)).toBe(false)
    expect(r.canHit(0)).toBe(true)
    expect(r.onBounce(1.5, 4)).toBeNull()
    expect(r.onBounce(1.4, 5)?.winner).toBe(1)
  })

  it('names the kind of serve fault', () => {
    const fault = (x: number, z: number) => {
      const r = new RallyTracker()
      r.startServe(0, 0)
      return r.onBounce(x, z)?.code
    }
    expect(fault(-1.5, -1)).toBe('serve-kitchen')
    expect(fault(-1.5, -COURT.kitchenDepth)).toBe('serve-kitchen') // the line counts as kitchen
    expect(fault(-1.5, -9)).toBe('serve-out')
    expect(fault(-5, -4)).toBe('serve-out')
  })

  it('only the diagonal receiver may return the serve; then anyone on the team', () => {
    const r = new RallyTracker()
    r.startServe(0, 0, 'bob')
    expect(r.canHit(1, 'dave')).toBe(false)
    expect(r.canHit(1, 'bob')).toBe(true)
    r.onHit(1)
    expect(r.canHit(0, 'carol')).toBe(true)
  })

  it('two-bounce rule covers the serve and the return, not the third shot', () => {
    const r = new RallyTracker()
    r.startServe(0, 0)
    expect(r.mustBounce).toBe(true)
    r.onHit(1) // return of serve
    expect(r.mustBounce).toBe(true)
    r.onHit(0) // third shot
    expect(r.mustBounce).toBe(false)
  })

  it('explains every kind of rally ending', () => {
    const codes = [
      'serve-kitchen',
      'serve-wrong-box',
      'serve-out',
      'out-long',
      'out-wide',
      'net',
      'short',
      'double-bounce',
      'not-returned',
      'kitchen-volley',
      'kitchen-momentum',
    ] as const
    for (const c of codes) {
      const t = explain(c, 'Ann', 'Ben')
      expect(t.reason.length).toBeGreaterThan(3)
      expect(t.detail).toMatch(/Ann|Ben/)
    }
  })
})
