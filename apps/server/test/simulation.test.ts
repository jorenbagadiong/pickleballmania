import {
  COURT,
  FIXED_DT,
  type FxEvent,
  PLAYER_SPEED,
  REACH_RADIUS,
  isOnFire,
  reachDistance,
} from '@pickleball/shared'
import { describe, expect, it } from 'vitest'
import { GameSimulation, type SimPlayer } from '../src/simulation/GameSimulation'

/** Deterministic RNG so aim scatter is reproducible. */
function seeded(seed = 1): () => number {
  let s = seed
  return () => {
    s = (s * 16807) % 2147483647
    return (s - 1) / 2147483646
  }
}

function readyMatch(): { sim: GameSimulation; a: SimPlayer; b: SimPlayer } {
  const sim = new GameSimulation(1, seeded())
  const a = sim.addPlayer('a', 'Alice') as SimPlayer
  const b = sim.addPlayer('b', 'Bob') as SimPlayer
  sim.setReady('a', true)
  sim.setReady('b', true)
  return { sim, a, b }
}

function stepUntil(sim: GameSimulation, done: (fx: FxEvent[]) => boolean, max = 600): FxEvent[] {
  const all: FxEvent[] = []
  for (let i = 0; i < max; i++) {
    const fx = sim.step(FIXED_DT)
    all.push(...fx)
    if (done(fx)) return all
  }
  throw new Error('condition not reached')
}

describe('GameSimulation roster and phases', () => {
  it('seats exactly two players on opposite sides', () => {
    const sim = new GameSimulation()
    const a = sim.addPlayer('a', 'Alice')
    const b = sim.addPlayer('b', 'Bob')
    expect(a?.slot).toBe(0)
    expect(b?.slot).toBe(1)
    expect(a!.z).toBeGreaterThan(0)
    expect(b!.z).toBeLessThan(0)
    expect(sim.addPlayer('c', 'Carol')).toBeNull()
    expect(sim.phase).toBe('lobby')
  })

  it('starts serving once both are ready', () => {
    const { sim, a } = readyMatch()
    expect(sim.phase).toBe('serving')
    expect(sim.ball.held).toBe(true)
    expect(a.z).toBeGreaterThan(COURT.halfLength) // server behind the baseline
  })

  it('pauses on disconnect and resumes on reconnect', () => {
    const { sim } = readyMatch()
    sim.setConnected('b', false)
    expect(sim.phase).toBe('paused')
    sim.setConnected('b', true)
    expect(sim.phase).toBe('serving')
  })

  it('returns to waiting and resets when a player leaves, freeing the slot', () => {
    const { sim, a } = readyMatch()
    sim.scores[0] = 3
    sim.removePlayer('b')
    expect(sim.phase).toBe('waiting')
    expect(sim.scores[0]).toBe(0)
    expect(a.ready).toBe(false)
    expect(sim.addPlayer('c', 'Carol')?.slot).toBe(1)
  })
})

describe('GameSimulation inputs', () => {
  it('applies queued inputs, acknowledges seq, and rejects replays', () => {
    const sim = new GameSimulation()
    const a = sim.addPlayer('a', 'Alice') as SimPlayer
    const startX = a.x
    sim.queueInputs('a', { frames: [{ seq: 1, mx: 1, mz: 0, ax: 0, az: -3 }] })
    sim.queueInputs('a', { frames: [{ seq: 1, mx: 1, mz: 0, ax: 0, az: -3 }] }) // replay
    sim.step(FIXED_DT)
    sim.step(FIXED_DT)
    expect(a.lastSeq).toBe(1)
    expect(a.x).toBeGreaterThan(startX)
    expect(a.x).toBeLessThanOrEqual(startX + PLAYER_SPEED * FIXED_DT)
  })

  it('rate-limits inputs so a client cannot move faster by flooding', () => {
    const sim = new GameSimulation()
    const a = sim.addPlayer('a', 'Alice') as SimPlayer
    const frames = Array.from({ length: 20 }, (_, i) => ({
      seq: i + 1,
      mx: 1,
      mz: 0,
      ax: 0,
      az: -3,
    }))
    sim.queueInputs('a', { frames })
    sim.step(FIXED_DT)
    expect(a.lastSeq).toBeLessThanOrEqual(8)
  })

  it('flooding for a long time gains at most the 10% catch-up allowance', () => {
    const { sim, a } = readyMatch()
    const ticks = 600
    let seq = 0
    let total = 0
    for (let t = 0; t < ticks; t++) {
      const frames = Array.from({ length: 5 }, () => ({ seq: ++seq, mx: 1, mz: 0, ax: 0, az: 0 }))
      sim.queueInputs('a', { frames })
      const queued = a.queue.length
      sim.step(FIXED_DT)
      total += queued - a.queue.length
    }
    expect(total).toBeLessThanOrEqual(ticks * 1.1 + 31)
  })

  it('catches up after a network stall instead of staying behind for good', () => {
    const { sim, a } = readyMatch()
    let seq = 0
    const held: { seq: number; mx: number; mz: number; ax: number; az: number }[] = []
    for (let t = 0; t < 360; t++) {
      held.push({ seq: ++seq, mx: 0, mz: 0, ax: 0, az: 0 })
      const stalled = t >= 120 && t < 145 // ~400 ms with nothing arriving
      if (!stalled) sim.queueInputs('a', { frames: held.splice(0, 20) })
      sim.step(FIXED_DT)
    }
    expect(a.queue.length).toBeLessThanOrEqual(1)
  })

  it('catches up after the server itself hitches and loses ticks', () => {
    const { sim, a } = readyMatch()
    let seq = 0
    for (let t = 0; t < 600; t++) {
      sim.queueInputs('a', { frames: [{ seq: ++seq, mx: 0, mz: 0, ax: 0, az: 0 }] })
      const hitch = t % 200 >= 100 && t % 200 < 115 // 250 ms of lost ticks, three times
      if (!hitch) sim.step(FIXED_DT)
    }
    expect(a.queue.length).toBeLessThanOrEqual(1)
  })

  it('ignores malformed messages', () => {
    const sim = new GameSimulation()
    sim.addPlayer('a', 'Alice')
    expect(() => {
      sim.queueInputs('a', null)
      sim.queueInputs('a', { frames: 'nope' })
      sim.queueInputs('a', { frames: [null, { seq: 'x' }] })
      sim.requestSwing('a', 'garbage')
      sim.requestServe('a', undefined)
      sim.setReady('a', 'yes')
      sim.step(FIXED_DT)
    }).not.toThrow()
  })
})

describe('GameSimulation rally', () => {
  it('only the serving player can serve', () => {
    const { sim } = readyMatch()
    sim.requestServe('b', { ax: 1.5, az: 4 })
    expect(sim.phase).toBe('serving')
  })

  it('serve, return, and a winner by double bounce', () => {
    const { sim, a, b } = readyMatch()
    // Alice (slot 0, +z) serves from the right (+x) to the diagonal box (-x, -z).
    sim.requestServe('a', { ax: -1.5, az: -4.5 })
    expect(sim.phase).toBe('rally')
    expect(sim.ball.vz).toBeLessThan(0)

    // First bounce in the service box keeps the rally alive.
    stepUntil(sim, (fx) => fx.some((e) => e.kind === 'bounce'))
    expect(sim.phase).toBe('rally')

    // Bob moves under the ball and swings back toward Alice's court.
    stepUntil(sim, () => sim.ball.vy < 0 && sim.ball.y < 1.0)
    b.x = sim.ball.x
    b.z = sim.ball.z - 0.4
    sim.requestSwing('b', { ax: 1, az: 4, power: 0.5 })
    stepUntil(sim, () => sim.lastHitSlot === 1, 20)
    expect(sim.ball.vz).toBeGreaterThan(0)

    // Alice does not return it → Bob wins the rally. He wasn't serving, so it's a
    // side out: no point, but he serves next.
    a.x = -COURT.halfWidth - 2 // well out of reach
    stepUntil(sim, () => sim.phase === 'pointOver')
    expect(sim.scores).toEqual([0, 0])
    expect(sim.servingSlot).toBe(1)
    expect(sim.lastRally).toMatchObject({ winner: 1, reason: 'Double bounce' })
    expect(sim.lastRally?.detail).toMatch(/Alice/)
    expect(sim.lastRally?.result).toMatch(/Side out.*Bob serves/)

    // After the pause, Bob serves.
    stepUntil(sim, () => sim.phase === 'serving', 400)
    expect(sim.ball.held).toBe(true)
  })

  /**
   * Sets up a ball passing straight through Bob after the serve bounces, steps
   * until it has left his reach, waits `extraTicks`, then swings.
   */
  function lateSwing(extraTicks: number, viewTick: 'seen' | 'none'): number {
    const { sim, b } = readyMatch()
    sim.requestServe('a', { ax: -1.5, az: -4.5 })
    stepUntil(sim, (fx) => fx.some((e) => e.kind === 'bounce'))
    b.x = sim.ball.x + sim.ball.vx * 0.1
    b.z = sim.ball.z + sim.ball.vz * 0.1
    let seen = -1
    let best = Infinity
    stepUntil(sim, () => {
      const d = Math.hypot(sim.ball.x - b.x, sim.ball.z - b.z)
      if (d < best) {
        best = d
        seen = sim.tick
      }
      return seen > 0 && d > 1.9
    })
    for (let i = 0; i < extraTicks; i++) sim.step(FIXED_DT)
    expect(sim.phase).toBe('rally')
    sim.requestSwing('b', {
      ax: 0,
      az: 4,
      power: 0.35,
      ...(viewTick === 'seen' ? { viewTick: seen } : {}),
    })
    return sim.lastHitSlot
  }

  it('a late swing hits if the player clicked while seeing the ball in reach', () => {
    expect(lateSwing(4, 'seen')).toBe(1)
  })

  it('a late swing without view information misses once the ball is gone', () => {
    expect(lateSwing(20, 'none')).toBe(0)
  })

  it('swings cannot claim to have happened more than 0.5 s ago', () => {
    const { sim, b } = readyMatch()
    for (let i = 0; i < 100; i++) sim.step(FIXED_DT)
    sim.requestSwing('b', { ax: 0, az: 4, power: 0.35, viewTick: 0 })
    expect(b.swing?.viewTick).toBe(sim.tick - 30)
  })

  it('a player can hit while running at full speed, and keeps running', () => {
    const { sim, b } = readyMatch()
    sim.requestServe('a', { ax: -1.5, az: -4.5 })
    stepUntil(sim, (fx) => fx.some((e) => e.kind === 'bounce'))
    b.x = sim.ball.x - 1.5
    b.z = sim.ball.z - 0.8
    let seq = 0
    const run = (): void => {
      sim.queueInputs('b', { frames: [{ seq: ++seq, mx: 1, mz: 0, ax: 0, az: 4 }] })
      sim.step(FIXED_DT)
    }
    for (let i = 0; i < 6; i++) run()
    sim.requestSwing('b', { ax: 0, az: 4, power: 0.35, viewTick: sim.tick })
    const x0 = b.x
    for (let i = 0; i < 10; i++) run()
    expect(sim.lastHitSlot).toBe(1)
    expect(b.x - x0).toBeGreaterThan(PLAYER_SPEED * FIXED_DT * 10 * 0.5) // not slowed by the swing
    expect(b.vx).toBeGreaterThan(PLAYER_SPEED * 0.95)
  })

  it('a swing out of reach does not hit', () => {
    const { sim, b } = readyMatch()
    sim.requestServe('a', { ax: -1.5, az: -4.5 })
    b.x = COURT.halfWidth + 2
    sim.requestSwing('b', { ax: 0, az: 4, power: 1 })
    expect(sim.lastHitSlot).toBe(0)
  })

  it('a serve into the wrong box is a fault', () => {
    const { sim } = readyMatch()
    sim.requestServe('a', { ax: 1.8, az: -4.5 })
    stepUntil(sim, () => sim.phase === 'pointOver')
    expect(sim.scores).toEqual([0, 0]) // receivers can't score
    expect(sim.servingSlot).toBe(1)
    expect(sim.lastRally?.detail).toMatch(/Alice.*service box/)
  })
})

describe('GameSimulation 2v2 (doubles)', () => {
  function doubles(): { sim: GameSimulation; ids: string[] } {
    const sim = new GameSimulation(2, seeded(7))
    const ids = ['a', 'b', 'c', 'd']
    for (const id of ids) sim.addPlayer(id, id.toUpperCase())
    return { sim, ids }
  }

  function readyAll(sim: GameSimulation, ids: string[]): void {
    for (const id of ids) sim.setReady(id, true)
  }

  it('seats four players, two per side, and refuses a fifth', () => {
    const { sim } = doubles()
    expect(sim.team(0).map((p) => p.id)).toEqual(['a', 'c'])
    expect(sim.team(1).map((p) => p.id)).toEqual(['b', 'd'])
    expect(sim.team(0).map((p) => p.spot)).toEqual([0, 1])
    for (const p of sim.team(0)) expect(p.z).toBeGreaterThan(0)
    for (const p of sim.team(1)) expect(p.z).toBeLessThan(0)
    expect(sim.addPlayer('e', 'E')).toBeNull()
    expect(sim.phase).toBe('lobby')
  })

  it('waits until all four have joined', () => {
    const sim = new GameSimulation(2)
    sim.addPlayer('a', 'A')
    sim.addPlayer('b', 'B')
    sim.setReady('a', true)
    sim.setReady('b', true)
    expect(sim.phase).toBe('waiting')
    expect(sim.message).toMatch(/2 more players/)
  })

  it('lets players switch team before the match, only into a free seat', () => {
    const sim = new GameSimulation(2)
    sim.addPlayer('a', 'A')
    sim.addPlayer('b', 'B')
    sim.addPlayer('c', 'C') // team 0, spot 1
    sim.switchTeam('c', { team: 1 })
    expect(sim.players.get('c')?.slot).toBe(1)
    expect(sim.players.get('c')?.z).toBeLessThan(0)
    sim.addPlayer('d', 'D') // smaller team is now team 0
    expect(sim.players.get('d')?.slot).toBe(0)
    sim.switchTeam('d', { team: 1 }) // team 1 is full
    expect(sim.players.get('d')?.slot).toBe(0)
    readyAll(sim, ['a', 'b', 'c', 'd'])
    sim.switchTeam('a', { team: 1 }) // match started: not allowed
    expect(sim.players.get('a')?.slot).toBe(0)
  })

  /** Ends the current rally with a serve fault (serving side loses it). */
  function serveFault(sim: GameSimulation): void {
    const server = sim.players.get(sim.serverId!)!
    // Straight ahead instead of diagonal: always the wrong box.
    sim.requestServe(server.id, {
      ax: Math.sign(server.x) * 1.8,
      az: -Math.sign(server.z) * 4.5,
    })
    stepUntil(sim, () => sim.phase === 'serving', 900)
  }

  /** Ends the current rally with an unreturned serve (serving side wins it). */
  function ace(sim: GameSimulation): void {
    const server = sim.players.get(sim.serverId!)!
    sim.requestServe(server.id, {
      ax: -Math.sign(server.x) * 1.5,
      az: -Math.sign(server.z) * 4.5,
    })
    stepUntil(sim, () => sim.phase === 'serving' || sim.phase === 'gameOver', 900)
  }

  it('rotates servers: one server at the start, then both partners, then side out', () => {
    const { sim, ids } = doubles()
    readyAll(sim, ids)
    expect([sim.serverId, sim.serverNumber]).toEqual(['a', 2])
    expect(sim.message).toContain('0–0–2')
    sim.requestServe('c', { ax: -1.5, az: -4.5 }) // partner can't serve
    expect(sim.phase).toBe('serving')

    serveFault(sim) // the opening team only gets one server
    expect([sim.servingSlot, sim.serverId, sim.serverNumber]).toEqual([1, 'b', 1])
    expect(sim.scores).toEqual([0, 0])
    expect(sim.players.get('b')!.z).toBeLessThan(-COURT.halfLength)

    serveFault(sim) // second server, from the other court
    expect([sim.servingSlot, sim.serverId, sim.serverNumber]).toEqual([1, 'd', 2])

    serveFault(sim) // side out back to team 0, right-hand player first
    expect([sim.servingSlot, sim.serverId, sim.serverNumber]).toEqual([0, 'a', 1])
  })

  it('the same server keeps serving and swaps courts after scoring', () => {
    const { sim, ids } = doubles()
    readyAll(sim, ids)
    const x0 = sim.players.get('a')!.x
    expect(sim.receiverId).toBe('b')
    ace(sim)
    expect(sim.scores).toEqual([1, 0])
    expect(sim.serverId).toBe('a')
    expect(Math.sign(sim.players.get('a')!.x)).toBe(-Math.sign(x0))
    expect(Math.sign(sim.players.get('c')!.x)).toBe(Math.sign(x0))
    expect(sim.receiverId).toBe('d') // now the other receiver is diagonal
  })

  it('wins at 11 by 2, then a rematch starts once everyone is ready', () => {
    const { sim, ids } = doubles()
    readyAll(sim, ids)
    sim.scores[0] = 10
    sim.scores[1] = 10
    ace(sim)
    expect(sim.scores).toEqual([11, 10]) // not enough: must win by 2
    expect(sim.phase).toBe('serving')
    ace(sim)
    expect(sim.scores).toEqual([12, 10])
    expect(sim.phase).toBe('gameOver')
    expect(sim.gameWinner).toBe(0)
    expect(sim.players.get('a')!.ready).toBe(false)

    readyAll(sim, ['a', 'b', 'c'])
    expect(sim.phase).toBe('gameOver')
    readyAll(sim, ['d'])
    expect(sim.phase).toBe('serving')
    expect(sim.scores).toEqual([0, 0])
    expect(sim.servingSlot).toBe(1) // losers start the rematch
  })

  it('partners cannot hit the ball twice in a row for their team', () => {
    const { sim, ids } = doubles()
    readyAll(sim, ids)
    sim.requestServe('a', { ax: -1.5, az: -4.5 })
    stepUntil(sim, (fx) => fx.some((e) => e.kind === 'bounce'))
    stepUntil(sim, () => sim.ball.vy < 0 && sim.ball.y < 1.0)
    // B returns it…
    const b = sim.players.get('b')!
    b.x = sim.ball.x
    b.z = sim.ball.z - 0.4
    sim.requestSwing('b', { ax: 1, az: 4, power: 0.35 })
    stepUntil(sim, () => sim.lastHitSlot === 1, 20)
    // …and partner D, standing right at the ball, cannot hit it again for team 1.
    sim.step(FIXED_DT)
    const d = sim.players.get('d')!
    d.x = sim.ball.x
    d.z = Math.min(sim.ball.z - 0.3, -0.5)
    sim.requestSwing('d', { ax: 1, az: 4, power: 0.35 })
    expect(sim.ball.vz).toBeGreaterThan(0) // still heading to team 0
    expect(sim.rallyShots).toBe(2)
  })

  it('a leaving player returns the room to waiting and resets team scores', () => {
    const { sim, ids } = doubles()
    readyAll(sim, ids)
    sim.scores[1] = 4
    sim.removePlayer('c')
    expect(sim.phase).toBe('waiting')
    expect(sim.scores).toEqual([0, 0])
    expect(sim.addPlayer('e', 'E')?.slot).toBe(0)
  })
})

describe('GameSimulation pickleball rules', () => {
  /** A rally past the two-bounce stage with a ball floating toward Bob, unbounced. */
  function volleyChance(bobZ: number, ball = { y: 1.4, dz: 0.8, vy: 0.5, vz: -2 }) {
    const { sim, a, b } = readyMatch()
    sim.requestServe('a', { ax: -1.5, az: -4.5 })
    stepUntil(sim, (fx) => fx.some((e) => e.kind === 'bounce'))
    // Return and third shot happened; Alice (team 0) hit last.
    const tracker = (sim as unknown as { rally: { onHit(s: 0 | 1): void } }).rally
    tracker.onHit(1)
    tracker.onHit(0)
    b.x = 0
    b.z = bobZ
    Object.assign(sim.ball, {
      x: 0.2,
      y: ball.y,
      z: bobZ + ball.dz,
      vx: 0,
      vy: ball.vy,
      vz: ball.vz,
    })
    return { sim, a, b }
  }

  it('two-bounce rule: an early swing at a serve waits for the bounce', () => {
    const { sim, b } = readyMatch()
    sim.requestServe('a', { ax: -1.5, az: -4.5 })
    stepUntil(sim, () => sim.ball.z < -2.5 && sim.ball.y < 1.2)
    expect(sim.ballBounced).toBe(false)
    b.x = sim.ball.x
    b.z = sim.ball.z - 0.8
    sim.requestSwing('b', { ax: 0, az: 4, power: 0.35, viewTick: sim.tick })
    expect(sim.lastHitSlot).toBe(0) // right there, but it has not bounced
    expect(sim.phase).toBe('rally') // and it is not a fault either
  })

  it('a volley outside the kitchen is legal', () => {
    const { sim } = volleyChance(-4)
    sim.requestSwing('b', { ax: 0, az: 4, power: 0.35, viewTick: sim.tick })
    stepUntil(sim, () => sim.lastHitSlot === 1, 20)
    expect(sim.phase).toBe('rally')
  })

  it('a volley from inside the kitchen is a fault, with the reason', () => {
    const { sim } = volleyChance(-1.5)
    sim.requestSwing('b', { ax: 0, az: 4, power: 0.35, viewTick: sim.tick })
    stepUntil(sim, () => sim.phase === 'pointOver', 20)
    expect(sim.lastRally).toMatchObject({ winner: 0, reason: 'Kitchen fault' })
    expect(sim.lastRally?.detail).toMatch(/Bob/)
    expect(sim.scores).toEqual([1, 0]) // Alice was serving
  })

  it('in the kitchen, clicking just before the bounce waits and plays it legally', () => {
    const { sim } = volleyChance(-1.8, { y: 0.3, dz: 0.5, vy: -2, vz: -0.5 })
    sim.requestSwing('b', { ax: 0, az: 4, power: 0.35, viewTick: sim.tick })
    expect(sim.phase).toBe('rally')
    stepUntil(sim, () => sim.lastHitSlot === 1, 30)
    expect(sim.phase).toBe('rally')
  })

  it('stepping into the kitchen right after a volley is a fault', () => {
    const { sim, b } = volleyChance(-COURT.kitchenDepth - 0.3)
    sim.requestSwing('b', { ax: 0, az: 4, power: 0.35, viewTick: sim.tick })
    stepUntil(sim, () => sim.lastHitSlot === 1, 20)
    b.z = -COURT.kitchenDepth + 0.2
    sim.step(FIXED_DT)
    expect(sim.phase).toBe('pointOver')
    expect(sim.lastRally?.detail).toMatch(/stepped into the kitchen/)
  })
})

describe('GameSimulation fire streaks', () => {
  /** Server aces: the serving player wins the rally with their own shot. */
  function ace(sim: GameSimulation): void {
    const server = sim.players.get(sim.serverId!)!
    sim.requestServe(server.id, {
      ax: -Math.sign(server.x) * 1.5,
      az: -Math.sign(server.z) * 4.5,
    })
    stepUntil(sim, () => sim.phase === 'serving', 900)
  }

  function fault(sim: GameSimulation): void {
    const server = sim.players.get(sim.serverId!)!
    sim.requestServe(server.id, {
      ax: Math.sign(server.x) * 1.8,
      az: -Math.sign(server.z) * 4.5,
    })
    stepUntil(sim, () => sim.phase === 'serving', 900)
  }

  it('builds one per rally won and catches fire at three', () => {
    const { sim, a, b } = readyMatch()
    ace(sim)
    ace(sim)
    expect([a.streak, isOnFire(a.streak)]).toEqual([2, false])
    ace(sim)
    expect([a.streak, isOnFire(a.streak)]).toEqual([3, true])
    expect(sim.lastRally?.ignited).toBe('Alice')
    ace(sim)
    expect(sim.lastRally?.ignited).toBe('') // announced once
    expect(b.streak).toBe(0)
  })

  it('goes out when their side loses a rally, and is not given for a free point', () => {
    const { sim, a, b } = readyMatch()
    for (let i = 0; i < 3; i++) ace(sim)
    fault(sim)
    expect(a.streak).toBe(0)
    expect(b.streak).toBe(0) // Bob never hit the ball
  })

  it('in doubles only the player who hit the winning shot builds a streak', () => {
    const sim = new GameSimulation(2, seeded(7))
    for (const id of ['a', 'b', 'c', 'd']) sim.addPlayer(id, id)
    for (const id of ['a', 'b', 'c', 'd']) sim.setReady(id, true)
    for (let i = 0; i < 3; i++) ace(sim)
    expect(sim.players.get('a')!.streak).toBe(3)
    expect(sim.players.get('c')!.streak).toBe(0)
  })

  it('starts cold in a new game', () => {
    const { sim, a } = readyMatch()
    for (let i = 0; i < 3; i++) ace(sim)
    sim.setReady('a', false) // back to the lobby
    sim.setReady('a', true)
    expect(a.streak).toBe(0)
  })
})

describe('GameSimulation hit box', () => {
  /** Alice's shot flies straight past Bob; he clicks `offset` ticks from its closest point. */
  function passingBall(offset: number, lag = 0) {
    const setup = () => {
      const m = readyMatch()
      m.sim.requestServe('a', { ax: -1.5, az: -4.5 })
      stepUntil(m.sim, (fx) => fx.some((e) => e.kind === 'bounce'))
      const tracker = (m.sim as unknown as { rally: { onHit(s: 0 | 1): void } }).rally
      tracker.onHit(1)
      tracker.onHit(0)
      m.b.x = 0
      m.b.z = -5
      Object.assign(m.sim.ball, { x: 0.6, y: 1.2, z: -1, vx: 0, vy: 2.2, vz: -8 })
      ;(m.sim as unknown as { history: unknown[] }).history.length = 0
      return m
    }
    // Where is the closest point?
    const probe = setup()
    const t0 = probe.sim.tick
    let best = Infinity
    let bestTick = 0
    for (let i = 0; i < 45; i++) {
      probe.sim.step(FIXED_DT)
      const d = Math.hypot(probe.sim.ball.x, probe.sim.ball.z + 5)
      if (d < best) {
        best = d
        bestTick = probe.sim.tick - t0
      }
    }
    const m = setup()
    const click = bestTick + offset
    let hit: Extract<FxEvent, { kind: 'hit' }> | undefined
    for (let i = 1; i < 70 && !hit; i++) {
      for (const e of m.sim.step(FIXED_DT)) if (e.kind === 'hit') hit = e
      if (i === click + lag) {
        m.sim.requestSwing('b', { ax: 0, az: 4, power: 0.35, viewTick: m.sim.tick - lag })
      }
    }
    return { hit, gap: hit ? Math.hypot(hit.x - m.b.x, hit.z - m.b.z) : Infinity, z: hit?.z }
  }

  it('an early click meets the ball beside the player, not at the edge of reach', () => {
    for (const early of [-6, -10, -14]) expect(passingBall(early).gap).toBeLessThan(0.8)
  })

  it('a lagged click hits where the player saw the ball, not behind them', () => {
    for (const lag of [6, 10, 14]) {
      const r = passingBall(0, lag)
      expect(r.gap).toBeLessThan(0.8)
      expect(r.z!).toBeGreaterThan(-5.5)
    }
  })

  it('rewards perfect timing, judged by what the player saw', () => {
    expect(passingBall(0).hit?.perfect).toBe(true)
    expect(passingBall(0, 10).hit?.perfect).toBe(true)
    expect(passingBall(-12).hit?.perfect).toBe(false)
  })

  it('reaches the same distance all the way round, including behind the back', () => {
    for (const side of [1, -1] as const) {
      const me = { x: 0.5, z: 5 * side }
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
        const at = (r: number) => ({ x: me.x + Math.cos(a) * r, y: 1, z: me.z + Math.sin(a) * r })
        expect(reachDistance(me, side, at(REACH_RADIUS - 0.05))).not.toBeNull()
        expect(reachDistance(me, side, at(REACH_RADIUS + 0.05))).toBeNull()
      }
      expect(reachDistance(me, side, { x: 0.5, y: 2.6, z: 5 * side })).toBeNull()
    }
  })

  it('a ball behind the player can be hit', () => {
    const { sim, b } = readyMatch()
    sim.requestServe('a', { ax: -1.5, az: -4.5 })
    stepUntil(sim, (fx) => fx.some((e) => e.kind === 'bounce'))
    stepUntil(sim, () => sim.ball.vy < 0)
    b.x = sim.ball.x
    b.z = sim.ball.z + 1.1 // the ball is 1.1 m behind Bob (toward his baseline)
    sim.requestSwing('b', { ax: 0, az: 4, power: 0.35, viewTick: sim.tick })
    stepUntil(sim, () => sim.lastHitSlot === 1, 5)
  })
})

describe('GameSimulation consecutive swings', () => {
  function midRally() {
    const m = readyMatch()
    m.sim.requestServe('a', { ax: -1.5, az: -4.5 })
    stepUntil(m.sim, (fx) => fx.some((e) => e.kind === 'bounce'))
    return m
  }
  const swing = (sim: GameSimulation, id: string): boolean => {
    const p = sim.players.get(id)!
    const before = p.swingSeq
    sim.requestSwing(id, { ax: 0, az: 0, power: 0.35, viewTick: sim.tick })
    return p.swingSeq !== before
  }

  it('a team cannot even swing again until the other side has hit the ball', () => {
    const { sim } = midRally()
    for (let i = 0; i < 30; i++) sim.step(FIXED_DT)
    expect(sim.lastHitSlot).toBe(0)
    expect(swing(sim, 'a')).toBe(false)
  })

  it('a miss delays the next swing, so mashing does not work', () => {
    const { sim, b } = midRally()
    b.x = COURT.halfWidth + 2 // nowhere near the ball
    sim.ball.vy = 12 // keep it in the air
    expect(swing(sim, 'b')).toBe(true)
    for (let i = 0; i < 30; i++) sim.step(FIXED_DT) // 0.5 s: past the normal cooldown
    expect(sim.phase).toBe('rally')
    expect(swing(sim, 'b')).toBe(false)
    for (let i = 0; i < 18; i++) sim.step(FIXED_DT) // 0.8 s
    expect(swing(sim, 'b')).toBe(true)
    for (let i = 0; i < 60; i++) sim.step(FIXED_DT)
    expect(sim.phase).toBe('rally')
    expect(swing(sim, 'b')).toBe(false) // two tries at one ball, no more
  })

  it('nobody ever hits twice in a row, even when everyone swings at everything', () => {
    for (const size of [1, 2] as const) {
      const sim = new GameSimulation(size, seeded(5))
      const ids = ['a', 'b', 'c', 'd'].slice(0, size * 2)
      for (const id of ids) sim.addPlayer(id, id)
      for (const id of ids) sim.setReady(id, true)
      let last = -1
      let hits = 0
      for (let t = 0; t < 3600; t++) {
        if (sim.phase === 'serving') {
          const s = sim.players.get(sim.serverId!)!
          last = s.slot
          sim.requestServe(s.id, { ax: -Math.sign(s.x) * 1.8, az: -Math.sign(s.z) * 4.6 })
          sim.step(FIXED_DT)
        }
        for (const p of sim.players.values()) {
          p.x = sim.ball.x
          if (Math.abs(p.z - sim.ball.z) > 1.5) continue // mash only near the ball
          sim.requestSwing(p.id, {
            ax: 0,
            az: p.slot === 0 ? -4 : 4,
            power: 0.35,
            viewTick: sim.tick - 8,
          })
        }
        for (const e of sim.step(FIXED_DT)) {
          if (e.kind !== 'hit') continue
          hits += 1
          expect(e.slot).not.toBe(last)
          last = e.slot
        }
      }
      expect(hits).toBeGreaterThan(5)
    }
  })
})

describe('curving shots', () => {
  it("curves toward the server's own right or left, on both sides of the net", () => {
    for (const slot of [0, 1] as const) {
      for (const spin of [1, -1]) {
        const { sim } = readyMatch()
        if (slot === 1) {
          sim.servingSlot = 1
          sim.setConnected('b', false)
          sim.setConnected('b', true) // a fresh serve, now by Bob
        }
        const id = slot === 0 ? 'a' : 'b'
        expect(sim.serverId).toBe(id)
        sim.requestServe(id, { ax: 0, az: slot === 0 ? -5 : 5, spin })
        const right = slot === 0 ? 1 : -1
        expect(Math.sign(sim.ball.curve ?? 0)).toBe(spin * right)
        const fx = sim.step(FIXED_DT)
        expect(fx.find((e) => e.kind === 'hit')).toMatchObject({ spin: spin * right })
      }
    }
  })

  it('a swing with spin curves; nonsense spin is ignored or capped', () => {
    const curveFor = (spin: unknown): number => {
      const { sim, a } = readyMatch()
      sim.requestServe('a', { ax: 0, az: -5, spin })
      expect(a.swing).not.toBeNull()
      return Math.abs(sim.ball.curve ?? 0)
    }
    expect(curveFor('lots')).toBe(0)
    expect(curveFor(Number.NaN)).toBe(0)
    expect(curveFor(undefined)).toBe(0)
    expect(curveFor(1e9)).toBeLessThan(12)
  })

  it('a returned ball carries the spin of the swing', () => {
    const { sim, b } = readyMatch()
    sim.requestServe('a', { ax: -2, az: -5, spin: 0 })
    stepUntil(sim, (fx) => fx.some((e) => e.kind === 'bounce'))
    b.x = sim.ball.x
    b.z = sim.ball.z - 0.3
    sim.requestSwing('b', { ax: 0, az: 5, power: 0.35, spin: 1, viewTick: sim.tick })
    const fx = stepUntil(sim, (e) => e.some((f) => f.kind === 'hit' && f.slot === 1))
    expect(fx.find((e) => e.kind === 'hit' && e.slot === 1)).toMatchObject({ spin: -1 })
    expect(sim.ball.curve).toBeLessThan(0)
  })
})

describe('smash power and jump smash', () => {
  /** Bob hits a ball dropping at `y`, moving forward or not; returns the hit and its speed. */
  function smash(o: { y: number; forward: boolean; jump: unknown; power?: number }) {
    const { sim, b } = readyMatch()
    sim.requestServe('a', { ax: -2, az: -5, spin: 0 })
    stepUntil(sim, (fx) => fx.some((e) => e.kind === 'bounce'))
    b.x = 0
    b.z = -4
    // Bob faces +z, so forward (toward the net) is +z.
    sim.queueInputs('b', { frames: [{ seq: 1, mx: 0, mz: o.forward ? 1 : 0, ax: 0, az: 5 }] })
    Object.assign(sim.ball, { x: 0.2, y: o.y, z: -4, vx: 0, vy: 0, vz: 0, curve: 0 })
    ;(sim as unknown as { history: unknown[] }).history.length = 0
    sim.requestSwing('b', {
      ax: 0,
      az: 5,
      power: o.power ?? 1,
      spin: 0,
      jump: o.jump,
      viewTick: sim.tick,
    })
    const fx: FxEvent[] = []
    for (let i = 0; i < 3; i++) fx.push(...sim.step(FIXED_DT))
    const hit = fx.find((e) => e.kind === 'hit' && e.slot === 1)
    return {
      hit: hit?.kind === 'hit' ? hit : null,
      speed: Math.hypot(sim.ball.vx, sim.ball.vz),
      swingJump: b.swingJump,
    }
  }

  it('a jump smash is faster than a smash, which is far faster than a normal shot', () => {
    const normal = smash({ y: 1.8, forward: false, jump: false, power: 0.35 })
    const standing = smash({ y: 1.8, forward: false, jump: false })
    const jumping = smash({ y: 1.8, forward: true, jump: true })
    expect(standing.speed).toBeGreaterThan(normal.speed * 1.5)
    expect(jumping.speed).toBeGreaterThan(standing.speed * 1.1)
    expect(jumping.hit?.jump).toBe(true)
    expect(jumping.swingJump).toBe(true)
    expect(standing.hit?.jump).toBe(false)
  })

  it('reaches balls only a jump can', () => {
    expect(smash({ y: 2.9, forward: false, jump: false }).hit).toBeNull()
    expect(smash({ y: 2.9, forward: true, jump: true }).hit).not.toBeNull()
    expect(smash({ y: 3.6, forward: true, jump: true }).hit).toBeNull()
  })

  it('cannot be claimed while standing still, with a soft shot, or with nonsense', () => {
    expect(smash({ y: 2.9, forward: false, jump: true }).hit).toBeNull()
    expect(smash({ y: 2.9, forward: true, jump: true, power: 0.35 }).hit).toBeNull()
    expect(smash({ y: 2.9, forward: true, jump: 'yes' }).hit).toBeNull()
  })

  it('a low ball gets no extra power from jumping', () => {
    expect(smash({ y: 0.6, forward: true, jump: true }).hit?.jump).toBe(false)
  })
})
