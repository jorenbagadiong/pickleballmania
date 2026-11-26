import {
  type AthleteId,
  type GameMode,
  type Phase,
  type PracticeDrill,
  type PracticeLevel,
  type Slot,
  type Spot,
  type TournamentView,
  parseLook,
} from '@pickleball/shared'
import { create } from 'zustand'
import { spectatorViews } from '../camera/views'
import { type Quality, fullQuality, savedQuality } from '../game/quality'

export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected'

/** Why the last rally ended, for the result banner. */
export interface RallyInfo {
  winner: Slot
  reason: string
  detail: string
  result: string
  /** Who caught fire on this rally ('' = nobody). */
  ignited: string
}

/** How the last shot in training went. */
export interface PracticeShot {
  /** Clicked at just the right moment. */
  perfect: boolean
  serve: boolean
  /** Seconds late (negative = early). */
  timing: number
  /** -1 to 1 as the player sees it (right is positive). */
  spin: number
  /** Where it landed: meters from the aim, and whether it was in (null = in the air). */
  landed: { off: number; inBounds: boolean } | null
}

export type CameraDistance = 'close' | 'normal' | 'far'
export const CAMERA_DISTANCES: readonly CameraDistance[] = ['close', 'normal', 'far']
const CAMERA_KEY = 'pb3d.camera'

const LOOK_KEY = 'pickleball.look'

function savedLook(): AthleteId | '' {
  try {
    return parseLook(localStorage.getItem(LOOK_KEY))
  } catch {
    return ''
  }
}

export function saveLook(look: AthleteId | ''): void {
  try {
    localStorage.setItem(LOOK_KEY, look)
  } catch {
    // Private browsing: it just won't be remembered.
  }
}

function startQuality(): Quality {
  if (typeof window === 'undefined') return fullQuality(1)
  let store: Storage | null = null
  try {
    store = window.localStorage
  } catch {
    // Storage blocked.
  }
  return savedQuality(window.devicePixelRatio, store)
}

function savedCamera(): CameraDistance {
  try {
    const saved = localStorage.getItem(CAMERA_KEY)
    return CAMERA_DISTANCES.find((d) => d === saved) ?? 'normal'
  } catch {
    return 'normal'
  }
}

export interface ChatLine {
  seq: number
  nickname: string
  text: string
}

export interface PlayerSummary {
  id: string
  nickname: string
  /** Team. */
  slot: Slot
  /** Position within the team. */
  spot: Spot
  ready: boolean
  connected: boolean
  /** Rallies won in a row. */
  streak: number
  /** The athlete they chose ('' = picked by name). */
  look: string
}

/**
 * UI-level state shared by DOM overlays and the 3D scene. High-frequency data
 * (positions, ball) deliberately does NOT live here — the render loop reads it
 * straight from the snapshot buffer to avoid React re-renders at 30–60 Hz.
 */
export interface UiState {
  /** Held curves (Q, E, the right button): the server turns them on for one player only. */
  cheats: boolean
  screen: 'start' | 'connecting' | 'game'
  status: ConnectionStatus
  error: string | null
  roomCode: string | null
  sessionId: string | null
  mode: GameMode
  /** Solo training (null = a normal game). */
  practice: { drill: PracticeDrill; level: PracticeLevel } | null
  practiceShot: PracticeShot | null
  /** The tournament this room is (null = an ordinary room). */
  tournament: TournamentView | null
  /** Tournament standings shown over a running game. */
  standingsOpen: boolean
  /** The lobby or tournament panel is minimized, to see the court. */
  panelHidden: boolean
  /** Court being played on or watched, and the one a spectator chose. */
  focusCourt: number
  watchCourt: number
  /** Every court, when there are several. */
  courts: { players: PlayerSummary[]; scores: [number, number] }[]
  /** A spectator is turning the camera by hand. */
  freeCamera: boolean
  /** How far behind the player the camera stays. */
  cameraDistance: CameraDistance
  /** Room to go back to after training. */
  returnTo: string | null
  /** My team. */
  mySlot: Slot | null
  phase: Phase
  /** Team serving. */
  servingSlot: Slot
  /** Session id of the player serving ('' when none). */
  serverId: string
  /** Which court the serve comes from (see serveParityFor). */
  serveParity: number
  serverNumber: number
  /** Player who must return the serve ('' when none). */
  receiverId: string
  gameWinner: Slot | null
  lastRally: RallyInfo | null
  /** The ball coming at the team that must hit it next has to bounce first. */
  waitForBounce: boolean
  /** Shots hit in the current rally. */
  rallyShots: number
  /** Short pop-up such as PERFECT!; `key` restarts its animation. */
  callout: { text: string; key: number } | null
  /** Points for team 0 and team 1. */
  scores: [number, number]
  /** Slot of the player who hit the ball last (-1 = nobody yet). */
  lastHitSlot: number
  message: string
  players: PlayerSummary[]
  /** People watching, by session id. */
  spectators: { id: string; nickname: string }[]
  /** Recent spectator messages, oldest first. */
  chat: ChatLine[]
  /** This player chose not to see chat. */
  chatHidden: boolean
  /** Which spectator camera is active. */
  spectatorView: number
  pingMs: number | null
  /** How unevenly updates from the server arrive (ms). */
  jitterMs: number
  /** Frames drawn per second, once known. */
  fps: number | null
  /** Pixels drawn per screen pixel, and what else is switched off when this computer can't draw the game smoothly. */
  dpr: number
  shadows: boolean
  crowd: boolean
  /** The athlete I play as ('' = picked by name), remembered on this computer. */
  myLook: AthleteId | ''
}

export const initialUiState: UiState = {
  cheats: false,
  screen: 'start',
  status: 'idle',
  error: null,
  roomCode: null,
  sessionId: null,
  mode: '1v1',
  practice: null,
  practiceShot: null,
  tournament: null,
  standingsOpen: false,
  panelHidden: false,
  focusCourt: 0,
  watchCourt: 0,
  courts: [],
  freeCamera: false,
  cameraDistance: savedCamera(),
  returnTo: null,
  mySlot: null,
  phase: 'waiting',
  servingSlot: 0,
  serverId: '',
  serveParity: 0,
  serverNumber: 1,
  receiverId: '',
  gameWinner: null,
  lastRally: null,
  waitForBounce: false,
  rallyShots: 0,
  callout: null,
  scores: [0, 0],
  lastHitSlot: -1,
  message: '',
  players: [],
  spectators: [],
  chat: [],
  chatHidden: false,
  spectatorView: 0,
  pingMs: null,
  jitterMs: 0,
  fps: null,
  ...startQuality(),
  myLook: savedLook(),
}

export const useUi = create<UiState>(() => initialUiState)

/** Next spectator camera (does nothing while playing). */
export function cycleSpectatorView(): void {
  useUi.setState((s) =>
    s.mySlot === null
      ? {
          // From the free camera, back to the view it started from.
          spectatorView: s.freeCamera
            ? s.spectatorView
            : (s.spectatorView + 1) % spectatorViews(s.courts.length).length,
          freeCamera: false,
        }
      : {},
  )
}

export function setCameraDistance(cameraDistance: CameraDistance): void {
  useUi.setState({ cameraDistance })
  try {
    localStorage.setItem(CAMERA_KEY, cameraDistance)
  } catch {
    /* private mode: just for this visit */
  }
}
