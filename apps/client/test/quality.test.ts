import { describe, expect, it } from 'vitest'
import {
  FrameRateMeter,
  type Quality,
  fullQuality,
  lowerQuality,
  saveQuality,
  savedQuality,
} from '../src/game/quality'

const full: Quality = { dpr: 2, shadows: true, crowd: true }

function stepsDown(fps: number): Quality[] {
  const out: Quality[] = []
  for (let q = lowerQuality(full, fps); q; q = lowerQuality(q, fps)) out.push(q)
  return out
}

describe('giving up looks for speed', () => {
  it('gives up sharpness first, then shadows, then the crowd', () => {
    const steps = stepsDown(45)
    expect(steps[0]).toEqual({ dpr: 1.75, shadows: true, crowd: true })
    expect(steps.findIndex((q) => q.dpr === 1)).toBeLessThan(steps.findIndex((q) => !q.shadows))
    expect(steps.findIndex((q) => !q.shadows)).toBeLessThan(steps.findIndex((q) => !q.crowd))
    expect(steps.at(-1)).toEqual({ dpr: 1, shadows: false, crowd: false })
  })

  it('gets there in three steps on a very slow computer', () => {
    expect(stepsDown(4)).toHaveLength(3)
    expect(stepsDown(4).at(-1)).toEqual({ dpr: 0.5, shadows: false, crowd: false })
  })
})

describe('choosing a sharpness', () => {
  it('goes straight to about the size this computer can draw', () => {
    // 40 fps at 2x: drawing takes ~1.4x too long, so about 1.7x the pixels per side is too many.
    expect(lowerQuality(full, 40)?.dpr).toBe(1.5)
    expect(lowerQuality(full, 48)?.dpr).toBe(1.75)
  })

  it('always gives up something, and never goes below the screen', () => {
    expect(lowerQuality(full, 49.9)?.dpr).toBe(1.75)
    expect(lowerQuality({ ...full, dpr: 1.25 }, 31)?.dpr).toBe(1)
  })

  it('never draws more than twice the pixels per side, or fewer than the screen', () => {
    expect(fullQuality(3).dpr).toBe(2)
    expect(fullQuality(1.25).dpr).toBe(1.25)
    expect(fullQuality(0.8).dpr).toBe(1)
    expect(fullQuality(Number.NaN).dpr).toBe(1)
  })
})

describe('remembering what this computer can draw', () => {
  const memory = () => {
    const m = new Map<string, string>()
    return {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
    }
  }
  const day = 24 * 3600 * 1000

  it('starts where it ended up last time', () => {
    const store = memory()
    saveQuality({ dpr: 1, shadows: false, crowd: true }, store, 1000)
    expect(savedQuality(2, store, 1000 + day)).toEqual({ dpr: 1, shadows: false, crowd: true })
  })

  it('starts at full quality the first time, or when storage is unavailable', () => {
    expect(savedQuality(2, memory())).toEqual(full)
    expect(savedQuality(2, null)).toEqual(full)
  })

  it('looks again after a week', () => {
    const store = memory()
    saveQuality({ dpr: 1, shadows: false, crowd: false }, store, 1000)
    expect(savedQuality(2, store, 1000 + 8 * day)).toEqual(full)
  })

  it('never starts sharper than this screen', () => {
    const store = memory()
    saveQuality({ dpr: 1.75, shadows: true, crowd: true }, store, 1000)
    expect(savedQuality(1, store, 2000).dpr).toBe(1)
  })

  it('ignores something unreadable', () => {
    const broken = { getItem: () => '{not json', setItem: () => {} }
    expect(savedQuality(2, broken)).toEqual(full)
    const throwing = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    }
    expect(savedQuality(2, throwing)).toEqual(full)
    expect(() => saveQuality(full, throwing)).not.toThrow()
  })
})

describe('FrameRateMeter', () => {
  const rate = (m: FrameRateMeter, delta: number, seconds: number): number | null => {
    let fps: number | null = null
    for (let t = 0; t < seconds; t += delta) fps = m.add(delta) ?? fps
    return fps
  }

  it('measures the frame rate after a warm-up', () => {
    const m = new FrameRateMeter()
    expect(rate(m, 1 / 60, 1)).toBeNull()
    expect(rate(m, 1 / 60, 3)).toBeCloseTo(60, 0)
  })

  it('ignores a single hiccup', () => {
    const m = new FrameRateMeter()
    rate(m, 1 / 60, 3)
    expect(m.add(2)).toBeNull()
    expect(rate(m, 1 / 60, 2)).toBeCloseTo(60, 0)
  })

  it('notices a computer whose every frame is very slow', () => {
    expect(rate(new FrameRateMeter(), 0.4, 8)).toBeCloseTo(2.5, 1)
  })
})
