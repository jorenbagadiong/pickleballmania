/** Wire protocol shared by client and server. */

export const ROOM_NAME = 'pickleball'

/** 1v1 singles or 2v2 doubles; chosen when the room is created. */
export type GameMode = '1v1' | '2v2'
export const GAME_MODES: readonly GameMode[] = ['1v1', '2v2']

export function parseGameMode(input: unknown): GameMode {
  return input === '2v2' ? '2v2' : '1v1'
}

export function teamSizeFor(mode: GameMode): 1 | 2 {
  return mode === '2v2' ? 2 : 1
}

export function maxPlayersFor(mode: GameMode): number {
  return teamSizeFor(mode) * 2
}
/** People who can watch one room. */
export const MAX_SPECTATORS = 20
/** Everyone in a tournament room, playing or watching. */
export const MAX_TOURNAMENT_PEOPLE = 40

export const DEFAULT_SERVER_PORT = 2567

/** Server simulation rate (Hz). Clients predict their own movement at the same rate. */
export const TICK_RATE = 60
export const FIXED_DT = 1 / TICK_RATE
/** How often the server sends state patches (ms). */
export const PATCH_INTERVAL_MS = 33

/** Games are played to 11, and must be won by 2. */
export const WINNING_SCORE = 11
export const WIN_BY = 2

/** Rallies in a row a player must win to catch fire (a visual effect only). */
export const FIRE_STREAK = 3

export function isOnFire(streak: number): boolean {
  return streak >= FIRE_STREAK
}

/** Seconds a dropped player has to reconnect before their seat is released. */
export const RECONNECT_GRACE_SECONDS = 30
/**
 * In a tournament, someone who is only waiting for their next match keeps their place
 * this long: a laptop that went to sleep, or Wi-Fi that was gone for a while, comes
 * back to the same place. (On court, the match can't wait that long.)
 */
export const TOURNAMENT_WAIT_GRACE_SECONDS = 600

export const NICKNAME_MAX_LENGTH = 16
export const ROOM_CODE_LENGTH = 5
/** Unambiguous characters only (no 0/O, 1/I/L). */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

export type Phase =
  /** Not every seat is filled yet. */
  | 'waiting'
  /** All seats filled, waiting for everyone to press Ready. */
  | 'lobby'
  /** The serving player holds the ball and may serve. */
  | 'serving'
  /** Ball in play. */
  | 'rally'
  /** Rally finished; showing the result before the next serve. */
  | 'pointOver'
  /** Someone won the game; waiting for everyone to want a rematch. */
  | 'gameOver'
  /** A player dropped and may reconnect. */
  | 'paused'

/** Client -> server message types. */
export const ClientMsg = {
  input: 'input',
  swing: 'swing',
  serve: 'serve',
  ready: 'ready',
  switchTeam: 'switchTeam',
  seat: 'seat',
  chat: 'chat',
  practice: 'practice',
  tournament: 'tournament',
  look: 'look',
} as const

/** The athletes people can play as (see tools/characters); '' means picked by name. */
export const ATHLETES = ['m1', 'm2', 'm3', 'f1', 'f2', 'f3'] as const
export type AthleteId = (typeof ATHLETES)[number]

/** A chosen athlete, or '' (picked by name) for anything else. */
export function parseLook(input: unknown): AthleteId | '' {
  return ATHLETES.find((a) => a === input) ?? ''
}

/** Server -> client message types. */
export const ServerMsg = {
  fx: 'fx',
} as const

/** One fixed-step input sample. Movement is a world-space intent; aim is a ground point. */
export interface InputFrame {
  seq: number
  mx: number
  mz: number
  ax: number
  az: number
}

export interface InputMessage {
  frames: InputFrame[]
}

export interface SwingMessage {
  ax: number
  az: number
  /** 0..1: NORMAL_SHOT_POWER, or DRIVE_SHOT_POWER when Shift is held. */
  power: number
  /** Sidespin as the player sees it: -1 curves left, 1 curves right, 0 is straight. */
  spin: number
  /** Jumping for it (only counts for a smash while moving forward). */
  jump: boolean
  /** Server tick the player was seeing when they clicked (their interpolated view). */
  viewTick: number
}

export interface ServeMessage {
  ax: number
  az: number
  /** Sidespin, as in SwingMessage. */
  spin: number
}

export interface ReadyMessage {
  ready: boolean
}

export interface SwitchTeamMessage {
  team: 0 | 1
}

/** Take an open seat (true) or give it up to watch (false). */
export interface SeatMessage {
  play: boolean
}

/** A chat message. Only spectators may send; everyone in the room sees it. */
export interface ChatMessage {
  text: string
}

/** Solo training: what to practice, and how hard. */
export type PracticeDrill = 'machine' | 'serve' | 'rally'
export const PRACTICE_DRILLS: readonly PracticeDrill[] = ['machine', 'serve', 'rally']
export type PracticeLevel = 'easy' | 'medium' | 'hard'
export const PRACTICE_LEVELS: readonly PracticeLevel[] = ['easy', 'medium', 'hard']

export interface PracticeMessage {
  drill: PracticeDrill
  level: PracticeLevel
}

/** From the host of a tournament. */
export type TournamentMessage =
  | { action: 'start' }
  /** Games per group match. */
  | { action: 'bestOf'; bestOf: 1 | 3 }
  /** Give the match called on a court to this side, as the other isn't here or ready. */
  | { action: 'walkover'; court: number; side: 'a' | 'b' }
  /** Back to signing up, after a finished tournament. */
  | { action: 'again' }

/** One entry in the room list (GET /rooms). */
export interface RoomSummary {
  code: string
  mode: GameMode
  /** A seat is open; otherwise joining means watching. */
  canPlay: boolean
  /** A game is being played. */
  inGame: boolean
  players: string[]
  seats: number
  spectators: number
  scores: [number, number]
  /** A tournament: signing up, being played, or over; and who plays next. */
  tournament: { status: 'signup' | 'playing' | 'done'; upNext: string[] } | null
}

export interface JoinOptions {
  nickname: string
  /** Only used when creating a room. */
  mode?: GameMode
  /** Only used when creating a room: a private court to train on alone. */
  practice?: boolean
  /** Only used when creating a room: a tournament. */
  tournament?: boolean
  /** Which athlete to play as ('' or missing: picked by name). */
  look?: string
}

/** One-shot visual events broadcast by the server. */
export type FxEvent =
  | {
      kind: 'hit'
      slot: number
      id: string
      x: number
      y: number
      z: number
      power: number
      /** Sidespin: curves toward +x (1) or -x (-1). */
      spin: number
      /** Clicked at just the right moment. */
      perfect: boolean
      /** How late the click was (seconds; negative = early). 0 for a serve. */
      timing: number
      /** A jump smash. */
      jump: boolean
    }
  | { kind: 'bounce'; x: number; z: number; inBounds: boolean }
  | { kind: 'net'; x: number; y: number; z: number }

/** An FxEvent stamped with the court and the server tick it happened on, so clients can show it in sync. */
export type FxMessage = FxEvent & { tick: number; court: number }

export function sanitizeNickname(input: unknown): string {
  const raw = typeof input === 'string' ? input : ''
  // Strip control characters, collapse whitespace.
  const cleaned = Array.from(raw.normalize('NFKC'))
    .filter((ch) => {
      const code = ch.codePointAt(0) ?? 0
      return code >= 0x20 && code !== 0x7f
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
  const clipped = Array.from(cleaned).slice(0, NICKNAME_MAX_LENGTH).join('')
  return clipped.length > 0 ? clipped : 'Player'
}

export const CHAT_MAX_LENGTH = 120
/** Recent messages kept for people who join later. */
export const CHAT_HISTORY = 30

/** Cleans a chat message ('' = nothing worth sending). */
export function sanitizeChat(input: unknown): string {
  if (typeof input !== 'string') return ''
  // Cap the work before cleaning; control characters and line breaks become spaces.
  const cleaned = Array.from(input.slice(0, CHAT_MAX_LENGTH * 4).normalize('NFC'))
    .map((ch) => {
      const code = ch.codePointAt(0) ?? 0
      return code < 0x20 || code === 0x7f ? ' ' : ch
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
  return Array.from(cleaned).slice(0, CHAT_MAX_LENGTH).join('').trim()
}

export function normalizeRoomCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, ROOM_CODE_LENGTH)
}

export function isValidRoomCode(code: string): boolean {
  if (code.length !== ROOM_CODE_LENGTH) return false
  for (const ch of code) if (!ROOM_CODE_ALPHABET.includes(ch)) return false
  return true
}
