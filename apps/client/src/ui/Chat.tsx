import { CHAT_MAX_LENGTH } from '@pickleball/shared'
import { type FormEvent, useEffect, useRef, useState } from 'react'
import { sendChat } from '../net/session'
import { type ChatLine, useUi } from '../state/store'

/** Players only ever see this many lines, and each one fades away by itself. */
const PLAYER_LINES = 3
const HIDE_KEY = 'pb3d.hideChat'

function Line({ m }: { m: ChatLine }) {
  return (
    <>
      <b className="text-sky-300">{m.nickname}</b> {m.text}
    </>
  )
}

/**
 * For players: spectator messages as faint captions in the corner. It ignores
 * the mouse (clicks and aiming pass straight through), takes no keyboard focus
 * and makes no sound.
 */
function PlayerFeed({ chat }: { chat: ChatLine[] }) {
  return (
    <ul
      data-testid="chat-feed"
      className="pointer-events-none absolute bottom-3 right-3 flex w-[min(20rem,28vw)] select-none flex-col items-end gap-1.5"
    >
      {chat.slice(-PLAYER_LINES).map((m) => (
        <li
          key={m.seq}
          className="pb-chat-fade line-clamp-3 max-w-full rounded-lg bg-slate-950/55 px-3 py-1.5 text-lg leading-snug text-slate-100 [overflow-wrap:anywhere]"
        >
          <Line m={m} />
        </li>
      ))}
    </ul>
  )
}

/** For spectators: the whole recent chat, with a box to write in. */
function SpectatorChat({ chat }: { chat: ChatLine[] }) {
  const [text, setText] = useState('')
  const list = useRef<HTMLUListElement>(null)
  useEffect(() => {
    const el = list.current
    if (el) el.scrollTop = el.scrollHeight
  }, [chat])

  const onSubmit = (e: FormEvent): void => {
    e.preventDefault()
    if (!text.trim()) return
    sendChat(text)
    setText('')
  }

  return (
    <div
      data-testid="chat"
      className="pointer-events-auto absolute bottom-3 right-3 flex w-[min(24rem,32vw)] flex-col rounded-xl bg-slate-900/75 text-lg leading-snug text-slate-100 shadow-lg"
    >
      <ul
        ref={list}
        data-testid="chat-log"
        className="max-h-[22vh] min-h-24 space-y-1.5 overflow-y-auto px-4 pt-3 [overflow-wrap:anywhere]"
      >
        {chat.length === 0 && <li className="text-slate-400">Say something to the court…</li>}
        {chat.map((m) => (
          <li key={m.seq}>
            <Line m={m} />
          </li>
        ))}
      </ul>
      <form onSubmit={onSubmit} className="flex gap-2 p-3">
        <input
          data-testid="chat-input"
          aria-label="Chat message"
          className="min-w-0 flex-1 rounded-md border border-white/10 bg-slate-800 px-3 py-2 outline-none ring-sky-400 focus:ring-2"
          value={text}
          maxLength={CHAT_MAX_LENGTH}
          placeholder="Message…"
          autoComplete="off"
          onChange={(e) => setText(e.target.value)}
          // Back to the game (so C changes the camera again).
          onKeyDown={(e) => e.key === 'Escape' && e.currentTarget.blur()}
        />
        <button
          type="submit"
          data-testid="chat-send"
          className="rounded-md bg-sky-500 px-4 font-semibold hover:bg-sky-400"
        >
          Send
        </button>
      </form>
    </div>
  )
}

function loadHidden(): boolean {
  try {
    return localStorage.getItem(HIDE_KEY) === '1'
  } catch {
    return false
  }
}

export function setChatHidden(hidden: boolean): void {
  useUi.setState({ chatHidden: hidden })
  try {
    localStorage.setItem(HIDE_KEY, hidden ? '1' : '0')
  } catch {
    /* just not remembered */
  }
}

export function Chat() {
  const chat = useUi((s) => s.chat)
  const spectating = useUi((s) => s.mySlot === null)
  const hidden = useUi((s) => s.chatHidden)
  useEffect(() => useUi.setState({ chatHidden: loadHidden() }), [])
  if (spectating) return <SpectatorChat chat={chat} />
  return hidden ? null : <PlayerFeed chat={chat} />
}

/** Lets a player turn the captions off completely. */
export function ChatToggle() {
  const hidden = useUi((s) => s.chatHidden)
  return (
    <button
      data-testid="chat-toggle"
      className="rounded-lg bg-slate-800/90 px-3 py-1 text-xs font-semibold text-slate-100 hover:bg-slate-700"
      onClick={(e) => (e.currentTarget.blur(), setChatHidden(!hidden))}
    >
      {hidden ? 'Show chat' : 'Hide chat'}
    </button>
  )
}
