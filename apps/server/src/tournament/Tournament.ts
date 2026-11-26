import {
  type BestOf,
  type MatchStage,
  type TournamentGroup,
  type TournamentMatch,
  type TournamentRow,
  groupPlan,
} from '@pickleball/shared'

const GROUP_NAMES = ['A', 'B', 'C', 'D']

/** Every pairing of a group, in rounds, so nobody waits too long or plays twice running. */
function roundRobin(members: number[]): [number, number][] {
  const ring: (number | null)[] = [...members]
  if (ring.length % 2 === 1) ring.push(null)
  const out: [number, number][] = []
  for (let round = 0; round < ring.length - 1; round++) {
    for (let i = 0; i < ring.length / 2; i++) {
      const a = ring[i] ?? null
      const b = ring[ring.length - 1 - i] ?? null
      if (a !== null && b !== null) out.push(round % 2 === 0 ? [a, b] : [b, a])
    }
    // Everyone but the first moves one place round.
    ring.splice(1, 0, ring.pop() ?? null)
  }
  return out
}

function shuffled<T>(items: T[], rng: () => number): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const t = out[i] as T
    out[i] = out[j] as T
    out[j] = t
  }
  return out
}

/** Splits people into random teams of two. */
export function randomTeams<T>(people: T[], rng: () => number): T[][] {
  const order = shuffled(people, rng)
  const teams: T[][] = []
  for (let i = 0; i + 1 < order.length; i += 2) teams.push([order[i] as T, order[i + 1] as T])
  return teams
}

/** Where a knockout place comes from. */
type Source = { group: number; place: number } | { runnerUp: true } | { winnerOf: number }

/**
 * Groups, then a knockout. Knows only entries (numbers) and results; nothing about
 * networks or rooms. Matches are played in the order of `matches`, several at once
 * where their entries are free.
 */
export class Tournament {
  readonly groups: number[][]
  readonly matches: TournamentMatch[] = []
  private readonly sources = new Map<number, [Source, Source]>()

  constructor(
    readonly entryCount: number,
    readonly groupBestOf: BestOf = 3,
    rng: () => number = Math.random,
  ) {
    const plan = groupPlan(entryCount)
    this.groups = Array.from({ length: plan.groups }, () => [])
    shuffled(
      Array.from({ length: entryCount }, (_, i) => i),
      rng,
    ).forEach((entry, i) => this.groups[i % Math.max(1, plan.groups)]?.push(entry))

    this.addGroupMatches()
    if (plan.groups === 0) this.addMatch('final', 'Final', 0, 1)
    else this.addKnockout(plan.groups)
  }

  private addMatch(
    stage: MatchStage,
    label: string,
    a: number | null,
    b: number | null,
    from?: [Source, Source],
  ): number {
    const id = this.matches.length
    this.matches.push({
      id,
      stage,
      label,
      a,
      b,
      hintA: from ? this.describe(from[0]) : '',
      hintB: from ? this.describe(from[1]) : '',
      bestOf: stage === 'group' ? this.groupBestOf : 3,
      games: [],
      winner: null,
      walkover: false,
    })
    if (from) this.sources.set(id, from)
    return id
  }

  /** Group matches take turns between the groups. */
  private addGroupMatches(): void {
    const perGroup = this.groups.map(roundRobin)
    const most = Math.max(0, ...perGroup.map((m) => m.length))
    for (let i = 0; i < most; i++) {
      perGroup.forEach((list, g) => {
        const pair = list[i]
        if (pair) this.addMatch('group', `Group ${GROUP_NAMES[g]}`, pair[0], pair[1])
      })
    }
  }

  private addKnockout(groups: number): void {
    const at = (group: number, place: number): Source => ({ group, place })
    const won = (winnerOf: number): Source => ({ winnerOf })
    if (groups === 1) {
      this.addMatch('final', 'Final', null, null, [at(0, 0), at(0, 1)])
      return
    }
    let semis: [Source, Source][]
    if (groups === 2) {
      semis = [
        [at(0, 0), at(1, 1)],
        [at(1, 0), at(0, 1)],
      ]
    } else if (groups === 3) {
      semis = [
        [at(0, 0), { runnerUp: true }],
        [at(1, 0), at(2, 0)],
      ]
    } else {
      const quarters = (
        [
          [at(0, 0), at(1, 1)],
          [at(2, 0), at(3, 1)],
          [at(1, 0), at(0, 1)],
          [at(3, 0), at(2, 1)],
        ] as [Source, Source][]
      ).map((s, i) => this.addMatch('quarter', `Quarter-final ${i + 1}`, null, null, s))
      semis = [
        [won(quarters[0] as number), won(quarters[1] as number)],
        [won(quarters[2] as number), won(quarters[3] as number)],
      ]
    }
    const ids = semis.map((s, i) => this.addMatch('semi', `Semi-final ${i + 1}`, null, null, s))
    this.addMatch('final', 'Final', null, null, [won(ids[0] as number), won(ids[1] as number)])
  }

  private describe(s: Source): string {
    if ('winnerOf' in s) return `Winner of ${this.matches[s.winnerOf]?.label.toLowerCase()}`
    if ('runnerUp' in s) return 'Best second place'
    return `${s.place === 0 ? 'Winner' : 'Second'} of group ${GROUP_NAMES[s.group]}`
  }

  /** Matches that could start now: undecided, both sides known, and neither of them `busy`. */
  playable(busy: ReadonlySet<number>): TournamentMatch[] {
    return this.matches.filter(
      (m) => m.winner === null && m.a !== null && m.b !== null && !busy.has(m.a) && !busy.has(m.b),
    )
  }

  /** The first match not decided yet. */
  get current(): TournamentMatch | null {
    return this.matches.find((m) => m.winner === null) ?? null
  }

  get champion(): number | null {
    return this.matches[this.matches.length - 1]?.winner ?? null
  }

  /** Games won by each side of a match. */
  static gamesWon(m: TournamentMatch): [number, number] {
    let a = 0
    let b = 0
    for (const [x, y] of m.games) {
      if (x > y) a++
      else b++
    }
    return [a, b]
  }

  /** Records a finished game of a match. Returns true if that decided the match. */
  recordGame(id: number, a: number, b: number): boolean {
    const m = this.matches[id]
    if (!m || m.winner !== null || m.a === null || m.b === null || a === b) return false
    m.games.push([a, b])
    const needed = m.bestOf === 3 ? 2 : 1
    const [wonA, wonB] = Tournament.gamesWon(m)
    if (wonA < needed && wonB < needed) return false
    this.finish(m, wonA > wonB ? m.a : m.b)
    return true
  }

  /** The other side is missing: `winner` takes the match. */
  walkover(id: number, winner: number): void {
    const m = this.matches[id]
    if (!m || m.winner !== null || (winner !== m.a && winner !== m.b)) return
    m.walkover = true
    this.finish(m, winner)
  }

  private finish(m: TournamentMatch, winner: number): void {
    m.winner = winner
    this.fillIn()
  }

  private groupDone(group: number): boolean {
    const label = `Group ${GROUP_NAMES[group]}`
    return this.matches.every((m) => m.label !== label || m.winner !== null)
  }

  private resolve(s: Source): number | null {
    if ('winnerOf' in s) return this.matches[s.winnerOf]?.winner ?? null
    if ('runnerUp' in s) {
      if (!this.groups.every((_, g) => this.groupDone(g))) return null
      const seconds = this.groups
        .map((_, g) => this.table(g)[1])
        .filter((r): r is TournamentRow => r !== undefined)
      return seconds.sort(compareAcrossGroups)[0]?.entry ?? null
    }
    return this.groupDone(s.group) ? (this.table(s.group)[s.place]?.entry ?? null) : null
  }

  /** Puts everyone who is known by now into the knockout. */
  private fillIn(): void {
    for (const [id, [from, to]] of this.sources) {
      const m = this.matches[id]
      if (!m) continue
      m.a ??= this.resolve(from)
      m.b ??= this.resolve(to)
    }
  }

  /** A group's standings, best first. */
  table(group: number): TournamentRow[] {
    const members = this.groups[group] ?? []
    const rows = new Map<number, TournamentRow>(
      members.map((entry) => [
        entry,
        { entry, played: 0, won: 0, lost: 0, gameDiff: 0, pointDiff: 0 },
      ]),
    )
    const played = this.matches.filter(
      (m) => m.label === `Group ${GROUP_NAMES[group]}` && m.winner !== null,
    )
    for (const m of played) {
      const a = rows.get(m.a ?? -1)
      const b = rows.get(m.b ?? -1)
      if (!a || !b) continue
      a.played++
      b.played++
      const [winner, loser] = m.winner === m.a ? [a, b] : [b, a]
      winner.won++
      loser.lost++
      // A walkover says who won, not by how much.
      if (m.walkover) continue
      const [gamesA, gamesB] = Tournament.gamesWon(m)
      a.gameDiff += gamesA - gamesB
      b.gameDiff += gamesB - gamesA
      for (const [x, y] of m.games) {
        a.pointDiff += x - y
        b.pointDiff += y - x
      }
    }
    const beat = (x: number, y: number): number => {
      const m = played.find((p) => (p.a === x && p.b === y) || (p.a === y && p.b === x))
      return m ? (m.winner === x ? -1 : 1) : 0
    }
    return [...rows.values()].sort((x, y) => {
      if (x.won !== y.won) return y.won - x.won
      // Two entries level on wins: whoever beat the other. Three or more: the numbers.
      const level = [...rows.values()].filter((r) => r.won === x.won).length
      return (
        (level === 2 ? beat(x.entry, y.entry) : 0) ||
        y.gameDiff - x.gameDiff ||
        y.pointDiff - x.pointDiff ||
        members.indexOf(x.entry) - members.indexOf(y.entry)
      )
    })
  }

  tables(): TournamentGroup[] {
    return this.groups.map((_, g) => ({
      name: `Group ${GROUP_NAMES[g]}`,
      rows: this.table(g),
    }))
  }
}

/** Groups differ in size, so compare shares won rather than totals. */
function compareAcrossGroups(x: TournamentRow, y: TournamentRow): number {
  const per = (v: number, r: TournamentRow): number => (r.played > 0 ? v / r.played : 0)
  return (
    per(y.won, y) - per(x.won, x) ||
    per(y.gameDiff, y) - per(x.gameDiff, x) ||
    per(y.pointDiff, y) - per(x.pointDiff, x) ||
    x.entry - y.entry
  )
}
