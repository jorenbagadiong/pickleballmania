import { type Slot, teamSizeFor } from '@pickleball/shared'
import { useState } from 'react'
import { TEAM_NAMES, playerColor, teamColor } from '../game/colors'
import { inviteUrl } from '../net/config'
import { leaveRoom, newRoom, sendReady, sendSeat, sendSwitchTeam } from '../net/session'
import { type PlayerSummary, useUi } from '../state/store'
import { CharacterPicker } from './CharacterPicker'
import { MiniBar, MiniReady, MinimizeButton } from './Minimize'
import { copyText } from './copy'

function PlayerRow({ p, isMe }: { p: PlayerSummary; isMe: boolean }) {
  return (
    <li className="flex items-center gap-2 rounded-lg bg-slate-800/80 px-3 py-2">
      <span
        className="h-3 w-3 shrink-0 rounded-full"
        style={{ background: playerColor(p.slot, p.spot) }}
      />
      <span className="flex-1 truncate font-semibold">
        {p.nickname}
        {isMe && <span className="text-slate-400"> (you)</span>}
      </span>
      {!p.connected ? (
        <span className="text-xs text-amber-300">reconnecting…</span>
      ) : p.ready ? (
        <span className="text-xs font-bold text-lime-300">READY</span>
      ) : (
        <span className="text-xs text-slate-400">not ready</span>
      )}
    </li>
  )
}

function OpenSeat() {
  return (
    <li className="flex items-center gap-2 rounded-lg border border-dashed border-slate-600 px-3 py-2 text-sm text-slate-400">
      <span className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-slate-500 border-t-transparent" />
      Open seat…
    </li>
  )
}

/** Shown over the 3D court while waiting for players / for everyone to be ready. */
export function Lobby() {
  const roomCode = useUi((s) => s.roomCode) ?? ''
  const players = useUi((s) => s.players)
  const sessionId = useUi((s) => s.sessionId)
  const phase = useUi((s) => s.phase)
  const mode = useUi((s) => s.mode)
  const teamSize = teamSizeFor(mode)
  const [copied, setCopied] = useState<'link' | 'code' | 'failed' | null>(null)
  const me = players.find((p) => p.id === sessionId)
  const link = inviteUrl(roomCode)
  const spectators = useUi((s) => s.spectators)
  const missing = teamSize * 2 - players.length
  const minimized = useUi((s) => s.panelHidden)

  const copy = async (what: 'link' | 'code'): Promise<void> => {
    const ok = await copyText(what === 'link' ? link : roomCode)
    setCopied(ok ? what : 'failed')
    setTimeout(() => setCopied(null), 2000)
  }

  if (minimized) {
    const readyCount = players.filter((p) => p.ready).length
    return (
      <MiniBar>
        <span>
          Room <b className="font-mono tracking-widest text-lime-300">{roomCode}</b>
        </span>
        <span className="text-slate-300">
          {missing > 0
            ? `${players.length}/${teamSize * 2} players`
            : `${readyCount}/${players.length} ready`}
        </span>
        {me && <MiniReady ready={me.ready} onClick={() => sendReady(!me.ready)} />}
        {!me && missing > 0 && (
          <button
            className="rounded-lg bg-lime-400 px-4 py-1 font-bold text-slate-900 hover:bg-lime-300"
            onClick={() => sendSeat(true)}
          >
            Take a seat
          </button>
        )}
      </MiniBar>
    )
  }

  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-4">
      <div
        className={`pointer-events-auto relative w-full ${teamSize === 2 ? 'max-w-xl' : 'max-w-md'} rounded-2xl border border-white/10 bg-slate-900/85 p-6 text-slate-100 shadow-2xl backdrop-blur`}
      >
        <MinimizeButton />
        <div className="mb-4 text-center">
          <div className="text-xs uppercase tracking-widest text-slate-400">
            <span
              data-testid="mode"
              className="mr-2 rounded bg-slate-700 px-1.5 py-0.5 text-slate-200"
            >
              {mode === '2v2' ? '2v2 doubles' : '1v1 singles'}
            </span>
            Room code
          </div>
          <div
            data-testid="room-code"
            className="font-mono text-4xl font-black tracking-[0.35em] text-lime-300"
          >
            {roomCode}
          </div>
        </div>

        <div className="mb-2 flex gap-2">
          <button
            data-testid="copy-invite"
            className="flex-1 rounded-lg bg-sky-500 py-2 font-semibold hover:bg-sky-400"
            onClick={() => void copy('link')}
          >
            {copied === 'link' ? 'Link copied!' : 'Copy invite link'}
          </button>
          <button
            className="rounded-lg bg-slate-700 px-4 py-2 font-semibold hover:bg-slate-600"
            onClick={() => void copy('code')}
          >
            {copied === 'code' ? 'Copied!' : 'Copy code'}
          </button>
        </div>
        <input
          readOnly
          data-testid="invite-url"
          className="mb-1 w-full rounded-md bg-slate-800 px-2 py-1 font-mono text-xs text-slate-300"
          value={link}
          onFocus={(e) => e.currentTarget.select()}
        />
        {copied === 'failed' && (
          <p className="text-xs text-amber-300">
            Couldn't copy automatically — select the link above and copy it.
          </p>
        )}

        <div className={`my-4 grid gap-3 ${teamSize === 2 ? 'grid-cols-2' : 'grid-cols-1'}`}>
          {([0, 1] as const).map((slot: Slot) => {
            const team = players.filter((pl) => pl.slot === slot)
            const canJoin = !!me && me.slot !== slot && team.length < teamSize
            return (
              <div key={slot} data-testid={`team-${slot}`}>
                <div className="mb-1 flex items-center justify-between text-xs font-semibold uppercase tracking-wider">
                  <span style={{ color: teamColor(slot) }}>{TEAM_NAMES[slot]}</span>
                  {teamSize === 2 && canJoin && (
                    <button
                      data-testid={`join-team-${slot}`}
                      className="rounded bg-slate-700 px-2 py-0.5 normal-case tracking-normal text-slate-100 hover:bg-slate-600"
                      onClick={(e) => {
                        e.currentTarget.blur()
                        sendSwitchTeam(slot)
                      }}
                    >
                      Switch here
                    </button>
                  )}
                </div>
                <ul className="space-y-2">
                  {team.map((p) => (
                    <PlayerRow key={p.id} p={p} isMe={p.id === sessionId} />
                  ))}
                  {Array.from({ length: teamSize - team.length }, (_, i) => (
                    <OpenSeat key={i} />
                  ))}
                </ul>
              </div>
            )
          })}
        </div>

        {me && (
          <div className="mb-4">
            <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-400">
              Your character
            </div>
            <CharacterPicker small />
          </div>
        )}

        {phase === 'waiting' ? (
          <p className="mb-4 text-center text-sm text-slate-400">
            Waiting for {missing} more player{missing === 1 ? '' : 's'} — send them the invite link.
            You can walk around with <b>WASD</b> while you wait.
          </p>
        ) : (
          <p className="mb-4 text-center text-sm text-slate-400">
            The match starts when everyone is ready.
          </p>
        )}

        {spectators.length > 0 && (
          <p data-testid="spectator-list" className="mb-3 text-center text-xs text-slate-400">
            👁 Watching: {spectators.map((s) => s.nickname).join(', ')}
          </p>
        )}
        {!me && (
          <button
            data-testid="take-seat"
            className="mb-2 w-full rounded-lg bg-lime-400 py-3 text-lg font-bold text-slate-900 hover:bg-lime-300 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={missing <= 0}
            onClick={() => sendSeat(true)}
          >
            {missing > 0 ? 'Take a seat and play' : 'All seats taken — you are watching'}
          </button>
        )}

        <div className="flex gap-2">
          {me && (
            <button
              data-testid="ready"
              className={`flex-1 rounded-lg py-3 text-lg font-bold transition disabled:cursor-not-allowed disabled:opacity-40 ${
                me?.ready
                  ? 'bg-slate-600 hover:bg-slate-500'
                  : 'bg-lime-400 text-slate-900 hover:bg-lime-300'
              }`}
              disabled={!me}
              onClick={(e) => {
                e.currentTarget.blur()
                sendReady(!me?.ready)
              }}
            >
              {me?.ready ? 'Not ready' : "I'm ready"}
            </button>
          )}
          {me && (
            <button
              data-testid="lobby-sit-out"
              className="rounded-lg bg-slate-700 px-4 font-semibold hover:bg-slate-600"
              onClick={() => sendSeat(false)}
            >
              Watch
            </button>
          )}
          <button
            data-testid="lobby-new-room"
            className="rounded-lg bg-slate-700 px-4 font-semibold hover:bg-slate-600"
            onClick={() => void newRoom()}
          >
            New room
          </button>
          <button
            data-testid="leave"
            className="rounded-lg bg-red-500/80 px-4 font-semibold hover:bg-red-500"
            onClick={() => void leaveRoom()}
          >
            Leave
          </button>
        </div>
      </div>
    </div>
  )
}
