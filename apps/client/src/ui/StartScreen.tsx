import {
  GAME_MODES,
  type GameMode,
  NICKNAME_MAX_LENGTH,
  ROOM_CODE_LENGTH,
  isValidRoomCode,
  normalizeRoomCode,
} from '@pickleball/shared'
import { type FormEvent, useState } from 'react'
import { unlockAudio } from '../audio/sfx'
import { SERVER_URL } from '../net/config'
import { roomStatus, useRoomList } from '../net/rooms'
import { createRoom, joinRoom, startPractice } from '../net/session'
import { useUi } from '../state/store'

const NICK_KEY = 'pb3d.nickname'

function loadNickname(): string {
  try {
    return localStorage.getItem(NICK_KEY) ?? ''
  } catch {
    return ''
  }
}

function saveNickname(name: string): void {
  try {
    localStorage.setItem(NICK_KEY, name)
  } catch {
    /* ignore */
  }
}

/** Every room on the server. Open seats can be played; running games can be watched. */
function RoomList({ canJoin, onJoin }: { canJoin: boolean; onJoin(code: string): void }) {
  const rooms = useRoomList()
  return (
    <section className="mb-5" data-testid="room-list">
      <h2 className="mb-2 text-sm font-medium text-slate-300">Rooms right now</h2>
      {rooms === null && <p className="text-sm text-slate-500">Looking for rooms…</p>}
      {rooms?.length === 0 && (
        <p className="text-sm text-slate-500">No rooms yet. Create the first one!</p>
      )}
      <ul className="max-h-56 space-y-2 overflow-y-auto">
        {rooms?.map((r) => (
          <li
            key={r.code}
            data-testid={`room-${r.code}`}
            className="flex items-center gap-3 rounded-lg bg-slate-800/80 px-3 py-2"
          >
            <div className="min-w-0 flex-1">
              <div className="truncate font-semibold">{r.players.join(', ') || 'Empty seats'}</div>
              <div className="text-xs text-slate-400">
                <span className="font-mono">{r.code}</span> · {r.mode} · {roomStatus(r)}
                {r.spectators > 0 && ` · 👁 ${r.spectators}`}
              </div>
            </div>
            <button
              data-testid={`join-${r.code}`}
              title={canJoin ? undefined : 'Enter a nickname first'}
              className={`shrink-0 rounded-lg px-4 py-1.5 font-bold text-white transition disabled:cursor-not-allowed disabled:opacity-40 ${
                r.canPlay ? 'bg-lime-600 hover:bg-lime-500' : 'bg-sky-600 hover:bg-sky-500'
              }`}
              disabled={!canJoin}
              onClick={() => onJoin(r.code)}
            >
              {r.canPlay ? 'Play' : 'Watch'}
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

export function StartScreen() {
  const screen = useUi((s) => s.screen)
  const error = useUi((s) => s.error)
  const busy = screen === 'connecting'
  const [nickname, setNickname] = useState(loadNickname)
  const [mode, setMode] = useState<GameMode>('1v1')
  const [tournament, setTournament] = useState(false)
  const [code, setCode] = useState(() =>
    normalizeRoomCode(new URLSearchParams(window.location.search).get('room') ?? ''),
  )
  const invited = code.length > 0
  const nickOk = nickname.trim().length > 0
  const codeOk = isValidRoomCode(code)

  const onCreate = (): void => {
    if (!nickOk || busy) return
    unlockAudio()
    saveNickname(nickname.trim())
    void createRoom(nickname.trim(), mode, tournament)
  }

  const join = (roomCode: string): void => {
    if (!nickOk || busy) return
    unlockAudio()
    saveNickname(nickname.trim())
    void joinRoom(roomCode, nickname.trim())
  }

  const onJoin = (e: FormEvent): void => {
    e.preventDefault()
    if (codeOk) join(code)
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-sky-900 via-slate-900 to-emerald-950 p-4 text-slate-100">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-slate-900/80 p-8 shadow-2xl backdrop-blur">
        <div className="mb-6 text-center">
          <div className="mb-2 text-5xl">🏓</div>
          <h1 className="text-3xl font-black tracking-tight">Pickleball 3D</h1>
          <p className="mt-1 text-sm text-slate-400">Online pickleball with friends — 1v1 or 2v2</p>
        </div>

        <label className="mb-1 block text-sm font-medium text-slate-300" htmlFor="nickname">
          Your nickname
        </label>
        <input
          id="nickname"
          data-testid="nickname"
          className="mb-5 w-full rounded-lg border border-white/10 bg-slate-800 px-3 py-2.5 text-lg outline-none ring-lime-400 focus:ring-2"
          value={nickname}
          maxLength={NICKNAME_MAX_LENGTH}
          placeholder="e.g. DinkMaster"
          autoFocus
          onChange={(e) => setNickname(e.target.value)}
        />

        {!invited && (
          <>
            <div className="mb-3 grid grid-cols-2 gap-2" role="radiogroup" aria-label="Game mode">
              {GAME_MODES.map((m) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={mode === m}
                  data-testid={`mode-${m}`}
                  className={`rounded-lg border px-3 py-2 text-left transition ${
                    mode === m
                      ? 'border-lime-400 bg-lime-400/15 text-lime-200'
                      : 'border-white/10 bg-slate-800 text-slate-300 hover:bg-slate-700'
                  }`}
                  onClick={() => setMode(m)}
                >
                  <div className="font-bold">{m === '1v1' ? '1v1 Singles' : '2v2 Doubles'}</div>
                  <div className="text-xs opacity-70">
                    {m === '1v1' ? '2 players' : '4 players'}
                  </div>
                </button>
              ))}
            </div>
            <label className="mb-3 flex cursor-pointer items-center gap-2 rounded-lg bg-slate-800/60 px-3 py-2 text-sm">
              <input
                type="checkbox"
                data-testid="tournament"
                className="h-4 w-4 accent-amber-400"
                checked={tournament}
                onChange={(e) => setTournament(e.target.checked)}
              />
              <span>
                <b>🏆 Tournament</b>{' '}
                <span className="text-slate-400">
                  — groups, then a knockout{mode === '2v2' && '; teams drawn at random'}
                </span>
              </span>
            </label>
            <button
              data-testid="create-room"
              className="w-full rounded-lg bg-lime-400 py-3 text-lg font-bold text-slate-900 transition hover:bg-lime-300 disabled:cursor-not-allowed disabled:opacity-40"
              disabled={!nickOk || busy}
              onClick={onCreate}
            >
              {busy ? 'Connecting…' : `Create ${mode} ${tournament ? 'Tournament' : 'Room'}`}
            </button>
            <div className="my-5 flex items-center gap-3 text-xs uppercase tracking-wider text-slate-500">
              <div className="h-px flex-1 bg-white/10" /> or join a room{' '}
              <div className="h-px flex-1 bg-white/10" />
            </div>
          </>
        )}

        {!invited && <RoomList canJoin={nickOk && !busy} onJoin={join} />}

        <form onSubmit={onJoin}>
          <label className="mb-1 block text-sm font-medium text-slate-300" htmlFor="room-code">
            Have a room code?
          </label>
          <div className="flex gap-2">
            <input
              id="room-code"
              data-testid="room-code-input"
              className="w-full rounded-lg border border-white/10 bg-slate-800 px-3 py-2.5 font-mono text-lg uppercase tracking-[0.3em] outline-none ring-lime-400 focus:ring-2"
              value={code}
              maxLength={ROOM_CODE_LENGTH}
              placeholder="ABCDE"
              onChange={(e) => setCode(normalizeRoomCode(e.target.value))}
            />
            <button
              type="submit"
              data-testid="join-room"
              className="shrink-0 rounded-lg bg-sky-500 px-5 font-bold text-white transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-40"
              disabled={!nickOk || !codeOk || busy}
            >
              {busy ? '…' : 'Join Room'}
            </button>
          </div>
        </form>

        {invited && (
          <button
            className="mt-4 w-full text-sm text-slate-400 underline-offset-2 hover:underline"
            onClick={() => {
              setCode('')
              window.history.replaceState(null, '', window.location.pathname)
            }}
          >
            Create my own room instead
          </button>
        )}

        <button
          data-testid="practice"
          className="mt-5 w-full rounded-lg border border-amber-400/50 bg-amber-400/10 py-2.5 font-bold text-amber-200 transition hover:bg-amber-400/20 disabled:cursor-not-allowed disabled:opacity-40"
          disabled={!nickOk || busy}
          onClick={() => {
            unlockAudio()
            saveNickname(nickname.trim())
            void startPractice(nickname.trim())
          }}
        >
          🎯 Training — practice alone
        </button>

        {error && (
          <p
            data-testid="error"
            className="mt-5 rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-200"
          >
            {error}
          </p>
        )}

        <p className="mt-6 text-center text-xs text-slate-500">
          Game server: <span className="font-mono">{SERVER_URL}</span>
        </p>
      </div>
    </div>
  )
}
