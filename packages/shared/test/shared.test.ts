import { describe, expect, it } from 'vitest'
import {
  CHAT_MAX_LENGTH,
  COURT,
  FIXED_DT,
  isInServiceBox,
  isInsideCourt,
  isValidRoomCode,
  movementBounds,
  netHeightAt,
  normalizeRoomCode,
  playBounds,
  sanitizeChat,
  sanitizeIntent,
  sanitizeNickname,
  serveBounds,
  PLAYER_SPEED,
  stepPlayer,
  WIRE,
  fromWire,
  toWire,
} from '../src'

describe('court geometry', () => {
  it('is 28 x 44 ft (wider than official) with a 7 ft kitchen', () => {
    expect(COURT.width).toBeCloseTo(8.534, 3)
    expect(COURT.length).toBeCloseTo(13.411, 3)
    expect(COURT.kitchenDepth).toBeCloseTo(2.134, 3)
  })

  it('net is 34 in at center and 36 in at the posts', () => {
    expect(netHeightAt(0)).toBeCloseTo(0.8636, 4)
    expect(netHeightAt(COURT.netHalfWidth)).toBeCloseTo(0.9144, 4)
  })

  it('counts lines as in', () => {
    expect(isInsideCourt(COURT.halfWidth, 3, 1)).toBe(true)
    expect(isInsideCourt(COURT.halfWidth + 0.01, 3, 1)).toBe(false)
    expect(isInsideCourt(0, -COURT.halfLength, -1)).toBe(true)
    expect(isInsideCourt(0, 3, -1)).toBe(false)
  })

  it('service box is diagonal and beyond the kitchen line', () => {
    // Slot 0 (+z half) serving with an even score stands on +x (their right) and
    // must land on the -z half, -x side, deeper than the kitchen.
    expect(isInServiceBox(-1.5, -4, 0, 0)).toBe(true)
    expect(isInServiceBox(1.5, -4, 0, 0)).toBe(false)
    expect(isInServiceBox(-1.5, -1.5, 0, 0)).toBe(false) // in the kitchen
    expect(isInServiceBox(-1.5, 4, 0, 0)).toBe(false) // own half
    // Odd score serves from the left, so the target box flips.
    expect(isInServiceBox(1.5, -4, 0, 1)).toBe(true)
  })
})

describe('movement', () => {
  it('moves at a bounded speed and stays on its own half', () => {
    const p = { x: 0, z: 1, vx: 0, vz: 0 }
    for (let i = 0; i < 120; i++) stepPlayer(p, { mx: 0, mz: -1 }, FIXED_DT, playBounds(0))
    expect(p.z).toBeGreaterThan(0) // cannot cross the net
    const q = { x: 0, z: -1, vx: 0, vz: 0 }
    for (let i = 0; i < 120; i++) stepPlayer(q, { mx: 0, mz: 1 }, FIXED_DT, playBounds(1))
    expect(q.z).toBeLessThan(0)
  })

  it('gets going and stops quickly, but not instantly, and never goes faster than it may', () => {
    const p = { x: 0, z: 4, vx: 0, vz: 0 }
    const run = (mx: number, mz: number, seconds: number): void => {
      for (let t = 0; t < seconds; t += FIXED_DT) {
        stepPlayer(p, { mx, mz }, FIXED_DT, playBounds(0))
        expect(Math.hypot(p.vx, p.vz)).toBeLessThanOrEqual(PLAYER_SPEED + 1e-9)
      }
    }
    run(1, 0, FIXED_DT * 2)
    expect(p.vx).toBeGreaterThan(0)
    expect(p.vx).toBeLessThan(PLAYER_SPEED * 0.5)
    run(1, 0, 0.2)
    expect(p.vx).toBeCloseTo(PLAYER_SPEED, 5)
    const x = p.x
    run(0, 0, 0.2)
    expect(p.vx).toBe(0)
    expect(p.x - x).toBeLessThan(0.45)
    run(-1, 0, 0.15) // turning round
    expect(p.vx).toBeLessThan(-PLAYER_SPEED * 0.8)
  })

  it('a wall stops the speed toward it', () => {
    const b = playBounds(0)
    const p = { x: b.maxX - 0.2, z: 4, vx: 0, vz: 0 }
    for (let i = 0; i < 60; i++) stepPlayer(p, { mx: 1, mz: 0 }, FIXED_DT, b)
    expect(p).toMatchObject({ x: b.maxX, vx: 0 })
  })

  it('normalizes diagonal and garbage input', () => {
    const d = sanitizeIntent(1, 1)
    expect(Math.hypot(d.mx, d.mz)).toBeCloseTo(1, 6)
    expect(sanitizeIntent(Number.NaN, 'x')).toEqual({ mx: 0, mz: 0 })
    expect(sanitizeIntent(50, -50).mx).toBeLessThanOrEqual(1)
  })

  it('keeps the server behind the baseline while serving', () => {
    const b = serveBounds(0, 0)
    expect(b.minZ).toBeGreaterThan(COURT.halfLength)
    expect(b.minX).toBeGreaterThan(0)
    expect(movementBounds(0, 'serving', true, 0)).toEqual(b)
    // Everyone else (receivers, and the server's partner in 2v2) moves freely.
    expect(movementBounds(0, 'serving', false, 0)).toEqual(playBounds(0))
    expect(movementBounds(1, 'serving', false, 0)).toEqual(playBounds(1))
    expect(movementBounds(0, 'paused', true, 0)).toBeNull()
  })
})

describe('protocol helpers', () => {
  it('cleans chat messages', () => {
    expect(sanitizeChat('  hi\n\tthere  ')).toBe('hi there')
    expect(sanitizeChat('\u0000\u0007')).toBe('')
    expect(sanitizeChat(undefined)).toBe('')
    expect(Array.from(sanitizeChat('🏓'.repeat(400))).length).toBe(CHAT_MAX_LENGTH)
    expect(sanitizeChat('<b>hi</b>')).toBe('<b>hi</b>') // shown as plain text, never as HTML
  })

  it('sanitizes nicknames', () => {
    expect(sanitizeNickname('  Alice\u0000\n  ')).toBe('Alice')
    expect(sanitizeNickname('')).toBe('Player')
    expect(sanitizeNickname(42)).toBe('Player')
    expect(sanitizeNickname('x'.repeat(50))).toHaveLength(16)
  })

  it('normalizes and validates room codes', () => {
    expect(normalizeRoomCode(' ab-c d9 ')).toBe('ABCD9')
    expect(isValidRoomCode('ABCD9')).toBe(true)
    expect(isValidRoomCode('ABCD0')).toBe(false)
    expect(isValidRoomCode('ABC')).toBe(false)
  })
})

describe('sending positions and speeds compactly', () => {
  it('keeps them to well under what anyone can see', () => {
    for (const v of [0, 1.2345678, -6.7, 10.9999, 0.0004]) {
      expect(Math.abs(fromWire(toWire(v, WIRE.position), WIRE.position) - v)).toBeLessThanOrEqual(
        0.0005,
      )
    }
    expect(fromWire(toWire(-Math.PI, WIRE.angle), WIRE.angle)).toBeCloseTo(-Math.PI, 3)
  })

  it('fits every value in two bytes, even far out of range', () => {
    expect(toWire(1e6, WIRE.position)).toBe(32767)
    expect(toWire(-1e6, WIRE.ballSpeed)).toBe(-32767)
    expect(toWire(Number.NaN, WIRE.curve)).toBe(0)
    // The fastest smash and the hardest curve still fit.
    expect(Math.abs(toWire(40, WIRE.ballSpeed))).toBeLessThan(32767)
    expect(Math.abs(toWire(250, WIRE.curve))).toBeLessThan(32767)
    expect(Math.abs(toWire(PLAYER_SPEED * 2, WIRE.runSpeed))).toBeLessThan(32767)
  })
})
