/**
 * TEZUKA ZONE presentation (Phases D1 and D2, src/players/zone): which state the field
 * shows, from replicated state only; which athlete the attraction is drawn on (the
 * server's `steerTarget`); how the field and the ribbons ease at any frame rate; how much
 * detail each quality step gets; and that every GPU resource is freed.
 */
import { SECRET_LOOK } from '@pickleball/shared'
import { describe, expect, it } from 'vitest'
import {
  BALL_JUMP,
  RATES,
  TIERS,
  VISIBLE_PRESENCE,
  type ZoneFxInfo,
  type ZoneInput,
  type ZoneTarget,
  approach,
  ballJumped,
  logState,
  stepZone,
  tierConfig,
  zoneLevels,
  zoneTarget,
  zoneTier,
} from '../src/players/zone/zoneFx'
import { MAX_PARTICLES, createZoneResources } from '../src/players/zone/zoneResources'
import { MAX_RIBBONS, MAX_STREAM_MOTES } from '../src/players/zone/zoneAttraction'

const ball = (steerX = 0, steerZ = 0, steerTarget = 'me') => ({
  visible: true,
  held: false,
  steerX,
  steerZ,
  steerTarget,
})

/** The secret athlete `me`, in a rally, with the server pulling the ball for them. */
function input(o: Partial<ZoneInput> = {}): ZoneInput {
  return {
    id: 'me',
    look: SECRET_LOOK,
    connected: true,
    focused: true,
    phase: 'rally',
    ball: ball(6, -2),
    ...o,
  }
}
const target = (state: ZoneTarget['state'], pull = 0, dirX = 0, dirZ = 0): ZoneTarget => ({
  state,
  pull,
  dirX,
  dirZ,
})

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

  it('attracting only on the player the server pulls for, while the drawn ball carries it', () => {
    expect(zoneTarget(input())).toEqual({
      state: 'attracting',
      pull: expect.any(Number),
      dirX: expect.any(Number),
      dirZ: expect.any(Number),
    })
    // No pull, a pull for somebody else, or for nobody: just available.
    expect(zoneTarget(input({ ball: ball(0, 0) })).state).toBe('available')
    expect(zoneTarget(input({ ball: ball(6, -2, 'other') })).state).toBe('available')
    expect(zoneTarget(input({ ball: ball(6, -2, '') })).state).toBe('available')
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

  it('the direction is the replicated pull, as a unit vector on the ground', () => {
    const t = zoneTarget(input({ ball: ball(3, -4) }))
    expect(t.dirX).toBeCloseTo(0.6, 12)
    expect(t.dirZ).toBeCloseTo(-0.8, 12)
    expect(zoneTarget(input({ ball: ball(0, 0) }))).toMatchObject({ dirX: 0, dirZ: 0 })
  })

  it('a disconnect, or another court than the one in focus, shows nothing', () => {
    expect(zoneTarget(input({ connected: false })).state).toBe('inactive')
    expect(zoneTarget(input({ focused: false })).state).toBe('inactive')
  })

  it('two secret athletes on a team: only the one the pull is for attracts', () => {
    const b = ball(6, -2, 'a')
    expect(zoneTarget(input({ id: 'a', ball: b })).state).toBe('attracting')
    expect(zoneTarget(input({ id: 'b', ball: b })).state).toBe('available')
    // The target changes: the other one now.
    const c = ball(6, -2, 'b')
    expect(zoneTarget(input({ id: 'a', ball: c })).state).toBe('available')
    expect(zoneTarget(input({ id: 'b', ball: c })).state).toBe('attracting')
    // A partner without the ability never shows a field, even named as the target.
    expect(zoneTarget(input({ id: 'b', look: 'm2', ball: c })).state).toBe('inactive')
  })
})

/** Runs a timeline of targets (and ribbon cuts) through the easing at a given frame rate. */
function run(timeline: [number, ZoneTarget, boolean?][], fps: number, until: number) {
  const l = zoneLevels()
  const out: { t: number; presence: number; pull: number; ribbon: number }[] = []
  const dt = 1 / fps
  for (let t = 0; t < until - 1e-9; t += dt) {
    const [, tg, cut] = [...timeline].reverse().find(([at]) => at <= t + 1e-9)!
    stepZone(l, tg, dt, cut ?? false)
    out.push({ t: t + dt, presence: l.presence, pull: l.pull, ribbon: l.ribbon })
  }
  return out
}
const at = (s: ReturnType<typeof run>, t: number) =>
  s.reduce((a, b) => (Math.abs(b.t - t) < Math.abs(a.t - t) ? b : a))

describe('how the field eases between states', () => {
  const timeline: [number, ZoneTarget][] = [
    [0, target('available')],
    [1, target('attracting', 1, 1, 0)],
    [1.6, target('available')],
    [3, target('inactive')],
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

describe('D2: how the attraction ribbons ease', () => {
  it('rise with the pull, let go faster than it, and keep the last pull direction', () => {
    const s = run(
      [
        [0, target('available')],
        [0.5, target('attracting', 1, 0, 1)],
        [1.5, target('available')],
      ],
      60,
      3,
    )
    expect(at(s, 0.45).ribbon).toBe(0)
    expect(at(s, 0.85).ribbon).toBeGreaterThan(0.9)
    // Gone within 0.4 s of the pull ending, while the field's own pull is still easing.
    expect(at(s, 1.9).ribbon).toBeLessThan(0.02)
    expect(at(s, 1.9).pull).toBeGreaterThan(0.2)
    expect(RATES.ribbonOut).toBeGreaterThan(RATES.pullOut)
    const l = zoneLevels()
    stepZone(l, target('attracting', 1, 0.6, 0.8), 1 / 60)
    stepZone(l, target('available'), 1 / 60)
    expect([l.dirX, l.dirZ]).toEqual([0.6, 0.8])
  })

  it('a reset ball cuts them at once; the field itself stays', () => {
    const l = zoneLevels()
    for (let i = 0; i < 60; i++) stepZone(l, target('attracting', 1, 1, 0), 1 / 60)
    expect(l.ribbon).toBeGreaterThan(0.99)
    stepZone(l, target('attracting', 1, 1, 0), 1 / 60, true)
    expect(l.ribbon).toBe(0)
    expect(l.presence).toBeGreaterThan(0.99)
  })

  it('a disconnect or a departure takes them with the field', () => {
    const s = run(
      [
        [0, target('attracting', 1, 1, 0)],
        [1, target('inactive')],
      ],
      60,
      3,
    )
    expect(at(s, 0.9).ribbon).toBeGreaterThan(0.99)
    expect(at(s, 1.4).ribbon).toBeLessThan(0.02)
    expect(at(s, 2.5).presence).toBeLessThan(VISIBLE_PRESENCE)
  })

  it('the target changes: the old target lets go as the new one takes over', () => {
    // A full-strength pull (12 m/s² or more shows at 1).
    const forA = ball(12, 0, 'a')
    const forB = ball(12, 0, 'b')
    const a = zoneLevels()
    const b = zoneLevels()
    const step = (bl: typeof forA) => {
      stepZone(a, zoneTarget(input({ id: 'a', ball: bl })), 1 / 60)
      stepZone(b, zoneTarget(input({ id: 'b', ball: bl })), 1 / 60)
    }
    for (let i = 0; i < 60; i++) step(forA)
    expect([a.ribbon > 0.9, b.ribbon]).toEqual([true, 0])
    for (let i = 0; i < 24; i++) step(forB)
    expect(a.ribbon).toBeLessThan(0.05)
    expect(b.ribbon).toBeGreaterThan(0.9)
  })

  it('the same at 30, 60 and 144 frames a second', () => {
    const tl: [number, ZoneTarget, boolean?][] = [
      [0, target('available')],
      [0.4, target('attracting', 0.8, 1, 0)],
      [1.2, target('available')],
    ]
    const ref = run(tl, 60, 2)
    for (const fps of [30, 144]) {
      const s = run(tl, fps, 2)
      for (const t of [0.5, 0.7, 1, 1.3, 1.6])
        expect(Math.abs(at(s, t).ribbon - at(ref, t).ribbon), `${fps} fps t=${t}`).toBeLessThan(
          0.15,
        )
    }
  })

  it('a reset is a jump no real shot makes in one frame, at any frame rate', () => {
    expect(ballJumped(BALL_JUMP + 0.1, 1 / 60)).toBe(true)
    // A 25 m/s shot in one frame: never a reset, even at 10 frames a second.
    for (const fps of [144, 60, 30, 10]) expect(ballJumped(25 / fps, 1 / fps), `${fps}`).toBe(false)
    // The ball back in the server's hand from the far court: a reset.
    expect(ballJumped(12, 1 / 30)).toBe(true)
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
    expect(TIERS.low).toEqual({
      secondaryRings: 0,
      markings: false,
      pulse: false,
      particles: 0,
      ribbons: 1,
      streamMotes: 0,
      flow: true,
      shimmer: false,
    })
    expect(TIERS.high.secondaryRings).toBe(2)
    expect(TIERS.medium.secondaryRings).toBe(1)
  })

  it('reduced motion: nothing pulses or drifts, at any step', () => {
    for (const t of ['high', 'medium', 'low'] as const) {
      const c = tierConfig(t, true)
      expect(c.pulse).toBe(false)
      expect(c.particles).toBe(0)
      expect(c.secondaryRings).toBe(TIERS[t].secondaryRings)
      // D2: one still ribbon, no travelling streaks, no flowing motes.
      expect([c.ribbons, c.streamMotes, c.flow, c.shimmer]).toEqual([1, 0, false, false])
    }
  })

  it('D2: fewer ribbons and flowing motes at each step, one ribbon and no motes at the lowest', () => {
    expect([TIERS.high.ribbons, TIERS.medium.ribbons, TIERS.low.ribbons]).toEqual([3, 2, 1])
    expect(TIERS.high.streamMotes).toBeGreaterThan(TIERS.medium.streamMotes)
    expect(TIERS.low.streamMotes).toBe(0)
    expect([TIERS.high.shimmer, TIERS.medium.shimmer]).toEqual([true, false])
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

  it('dispose frees every geometry and material, the attraction included', () => {
    const r = createZoneResources(TIERS.high)
    const freed: string[] = []
    for (const [name, o] of [
      ['ground geometry', r.groundGeometry],
      ['ground material', r.ground],
      ['mote geometry', r.moteGeometry],
      ['mote material', r.motes],
      ['ribbon geometry', r.attraction.ribbonGeometry],
      ['ribbon material', r.attraction.ribbons],
      ['stream geometry', r.attraction.streamGeometry],
      ['stream material', r.attraction.stream],
    ] as const)
      o.addEventListener('dispose', () => freed.push(name))
    r.dispose()
    expect(freed.sort()).toEqual([
      'ground geometry',
      'ground material',
      'mote geometry',
      'mote material',
      'ribbon geometry',
      'ribbon material',
      'stream geometry',
      'stream material',
    ])
  })

  it('D2: one instanced ribbon draw and one fixed mote buffer; a step changes counts only', () => {
    const r = createZoneResources(TIERS.high)
    const a = r.attraction
    const seeds = a.streamGeometry.getAttribute('seed')
    expect(seeds.count).toBe(MAX_STREAM_MOTES)
    expect(MAX_RIBBONS).toBe(3)
    for (const t of ['high', 'medium', 'low'] as const) {
      r.configure(TIERS[t])
      expect(a.ribbonGeometry.instanceCount, t).toBe(TIERS[t].ribbons)
      expect(a.ribbons.uniforms.uRibbons!.value).toBe(TIERS[t].ribbons)
      expect(a.streamGeometry.drawRange.count, t).toBe(TIERS[t].streamMotes)
      expect(a.streamGeometry.getAttribute('seed')).toBe(seeds)
    }
    // The ribbons spread round the ring: one centred, or evenly either side.
    r.configure(TIERS.high)
    const spread = (a.ribbons.uniforms.uSeeds!.value as { x: number }[]).map((v) => v.x)
    expect(spread).toEqual([0.5, 0.18, 0.82])
    r.dispose()
  })

  it('D2: the ribbon shader is rebuilt only when its variant changes', () => {
    const r = createZoneResources(TIERS.high)
    const a = r.attraction
    expect(a.ribbons.defines).toEqual({ FLOW: 1, SHIMMER: 1 })
    const v = a.ribbons.version
    r.configure(TIERS.high)
    expect(a.ribbons.version).toBe(v)
    r.configure(TIERS.medium)
    expect(a.ribbons.defines).toEqual({ FLOW: 1, SHIMMER: 0 })
    r.configure(TIERS.low)
    expect(a.ribbons.version).toBe(v + 1)
    r.configure(tierConfig('high', true))
    expect(a.ribbons.defines).toEqual({ FLOW: 0, SHIMMER: 0 })
    r.dispose()
  })

  it('D2: ribbons and motes share one set of uniforms, written in place', () => {
    const r = createZoneResources(TIERS.high)
    const a = r.attraction
    expect(a.stream.uniforms.uBall).toBe(a.ribbons.uniforms.uBall)
    expect(a.ribbons.uniforms.uBall!.value).toBe(a.ball)
    const dir = a.ribbons.uniforms.uDir!.value as { x: number; y: number }
    a.set(1.5, 0.8, 0.9, 0.6, -0.8, 700)
    expect(a.ribbons.uniforms.uDir!.value).toBe(dir)
    expect([dir.x, dir.y]).toEqual([0.6, -0.8])
    expect(a.stream.uniforms.uLevel!.value).toBe(0.8)
    expect(a.stream.uniforms.uScale!.value).toBe(700)
    r.dispose()
  })
})
