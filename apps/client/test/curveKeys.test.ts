import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { bendSpin, controls, keySpin, plannedSpin, updateBend } from '../src/input/controls'

function release(): void {
  controls.cheats = true
  controls.keys.clear()
  controls.rightButton = false
  controls.bend = null
  controls.pointer = { x: 0, y: 0 }
}

describe('curving with Q and E', () => {
  beforeEach(release)
  afterEach(release)

  it('does nothing for normal players: they curve by swiping only', () => {
    controls.cheats = false
    controls.keys.add('KeyE')
    controls.rightButton = true
    updateBend()
    expect(controls.bend).toBeNull()
    expect(plannedSpin(10).spin).toBe(0)
  })

  it('Q curves left, E curves right, fully', () => {
    expect(keySpin(new Set(['KeyQ']))).toBe(-1)
    expect(keySpin(new Set(['KeyE']))).toBe(1)
  })

  it('neither or both hit straight', () => {
    expect(keySpin(new Set())).toBe(0)
    expect(keySpin(new Set(['KeyQ', 'KeyE']))).toBe(0)
  })

  it('a held key curves the next swing, and lets go when released', () => {
    controls.keys.add('KeyE')
    updateBend()
    expect(plannedSpin(10)).toEqual({ spin: 1, pointer: null })
    controls.keys.clear()
    updateBend()
    expect(controls.bend).toBeNull()
    expect(plannedSpin(10).spin).toBe(0)
  })
})

describe('holding a curve and sliding the mouse', () => {
  beforeEach(release)
  afterEach(release)
  const start = { start: { x: 0.2, y: -0.1 } }

  it('sliding right bends right, sliding left bends left, more the further', () => {
    const none = new Set<string>()
    expect(bendSpin(start, { x: 0.3, y: -0.1 }, none)).toBeGreaterThan(0.2)
    expect(bendSpin(start, { x: 0.4, y: -0.1 }, none)).toBeGreaterThan(
      bendSpin(start, { x: 0.3, y: -0.1 }, none),
    )
    expect(bendSpin(start, { x: 0.6, y: 0.3 }, none)).toBe(1)
    expect(bendSpin(start, { x: -0.3, y: -0.1 }, none)).toBe(-1)
  })

  it('the mouse decides once it slides, even against the key held', () => {
    expect(bendSpin(start, { x: 0.35, y: -0.1 }, new Set(['KeyQ']))).toBeGreaterThan(0.3)
  })

  it('a hand that shakes a little does not change the bend', () => {
    expect(bendSpin(start, { x: 0.21, y: 0 }, new Set(['KeyQ']))).toBe(-1)
    expect(bendSpin(start, { x: 0.21, y: 0 }, new Set())).toBe(0)
  })

  it('the right mouse button holds a curve too, starting where the mouse was', () => {
    controls.pointer = { x: -0.4, y: 0.1 }
    controls.rightButton = true
    updateBend()
    expect(controls.bend?.start).toEqual({ x: -0.4, y: 0.1 })
    controls.pointer = { x: -0.8, y: 0.1 }
    expect(plannedSpin(10).spin).toBe(-1)
    // Pressing E as well keeps the same hold.
    controls.keys.add('KeyE')
    updateBend()
    expect(controls.bend?.start).toEqual({ x: -0.4, y: 0.1 })
    controls.rightButton = false
    controls.keys.clear()
    updateBend()
    expect(controls.bend).toBeNull()
  })
})
