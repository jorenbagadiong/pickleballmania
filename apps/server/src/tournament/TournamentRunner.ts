import {
  type BestOf,
  type GameMode,
  MAX_ENTRIES_DOUBLES,
  MAX_ENTRIES_SINGLES,
  MIN_ENTRIES,
  type TournamentMatch,
  type TournamentStatus,
  type TournamentStep,
  type TournamentView,
  countMatches,
  courtsFor,
  teamSizeFor,
} from '@pickleball/shared'
import type { GameSimulation } from '../simulation/GameSimulation'
import { Tournament, randomTeams } from './Tournament'

/** Someone in the room, entered or just watching. */
interface Person {
  name: string
  /** Null after they left; taken up again if they come back under the same name. */
  session: string | null
  entered: boolean
}

interface Entry {
  name: string
  members: Person[]
}

interface Court {
  sim: GameSimulation
  /** Match on it (id). */
  match: number | null
  step: TournamentStep
  timer: number
}

/** Between games of a match, and after a match (seconds). */
const GAME_BREAK_SECONDS = 7
const MATCH_BREAK_SECONDS = 9
/** A called match is lost by players who are not here for this long. */
export const ABSENT_SECONDS = 60

/**
 * Runs a tournament in one room: takes entries, puts matches on free courts, seats
 * their players, and records what happens. Whoever isn't playing watches.
 */
export class TournamentRunner {
  status: TournamentStatus = 'signup'
  host = ''
  /** Something clients are shown has changed since this was last cleared. */
  changed = true
  private readonly people: Person[] = []
  private groupBestOf: BestOf = 3
  private entries: Entry[] = []
  private tournament: Tournament | null = null
  private readonly courts: Court[]
  /** Courts in use for this many entries. */
  courtCount = 1

  constructor(
    private readonly mode: GameMode,
    sims: GameSimulation[],
    private readonly isConnected: (session: string) => boolean,
    private readonly rng: () => number = Math.random,
  ) {
    this.courts = sims.map((sim) => ({ sim, match: null, step: 'idle', timer: 0 }))
  }

  // ---------------------------------------------------------------- people

  /** Adds someone (back). Returns the name they go by here. */
  join(session: string, nickname: string): string {
    this.changed = true
    const same = (p: Person): boolean => p.name.toLowerCase() === nickname.toLowerCase()
    const returning = this.people.find((p) => p.entered && p.session === null && same(p))
    if (returning) {
      returning.session = session
      this.pickHost()
      return returning.name
    }
    let name = nickname
    for (let n = 2; this.people.some((p) => p.name.toLowerCase() === name.toLowerCase()); n++) {
      name = `${nickname} ${n}`
    }
    const person: Person = { name, session, entered: false }
    this.people.push(person)
    if (this.status === 'signup') this.enter(person, true)
    this.pickHost()
    return name
  }

  leave(session: string): void {
    const person = this.bySession(session)
    if (!person) return
    this.changed = true
    person.session = null
    // Only people with matches to play are worth waiting for.
    if (this.status === 'signup' || !person.entered) {
      this.people.splice(this.people.indexOf(person), 1)
    }
    this.pickHost()
    const court = this.courts.find((c) => this.onCourt(c).includes(person))
    if (this.status === 'playing' && court) this.playerLeft(court)
  }

  nameOf(session: string): string | null {
    return this.bySession(session)?.name ?? null
  }

  /** Everyone here, by session. */
  present(): { session: string; name: string }[] {
    return this.people.flatMap((p) => (p.session ? [{ session: p.session, name: p.name }] : []))
  }

  private bySession(session: string): Person | undefined {
    return this.people.find((p) => p.session === session)
  }

  private pickHost(): void {
    const here = this.people.filter((p) => p.session !== null)
    if (here.some((p) => p.session === this.host)) return
    this.host = (here.find((p) => p.entered) ?? here[0])?.session ?? ''
  }

  private get capacity(): number {
    return teamSizeFor(this.mode) === 2 ? MAX_ENTRIES_DOUBLES * 2 : MAX_ENTRIES_SINGLES
  }

  private get entered(): Person[] {
    return this.people.filter((p) => p.entered)
  }

  get hasRoom(): boolean {
    return this.status === 'signup' && this.entered.length < this.capacity
  }

  private enter(person: Person, enter: boolean): void {
    if (this.status !== 'signup' || person.entered === enter) return
    if (enter && !this.hasRoom) return
    person.entered = enter
    this.changed = true
  }

  /** Enter the tournament, or just watch (only while signing up). */
  setEntered(session: string, enter: unknown): void {
    const person = this.bySession(session)
    if (person && typeof enter === 'boolean') this.enter(person, enter)
  }

  // --------------------------------------------------------------- running

  /** Commands from the host. */
  command(session: string, msg: unknown): void {
    if (session !== this.host) return
    const m = (msg ?? {}) as {
      action?: unknown
      bestOf?: unknown
      court?: unknown
      side?: unknown
    }
    if (m.action === 'bestOf' && this.status === 'signup') {
      if (m.bestOf !== 1 && m.bestOf !== 3) return
      this.groupBestOf = m.bestOf
      this.changed = true
    } else if (m.action === 'start') this.start()
    else if (m.action === 'walkover') this.awardWalkover(m.court, m.side)
    else if (m.action === 'again') this.startOver()
  }

  /** Why the tournament can't start yet. */
  private get problem(): string {
    const n = this.entered.length
    const size = teamSizeFor(this.mode)
    const missing = MIN_ENTRIES * size - n
    if (missing > 0) return `${missing} more player${missing === 1 ? '' : 's'} needed`
    if (n % size !== 0) return 'Teams of two need an even number: one more player, or one less'
    return ''
  }

  private start(): void {
    if (this.status !== 'signup' || this.problem !== '') return
    const teams =
      teamSizeFor(this.mode) === 2
        ? randomTeams(this.entered, this.rng)
        : this.entered.map((p) => [p])
    this.entries = teams.map((members) => ({
      name: members.map((p) => p.name).join(' & '),
      members,
    }))
    this.tournament = new Tournament(this.entries.length, this.groupBestOf, this.rng)
    this.status = 'playing'
    this.courtCount = Math.min(this.courts.length, courtsFor(this.entries.length))
    this.fillCourts()
  }

  private startOver(): void {
    if (this.status !== 'done') return
    this.status = 'signup'
    this.tournament = null
    this.entries = []
    this.courtCount = 1
    for (const c of this.courts) this.clear(c)
    for (const p of [...this.people]) {
      if (p.session === null) this.people.splice(this.people.indexOf(p), 1)
    }
    this.changed = true
  }

  private clear(c: Court): void {
    c.sim.clearSeats()
    c.match = null
    c.step = 'idle'
    c.timer = 0
    this.changed = true
  }

  private matchOn(c: Court): TournamentMatch | null {
    return c.match === null ? null : (this.tournament?.matches[c.match] ?? null)
  }

  private get courtsInUse(): Court[] {
    return this.courts.slice(0, this.courtCount)
  }

  /** Entries with a match on some court. */
  private busy(): Set<number> {
    const out = new Set<number>()
    for (const c of this.courtsInUse) {
      const m = this.matchOn(c)
      if (m?.a !== null && m?.a !== undefined) out.add(m.a)
      if (m?.b !== null && m?.b !== undefined) out.add(m.b)
    }
    return out
  }

  /** Calls matches onto every free court; ends the tournament when there are none left. */
  private fillCourts(): void {
    const t = this.tournament
    if (!t || this.status !== 'playing') return
    for (const c of this.courtsInUse) {
      if (c.step !== 'idle') continue
      const m = t.playable(this.busy())[0]
      if (!m) break
      c.match = m.id
      c.step = 'calling'
      c.timer = 0
      this.changed = true
    }
    if (t.champion !== null && this.courtsInUse.every((c) => c.step === 'idle')) {
      this.status = 'done'
      this.changed = true
    }
  }

  private side(c: Court, side: 'a' | 'b'): Person[] {
    const entry = this.matchOn(c)?.[side]
    return entry === null || entry === undefined ? [] : (this.entries[entry]?.members ?? [])
  }

  private onCourt(c: Court): Person[] {
    return [...this.side(c, 'a'), ...this.side(c, 'b')]
  }

  private missing(c: Court): Person[] {
    if (this.status !== 'playing' || c.step !== 'calling') return []
    return this.onCourt(c).filter((p) => p.session === null)
  }

  /** Players of a called match say they are ready; nobody else, and not later. */
  mayReady(session: string): boolean {
    return this.courts.some((c) => c.step === 'calling' && c.sim.players.has(session))
  }

  /** Called every simulation step, after the simulations. */
  step60(dt: number): void {
    if (this.status !== 'playing') return
    for (const c of this.courtsInUse) this.stepCourt(c, dt)
  }

  private stepCourt(c: Court, dt: number): void {
    if (c.step === 'calling') this.whileCalling(c, dt)
    else if (c.step === 'playing') {
      if (c.sim.phase === 'gameOver') this.gameFinished(c)
    } else if (c.step !== 'idle') {
      c.timer -= dt
      if (c.timer > 0) return
      if (c.step === 'matchBreak') {
        this.clear(c)
        this.fillCourts()
      } else {
        c.sim.nextGame()
        c.step = 'playing'
        this.changed = true
      }
    }
  }

  private whileCalling(c: Court, dt: number): void {
    const seated = c.sim.players.size > 0
    if (this.missing(c).length > 0) {
      if (seated) c.sim.clearSeats()
      c.timer += dt
      if (c.timer >= ABSENT_SECONDS) this.giveToThePresent(c)
      return
    }
    c.timer = 0
    if (!seated) this.seat(c)
    else if (c.sim.phase === 'serving' || c.sim.phase === 'rally') {
      c.step = 'playing'
      this.changed = true
    }
  }

  private seat(c: Court): void {
    const [a, b] = [this.side(c, 'a'), this.side(c, 'b')]
    // Alternating fills the simulation's teams in order: side a is team 0.
    const order = a.flatMap((p, i) => [p, b[i]]).filter((p): p is Person => p !== undefined)
    c.sim.seatMatch(
      order.map((p) => ({
        id: p.session ?? '',
        nickname: p.name,
        connected: p.session !== null && this.isConnected(p.session),
      })),
    )
    this.changed = true
  }

  private gameFinished(c: Court): void {
    if (c.match === null) return
    const [x, y] = c.sim.scores
    const decided = this.tournament?.recordGame(c.match, x, y) ?? false
    c.step = decided ? 'matchBreak' : 'gameBreak'
    c.timer = decided ? MATCH_BREAK_SECONDS : GAME_BREAK_SECONDS
    this.changed = true
  }

  /** A player of the match on this court is gone for good. */
  private playerLeft(c: Court): void {
    // Still being called: there is time to come back. After the match: no matter.
    if (c.step === 'playing' || c.step === 'gameBreak') this.giveToThePresent(c)
  }

  private giveToThePresent(c: Court): void {
    const gone = (people: Person[]): number => people.filter((p) => p.session === null).length
    const m = this.matchOn(c)
    if (!m || m.a === null || m.b === null) return
    this.walkover(c, gone(this.side(c, 'a')) > gone(this.side(c, 'b')) ? m.b : m.a)
  }

  private awardWalkover(court: unknown, side: unknown): void {
    const c = typeof court === 'number' ? this.courtsInUse[court] : undefined
    if (this.status !== 'playing' || c?.step !== 'calling') return
    if (side !== 'a' && side !== 'b') return
    const entry = this.matchOn(c)?.[side]
    // Not against people who are here and ready to play.
    const others = this.side(c, side === 'a' ? 'b' : 'a')
    const waitingFor = others.some(
      (p) => p.session === null || !c.sim.players.get(p.session)?.ready,
    )
    if (entry !== null && entry !== undefined && waitingFor) this.walkover(c, entry)
  }

  private walkover(c: Court, winner: number): void {
    if (c.match !== null) this.tournament?.walkover(c.match, winner)
    c.sim.clearSeats()
    c.step = 'matchBreak'
    c.timer = MATCH_BREAK_SECONDS
    this.changed = true
  }

  // ------------------------------------------------------------- reporting

  /** Matches waiting for a court, soonest first. */
  private get queue(): TournamentMatch[] {
    const onCourt = new Set(this.courtsInUse.map((c) => c.match))
    return (this.tournament?.matches ?? []).filter((m) => m.winner === null && !onCourt.has(m.id))
  }

  /** Who has been called, and who plays in the first match waiting. */
  get upNext(): string[] {
    if (this.status !== 'playing') return []
    const called = this.courtsInUse
      .filter((c) => c.step === 'calling')
      .flatMap((c) => this.onCourt(c).map((p) => p.name))
    const first = this.queue[0]
    const waiting = [first?.a, first?.b].flatMap((e) =>
      e === null || e === undefined ? [] : (this.entries[e]?.members.map((p) => p.name) ?? []),
    )
    return [...new Set([...called, ...waiting])]
  }

  view(): TournamentView {
    const t = this.tournament
    const size = teamSizeFor(this.mode)
    return {
      status: this.status,
      host: this.host,
      groupBestOf: this.groupBestOf,
      entrants: this.entered.flatMap((p) => (p.session ? [p.session] : [])),
      problem: this.status === 'signup' ? this.problem : '',
      matchCount: t ? t.matches.length : countMatches(Math.floor(this.entered.length / size)),
      entries: this.entries.map((e) => ({
        name: e.name,
        members: e.members.map((p) => p.name),
        ids: e.members.map((p) => p.session ?? ''),
      })),
      groups: t?.tables() ?? [],
      matches: t?.matches ?? [],
      courts: this.courtsInUse.map((c) => ({
        step: c.step,
        match: c.match,
        missing: this.missing(c).map((p) => p.name),
      })),
      queue: this.queue.slice(0, 4).map((m) => m.id),
      champion: t?.champion ?? null,
    }
  }
}
