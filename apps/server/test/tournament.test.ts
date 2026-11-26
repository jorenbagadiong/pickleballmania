import { countMatches, groupPlan } from '@pickleball/shared'
import { describe, expect, it } from 'vitest'
import { Tournament, randomTeams } from '../src/tournament/Tournament'

function seeded(seed = 1): () => number {
  let s = seed
  return () => {
    s = (s * 16807) % 2147483647
    return (s - 1) / 2147483646
  }
}

/** Plays every match; the lower-numbered entry always wins 2–0. */
function playAll(t: Tournament): number {
  let n = 0
  while (t.current) {
    const m = t.current
    expect(m.a, m.label).not.toBeNull()
    expect(m.b, m.label).not.toBeNull()
    expect(m.a).not.toBe(m.b)
    const aWins = (m.a as number) < (m.b as number)
    while (!t.recordGame(t.current?.id ?? -1, aWins ? 11 : 5, aWins ? 5 : 11));
    n++
  }
  return n
}

describe('tournament', () => {
  for (let n = 2; n <= 12; n++) {
    it(`${n} entries: everyone plays, and the best one wins`, () => {
      const t = new Tournament(n, 3, seeded(n))
      expect(t.matches).toHaveLength(countMatches(n))
      expect(playAll(t)).toBe(countMatches(n))
      expect(t.champion).toBe(0)
      const final = t.matches.at(-1)!
      expect(final.stage).toBe('final')
      // Each group: everyone meets everyone once.
      t.groups.forEach((members, g) => {
        expect(members.length).toBeGreaterThanOrEqual(3)
        for (const row of t.table(g)) expect(row.played).toBe(members.length - 1)
      })
      const all = t.groups.flat()
      if (groupPlan(n).groups > 0) expect([...all].sort((a, b) => a - b)).toHaveLength(n)
    })
  }

  it('keeps group sizes within one of each other', () => {
    for (let n = 3; n <= 12; n++) {
      const sizes = new Tournament(n, 1, seeded(3)).groups.map((g) => g.length)
      expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1)
    }
  })

  it('with two groups, winners meet the other group’s second in the semi-finals', () => {
    const t = new Tournament(8, 3, seeded(5))
    const [a, b] = [t.groups[0]!, t.groups[1]!]
    while (t.current?.stage === 'group') {
      const m = t.current
      const aWins = (m.a as number) < (m.b as number)
      while (!t.recordGame(t.current?.id ?? -1, aWins ? 11 : 3, aWins ? 3 : 11));
    }
    const best = (g: number[]) => [...g].sort((x, y) => x - y)
    const [s1, s2] = t.matches.filter((m) => m.stage === 'semi')
    expect([s1!.a, s1!.b]).toEqual([best(a)[0], best(b)[1]])
    expect([s2!.a, s2!.b]).toEqual([best(b)[0], best(a)[1]])
  })

  it('a match is best of three; group matches can be a single game', () => {
    const t = new Tournament(3, 3, seeded())
    expect(t.recordGame(t.current?.id ?? -1, 11, 5)).toBe(false)
    expect(t.recordGame(t.current?.id ?? -1, 6, 11)).toBe(false)
    expect(t.matches[0]!.winner).toBeNull()
    expect(t.recordGame(t.current?.id ?? -1, 12, 10)).toBe(true)
    expect(t.matches[0]!.winner).toBe(t.matches[0]!.a)

    const quick = new Tournament(3, 1, seeded())
    expect(quick.recordGame(0, 4, 11)).toBe(true)
    expect(quick.matches[0]!.winner).toBe(quick.matches[0]!.b)
    expect(quick.matches.at(-1)!.bestOf).toBe(3) // the knockout always is
  })

  it('names who is still to come', () => {
    const t = new Tournament(6, 3, seeded())
    const semi = t.matches.find((m) => m.stage === 'semi')!
    expect(semi.a).toBeNull()
    expect(semi.hintA).toBe('Winner of group A')
    expect(semi.hintB).toBe('Second of group B')
    expect(t.matches.at(-1)!.hintA).toBe('Winner of semi-final 1')
  })

  it('breaks a tie between two by who beat whom', () => {
    const t = new Tournament(4, 1, seeded(2))
    const [w, x, y, z] = t.groups[0] as [number, number, number, number]
    // w and x both win two, w on huge scores; but x beat w.
    const result = new Map([
      [`${w}-${x}`, x],
      [`${w}-${y}`, w],
      [`${w}-${z}`, w],
      [`${x}-${y}`, x],
      [`${x}-${z}`, z],
      [`${y}-${z}`, y],
    ])
    while (t.current?.stage === 'group') {
      const m = t.current
      const winner = result.get(`${m.a}-${m.b}`) ?? result.get(`${m.b}-${m.a}`)
      const big = winner === w ? 0 : 9
      t.recordGame(t.current?.id ?? -1, winner === m.a ? 11 : big, winner === m.a ? big : 11)
    }
    expect(
      t
        .table(0)
        .map((r) => r.entry)
        .slice(0, 2),
    ).toEqual([x, w])
  })

  it('breaks a three-way tie by games, then points', () => {
    const t = new Tournament(3, 1, seeded())
    const [p, q, r] = t.groups[0] as [number, number, number]
    const score = (m: { a: number | null }, winner: number, loserPoints: number) =>
      m.a === winner
        ? t.recordGame(t.current?.id ?? -1, 11, loserPoints)
        : t.recordGame(t.current?.id ?? -1, loserPoints, 11)
    while (t.current?.stage === 'group') {
      const m = t.current
      const pair = [m.a, m.b]
      // A circle: p beats q 11–0, q beats r 11–9, r beats p 11–9.
      if (pair.includes(p) && pair.includes(q)) score(m, p, 0)
      else if (pair.includes(q) && pair.includes(r)) score(m, q, 9)
      else score(m, r, 9)
    }
    expect(t.table(0)[0]!.entry).toBe(p)
    expect(t.table(0)[2]!.entry).toBe(q)
  })

  it('a walkover wins the match but no games or points', () => {
    const t = new Tournament(4, 3, seeded())
    const m = t.current!
    t.walkover(t.current?.id ?? -1, 99) // not in this match
    expect(m.winner).toBeNull()
    t.walkover(t.current?.id ?? -1, m.b as number)
    expect(m.winner).toBe(m.b)
    expect(m.walkover).toBe(true)
    const row = t.table(0).find((r) => r.entry === m.b)!
    expect(row).toMatchObject({ won: 1, gameDiff: 0, pointDiff: 0 })
  })

  it('ignores results once it is over', () => {
    const t = new Tournament(2, 3, seeded())
    playAll(t)
    expect(t.current).toBeNull()
    expect(t.recordGame(t.current?.id ?? -1, 11, 3)).toBe(false)
    t.walkover(t.current?.id ?? -1, 1)
    expect(t.champion).toBe(0)
  })

  it('rarely makes anyone play twice in a row', () => {
    let back = 0
    let total = 0
    for (let n = 6; n <= 12; n++) {
      const ms = new Tournament(n, 1, seeded(n)).matches.filter((m) => m.stage === 'group')
      for (let i = 1; i < ms.length; i++) {
        total++
        const before = [ms[i - 1]!.a, ms[i - 1]!.b]
        if (before.includes(ms[i]!.a) || before.includes(ms[i]!.b)) back++
      }
    }
    expect(back / total).toBeLessThan(0.1)
  })
})

describe('random teams', () => {
  it('puts everyone in exactly one team of two, differently each time', () => {
    const people = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
    const one = randomTeams(people, seeded(1))
    expect(one).toHaveLength(4)
    expect(one.flat().sort()).toEqual(people)
    const pairings = new Set(
      Array.from({ length: 20 }, (_, i) => JSON.stringify(randomTeams(people, seeded(i + 1)))),
    )
    expect(pairings.size).toBeGreaterThan(10)
  })
})
