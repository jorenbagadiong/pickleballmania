import {
  COURT,
  FIXED_DT,
  type FxEvent,
  type PracticeDrill,
  type PracticeLevel,
} from '@pickleball/shared'
import { describe, expect, it } from 'vitest'
import type { SimPlayer } from '../src/simulation/GameSimulation'
import { COACH_ID, PracticeSimulation } from '../src/simulation/PracticeSimulation'

function seeded(seed = 1): () => number {
  let s = seed
  return () => {
    s = (s * 16807) % 2147483647
    return (s - 1) / 2147483646
  }
}

function training(drill: PracticeDrill, level: PracticeLevel = 'easy', seed = 1) {
  const sim = new PracticeSimulation(seeded(seed))
  const me = sim.addPlayer('me', 'Ann') as SimPlayer
  sim.step(FIXED_DT)
  sim.setDrill({ drill, level })
  sim.step(FIXED_DT)
  return { sim, me }
}

/** A trainee who runs to the ball, lets it bounce and hits it back. */
function play(sim: PracticeSimulation, me: SimPlayer, seconds: number): FxEvent[] {
  const fx: FxEvent[] = []
  for (let t = 0; t < seconds; t += FIXED_DT) {
    if (sim.phase === 'serving' && sim.serverId === 'me') {
      sim.requestServe('me', { ax: -Math.sign(me.x) * 2, az: -4.6, spin: 0 })
    }
    if (sim.phase === 'rally' && sim.lastHitSlot === 1) {
      me.x += Math.max(-0.1, Math.min(0.1, sim.ball.x - me.x))
      me.z = 6.2
      if (sim.ballBounced && sim.ball.z > 5.2) {
        sim.requestSwing('me', { ax: 0, az: -4.5, power: 0.35, spin: 0, viewTick: sim.tick })
      }
    }
    fx.push(...sim.step(FIXED_DT))
  }
  return fx
}

describe('solo training', () => {
  it('starts at once with a coach, and nobody else fits in', () => {
    const { sim, me } = training('machine')
    expect(me.slot).toBe(0)
    expect(sim.players.get(COACH_ID)?.slot).toBe(1)
    expect(sim.isFull).toBe(true)
    expect(sim.addPlayer('x', 'Other')).toBeNull()
    expect(sim.phase).toBe('serving')
  })

  it('the trainee leaving takes the coach along', () => {
    const { sim } = training('machine')
    sim.removePlayer('me')
    expect(sim.players.size).toBe(0)
  })

  for (const level of ['easy', 'medium', 'hard'] as const) {
    it(`the ball machine (${level}) keeps feeding balls that land in`, () => {
      const { sim } = training('machine', level)
      const fx: FxEvent[] = []
      for (let t = 0; t < 60; t += FIXED_DT) fx.push(...sim.step(FIXED_DT))
      const feeds = fx.filter((e) => e.kind === 'hit')
      expect(feeds.length).toBeGreaterThan(10)
      expect(feeds.every((e) => e.kind === 'hit' && e.id === COACH_ID)).toBe(true)
      const bounces = fx.filter((e) => e.kind === 'bounce')
      expect(bounces.every((e) => e.kind === 'bounce' && e.z > 0)).toBe(true)
      expect(fx.some((e) => e.kind === 'net')).toBe(false)
      expect(sim.lastRally?.reason).toBe('Double bounce')
    })
  }

  it('only the hard machine curves the ball', () => {
    const spins = (level: PracticeLevel) => {
      const { sim } = training('machine', level)
      const fx: FxEvent[] = []
      for (let t = 0; t < 60; t += FIXED_DT) fx.push(...sim.step(FIXED_DT))
      return fx.some((e) => e.kind === 'hit' && e.spin !== 0)
    }
    expect(spins('easy')).toBe(false)
    expect(spins('hard')).toBe(true)
  })

  it('machine balls can be hit, and landing in ends the rally as a success', () => {
    const { sim, me } = training('machine')
    const fx = play(sim, me, 40)
    expect(fx.filter((e) => e.kind === 'hit' && e.id === 'me').length).toBeGreaterThan(5)
    expect(sim.scores[0]).toBeGreaterThan(5)
    expect(sim.lastRally?.reason).toBe('In!')
  })

  it('the serve drill gives one serve after another, and the coach lets them go', () => {
    const { sim, me } = training('serve')
    const fx = play(sim, me, 40)
    const hits = fx.filter((e) => e.kind === 'hit')
    expect(hits.length).toBeGreaterThan(8)
    expect(hits.every((e) => e.kind === 'hit' && e.id === 'me')).toBe(true)
    expect(sim.scores[0]).toBeGreaterThan(8)
  })

  it('the serves alternate between the two sides', () => {
    const { sim, me } = training('serve')
    const serves = play(sim, me, 30).filter((e) => e.kind === 'hit')
    const sides = new Set(serves.map((e) => Math.sign(e.x)))
    expect(sides.size).toBe(2)
  })

  for (const level of ['easy', 'medium', 'hard'] as const) {
    it(`the coach (${level}) plays rallies and serves every other one`, () => {
      const { sim, me } = training('rally', level)
      const fx = play(sim, me, 90)
      const coach = fx.filter((e) => e.kind === 'hit' && e.id === COACH_ID)
      const mine = fx.filter((e) => e.kind === 'hit' && e.id === 'me')
      expect(coach.length).toBeGreaterThan(10)
      expect(mine.length).toBeGreaterThan(10)
      expect(Math.abs(sim.players.get(COACH_ID)!.x)).toBeLessThan(COURT.halfWidth + 4)
    })
  }

  it('no game is ever won', () => {
    const { sim, me } = training('serve')
    play(sim, me, 90)
    expect(sim.scores[0]).toBeGreaterThan(12)
    expect(sim.gameWinner).toBeNull()
    expect(['serving', 'rally', 'pointOver']).toContain(sim.phase)
  })

  it('switching drill starts over; nonsense is ignored', () => {
    const { sim, me } = training('serve')
    play(sim, me, 20)
    sim.setDrill({ drill: 'rally', level: 'impossible' })
    sim.setDrill(null)
    sim.setDrill({ drill: 'nope', level: 'easy' })
    expect(sim.drill).toBe('serve')
    sim.setDrill({ drill: 'rally', level: 'hard' })
    sim.step(FIXED_DT)
    expect(sim.drill).toBe('rally')
    expect(sim.scores).toEqual([0, 0])
    expect(sim.phase).toBe('serving')
  })

  it('pauses while the trainee is disconnected and carries on after', () => {
    const { sim, me } = training('machine')
    sim.setConnected('me', false)
    sim.setDrill({ drill: 'serve', level: 'easy' })
    sim.step(FIXED_DT)
    expect(sim.phase).toBe('paused')
    sim.setConnected('me', true)
    sim.step(FIXED_DT)
    expect(sim.phase).toBe('serving')
    expect(play(sim, me, 5).some((e) => e.kind === 'hit')).toBe(true)
  })

  it('says how early or late a click was', () => {
    const { sim, me } = training('machine')
    const hits = play(sim, me, 20).filter((e) => e.kind === 'hit' && e.id === 'me')
    for (const h of hits) if (h.kind === 'hit') expect(Math.abs(h.timing)).toBeLessThan(0.6)
  })
})
