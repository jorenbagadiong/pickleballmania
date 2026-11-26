import {
  MAX_ENTRIES_DOUBLES,
  MAX_ENTRIES_SINGLES,
  type TournamentMatch,
  type TournamentView,
  courtsFor,
  groupPlan,
  teamSizeFor,
} from '@pickleball/shared'
import { type ReactNode, useState } from 'react'
import { inviteUrl } from '../net/config'
import { leaveRoom, sendReady, sendSeat, sendTournament } from '../net/session'
import { useUi } from '../state/store'
import { CharacterPicker } from './CharacterPicker'
import { MiniBar, MiniReady, MinimizeButton } from './Minimize'
import { copyText } from './copy'

/** Games won by each side of a match. */
export function gamesWon(m: TournamentMatch): [number, number] {
  const a = m.games.filter(([x, y]) => x > y).length
  return [a, m.games.length - a]
}

function nameOf(t: TournamentView, entry: number | null, hint: string): string {
  return entry === null ? hint : (t.entries[entry]?.name ?? '?')
}

function isMine(t: TournamentView, entry: number | null, session: string | null): boolean {
  return entry !== null && !!session && !!t.entries[entry]?.ids.includes(session)
}

function Panel({
  children,
  wide,
  testId,
  mini,
}: {
  children: ReactNode
  /** What is shown when the panel is minimized (without it, it can't be). */
  mini?: ReactNode
  wide?: boolean
  testId: string
}) {
  // Spectators have a chat box in the corner; leave it free.
  const chat = useUi((s) => s.mySlot === null)
  const minimized = useUi((s) => s.panelHidden)
  if (mini && minimized) return <MiniBar>{mini}</MiniBar>
  return (
    <div
      className={`pointer-events-none absolute inset-x-0 bottom-28 top-0 flex items-start justify-center overflow-y-auto p-4 pt-20 ${
        chat ? 'lg:pr-[26rem]' : ''
      }`}
    >
      <div
        data-testid={testId}
        className={`pointer-events-auto relative w-full ${wide ? 'max-w-4xl' : 'max-w-xl'} rounded-2xl border border-white/10 bg-slate-900/90 p-5 text-slate-100 shadow-2xl backdrop-blur`}
      >
        {mini && <MinimizeButton />}
        {children}
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ sign-up

/** What a tournament of this size looks like. */
function planText(entries: number, what: string): string {
  if (entries < 2) return ''
  const { groups, qualifiers } = groupPlan(entries)
  if (groups === 0) return 'Straight to the final'
  const knockout = { 2: 'the final', 4: 'semi-finals', 8: 'quarter-finals' }[qualifiers] ?? ''
  return `${entries} ${what}: ${groups === 1 ? 'one group' : `${groups} groups`}, then ${knockout}`
}

function SignUp({ t }: { t: TournamentView }) {
  const roomCode = useUi((s) => s.roomCode) ?? ''
  const mode = useUi((s) => s.mode)
  const me = useUi((s) => s.sessionId)
  const people = useUi((s) => s.spectators)
  const [copied, setCopied] = useState(false)
  const size = teamSizeFor(mode)
  const isHost = t.host === me
  const entered = people.filter((p) => t.entrants.includes(p.id))
  const watching = people.filter((p) => !t.entrants.includes(p.id))
  const iAmIn = !!me && t.entrants.includes(me)
  const entries = Math.floor(t.entrants.length / size)
  const full = t.entrants.length >= (size === 2 ? MAX_ENTRIES_DOUBLES * 2 : MAX_ENTRIES_SINGLES)
  return (
    <Panel
      testId="tournament-signup"
      mini={
        <>
          <span>
            🏆 Sign-up <b className="font-mono tracking-widest text-lime-300">{roomCode}</b>
          </span>
          <span className="text-slate-300">{entered.length} players</span>
          {isHost && t.problem === '' && (
            <button
              className="rounded-lg bg-lime-400 px-4 py-1 font-bold text-slate-900 hover:bg-lime-300"
              onClick={() => sendTournament({ action: 'start' })}
            >
              Start
            </button>
          )}
        </>
      }
    >
      <div className="mb-3 text-center">
        <div className="text-3xl">🏆</div>
        <div className="text-xl font-black">{mode} Tournament</div>
        <div className="text-xs text-slate-400">
          Room code{' '}
          <span
            data-testid="room-code"
            className="font-mono text-2xl font-black tracking-[0.25em] text-lime-300"
          >
            {roomCode}
          </span>
        </div>
        <button
          className="mt-2 rounded-lg bg-sky-500 px-4 py-1.5 text-sm font-semibold hover:bg-sky-400"
          onClick={() =>
            void copyText(inviteUrl(roomCode)).then((ok) => {
              setCopied(ok)
              setTimeout(() => setCopied(false), 2000)
            })
          }
        >
          {copied ? 'Link copied!' : 'Copy invite link'}
        </button>
      </div>

      <div className="mb-3">
        <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-400">
          Your character
        </div>
        <CharacterPicker small />
      </div>

      <div className="mb-1 text-sm font-semibold">
        Players ({entered.length})
        {size === 2 && <span className="text-slate-400"> — teams are drawn at random</span>}
      </div>
      <ul data-testid="entrants" className="mb-3 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
        {entered.map((p) => (
          <li key={p.id} className="truncate rounded-lg bg-slate-800 px-2 py-1 text-sm">
            {p.nickname}
            {p.id === me && <span className="text-slate-400"> (you)</span>}
            {p.id === t.host && <span title="Host"> 👑</span>}
          </li>
        ))}
      </ul>
      {watching.length > 0 && (
        <p className="mb-3 text-xs text-slate-400">
          👁 Watching: {watching.map((p) => p.nickname).join(', ')}
        </p>
      )}

      {isHost && (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-slate-300">Group matches:</span>
          {([3, 1] as const).map((n) => (
            <button
              key={n}
              data-testid={`best-of-${n}`}
              aria-pressed={t.groupBestOf === n}
              className={`rounded-lg px-3 py-1 font-semibold ${
                t.groupBestOf === n ? 'bg-amber-400 text-slate-900' : 'bg-slate-700'
              }`}
              onClick={() => sendTournament({ action: 'bestOf', bestOf: n })}
            >
              {n === 3 ? 'Best of 3' : 'One game (quicker)'}
            </button>
          ))}
        </div>
      )}
      <p data-testid="tournament-plan" className="mb-3 text-sm text-slate-300">
        {planText(entries, size === 2 ? 'teams' : 'players')}
        {t.matchCount > 0 && ` — ${t.matchCount} match${t.matchCount === 1 ? '' : 'es'}`}
        {t.matchCount > 0 && (t.groupBestOf === 3 ? ', best of 3' : ', knockout best of 3')}
        {entries > 1 && courtsFor(entries) > 1 && `, ${courtsFor(entries)} courts at once`}
      </p>

      <div className="flex gap-2">
        {isHost ? (
          <button
            data-testid="start-tournament"
            className="flex-1 rounded-lg bg-lime-400 py-3 font-bold text-slate-900 hover:bg-lime-300 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={t.problem !== ''}
            onClick={() => sendTournament({ action: 'start' })}
          >
            {t.problem || 'Start tournament'}
          </button>
        ) : (
          <div className="flex-1 rounded-lg bg-slate-800 py-3 text-center text-sm text-slate-300">
            {t.problem || 'Waiting for the host to start'}
          </div>
        )}
        <button
          data-testid="toggle-entry"
          className="rounded-lg bg-slate-700 px-4 font-semibold hover:bg-slate-600 disabled:opacity-40"
          disabled={!iAmIn && full}
          onClick={() => sendSeat(!iAmIn)}
        >
          {iAmIn ? 'Just watch' : full ? 'Full' : 'Play'}
        </button>
        <button
          className="rounded-lg bg-red-500/80 px-4 font-semibold hover:bg-red-500"
          onClick={() => void leaveRoom()}
        >
          Leave
        </button>
      </div>
    </Panel>
  )
}

// ---------------------------------------------------------------- standings

function Groups({ t }: { t: TournamentView }) {
  const me = useUi((s) => s.sessionId)
  const { qualifiers } = groupPlan(t.entries.length)
  const through = t.groups.length > 0 ? Math.floor(qualifiers / t.groups.length) : 0
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {t.groups.map((g) => (
        <table key={g.name} data-testid="group-table" className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-slate-400">
              <th className="pb-1 font-semibold text-slate-200">{g.name}</th>
              <th className="w-8 text-center">W</th>
              <th className="w-8 text-center">L</th>
              <th className="w-12 text-center" title="Games won minus lost">
                Games
              </th>
              <th className="w-12 text-center" title="Points won minus lost">
                Points
              </th>
            </tr>
          </thead>
          <tbody>
            {g.rows.map((r, i) => (
              <tr
                key={r.entry}
                className={`border-t border-white/5 ${isMine(t, r.entry, me) ? 'text-amber-300' : ''}`}
              >
                <td className="max-w-0 truncate py-1">
                  <span className={i < through ? 'text-lime-300' : 'text-slate-500'}>{i + 1}</span>{' '}
                  {nameOf(t, r.entry, '')}
                </td>
                <td className="text-center">{r.won}</td>
                <td className="text-center">{r.lost}</td>
                <td className="text-center">{signed(r.gameDiff)}</td>
                <td className="text-center">{signed(r.pointDiff)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ))}
    </div>
  )
}

function signed(n: number): string {
  return n > 0 ? `+${n}` : `${n}`
}

function MatchCard({ t, m }: { t: TournamentView; m: TournamentMatch }) {
  const me = useUi((s) => s.sessionId)
  const court = t.courts.findIndex((c) => c.match === m.id)
  const now = t.status === 'playing' && court >= 0 && m.winner === null
  const side = (entry: number | null, hint: string, i: 0 | 1) => {
    const won = m.winner !== null && m.winner === entry
    return (
      <div
        className={`flex items-center gap-2 ${
          m.winner !== null && !won ? 'text-slate-500' : won ? 'font-bold' : ''
        } ${entry === null ? 'italic text-slate-500' : ''}`}
      >
        <span className={`flex-1 truncate ${isMine(t, entry, me) ? 'text-amber-300' : ''}`}>
          {nameOf(t, entry, hint)}
        </span>
        <span className="font-mono text-xs">{m.games.map((g) => g[i]).join('  ')}</span>
        {won && m.walkover && <span className="text-xs text-slate-400">walkover</span>}
      </div>
    )
  }
  return (
    <div
      className={`rounded-lg px-2.5 py-1.5 text-sm ${now ? 'bg-lime-400/15 ring-1 ring-lime-400' : 'bg-slate-800'}`}
    >
      <div className="text-[11px] uppercase tracking-wide text-slate-400">
        {m.label}
        {now && <span className="ml-2 text-lime-300">court {court + 1}</span>}
      </div>
      {side(m.a, m.hintA, 0)}
      {side(m.b, m.hintB, 1)}
    </div>
  )
}

/** Group tables, the knockout, and every group match. */
export function Standings({ t }: { t: TournamentView }) {
  const [all, setAll] = useState(false)
  const knockout = t.matches.filter((m) => m.stage !== 'group')
  const group = t.matches.filter((m) => m.stage === 'group')
  return (
    <div data-testid="standings" className="space-y-4">
      {t.groups.length > 0 && <Groups t={t} />}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {knockout.map((m) => (
          <MatchCard key={m.id} t={t} m={m} />
        ))}
      </div>
      {group.length > 0 && (
        <div>
          <button
            className="mb-2 text-sm font-semibold text-slate-300"
            onClick={(e) => (e.currentTarget.blur(), setAll((v) => !v))}
          >
            Group matches ({group.filter((m) => m.winner !== null).length}/{group.length}){' '}
            {all ? '▾' : '▸'}
          </button>
          {all && (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {group.map((m) => (
                <MatchCard key={m.id} t={t} m={m} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ matches

/** The match on a court. */
function matchOn(t: TournamentView, court: number): TournamentMatch | undefined {
  const id = t.courts[court]?.match
  return id === null || id === undefined ? undefined : t.matches[id]
}

/** What else is going on: the other courts, and who is up next. */
function Elsewhere({ t, court }: { t: TournamentView; court: number }) {
  const me = useUi((s) => s.sessionId)
  const others = t.courts
    .map((_, i) => ({ i, m: matchOn(t, i) }))
    .filter(({ i, m }) => i !== court && m)
  const queue = t.queue.map((id) => t.matches[id]).filter((m) => m !== undefined)
  const next = queue[0]
  const iAmNext = !!next && (isMine(t, next.a, me) || isMine(t, next.b, me))
  return (
    <div className="space-y-0.5 text-center text-xs text-slate-400">
      {others.map(({ i, m }) => (
        <div key={i}>
          Court {i + 1}: {nameOf(t, m?.a ?? null, '')} vs {nameOf(t, m?.b ?? null, '')}
        </div>
      ))}
      {iAmNext && <div className="text-sm font-bold text-amber-300">You play next</div>}
      {next && (
        <div>
          Next: {nameOf(t, next.a, next.hintA)} vs {nameOf(t, next.b, next.hintB)} ({next.label})
        </div>
      )}
    </div>
  )
}

/** For the host: move on when the players of a called match don't show up. */
function HostControls({ t }: { t: TournamentView }) {
  const isHost = useUi((s) => s.sessionId === t.host)
  const players = useUi((s) => s.players)
  const courts = useUi((s) => s.courts)
  if (!isHost) return null
  const rows = t.courts.flatMap((c, court) => {
    const m = matchOn(t, court)
    if (c.step !== 'calling' || !m) return []
    const there = courts.length > 0 ? (courts[court]?.players ?? []) : players
    const ready = (entry: number | null): boolean =>
      entry !== null && !!t.entries[entry]?.ids.every((id) => there.find((p) => p.id === id)?.ready)
    return (['a', 'b'] as const).flatMap((side) =>
      ready(side === 'a' ? m.b : m.a)
        ? []
        : [{ court, side, name: nameOf(t, side === 'a' ? m.a : m.b, '') }],
    )
  })
  if (rows.length === 0) return null
  return (
    <details className="mt-2 text-center text-xs text-slate-300">
      <summary data-testid="host-controls" className="cursor-pointer">
        Host: someone isn't showing up
      </summary>
      <div className="mt-1 flex flex-wrap justify-center gap-2">
        {rows.map(({ court, side, name }) => (
          <button
            key={`${court}${side}`}
            data-testid={`walkover-${court}-${side}`}
            className="rounded bg-slate-700 px-2 py-1 hover:bg-slate-600"
            onClick={(e) => (
              e.currentTarget.blur(),
              sendTournament({ action: 'walkover', court, side })
            )}
          >
            Court {court + 1}: {name} wins without playing
          </button>
        ))}
      </div>
    </details>
  )
}

/** A called match: its players get ready, everyone else sees where things stand. */
function MatchCall({ t }: { t: TournamentView }) {
  const me = useUi((s) => s.sessionId)
  const players = useUi((s) => s.players)
  const court = useUi((s) => s.focusCourt)
  const m = matchOn(t, court)
  if (!m) return null
  const missing = t.courts[court]?.missing ?? []
  const mine = players.find((p) => p.id === me)
  return (
    <Panel
      testId="match-call"
      wide
      mini={
        <>
          <span>
            {t.courts.length > 1 && `Court ${court + 1}: `}
            <b>{nameOf(t, m.a, m.hintA)}</b> vs <b>{nameOf(t, m.b, m.hintB)}</b>
          </span>
          {mine && <MiniReady ready={mine.ready} onClick={() => sendReady(!mine.ready)} />}
        </>
      }
    >
      <div className="text-center">
        <div className="text-xs uppercase tracking-widest text-slate-400">
          {t.courts.length > 1 && `Court ${court + 1} · `}
          {m.label} · {m.bestOf === 3 ? 'best of 3' : 'one game'}
        </div>
        <div data-testid="match-names" className="my-1 text-2xl font-black">
          {nameOf(t, m.a, m.hintA)} <span className="text-slate-500">vs</span>{' '}
          {nameOf(t, m.b, m.hintB)}
        </div>
        {missing.length > 0 ? (
          <div data-testid="missing" className="text-sm text-amber-300">
            Waiting up to a minute for {missing.join(' and ')} to come back
          </div>
        ) : (
          <div className="text-sm text-slate-300">
            {players.map((p) => (
              <span key={p.id} className="mx-2">
                {p.nickname} {p.ready ? <b className="text-lime-300">ready</b> : '…'}
              </span>
            ))}
          </div>
        )}
        {mine && (
          <button
            data-testid="ready"
            className={`mt-3 w-64 rounded-lg py-3 text-lg font-bold ${
              mine.ready ? 'bg-slate-600' : 'bg-lime-400 text-slate-900 hover:bg-lime-300'
            }`}
            onClick={(e) => (e.currentTarget.blur(), sendReady(!mine.ready))}
          >
            {mine.ready ? 'Not ready' : "It's your match — I'm ready"}
          </button>
        )}
        <div className="mt-2">
          <Elsewhere t={t} court={court} />
        </div>
        <HostControls t={t} />
      </div>
      <div className="mt-4 border-t border-white/10 pt-4">
        <Standings t={t} />
      </div>
    </Panel>
  )
}

function MatchResult({ t }: { t: TournamentView }) {
  const court = useUi((s) => s.focusCourt)
  const m = matchOn(t, court)
  if (!m) return null
  return (
    <Panel
      testId="match-result"
      wide
      mini={
        <span>
          {m.label}: <b>{nameOf(t, m.winner, '')}</b> won
        </span>
      }
    >
      <div className="text-center">
        <div className="text-xs uppercase tracking-widest text-slate-400">{m.label}</div>
        <div className="text-2xl font-black">{nameOf(t, m.winner, '')} won</div>
        <div className="font-mono text-slate-300">
          {m.walkover
            ? 'walkover — the other side left'
            : m.games.map(([a, b]) => `${a}–${b}`).join('   ')}
        </div>
      </div>
      <div className="mt-4 border-t border-white/10 pt-4">
        <Standings t={t} />
      </div>
    </Panel>
  )
}

function Champion({ t }: { t: TournamentView }) {
  const me = useUi((s) => s.sessionId)
  return (
    <Panel testId="champion" wide>
      <div className="text-center">
        <div className="pb-bump text-6xl">🏆</div>
        <div className="text-xs uppercase tracking-widest text-amber-300">Champion</div>
        <div data-testid="champion-name" className="text-4xl font-black">
          {nameOf(t, t.champion, '')}
        </div>
      </div>
      <div className="my-4 border-y border-white/10 py-4">
        <Standings t={t} />
      </div>
      <div className="flex gap-2">
        {t.host === me ? (
          <button
            data-testid="tournament-again"
            className="flex-1 rounded-lg bg-lime-400 py-3 font-bold text-slate-900 hover:bg-lime-300"
            onClick={() => sendTournament({ action: 'again' })}
          >
            New tournament, same people
          </button>
        ) : (
          <div className="flex-1 py-3 text-center text-sm text-slate-400">
            The host can start another one
          </div>
        )}
        <button
          className="rounded-lg bg-red-500/80 px-4 font-semibold hover:bg-red-500"
          onClick={() => void leaveRoom()}
        >
          Leave
        </button>
      </div>
    </Panel>
  )
}

/** Over the court whenever no game is being played on it. */
export function TournamentScreen() {
  const t = useUi((s) => s.tournament)
  const court = useUi((s) => s.focusCourt)
  if (!t) return null
  if (t.status === 'signup') return <SignUp t={t} />
  if (t.status === 'done') return <Champion t={t} />
  const step = t.courts[court]?.step ?? 'idle'
  if (step === 'playing' || step === 'gameBreak') return <StandingsOverlay t={t} />
  if (step === 'calling') return <MatchCall t={t} />
  if (step === 'matchBreak') return <MatchResult t={t} />
  return (
    <Panel testId="waiting-panel" wide mini={<span>No match on this court right now</span>}>
      <Elsewhere t={t} court={court} />
      <Standings t={t} />
    </Panel>
  )
}

/** During a game: the standings, only when asked for. */
function StandingsOverlay({ t }: { t: TournamentView }) {
  const open = useUi((s) => s.standingsOpen)
  const court = useUi((s) => s.focusCourt)
  if (!open) return null
  return (
    <Panel testId="standings-overlay" wide>
      <div className="mb-3">
        <Elsewhere t={t} court={court} />
        <HostControls t={t} />
      </div>
      <Standings t={t} />
    </Panel>
  )
}

/** Above the scoreboard during a match: which match, which game. */
export function MatchHeader() {
  const t = useUi((s) => s.tournament)
  const court = useUi((s) => s.focusCourt)
  const open = useUi((s) => s.standingsOpen)
  if (!t || t.status !== 'playing') return null
  const step = t.courts[court]?.step
  const m = matchOn(t, court)
  if (!m || (step !== 'playing' && step !== 'gameBreak')) return null
  const [a, b] = gamesWon(m)
  const game = m.games.length + (step === 'playing' ? 1 : 0)
  return (
    <div
      data-testid="match-header"
      className="pointer-events-auto flex items-center gap-3 rounded-full bg-slate-900/80 px-4 py-1 text-sm text-slate-100"
    >
      <b>
        🏆 {m.label}
        {t.courts.length > 1 && ` · Court ${court + 1}`}
      </b>
      {m.bestOf === 3 && (
        <span>
          Game {game} of 3 · games{' '}
          <b>
            {a}–{b}
          </b>
        </span>
      )}
      <button
        data-testid="toggle-standings"
        className="rounded-full bg-slate-700 px-2 text-xs hover:bg-slate-600"
        onClick={(e) => (
          e.currentTarget.blur(),
          useUi.setState((s) => ({ standingsOpen: !s.standingsOpen }))
        )}
      >
        {open ? 'Hide standings' : 'Standings'}
      </button>
    </div>
  )
}

/** Between the games of a match. */
export function GameBreak() {
  const t = useUi((s) => s.tournament)
  const court = useUi((s) => s.focusCourt)
  if (!t || t.status !== 'playing' || t.courts[court]?.step !== 'gameBreak') return null
  const m = matchOn(t, court)
  const last = m?.games.at(-1)
  if (!m || !last) return null
  const winner = last[0] > last[1] ? m.a : m.b
  return (
    <div
      data-testid="game-break"
      className="rounded-2xl bg-slate-950/90 px-6 py-3 text-center text-slate-100 shadow-2xl"
    >
      <div className="text-xl font-black">
        {nameOf(t, winner, '')} took game {m.games.length}, {Math.max(...last)}–{Math.min(...last)}
      </div>
      <div className="text-sm text-slate-300">Game {m.games.length + 1} is about to start…</div>
    </div>
  )
}
