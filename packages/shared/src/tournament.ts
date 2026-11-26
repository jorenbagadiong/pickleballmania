/** What clients are told about a tournament. Entries are players (1v1) or teams (2v2). */

/** People who can enter: 12 singles players, or 8 teams of two. */
export const MAX_ENTRIES_SINGLES = 12
export const MAX_ENTRIES_DOUBLES = 8
export const MIN_ENTRIES = 2
/** Games in a match (first to win most of them). */
export type BestOf = 1 | 3

/** Courts in the arena; matches run side by side on them. */
export const MAX_COURTS = 4

/** As many courts as there can be group matches at the same time. */
export function courtsFor(entries: number): number {
  const { groups } = groupPlan(entries)
  let pairs = 0
  for (let g = 0; g < groups; g++) pairs += Math.floor(groupSize(entries, groups, g) / 2)
  return Math.max(1, Math.min(MAX_COURTS, pairs))
}

export type TournamentStatus = 'signup' | 'playing' | 'done'
/** What a court is doing while the tournament is being played. */
export type TournamentStep =
  /** No match to put on it at the moment. */
  | 'idle'
  /** The next match has been called; its players get ready. */
  | 'calling'
  | 'playing'
  /** Between two games of a match. */
  | 'gameBreak'
  /** A match just ended. */
  | 'matchBreak'
export type MatchStage = 'group' | 'quarter' | 'semi' | 'final'

export interface TournamentRow {
  entry: number
  played: number
  won: number
  lost: number
  gameDiff: number
  pointDiff: number
}

export interface TournamentGroup {
  name: string
  /** Best first. */
  rows: TournamentRow[]
}

export interface TournamentMatch {
  id: number
  stage: MatchStage
  /** "Group A", "Semi-final 1", "Final"… */
  label: string
  /** Entries, or null while not known yet; then the hint says who it will be ("Winner of group A"). */
  a: number | null
  b: number | null
  hintA: string
  hintB: string
  bestOf: BestOf
  /** Points of each finished game, as [a, b]. */
  games: [number, number][]
  winner: number | null
  /** Won because the other side was missing. */
  walkover: boolean
}

export interface TournamentCourt {
  step: TournamentStep
  /** Match on it (id); during a break, the one that just ended. */
  match: number | null
  /** Players of a called match who are not here. */
  missing: string[]
}

export interface TournamentView {
  status: TournamentStatus
  /** Session id of who runs it. */
  host: string
  groupBestOf: BestOf
  /** During sign-up: who has entered (session ids). */
  entrants: string[]
  /** Why it can't start yet ('' = it can). */
  problem: string
  /** How many matches there would be / are. */
  matchCount: number
  entries: { name: string; members: string[]; ids: string[] }[]
  groups: TournamentGroup[]
  matches: TournamentMatch[]
  courts: TournamentCourt[]
  /** Matches coming up next (ids), soonest first. */
  queue: number[]
  champion: number | null
}

/** How entries are split up, and how many of them go through to the knockout. */
export function groupPlan(entries: number): { groups: number; qualifiers: number } {
  if (entries <= 2) return { groups: 0, qualifiers: entries }
  if (entries <= 5) return { groups: 1, qualifiers: 2 }
  if (entries <= 8) return { groups: 2, qualifiers: 4 }
  if (entries <= 11) return { groups: 3, qualifiers: 4 }
  return { groups: 4, qualifiers: 8 }
}

function groupSize(entries: number, groups: number, group: number): number {
  return Math.floor(entries / groups) + (group < entries % groups ? 1 : 0)
}

export function countMatches(entries: number): number {
  const { groups, qualifiers } = groupPlan(entries)
  if (entries < 2) return 0
  let total = qualifiers - 1
  for (let g = 0; g < groups; g++) {
    const size = groupSize(entries, groups, g)
    total += (size * (size - 1)) / 2
  }
  return total
}
