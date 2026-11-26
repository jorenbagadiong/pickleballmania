import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { type OrbitState, orbitPosition, turnOrbit, zoomOrbit } from '../src/camera/useOrbit'
import { COURT_SPACING, courtX, extraHalfWidth, hallHeight, hallX } from '../src/court/layout'

const start = (): OrbitState => ({ yaw: 0, pitch: 0.5, radius: 10 })

describe('spectator camera turned by hand', () => {
  it('goes all the way round', () => {
    const o = start()
    const seen = new Set<string>()
    for (let i = 0; i < 1100; i++) {
      turnOrbit(o, -1, 0)
      const p = orbitPosition(o, 1, 0, new Vector3())
      seen.add(`${Math.sign(Math.round(p.x))},${Math.sign(Math.round(p.z))}`)
    }
    expect(Math.abs(o.yaw)).toBeGreaterThan(Math.PI * 2)
    for (const side of ['1,1', '1,-1', '-1,-1', '-1,1']) expect(seen).toContain(side)
  })

  it('can look from near the floor to straight down, but not beyond', () => {
    const o = start()
    turnOrbit(o, 0, -5000)
    expect(orbitPosition(o, 1, 0, new Vector3()).y).toBeGreaterThan(0.4)
    turnOrbit(o, 0, 5000)
    const top = orbitPosition({ ...o, radius: 6 }, 1, 0, new Vector3())
    expect(Math.hypot(top.x, top.z)).toBeLessThan(1)
    expect(top.y).toBeGreaterThan(6)
  })

  it('zooms between limits', () => {
    const o = start()
    for (let i = 0; i < 100; i++) zoomOrbit(o, -500)
    expect(o.radius).toBeCloseTo(3)
    for (let i = 0; i < 100; i++) zoomOrbit(o, 500)
    expect(o.radius).toBeCloseTo(24)
  })

  it('never leaves the hall or sinks into the seats, whatever the number of courts', () => {
    for (const courts of [1, 2, 4]) {
      for (let focus = 0; focus < courts; focus++) {
        for (let yaw = 0; yaw < 6.3; yaw += 0.2) {
          for (const pitch of [0.04, 0.4, 1, 1.5]) {
            const p = orbitPosition({ yaw, pitch, radius: 24 }, courts, focus, new Vector3())
            const half = 14 + extraHalfWidth(courts)
            const fromMiddle = Math.abs(p.x - hallX(courts, focus))
            expect(fromMiddle).toBeLessThan(half)
            expect(Math.abs(p.z)).toBeLessThan(21)
            expect(p.y).toBeLessThan(hallHeight(courts))
            if (fromMiddle > 8.6 + extraHalfWidth(courts)) expect(p.y).toBeGreaterThan(3)
          }
        }
      }
    }
  })
})

describe('courts side by side', () => {
  it('are drawn around the one in focus, inside the hall', () => {
    expect(courtX(2, 2)).toBe(0)
    expect(courtX(3, 2)).toBe(COURT_SPACING)
    expect(hallX(1, 0)).toBe(0)
    for (const focus of [0, 1, 2, 3]) {
      const middle = hallX(4, focus)
      for (const i of [0, 1, 2, 3]) {
        expect(Math.abs(courtX(i, focus) - middle)).toBeLessThanOrEqual(extraHalfWidth(4) + 1e-9)
      }
    }
  })
})
