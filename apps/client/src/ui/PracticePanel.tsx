import { PERFECT_TIMING_SECONDS, type PracticeDrill, type PracticeLevel } from '@pickleball/shared'
import { useEffect, useRef, useState } from 'react'
import { frame } from '../game/frame'
import { SWIPE_FULL_SPEED, SWIPE_MIN_SPEED, swipe } from '../input/swipe'
import { useRoomList } from '../net/rooms'
import { backToRoom, nowSeconds, sendPractice } from '../net/session'
import { type PracticeShot, useUi } from '../state/store'

const DRILLS: Record<PracticeDrill, string> = {
  machine: 'Machine',
  serve: 'Serves',
  rally: 'Rally',
}
const LEVELS: Record<PracticeLevel, string> = { easy: 'Easy', medium: 'Medium', hard: 'Hard' }

function Choice<T extends string>({
  options,
  value,
  testId,
  onPick,
}: {
  options: Record<T, string>
  value: T
  testId: string
  onPick(v: T): void
}) {
  return (
    <div className="grid grid-cols-3 gap-1">
      {(Object.keys(options) as T[]).map((o) => (
        <button
          key={o}
          data-testid={`${testId}-${o}`}
          aria-pressed={o === value}
          className={`rounded-md px-1 py-1 text-xs font-semibold ${
            o === value ? 'bg-amber-400 text-slate-900' : 'bg-slate-700 hover:bg-slate-600'
          }`}
          onClick={(e) => (e.currentTarget.blur(), onPick(o))}
        >
          {options[o]}
        </button>
      ))}
    </div>
  )
}

function timingText(s: PracticeShot): string {
  if (s.perfect) return 'PERFECT'
  const ms = Math.round(Math.abs(s.timing) * 1000)
  if (Math.abs(s.timing) <= PERFECT_TIMING_SECONDS) return 'On time, but too far away'
  return s.timing < 0 ? `${ms} ms early` : `${ms} ms late`
}

function curveText(spin: number): string {
  const percent = Math.round(Math.abs(spin) * 100)
  return percent === 0 ? 'Straight' : `${percent}% ${spin > 0 ? 'right' : 'left'}`
}

function landingText(s: PracticeShot): string {
  if (!s.landed) return '…'
  return `${s.landed.inBounds ? 'In' : 'Out'}, ${s.landed.off.toFixed(1)} m from your aim`
}

/** How fast the mouse is moving sideways, against what a curve needs. */
function SwipeMeter() {
  const bar = useRef<HTMLDivElement>(null)
  const [last, setLast] = useState<{ speed: number; spin: number } | null>(null)
  const seen = useRef(frame.localShot.at)

  useEffect(() => {
    let id = 0
    const draw = (): void => {
      const share = Math.max(-1, Math.min(1, swipe.speed(nowSeconds()) / SWIPE_FULL_SPEED))
      if (bar.current) {
        bar.current.style.left = `${50 + Math.min(0, share) * 50}%`
        bar.current.style.width = `${Math.abs(share) * 50}%`
        bar.current.style.background =
          Math.abs(share) * SWIPE_FULL_SPEED > SWIPE_MIN_SPEED ? '#22d3ee' : '#64748b'
      }
      const shot = frame.localShot
      if (shot.at !== seen.current) {
        seen.current = shot.at
        setLast({ speed: shot.mouseSpeed, spin: shot.spin })
      }
      id = requestAnimationFrame(draw)
    }
    draw()
    return () => cancelAnimationFrame(id)
  }, [])

  const start = (SWIPE_MIN_SPEED / SWIPE_FULL_SPEED) * 50
  const mark = last && Math.max(-1, Math.min(1, last.speed / SWIPE_FULL_SPEED))
  return (
    <div data-testid="swipe-meter">
      <div className="mb-1 flex justify-between text-[11px] text-slate-400">
        <span>◀ left</span>
        <span>mouse speed</span>
        <span>right ▶</span>
      </div>
      <div className="relative h-4 overflow-hidden rounded bg-slate-800">
        <div
          className="absolute inset-y-0 left-0 bg-cyan-400/15"
          style={{ width: `${50 - start}%` }}
        />
        <div
          className="absolute inset-y-0 right-0 bg-cyan-400/15"
          style={{ width: `${50 - start}%` }}
        />
        <div ref={bar} className="absolute inset-y-0" />
        <div className="absolute inset-y-0 left-1/2 w-px bg-white/40" />
        {mark !== null && (
          <div
            className="absolute inset-y-0 w-1 -translate-x-1/2 bg-amber-300"
            style={{ left: `${50 + mark * 50}%` }}
          />
        )}
      </div>
      <div data-testid="swipe-verdict" className="mt-1 text-xs text-slate-300">
        {last === null
          ? 'To curve: swing while the bar is in the blue part.'
          : last.spin !== 0
            ? `Your swing: curved ${curveText(last.spin)}`
            : Math.abs(last.speed) > SWIPE_MIN_SPEED / 4
              ? 'Your swing: straight — swipe faster'
              : 'Your swing: straight — the mouse was not moving when you swung'}
      </div>
    </div>
  )
}

/** The game being played meanwhile, and the way back to it. */
function WayBack() {
  const code = useUi((s) => s.returnTo)
  return code ? <WayBackTo code={code} /> : null
}

function WayBackTo({ code }: { code: string }) {
  const rooms = useRoomList()
  const myName = useUi((s) => s.players.find((p) => p.id === s.sessionId)?.nickname ?? '')
  const r = rooms?.find((x) => x.code === code)
  const status =
    rooms === null
      ? ''
      : !r
        ? 'That room has closed'
        : r.tournament?.upNext.includes(myName)
          ? 'You play next — go back!'
          : r.canPlay
            ? 'A seat is open!'
            : r.inGame
              ? `${r.players.join(' · ')}: ${r.scores[0]}–${r.scores[1]}`
              : 'The game is over'
  return (
    <div className="border-t border-white/10 pt-2">
      <div data-testid="room-status" className="mb-1 truncate text-xs text-slate-300">
        Room {code}:{' '}
        <b
          className={
            r?.tournament?.upNext.includes(myName)
              ? 'animate-pulse text-amber-300'
              : r?.canPlay
                ? 'text-lime-300'
                : ''
          }
        >
          {status}
        </b>
      </div>
      <button
        data-testid="back-to-room"
        className="w-full rounded-lg bg-sky-500 py-1.5 text-sm font-semibold hover:bg-sky-400 disabled:opacity-40"
        disabled={rooms !== null && !r}
        onClick={() => void backToRoom()}
      >
        Back to room {code}
      </button>
    </div>
  )
}

/** Solo training: what to practice, how the last shot went, and the way back. */
export function PracticePanel() {
  const practice = useUi((s) => s.practice)
  const shot = useUi((s) => s.practiceShot)
  const scores = useUi((s) => s.scores)
  const rally = useUi((s) => s.lastRally)
  const phase = useUi((s) => s.phase)
  if (!practice) return null
  const { drill, level } = practice
  const total = scores[0] + scores[1]
  return (
    <div
      data-testid="practice-panel"
      className="pointer-events-auto w-64 space-y-2 rounded-xl bg-slate-900/80 p-3 text-sm text-slate-100 shadow-lg"
    >
      <Choice
        options={DRILLS}
        value={drill}
        testId="drill"
        onPick={(d) => sendPractice(d, level)}
      />
      {drill !== 'serve' && (
        <Choice
          options={LEVELS}
          value={level}
          testId="level"
          onPick={(l) => sendPractice(drill, l)}
        />
      )}
      <div data-testid="practice-tally" className="flex justify-between">
        <span>{drill === 'rally' ? 'Rallies won' : 'Landed in'}</span>
        <b>
          {scores[0]} / {total}
        </b>
      </div>
      <div className="h-5 truncate text-xs text-slate-300" title={rally?.detail}>
        {phase === 'pointOver' && rally && (
          <span className={rally.winner === 0 ? 'text-lime-300' : 'text-amber-300'}>
            <b>{rally.reason}</b>
            {rally.reason !== 'In!' && ` — ${rally.detail}`}
          </span>
        )}
      </div>
      <dl
        data-testid="practice-shot"
        className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 border-t border-white/10 pt-2 text-xs"
      >
        <dt className="text-slate-400">Timing</dt>
        <dd>{shot ? (shot.serve ? 'Serve' : timingText(shot)) : '—'}</dd>
        <dt className="text-slate-400">Curve</dt>
        <dd>{shot ? curveText(shot.spin) : '—'}</dd>
        <dt className="text-slate-400">Landing</dt>
        <dd>{shot ? landingText(shot) : '—'}</dd>
      </dl>
      <div className="border-t border-white/10 pt-2">
        <SwipeMeter />
      </div>
      <WayBack />
    </div>
  )
}
