import {
  RECONNECT_GRACE_SECONDS,
  WINNING_SCORE,
  WIN_BY,
  isOnFire,
  rallyHeat,
} from '@pickleball/shared'
import { useState } from 'react'
import { TEAM_NAMES, playerColor, teamColor } from '../game/colors'
import { Chat, ChatToggle } from './Chat'
import { gamePointFor } from '../game/gamePoint'
import { leaveRoom, newRoom, sendReady, sendSeat, startPractice } from '../net/session'
import { GameBreak, MatchHeader } from './Tournament'
import { PracticePanel } from './PracticePanel'
import { spectatorViews } from '../camera/views'
import {
  CAMERA_DISTANCES,
  type ConnectionStatus,
  cycleSpectatorView,
  setCameraDistance,
  useUi,
} from '../state/store'

const STATUS_STYLE: Record<ConnectionStatus, { label: string; dot: string }> = {
  idle: { label: 'Idle', dot: 'bg-slate-400' },
  connecting: { label: 'Connecting…', dot: 'bg-amber-400 animate-pulse' },
  connected: { label: 'Connected', dot: 'bg-lime-400' },
  reconnecting: { label: 'Reconnecting…', dot: 'bg-amber-400 animate-pulse' },
  disconnected: { label: 'Disconnected', dot: 'bg-red-500' },
}

/** Beyond these, the player is told what is making the game lag. */
const SLOW_FPS = 35
const SLOW_PING_MS = 180
const UNSTEADY_MS = 90

function ConnectionPill() {
  const status = useUi((s) => s.status)
  const ping = useUi((s) => s.pingMs)
  const fps = useUi((s) => s.fps)
  const jitter = useUi((s) => s.jitterMs)
  const st = STATUS_STYLE[status]
  // Says whose lag it is, so players know what to fix.
  const problem =
    status !== 'connected'
      ? null
      : fps !== null && fps < SLOW_FPS
        ? {
            label: 'Slow computer',
            tip: 'Close other tabs and apps, and check that hardware acceleration is on in the browser',
          }
        : (ping !== null && ping > SLOW_PING_MS) || jitter > UNSTEADY_MS
          ? {
              label: 'Weak connection',
              tip: 'Move closer to the router or use a cable; stop downloads and streaming',
            }
          : null
  return (
    <div
      data-testid="connection"
      className="flex items-center gap-2 rounded-full bg-slate-900/75 px-3 py-1 text-xs text-slate-200"
    >
      <span className={`h-2 w-2 rounded-full ${st.dot}`} />
      {st.label}
      {status === 'connected' && ping !== null && <span className="text-slate-400">{ping} ms</span>}
      {status === 'connected' && fps !== null && <span className="text-slate-400">{fps} fps</span>}
      {problem && (
        <span
          data-testid="lag-hint"
          title={problem.tip}
          className="pointer-events-auto font-semibold text-amber-300"
        >
          {problem.label}
        </span>
      )}
    </div>
  )
}

/** PERFECT! and other short pop-ups. */
function Callout() {
  const callout = useUi((s) => s.callout)
  if (!callout) return null
  return (
    <div
      key={callout.key}
      data-testid="callout"
      className="pb-pop text-4xl font-black tracking-wide text-yellow-300 [text-shadow:0_2px_8px_rgba(0,0,0,0.7)]"
    >
      {callout.text}
    </div>
  )
}

/** Grows and heats up as a rally goes on (shots also get faster). */
function RallyCounter() {
  const phase = useUi((s) => s.phase)
  const shots = useUi((s) => s.rallyShots)
  if (phase !== 'rally' || shots < 4) return null
  const heat = Math.min((shots - 4) / 12, 1)
  return (
    <div
      key={shots}
      data-testid="rally-counter"
      className="pb-bump font-black italic [text-shadow:0_2px_8px_rgba(0,0,0,0.7)]"
      style={{ fontSize: `${1.25 + heat * 1.5}rem`, color: `hsl(${50 - heat * 45} 100% 60%)` }}
    >
      RALLY ×{shots}
      {rallyHeat(shots) > 0 && <span className="ml-2 text-sm not-italic">SPEEDING UP!</span>}
    </div>
  )
}

function GamePoint() {
  const practice = useUi((s) => s.practice)
  const phase = useUi((s) => s.phase)
  const scores = useUi((s) => s.scores)
  const servingSlot = useUi((s) => s.servingSlot)
  if (practice || (phase !== 'serving' && phase !== 'rally') || !gamePointFor(scores, servingSlot))
    return null
  return (
    <>
      {/* Darkened edges for tension; the court stays clear. */}
      <div className="pb-pulse pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_center,transparent_55%,rgba(80,0,0,0.55))]" />
      <div
        data-testid="game-point"
        className="rounded-full px-4 py-1 font-black uppercase tracking-widest text-white shadow-lg"
        style={{ background: teamColor(servingSlot) }}
      >
        Game point — {TEAM_NAMES[servingSlot]}
      </div>
    </>
  )
}

/** For spectators: what they are, how to change camera, and how to leave. */
function SpectatorBar() {
  const view = useUi((s) => s.spectatorView)
  const free = useUi((s) => s.freeCamera)
  const tournament = useUi((s) => s.tournament)
  const hidden = useUi((s) => s.panelHidden)
  const courts = useUi((s) => s.courts)
  const focus = useUi((s) => s.focusCourt)
  return (
    <div
      data-testid="spectating"
      className="pointer-events-auto flex max-w-[calc(100vw-min(24rem,32vw)-3rem)] flex-wrap items-center gap-2 rounded-xl bg-slate-900/85 px-3 py-2 text-slate-100 shadow-lg"
    >
      <span className="font-bold">👁 Spectating</span>
      <span className="hidden text-xs text-slate-400 xl:inline">
        drag to look around, scroll to zoom
      </span>
      {courts.length > 1 && (
        <span className="flex gap-1">
          {courts.map((c, i) => (
            <button
              key={i}
              data-testid={`court-${i + 1}`}
              aria-pressed={i === focus}
              disabled={c.players.length === 0}
              title={c.players.map((p) => p.nickname).join(', ')}
              className={`rounded-lg px-2.5 py-1 text-sm font-semibold disabled:opacity-40 ${
                i === focus ? 'bg-lime-400 text-slate-900' : 'bg-slate-700 hover:bg-slate-600'
              }`}
              onClick={(e) => (e.currentTarget.blur(), useUi.setState({ watchCourt: i }))}
            >
              Court {i + 1}
            </button>
          ))}
        </span>
      )}
      <button
        data-testid="camera-view"
        className="rounded-lg bg-sky-500 px-3 py-1 text-sm font-semibold hover:bg-sky-400"
        onClick={(e) => (e.currentTarget.blur(), cycleSpectatorView())}
      >
        Camera: {free ? 'Free' : (spectatorViews(courts.length)[view]?.name ?? 'Side')} (C)
      </button>
      {tournament?.status === 'playing' && (
        <button
          data-testid="toggle-panel"
          className="rounded-lg bg-slate-700 px-3 py-1 text-sm font-semibold hover:bg-slate-600"
          onClick={(e) => (
            e.currentTarget.blur(),
            useUi.setState((s) => ({ panelHidden: !s.panelHidden }))
          )}
        >
          {hidden ? 'Show standings' : 'Hide standings'}
        </button>
      )}
      <button
        data-testid="practice-meanwhile"
        className="rounded-lg bg-amber-400 px-3 py-1 text-sm font-semibold text-slate-900 hover:bg-amber-300"
        onClick={() => void startPractice()}
      >
        🎯 Train meanwhile
      </button>
    </div>
  )
}

function Watchers() {
  const spectators = useUi((s) => s.spectators)
  if (spectators.length === 0) return null
  return (
    <span
      data-testid="watchers"
      className="rounded-full bg-slate-900/75 px-3 py-1 text-xs text-slate-200"
      title={spectators.map((s) => s.nickname).join(', ')}
    >
      👁 {spectators.length} watching
    </span>
  )
}

function Scoreboard() {
  const players = useUi((s) => s.players)
  const scores = useUi((s) => s.scores)
  const serverId = useUi((s) => s.serverId)
  const doubles = useUi((s) => s.mode === '2v2')
  const serverNumber = useUi((s) => s.serverNumber)
  return (
    <div
      data-testid="scoreboard"
      className="flex items-center gap-3 rounded-xl bg-slate-900/80 px-4 py-2 text-slate-100 shadow-lg"
    >
      {([0, 1] as const).map((slot) => {
        const team = players.filter((pl) => pl.slot === slot)
        return (
          <div
            key={slot}
            className={`flex items-center gap-2 ${slot === 1 ? 'flex-row-reverse' : ''}`}
          >
            <div className={`flex flex-col ${slot === 1 ? 'items-end' : 'items-start'}`}>
              {team.length === 0 && <span className="font-semibold">—</span>}
              {team.map((p) => (
                <span
                  key={p.id}
                  className={`flex max-w-[9rem] items-center gap-1.5 text-sm font-semibold ${
                    slot === 1 ? 'flex-row-reverse' : ''
                  }`}
                >
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ background: playerColor(p.slot, p.spot) }}
                  />
                  <span className="truncate">{p.nickname}</span>
                  {isOnFire(p.streak) && (
                    <span data-testid="on-fire" title={`${p.streak} rallies in a row`}>
                      🔥
                    </span>
                  )}
                  {p.id === serverId && (
                    <span title="Serving">🏓{doubles ? serverNumber : ''}</span>
                  )}
                </span>
              ))}
            </div>
            <span className="min-w-[1.5rem] text-center font-mono text-2xl font-black">
              {scores[slot]}
            </span>
            {slot === 0 && <span className="px-1 text-slate-500">–</span>}
          </div>
        )
      })}
    </div>
  )
}

/** What ended the rally, who did it, and what it was worth. */
function RallyBanner() {
  const practice = useUi((s) => s.practice)
  const phase = useUi((s) => s.phase)
  const rally = useUi((s) => s.lastRally)
  // Training shows results in its own panel, out of the way.
  if (practice || phase !== 'pointOver' || !rally) return null
  const color = teamColor(rally.winner)
  return (
    <div
      data-testid="rally-banner"
      className="max-w-md rounded-2xl border-2 bg-slate-950/90 px-6 py-3 text-center text-slate-100 shadow-2xl"
      style={{ borderColor: color }}
    >
      <div data-testid="rally-reason" className="text-2xl font-black uppercase tracking-wide">
        {rally.reason}
      </div>
      <div data-testid="rally-detail" className="text-sm text-slate-300">
        {rally.detail}
      </div>
      <div
        data-testid="rally-result"
        className="mt-1 rounded-md px-2 py-0.5 text-sm font-bold text-white"
        style={{ background: color }}
      >
        {rally.result}
      </div>
      {rally.ignited && (
        <div data-testid="ignited" className="mt-1 font-black text-orange-400">
          🔥 {rally.ignited} is on fire!
        </div>
      )}
    </div>
  )
}

/** Between rallies: a one-line reminder of how the last one ended. */
function LastRally() {
  const practice = useUi((s) => s.practice)
  const phase = useUi((s) => s.phase)
  const rally = useUi((s) => s.lastRally)
  if (practice || phase !== 'serving' || !rally) return null
  return (
    <div data-testid="last-rally" className="text-xs text-slate-100/90 drop-shadow">
      Last rally: {rally.reason} — {rally.detail}
    </div>
  )
}

function GameOver() {
  const tournament = useUi((s) => s.tournament !== null)
  const phase = useUi((s) => s.phase)
  const winner = useUi((s) => s.gameWinner)
  const scores = useUi((s) => s.scores)
  const players = useUi((s) => s.players)
  const sessionId = useUi((s) => s.sessionId)
  if (tournament || phase !== 'gameOver' || winner === null) return null
  const me = players.find((p) => p.id === sessionId)
  const names = players
    .filter((p) => p.slot === winner)
    .map((p) => p.nickname)
    .join(' & ')
  const ready = players.filter((p) => p.ready).length
  return (
    <div
      data-testid="game-over"
      className="pointer-events-auto w-full max-w-sm rounded-2xl border-2 bg-slate-950/90 p-6 text-center text-slate-100 shadow-2xl"
      style={{ borderColor: teamColor(winner) }}
    >
      <div className="text-4xl">🏆</div>
      <div className="text-2xl font-black">{names} won!</div>
      <div className="mb-1 text-xs uppercase tracking-widest" style={{ color: teamColor(winner) }}>
        {TEAM_NAMES[winner]}
      </div>
      <div className="mb-4 font-mono text-3xl font-black">
        {scores[winner]}–{scores[winner === 0 ? 1 : 0]}
      </div>
      {me ? (
        <>
          <button
            data-testid="rematch"
            className="mb-2 w-full rounded-lg bg-lime-400 py-3 text-lg font-bold text-slate-900 hover:bg-lime-300"
            onClick={(e) => (e.currentTarget.blur(), sendReady(!me.ready))}
          >
            {me.ready ? 'Waiting for the others…' : 'Play again'} ({ready}/{players.length})
          </button>
          <button
            data-testid="sit-out"
            className="mb-2 w-full rounded-lg bg-sky-600 py-2 font-semibold hover:bg-sky-500"
            onClick={() => sendSeat(false)}
          >
            Give up my seat and watch
          </button>
        </>
      ) : (
        <p className="mb-3 text-sm text-slate-300">
          Waiting for a rematch ({ready}/{players.length} ready). If someone gives up their seat you
          can take it.
        </p>
      )}
      <div className="flex gap-2">
        <button
          className="flex-1 rounded-lg bg-slate-700 py-2 font-semibold hover:bg-slate-600"
          onClick={() => void newRoom()}
        >
          New room
        </button>
        <button
          className="flex-1 rounded-lg bg-red-500/80 py-2 font-semibold hover:bg-red-500"
          onClick={() => void leaveRoom()}
        >
          Leave
        </button>
      </div>
    </div>
  )
}

/** Leaving mid-match ends it for everyone, so this needs a second click. */
function NewRoomButton() {
  const [sure, setSure] = useState(false)
  return (
    <button
      data-testid="new-room"
      className="rounded-lg bg-slate-800/90 px-3 py-1 text-xs font-semibold text-slate-100 hover:bg-slate-700"
      onBlur={() => setSure(false)}
      onClick={() => {
        if (sure) void newRoom()
        else setSure(true)
      }}
    >
      {sure ? 'Leave this match?' : 'New room'}
    </button>
  )
}

/** Leaving a tournament match loses it, so that needs a second click. */
function LeaveButton({ confirm }: { confirm: boolean }) {
  const [sure, setSure] = useState(false)
  return (
    <button
      data-testid="hud-leave"
      className="rounded-lg bg-red-500/80 px-3 py-1 text-xs font-semibold text-white hover:bg-red-500"
      onBlur={() => setSure(false)}
      onClick={() => {
        if (confirm && !sure) setSure(true)
        else void leaveRoom()
      }}
    >
      {sure ? 'Lose this match?' : 'Leave'}
    </button>
  )
}

function CameraChoice() {
  const distance = useUi((s) => s.cameraDistance)
  return (
    <div className="mt-2 flex items-center gap-1 border-t border-white/10 pt-2">
      <span className="mr-1 font-semibold text-slate-100">Camera</span>
      {CAMERA_DISTANCES.map((d) => (
        <button
          key={d}
          data-testid={`camera-${d}`}
          aria-pressed={d === distance}
          className={`rounded px-2 py-0.5 capitalize ${
            d === distance
              ? 'bg-lime-400 font-bold text-slate-900'
              : 'bg-slate-700 hover:bg-slate-600'
          }`}
          onClick={(e) => (e.currentTarget.blur(), setCameraDistance(d))}
        >
          {d}
        </button>
      ))}
    </div>
  )
}

function Rules() {
  const [open, setOpen] = useState(false)
  return (
    <div className="mt-2 border-t border-white/10 pt-2">
      <button
        className="font-semibold text-slate-100"
        onClick={(e) => (e.currentTarget.blur(), setOpen((o) => !o))}
      >
        Rules {open ? '▾' : '▸'}
      </button>
      {open && (
        <ul className="mt-1 list-disc space-y-0.5 pl-4">
          <li>Only the serving side scores.</li>
          <li>
            First to {WINNING_SCORE}, win by {WIN_BY}.
          </li>
          <li>Serve diagonally, past the kitchen line.</li>
          <li>The serve and the return must each bounce before they are hit.</li>
          <li>
            In the kitchen (light blue, by the net) let the ball bounce. Hitting it out of the air
            there is a fault.
          </li>
          <li>Doubles: both partners serve before the serve changes sides.</li>
        </ul>
      )}
    </div>
  )
}

export function ControlsHelp() {
  const [open, setOpen] = useState(true)
  return (
    <div className="pointer-events-auto max-w-[17rem] rounded-xl bg-slate-900/75 px-3 py-2 text-xs text-slate-200">
      <button
        className="font-semibold text-slate-100"
        onClick={(e) => (e.currentTarget.blur(), setOpen((o) => !o))}
      >
        Controls {open ? '▾' : '▸'}
      </button>
      {open && (
        <ul className="mt-1 space-y-0.5">
          <li>
            <b>W A S D</b> — move (W is toward the net)
          </li>
          <li>
            <b>Mouse</b> — aim the shot (ring on the court)
          </li>
          <li>
            <b>Left click</b> or <b>Space</b> — swing
          </li>
          <li>
            <b>Shift</b> + swing — smash
          </li>
          <li>
            <b>W</b> + <b>Shift</b> + swing — jump smash (reaches higher, hits harder)
          </li>
          <li>
            <b>Swipe the mouse</b> left / right while swinging or serving — curve it
          </li>
          <li>
            <b>Space</b> — serve (when it is your serve)
          </li>
          <li className="text-slate-400">
            The big circle is your hit zone, front and back. Swing when it lights up; red means let
            it bounce. You get two swings at each ball. Time it exactly as the ball passes you for a
            faster, more accurate PERFECT hit.
          </li>
        </ul>
      )}
      <CameraChoice />
      <Rules />
    </div>
  )
}

function Prompt() {
  const phase = useUi((s) => s.phase)
  const sessionId = useUi((s) => s.sessionId)
  const serverId = useUi((s) => s.serverId)
  const players = useUi((s) => s.players)
  const server = players.find((p) => p.id === serverId)
  const waitForBounce = useUi((s) => s.waitForBounce)
  const lastHitSlot = useUi((s) => s.lastHitSlot)
  const mySlot = useUi((s) => s.mySlot)
  const receiverId = useUi((s) => s.receiverId)
  const fed = useUi((s) => s.practice?.drill === 'machine')
  if (phase === 'rally' && waitForBounce && mySlot !== null && lastHitSlot !== mySlot) {
    return (
      <div className="rounded-xl bg-sky-400 px-4 py-2 font-bold text-slate-900 shadow-lg">
        Let it bounce first
      </div>
    )
  }
  if (phase === 'serving' && fed) return null
  if (phase === 'serving') {
    return serverId === sessionId ? (
      <div
        data-testid="serve-prompt"
        className="rounded-xl bg-lime-400 px-4 py-2 font-bold text-slate-900 shadow-lg"
      >
        Your serve! Aim at the highlighted box and press{' '}
        <kbd className="rounded bg-slate-900 px-1.5 text-lime-300">SPACE</kbd>
      </div>
    ) : (
      <div className="rounded-xl bg-slate-900/80 px-4 py-2 text-slate-100">
        {server?.nickname ?? 'Opponent'} is serving
        {receiverId === sessionId ? ' — you receive!' : '…'}
      </div>
    )
  }
  return null
}

export function Hud() {
  const phase = useUi((s) => s.phase)
  const practice = useUi((s) => s.practice)
  const tournament = useUi((s) => s.tournament)
  const message = useUi((s) => s.message)
  const roomCode = useUi((s) => s.roomCode)
  const status = useUi((s) => s.status)
  const spectating = useUi((s) => s.mySlot === null)
  // The rally counter takes over from the plain message.
  const longRally = useUi((s) => s.phase === 'rally' && s.rallyShots >= 4)
  const inMatch =
    phase === 'serving' ||
    phase === 'rally' ||
    phase === 'pointOver' ||
    phase === 'gameOver' ||
    phase === 'paused'

  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="pointer-events-auto flex flex-col items-start gap-2">
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-slate-900/75 px-3 py-1 font-mono text-xs text-slate-200">
              {practice ? '🎯 Training' : `Room ${roomCode}`}
            </span>
            <ConnectionPill />
            <Watchers />
          </div>
          {inMatch && phase !== 'gameOver' && (
            <div className="flex gap-2">
              {!spectating && !practice && !tournament && (
                <button
                  data-testid="back-to-lobby"
                  className="rounded-lg bg-slate-800/90 px-3 py-1 text-xs font-semibold text-slate-100 hover:bg-slate-700"
                  onClick={(e) => (e.currentTarget.blur(), sendReady(false))}
                >
                  Return to lobby
                </button>
              )}
              {!spectating && !practice && <ChatToggle />}
              {!practice && !tournament && <NewRoomButton />}
              <LeaveButton confirm={tournament !== null && !spectating} />
            </div>
          )}
        </div>

        {inMatch && (
          <div className="flex flex-col items-center gap-2">
            <MatchHeader />
            {!practice && <Scoreboard />}
            <GameBreak />
            {message && phase !== 'pointOver' && phase !== 'gameOver' && !longRally && (
              <div
                data-testid="message"
                className="rounded-lg bg-slate-900/70 px-3 py-1 text-sm text-slate-100"
              >
                {message}
              </div>
            )}
            <GamePoint />
            <RallyBanner />
            <RallyCounter />
            <Callout />
            <LastRally />
          </div>
        )}
        {practice ? <PracticePanel /> : <div className="w-40" />}
      </div>

      <div className="flex flex-col items-center gap-3">
        <GameOver />
        {phase === 'paused' && (
          <div
            data-testid="paused"
            className="rounded-xl bg-amber-500/90 px-5 py-3 text-center font-semibold text-slate-900 shadow-lg"
          >
            A player disconnected — waiting up to {RECONNECT_GRACE_SECONDS}s for them to come back…
          </div>
        )}
        {status === 'reconnecting' && (
          <div className="rounded-xl bg-amber-500/90 px-5 py-3 font-semibold text-slate-900 shadow-lg">
            Connection lost — reconnecting…
          </div>
        )}
      </div>

      <div className="flex items-end justify-between gap-3">
        {spectating ? <SpectatorBar /> : <ControlsHelp />}
        <div className="flex flex-col items-center gap-2">{!spectating && <Prompt />}</div>
        <div className="w-40" />
      </div>

      {!practice && <Chat />}
    </div>
  )
}
