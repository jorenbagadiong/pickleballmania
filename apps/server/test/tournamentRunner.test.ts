import { FIXED_DT, type GameMode, MAX_COURTS, courtsFor, teamSizeFor } from '@pickleball/shared'
import { describe, expect, it } from 'vitest'
import { GameSimulation } from '../src/simulation/GameSimulation'
import { ABSENT_SECONDS, TournamentRunner } from '../src/tournament/TournamentRunner'

function setup(mode: GameMode, names: string[], seed = 7) {
  let s = seed
  const rng = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646
  const sims = Array.from({ length: MAX_COURTS }, () => new GameSimulation(teamSizeFor(mode), rng))
  const sim = sims[0]!
  const dropped = new Set<string>()
  const runner = new TournamentRunner(mode, sims, (id) => !dropped.has(id), rng)
  for (const n of names) runner.join(`s-${n}`, n)
  const run = (seconds: number): void => {
    for (let t = 0; t < seconds; t += FIXED_DT) {
      for (const c of sims) c.step(FIXED_DT)
      runner.step60(FIXED_DT)
    }
  }
  const host = (msg: unknown): void => runner.command(runner.host, msg)
  const readyAll = (c = sim): void => {
    for (const id of c.players.keys()) c.setReady(id, true)
    run(0.1)
  }
  /** Ends the game on court with this score for teams 0 and 1. */
  const endGame = (a: number, b: number, c = sim): void => {
    c.scores[0] = a
    c.scores[1] = b
    const s2 = c as unknown as { gameWinner: number; enterGameOver(): void }
    s2.gameWinner = a > b ? 0 : 1
    s2.enterGameOver()
    run(0.05)
  }
  const step = (i = 0): string => runner.view().courts[i]!.step
  return { sim, sims, runner, run, host, readyAll, endGame, dropped, step }
}

const onCourt = (sim: GameSimulation): string[] => [...sim.players.values()].map((p) => p.nickname)

describe('tournament runner', () => {
  it('signs people up; only the host can start, and only with enough players', () => {
    const { runner, host } = setup('1v1', ['Ann'])
    expect(runner.host).toBe('s-Ann')
    expect(runner.view().problem).toMatch(/1 more player/)
    host({ action: 'start' })
    expect(runner.status).toBe('signup')
    runner.join('s-Ben', 'Ben')
    runner.command('s-Ben', { action: 'start' })
    expect(runner.status).toBe('signup')
    host({ action: 'start' })
    expect(runner.status).toBe('playing')
  })

  it('needs an even number for teams, and people can choose to watch', () => {
    const { runner } = setup('2v2', ['A', 'B', 'C', 'D', 'E'])
    expect(runner.view().problem).toMatch(/even number/)
    runner.setEntered('s-E', false)
    expect(runner.view().problem).toBe('')
    expect(runner.view().entrants).toHaveLength(4)
    runner.setEntered('s-E', 'yes')
    expect(runner.view().entrants).toHaveLength(4)
  })

  it('limits entries; later people watch', () => {
    const { runner } = setup(
      '1v1',
      Array.from({ length: 14 }, (_, i) => `P${i}`),
    )
    expect(runner.view().entrants).toHaveLength(12)
    expect(runner.hasRoom).toBe(false)
  })

  it('gives people with the same name different ones', () => {
    const { runner } = setup('1v1', ['Ann', 'ann', 'ANN'])
    expect(runner.present().map((p) => p.name)).toEqual(['Ann', 'ann 2', 'ANN 3'])
  })

  it('passes the host role on when the host leaves', () => {
    const { runner } = setup('1v1', ['Ann', 'Ben'])
    runner.leave('s-Ann')
    expect(runner.host).toBe('s-Ben')
  })

  for (const mode of ['1v1', '2v2'] as const) {
    for (const entries of [2, 3, 6, mode === '1v1' ? 12 : 8]) {
      it(`plays a whole ${mode} tournament of ${entries} on several courts, to a champion`, () => {
        const size = teamSizeFor(mode)
        const names = Array.from({ length: entries * size }, (_, i) => `P${i}`)
        const { sims, runner, run, host, readyAll, endGame, step } = setup(mode, names, entries)
        host({ action: 'start' })
        expect(runner.view().courts).toHaveLength(courtsFor(entries))
        const total = runner.view().matchCount
        const seen = new Set<string>()
        let most = 0
        let finalAlone = false
        for (let guard = 0; runner.status === 'playing' && guard < 200; guard++) {
          run(0.1)
          const v = runner.view()
          // Nobody is on two courts at once.
          const everyone = sims.flatMap(onCourt)
          expect(new Set(everyone).size).toBe(everyone.length)
          everyone.forEach((n) => seen.add(n))
          most = Math.max(most, v.courts.filter((c) => c.match !== null).length)
          const final = v.matches.at(-1)!
          if (v.courts.some((c) => c.match === final.id)) {
            expect(v.courts[0]!.match).toBe(final.id) // on the main court…
            expect(v.courts.filter((c) => c.match !== null)).toHaveLength(1) // …and alone
            finalAlone = true
          }
          sims.forEach((c, i) => {
            if (i >= v.courts.length || step(i) !== 'calling') return
            const m = v.matches[v.courts[i]!.match!]!
            const side0 = c.team(0).map((p) => p.nickname)
            expect(side0.sort()).toEqual([...v.entries[m.a!]!.members].sort())
            readyAll(c)
            expect(step(i)).toBe('playing')
          })
          // One court finishes at a time; the others are still playing.
          const i = runner.view().courts.findIndex((c) => c.step === 'playing')
          if (i < 0) {
            run(1)
            continue
          }
          const c = sims[i]!
          endGame(11, 4, c)
          if (step(i) === 'gameBreak') {
            run(8)
            expect(step(i)).toBe('playing')
            endGame(7, 11, c)
            run(8)
            endGame(12, 10, c)
          }
          expect(step(i)).toBe('matchBreak')
        }
        const v = runner.view()
        expect(v.status).toBe('done')
        expect(v.champion).not.toBeNull()
        expect(v.matches.filter((m) => m.winner !== null)).toHaveLength(total)
        expect(seen.size).toBe(names.length)
        expect(finalAlone).toBe(true)
        expect(most).toBe(courtsFor(entries))
        expect(sims.every((c) => c.players.size === 0)).toBe(true)
      })
    }
  }

  it('a free court is filled straight away while others play on', () => {
    const { sims, runner, run, host, readyAll, endGame, step } = setup(
      '1v1',
      Array.from({ length: 8 }, (_, i) => `P${i}`),
    )
    host({ action: 'bestOf', bestOf: 1 })
    host({ action: 'start' })
    run(0.1)
    for (const c of sims) readyAll(c)
    // Courts 1 and 3 hold one group, courts 2 and 4 the other.
    const before = runner.view().courts[0]!.match
    endGame(11, 2, sims[0]!)
    endGame(11, 2, sims[2]!)
    run(10)
    expect(step(1)).toBe('playing')
    expect(runner.view().courts[0]!.match).not.toBe(before)
    expect(step(0)).toBe('calling')
    expect(step(2)).toBe('calling')
  })

  it('only players of a called match may say they are ready', () => {
    const { sim, runner, run, host, readyAll } = setup('1v1', ['A', 'B', 'C'])
    host({ action: 'start' })
    run(0.1)
    const ids = [...sim.players.keys()]
    const watcher = ['s-A', 's-B', 's-C'].find((x) => !ids.includes(x))!
    expect(runner.mayReady(ids[0]!)).toBe(true)
    expect(runner.mayReady(watcher)).toBe(false)
    readyAll()
    expect(runner.mayReady(ids[0]!)).toBe(false) // can't stop a match that has begun
  })

  it('single-game group matches, best of three after', () => {
    const { runner, run, host, readyAll, endGame, step } = setup('1v1', ['A', 'B', 'C'])
    host({ action: 'bestOf', bestOf: 2 })
    expect(runner.view().groupBestOf).toBe(3)
    host({ action: 'bestOf', bestOf: 1 })
    host({ action: 'start' })
    for (let i = 0; i < 3; i++) {
      run(0.1)
      readyAll()
      endGame(11, 3)
      expect(step()).toBe('matchBreak')
      run(10)
    }
    run(0.1)
    readyAll()
    endGame(11, 3)
    expect(step()).toBe('gameBreak')
  })

  it('a player who leaves mid-match loses it, but can come back for the next', () => {
    const { sim, runner, run, host, readyAll } = setup('1v1', ['A', 'B', 'C'])
    host({ action: 'start' })
    run(0.1)
    readyAll()
    const [gone, other] = [...sim.players.values()]
    const goneName = gone!.nickname
    runner.leave(gone!.id)
    const v = runner.view()
    const m = v.matches[0]!
    expect(m.walkover).toBe(true)
    expect(v.entries[m.winner!]!.members).toEqual([other!.nickname])
    expect(sim.players.size).toBe(0)
    // Back under the same name, with a new connection.
    expect(runner.join('new', goneName.toLowerCase())).toBe(goneName)
    expect(runner.nameOf('new')).toBe(goneName)
    run(12)
    for (let i = 0; i < 2 && !onCourt(sim).includes(goneName); i++) {
      readyAll()
      const s2 = sim as unknown as { gameWinner: number; enterGameOver(): void }
      for (let g = 0; g < 2; g++) {
        sim.scores[0] = 11
        sim.scores[1] = 2
        s2.gameWinner = 0
        s2.enterGameOver()
        run(g === 0 ? 8 : 11)
      }
    }
    expect(onCourt(sim)).toContain(goneName)
  })

  it('waits a while for someone missing when their match is called, then moves on', () => {
    const { sim, runner, run, host, step } = setup('1v1', ['A', 'B', 'C'])
    host({ action: 'start' })
    run(0.1)
    const away = [...sim.players.values()][0]!
    runner.leave(away.id)
    run(0.1)
    expect(runner.view().courts[0]!.missing).toEqual([away.nickname])
    expect(sim.players.size).toBe(0)
    run(ABSENT_SECONDS - 5)
    expect(step()).toBe('calling')
    expect(runner.view().matches[0]!.winner).toBeNull()
    run(6)
    const m = runner.view().matches[0]!
    expect(m.walkover).toBe(true)
    expect(runner.view().entries[m.winner!]!.members).not.toContain(away.nickname)
  })

  it('coming back in time resumes the call', () => {
    const { sim, runner, run, host } = setup('1v1', ['A', 'B'])
    host({ action: 'start' })
    run(0.1)
    const away = [...sim.players.values()][0]!
    runner.leave(away.id)
    run(20)
    runner.join('back', away.nickname)
    run(0.1)
    expect(sim.players.size).toBe(2)
    expect(runner.view().courts[0]!.missing).toEqual([])
  })

  it('the host can pass over people who are not ready, but not people who are', () => {
    const { sim, runner, run, host } = setup('1v1', ['A', 'B', 'C'])
    host({ action: 'start' })
    run(0.1)
    sim.setReady(sim.team(0)[0]!.id, true)
    run(0.05)
    host({ action: 'walkover', court: 0, side: 'b' }) // side a is ready
    expect(runner.view().matches[0]!.winner).toBeNull()
    runner.command('s-nobody', { action: 'walkover', court: 0, side: 'a' })
    expect(runner.view().matches[0]!.winner).toBeNull()
    host({ action: 'walkover', court: 0, side: 'a' })
    expect(runner.view().matches[0]!.winner).toBe(runner.view().matches[0]!.a)
  })

  it('a dropped connection while being called does not get the match stuck', () => {
    const { sim, run, host, readyAll, dropped, step } = setup('1v1', ['A', 'B'])
    host({ action: 'start' })
    run(0.1)
    const p = [...sim.players.values()][0]!
    dropped.add(p.id)
    sim.setConnected(p.id, false)
    run(1)
    expect(step()).toBe('calling')
    dropped.delete(p.id)
    sim.setConnected(p.id, true)
    run(0.1)
    expect(sim.phase).toBe('lobby')
    readyAll()
    expect(step()).toBe('playing')
  })

  it('a dropped connection in game two pauses it and it resumes', () => {
    const { sim, run, host, readyAll, endGame, step } = setup('1v1', ['A', 'B'])
    host({ action: 'start' })
    run(0.1)
    readyAll()
    endGame(11, 5)
    const p = [...sim.players.values()][0]!
    sim.setConnected(p.id, false) // during the break
    run(8)
    expect(sim.phase).toBe('paused')
    sim.setConnected(p.id, true)
    run(0.1)
    expect(sim.phase).toBe('serving')
    sim.setConnected(p.id, false)
    sim.setConnected(p.id, true)
    expect(sim.phase).toBe('serving')
    expect(step()).toBe('playing')
  })

  it('a champion can be followed by a new tournament with the same people', () => {
    const { sim, runner, run, host, readyAll, endGame } = setup('1v1', ['A', 'B', 'C', 'D'])
    runner.setEntered('s-C', false)
    runner.setEntered('s-D', false)
    host({ action: 'start' })
    run(0.1)
    readyAll()
    endGame(11, 5)
    run(8)
    endGame(11, 5)
    run(10)
    expect(runner.status).toBe('done')
    runner.leave('s-B')
    host({ action: 'again' })
    expect(runner.status).toBe('signup')
    expect(runner.view().entrants).toEqual(['s-A'])
    expect(runner.view().champion).toBeNull()
    expect(sim.players.size).toBe(0)
  })

  it('says who plays next', () => {
    const { sim, runner, run, host, readyAll } = setup('1v1', ['A', 'B', 'C'])
    host({ action: 'start' })
    run(0.1)
    expect(runner.upNext).toEqual(expect.arrayContaining(onCourt(sim)))
    readyAll()
    const v = runner.view()
    const next = v.matches[v.queue[0]!]!
    expect(runner.upNext).toEqual([v.entries[next.a!]!.name, v.entries[next.b!]!.name])
  })

  it('ignores nonsense', () => {
    const { runner, host } = setup('1v1', ['A', 'B'])
    for (const msg of [
      null,
      42,
      'start',
      {},
      { action: 5 },
      { action: 'walkover', court: 0, side: 'c' },
    ])
      host(msg)
    host({ action: 'again' })
    expect(runner.status).toBe('signup')
  })
})
