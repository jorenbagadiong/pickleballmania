/**
 * TEZUKA ZONE presentation (Phase D1, src/players/zone): which state the field shows,
 * from replicated state only, how it eases between states at any frame rate, how much
 * detail each quality step gets, and that every GPU resource it owns is freed.
 */
import { SECRET_LOOK } from '@pickleball/shared'
import { describe, expect, it } from 'vitest'
import {
  TIERS,
  VISIBLE_PRESENCE,
  type ZoneFxInfo,
  type ZoneInput,
  type ZoneLevels,
  type ZoneTarget,
  approach,
  logState,
  stepZone,
  tierConfig,
  zoneTarget,
  zoneTier,
} from '../src/players/zone/zoneFx'
import { MAX_PARTICLES, createZoneResources } from '../src/players/zone/zoneResources'

const ball = (steerX = 0, steerZ = 0) => ({ visible: true, held: false, steerX, steerZ })

/** The secret athlete on slot 0, receiving a steered shot from slot 1 in a rally. */
function input(o: Partial<ZoneInput> = {}): ZoneInput {
  return {
    look: SECRET_LOOK,
    connected: true,
    focused: true,
    slot: 0,
    phase: 'rally',
    lastHitSlot: 1,
    ball: ball(6, -2),
    ...o,
  }
}

describe('which state the field shows', () => {
  it('only the look the server gives shows anything (the nickname plays no part)', () => {
    for (const look of ['m1', 'f2', 'cheater', 'Tezuka', 'tezuka', '', 'X1'])
      expect(zoneTarget(input({ look })).state, look).toBe('inactive')
    expect(zoneTarget(input()).state).toBe('attracting')
  })

  it('available whenever the athlete is on the court in focus and connected', () => {
    for (const phase of ['waiting', 'lobby', 'serving', 'pointOver', 'gameOver'])
      expect(zoneTarget(input({ phase, ball: ball() })).state, phase).toBe('available')
  })

  it('attracting only while the replicated ball is pulled, in a rally, after an opponent hit', () => {
    expect(zoneTarget(input())).toEqual({ state: 'attracting', pull: expect.any(Number) })
    // No pull, the athlete's own team's shot, or nobody has hit yet: just available.
    expect(zoneTarget(input({ ball: ball(0, 0) })).state).toBe('available')
    expect(zoneTarget(input({ lastHitSlot: 0 })).state).toBe('available')
    expect(zoneTarget(input({ lastHitSlot: -1 })).state).toBe('available')
    // A held or hidden ball, or no ball yet.
    expect(zoneTarget(input({ ball: { ...ball(6), held: true } })).state).toBe('available')
    expect(zoneTarget(input({ ball: { ...ball(6), visible: false } })).state).toBe('available')
    expect(zoneTarget(input({ ball: null })).state).toBe('available')
  })

  it('the rally ending clears the attraction even if a pull is still on the wire', () => {
    expect(zoneTarget(input({ phase: 'pointOver' })).state).toBe('available')
    expect(zoneTarget(input({ phase: 'gameOver' })).state).toBe('available')
  })

  it('the pull shows harder for a stronger replicated pull, within 0.55..1', () => {
    const weak = zoneTarget(input({ ball: ball(0.5) })).pull
    const strong = zoneTarget(input({ ball: ball(40) })).pull
    expect(weak).toBeGreaterThanOrEqual(0.55)
    expect(strong).toBe(1)
    expect(strong).toBeGreaterThan(weak)
  })

  it('a disconnect, or another court than the one in focus, shows nothing', () => {
    expect(zoneTarget(input({ connected: false })).state).toBe('inactive')
    expect(zoneTarget(input({ focused: false })).state).toBe('inactive')
  })

  it('doubles: the partner on the same team never shows a field', () => {
    const partner = input({ look: 'm2' })
    expect(zoneTarget(partner).state).toBe('inactive')
    expect(zoneTarget(input()).state).toBe('attracting')
  })
})

/** Runs a timeline of targets through the easing at a given frame rate. */
function run(timeline: [number, ZoneTarget][], fps: number, until: number) {
  const l: ZoneLevels = { presence: 0, pull: 0 }
  const out: { t: number; presence: number; pull: number }[] = []
  const dt = 1 / fps
  for (let t = 0; t < until - 1e-9; t += dt) {
    const target = [...timeline].reverse().find(([at]) => at <= t + 1e-9)![1]
    stepZone(l, target, dt)
    out.push({ t: t + dt, ...l })
  }
  return out
}
const at = (s: ReturnType<typeof run>, t: number) =>
  s.reduce((a, b) => (Math.abs(b.t - t) < Math.abs(a.t - t) ? b : a))

describe('how the field eases between states', () => {
  const timeline: [number, ZoneTarget][] = [
    [0, { state: 'available', pull: 0 }],
    [1, { state: 'attracting', pull: 1 }],
    [1.6, { state: 'available', pull: 0 }],
    [3, { state: 'inactive', pull: 0 }],
  ]

  it('fades in, rises to the pull, eases back, and fades out completely', () => {
    const s = run(timeline, 60, 5)
    expect(at(s, 0.1).presence).toBeGreaterThan(0.3)
    expect(at(s, 0.1).presence).toBeLessThan(0.7)
    expect(at(s, 0.9).presence).toBeGreaterThan(0.99)
    expect(at(s, 0.9).pull).toBe(0)
    expect(at(s, 1.4).pull).toBeGreaterThan(0.95)
    // Rally over: the pull eases off, the field stays.
    expect(at(s, 2.9).pull).toBeLessThan(0.02)
    expect(at(s, 2.9).presence).toBe(1)
    // Disconnect or exit: gone within a second and a half.
    expect(at(s, 4.5).presence).toBeLessThan(VISIBLE_PRESENCE)
    expect(at(s, 4.5).pull).toBe(0)
  })

  it('the same at 30, 60 and 144 frames a second', () => {
    const ref = run(timeline, 60, 5)
    for (const fps of [30, 144]) {
      const s = run(timeline, fps, 5)
      for (const t of [0.2, 0.5, 1.1, 1.3, 2, 3.2, 4]) {
        const a = at(s, t)
        const b = at(ref, t)
        // Sampled at slightly different instants; the curves themselves agree.
        expect(Math.abs(a.presence - b.presence), `${fps} fps, t=${t}`).toBeLessThan(0.12)
        expect(Math.abs(a.pull - b.pull), `${fps} fps, t=${t}`).toBeLessThan(0.15)
      }
    }
  })

  it('approach: one step of 2·dt equals two of dt, and no step overshoots', () => {
    const two = approach(approach(0, 1, 6, 1 / 60), 1, 6, 1 / 60)
    expect(approach(0, 1, 6, 2 / 60)).toBeCloseTo(two, 12)
    expect(approach(0.4, 0.4, 6, 1)).toBe(0.4)
    expect(approach(0.2, 1, 6, 0)).toBe(0.2)
    for (const dt of [0.001, 0.05, 1, 100]) expect(approach(0, 1, 6, dt)).toBeLessThanOrEqual(1)
  })

  it('the state log keeps changes only, and stays bounded', () => {
    const info = { state: 'inactive', log: [] } as unknown as ZoneFxInfo
    logState(info, 'inactive', 0)
    logState(info, 'inactive', 1)
    logState(info, 'available', 2)
    expect(info.log.map((e) => e.state)).toEqual(['inactive', 'available'])
    for (let i = 0; i < 200; i++) logState(info, i % 2 ? 'attracting' : 'available', i)
    expect(info.log.length).toBe(64)
  })
})

describe('quality', () => {
  it("follows the game's own quality steps", () => {
    expect(zoneTier({ shadows: true, crowd: true })).toBe('high')
    expect(zoneTier({ shadows: false, crowd: true })).toBe('medium')
    expect(zoneTier({ shadows: false, crowd: false })).toBe('low')
  })

  it('less detail at each step, and still a ring at the lowest', () => {
    expect(TIERS.high.particles).toBeGreaterThan(TIERS.medium.particles)
    expect(TIERS.medium.particles).toBeGreaterThan(TIERS.low.particles)
    expect(TIERS.low).toEqual({ secondaryRings: 0, markings: false, pulse: false, particles: 0 })
    expect(TIERS.high.secondaryRings).toBe(2)
    expect(TIERS.medium.secondaryRings).toBe(1)
  })

  it('reduced motion: nothing pulses or drifts, at any step', () => {
    for (const t of ['high', 'medium', 'low'] as const) {
      const c = tierConfig(t, true)
      expect(c.pulse).toBe(false)
      expect(c.particles).toBe(0)
      expect(c.secondaryRings).toBe(TIERS[t].secondaryRings)
    }
  })
})

describe('GPU resources', () => {
  it('one fixed particle buffer; each step only changes how much of it is drawn', () => {
    const r = createZoneResources(TIERS.high)
    const buffer = r.moteGeometry.getAttribute('seed')
    expect(buffer.count).toBe(MAX_PARTICLES)
    for (const t of ['high', 'medium', 'low'] as const) {
      r.configure(TIERS[t])
      expect(r.moteGeometry.drawRange.count).toBe(TIERS[t].particles)
      expect(r.moteGeometry.getAttribute('seed')).toBe(buffer)
    }
    r.dispose()
  })

  it('the ground shader is rebuilt only when its detail changes', () => {
    const r = createZoneResources(TIERS.high)
    const v = r.ground.version
    r.configure(TIERS.high)
    expect(r.ground.version).toBe(v)
    r.configure(TIERS.low)
    expect(r.ground.version).toBe(v + 1)
    expect(r.ground.defines).toEqual({ SECONDARY: 0, MARKINGS: 0, PULSE: 0 })
    r.configure(tierConfig('low', true))
    expect(r.ground.version).toBe(v + 1)
    r.dispose()
  })

  it('per-frame updates write uniforms in place', () => {
    const r = createZoneResources(TIERS.medium)
    const u = r.ground.uniforms.uTime!
    r.set(2.5, 0.7, 0.4, 900)
    expect(r.ground.uniforms.uTime).toBe(u)
    expect([u.value, r.ground.uniforms.uPresence!.value, r.ground.uniforms.uPull!.value]).toEqual([
      2.5, 0.7, 0.4,
    ])
    expect(r.motes.uniforms.uScale!.value).toBe(900)
    r.dispose()
  })

  it('dispose frees both geometries and both materials', () => {
    const r = createZoneResources(TIERS.high)
    const freed: string[] = []
    for (const [name, o] of [
      ['ground geometry', r.groundGeometry],
      ['ground material', r.ground],
      ['mote geometry', r.moteGeometry],
      ['mote material', r.motes],
    ] as const)
      o.addEventListener('dispose', () => freed.push(name))
    r.dispose()
    expect(freed.sort()).toEqual([
      'ground geometry',
      'ground material',
      'mote geometry',
      'mote material',
    ])
  })
})
