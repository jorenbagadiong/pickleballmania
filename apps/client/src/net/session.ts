import { Client, CloseCode, type Room } from '@colyseus/sdk'
import {
  ClientMsg,
  FIXED_DT,
  type FxMessage,
  type GameMode,
  type InputFrame,
  PRACTICE_DRILLS,
  PRACTICE_LEVELS,
  type Phase,
  type PracticeDrill,
  type PracticeLevel,
  ROOM_NAME,
  ServerMsg,
  type Slot,
  type Spot,
  type TournamentMessage,
  type TournamentView,
  movementBounds,
  parseGameMode,
  serveParityFor,
  WIRE,
  fromWire,
} from '@pickleball/shared'
import { type ChatLine, type PlayerSummary, initialUiState, useUi } from '../state/store'
import { SERVER_URL } from './config'
import { LocalPrediction } from './prediction'
import { type PlayerSnap, type Snapshot, SnapshotBuffer, type WorldSample } from './snapshots'

/** Shape of the synchronized state as decoded on the client (numbers as sent: see WIRE). */
interface PlayerView {
  slot: number
  spot: number
  nickname: string
  x: number
  z: number
  vx: number
  vz: number
  yaw: number
  connected: boolean
  ready: boolean
  lastSeq: number
  swingSeq: number
  swingPower: number
  swingJump: boolean
  streak: number
}
/** One court: the room's main one, or another of a tournament. */
interface CourtView {
  score0: number
  score1: number
  serverId: string
  serverNumber: number
  receiverId: string
  gameWinner: number
  rallyReason: string
  rallyDetail: string
  rallyResult: string
  rallyIgnited: string
  rallyShots: number
  rallyWinner: number
  phase: string
  servingSlot: number
  lastHitSlot: number
  message: string
  players?: {
    forEach(cb: (p: PlayerView, id: string) => void): void
    get(id: string): PlayerView | undefined
  }
  ball?: {
    x: number
    y: number
    z: number
    vx: number
    vy: number
    vz: number
    curve: number
    visible: boolean
    held: boolean
    bounced: boolean
    mustBounce: boolean
  }
}
interface StateView extends CourtView {
  roomCode: string
  mode: string
  drill: string
  level: string
  tournament: string
  tick: number
  chat?: { forEach(cb: (m: ChatLine) => void): void }
  spectators?: { forEach(cb: (s: { nickname: string }, id: string) => void): void }
  /** Courts 2 and up. */
  courts?: { forEach(cb: (c: CourtView) => void): void }
}

const SESSION_KEY = 'pb3d.session'

export const client = new Client(SERVER_URL)
/** One per court. */
const courtSnapshots: SnapshotBuffer[] = [new SnapshotBuffer()]
/** The court being played on or watched; everything on screen is relative to it. */
let focus = 0

export function focusCourt(): number {
  return focus
}

function focused(): SnapshotBuffer {
  return courtSnapshots[focus] ?? (courtSnapshots[0] as SnapshotBuffer)
}

/** Every court as it should be drawn now. */
export function sampleCourts(now: number): (WorldSample | null)[] {
  return courtSnapshots.map((c) => c.sample(now))
}
export const prediction = new LocalPrediction()

/** Effects waiting until the interpolated world reaches the moment they happened. */
export const pendingFx: Array<FxMessage & { at: number }> = []
type FxListener = (e: FxMessage) => void
const fxListeners = new Set<FxListener>()
export function onFx(cb: FxListener): () => void {
  fxListeners.add(cb)
  return () => fxListeners.delete(cb)
}

let room: Room | null = null
let leavingOnPurpose = false
let pingTimer: ReturnType<typeof setInterval> | undefined
let lastUiKey = ''
let lastTournament = ''

export function nowSeconds(): number {
  return performance.now() / 1000
}

export function currentRoom(): Room | null {
  return room
}

/** Latest decoded state, for the render loop. */
export function latestState(): StateView | null {
  return (room?.state as StateView | undefined) ?? null
}

function courtsOf(state: StateView): CourtView[] {
  const list: CourtView[] = [state]
  state.courts?.forEach((c) => list.push(c))
  return list
}

/** The court being played on or watched. */
export function focusedCourt(): CourtView | null {
  const state = latestState()
  return state ? (courtsOf(state)[focus] ?? state) : null
}

function friendlyError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  if (/not found|expired|already consumed|bad reconnection/i.test(msg)) {
    return 'That room does not exist (or has closed). Check the code and try again.'
  }
  if (/full|locked/i.test(msg)) return 'That room is full, even for watching.'
  if (/not allowed/i.test(msg)) return msg
  if (/fetch|network|ECONNREFUSED|Failed|timed? ?out|load failed/i.test(msg) || msg === '') {
    return `Cannot reach the game server at ${SERVER_URL}. Is it running and reachable from this device? (See LOCAL_MULTIPLAYER.md → Troubleshooting.)`
  }
  return msg
}

function saveSession(r: Room): void {
  try {
    sessionStorage.setItem(
      SESSION_KEY,
      JSON.stringify({ token: r.reconnectionToken, code: r.roomId }),
    )
  } catch {
    // Storage may be unavailable (private mode); refresh-resume just won't work.
  }
}

function clearSession(): void {
  try {
    sessionStorage.removeItem(SESSION_KEY)
  } catch {
    /* ignore */
  }
}

/** A court's players, as drawn and as listed. */
function readPlayers(court: CourtView): {
  players: Map<string, PlayerSnap>
  summary: PlayerSummary[]
} {
  const players = new Map<string, PlayerSnap>()
  const summary: PlayerSummary[] = []
  court.players?.forEach((p, id) => {
    players.set(id, {
      x: fromWire(p.x, WIRE.position),
      z: fromWire(p.z, WIRE.position),
      yaw: fromWire(p.yaw, WIRE.angle),
      swingSeq: p.swingSeq,
      swingPower: p.swingPower,
      swingJump: p.swingJump,
    })
    summary.push({
      id,
      nickname: p.nickname,
      slot: p.slot as Slot,
      spot: (p.spot === 1 ? 1 : 0) as Spot,
      ready: p.ready,
      connected: p.connected,
      streak: p.streak,
    })
  })
  summary.sort((a, z) => a.slot - z.slot || a.spot - z.spot)
  return { players, summary }
}

function readCourt(court: CourtView, tick: number): Snapshot | null {
  const b = court.ball
  if (!b) return null
  return {
    time: tick * FIXED_DT,
    players: readPlayers(court).players,
    ball: {
      x: fromWire(b.x, WIRE.position),
      y: fromWire(b.y, WIRE.position),
      z: fromWire(b.z, WIRE.position),
      vx: fromWire(b.vx, WIRE.ballSpeed),
      vy: fromWire(b.vy, WIRE.ballSpeed),
      vz: fromWire(b.vz, WIRE.ballSpeed),
      curve: fromWire(b.curve, WIRE.curve),
      visible: b.visible,
      held: b.held,
      bounced: b.bounced,
      mustBounce: b.mustBounce,
    },
  }
}

/** My court while I play; otherwise the one I chose, or one with a match on it. */
function chooseFocus(courts: CourtView[], me: string): number {
  const mine = courts.findIndex((c) => c.players?.get(me))
  if (mine >= 0) return mine
  const inUse = courts.map((c) => readPlayers(c).summary.length > 0)
  const { watchCourt } = useUi.getState()
  if (inUse[watchCourt]) return watchCourt
  const first = inUse.indexOf(true)
  return first >= 0 ? first : 0
}

function onState(r: Room, state: StateView): void {
  if (!state.players || !state.ball) return
  const now = nowSeconds()
  const courts = courtsOf(state)

  courtSnapshots.length = Math.max(1, Math.min(courtSnapshots.length, courts.length))
  courts.forEach((c, i) => {
    const snap = readCourt(c, state.tick)
    if (!snap) return
    const buffer = (courtSnapshots[i] ??= new SnapshotBuffer())
    buffer.push(snap, now)
  })

  const was = focus
  focus = chooseFocus(courts, r.sessionId)
  if (focus !== was) {
    pendingFx.length = 0
    prediction.reset()
  }
  const court = courts[focus] ?? state
  const { summary } = readPlayers(court)
  const b = court.ball ?? state.ball

  const me = court.players?.get(r.sessionId)
  const phase = court.phase as Phase
  const server = court.players?.get(court.serverId)
  const serveParity = serveParityFor(
    court.servingSlot === 1 ? court.score1 : court.score0,
    server?.spot === 1 ? 1 : 0,
  )
  if (me) {
    const bounds = movementBounds(
      me.slot as Slot,
      phase,
      court.serverId === r.sessionId,
      serveParity,
    )
    prediction.reconcile(
      {
        x: fromWire(me.x, WIRE.position),
        z: fromWire(me.z, WIRE.position),
        vx: fromWire(me.vx, WIRE.runSpeed),
        vz: fromWire(me.vz, WIRE.runSpeed),
      },
      me.lastSeq,
      bounds,
    )
  } else if (prediction.ready) prediction.reset() // gave up the seat, or their match is over

  const spectators: { id: string; nickname: string }[] = []
  state.spectators?.forEach((s, id) => spectators.push({ id, nickname: s.nickname }))

  const chat: ChatLine[] = []
  state.chat?.forEach((m) => chat.push({ seq: m.seq, nickname: m.nickname, text: m.text }))

  const drill = PRACTICE_DRILLS.find((d) => d === state.drill)
  const level = PRACTICE_LEVELS.find((l) => l === state.level)
  const ui = {
    roomCode: state.roomCode || r.roomId,
    mode: parseGameMode(state.mode),
    practice: drill && level ? { drill, level } : null,
    mySlot: me ? (me.slot as Slot) : null,
    phase,
    servingSlot: court.servingSlot as Slot,
    serverId: court.serverId,
    serveParity,
    serverNumber: court.serverNumber,
    receiverId: court.receiverId,
    gameWinner: court.gameWinner < 0 ? null : (court.gameWinner as Slot),
    lastRally:
      court.rallyWinner < 0
        ? null
        : {
            winner: court.rallyWinner as Slot,
            reason: court.rallyReason,
            detail: court.rallyDetail,
            result: court.rallyResult,
            ignited: court.rallyIgnited,
          },
    rallyShots: court.rallyShots,
    waitForBounce: b.mustBounce && !b.bounced,
    scores: [court.score0, court.score1] as [number, number],
    lastHitSlot: court.lastHitSlot,
    message: court.message,
    players: summary,
    focusCourt: focus,
    courts:
      courts.length < 2
        ? []
        : courts.map((c) => ({
            players: readPlayers(c).summary,
            scores: [c.score0, c.score1] as [number, number],
          })),
    spectators,
    chat,
  }
  if (state.tournament !== lastTournament) {
    lastTournament = state.tournament
    useUi.setState({ tournament: parseTournament(state.tournament) })
  }
  const key = JSON.stringify(ui)
  if (key !== lastUiKey) {
    lastUiKey = key
    useUi.setState(ui)
  }
}

function parseTournament(json: string): TournamentView | null {
  if (!json) return null
  try {
    return JSON.parse(json) as TournamentView
  } catch {
    return null
  }
}

function resetCourts(): void {
  courtSnapshots.length = 1
  courtSnapshots[0] = new SnapshotBuffer()
  focus = 0
  jitterReadings = []
}

function attach(r: Room): void {
  room = r
  leavingOnPurpose = false
  resetCourts()
  prediction.reset()
  pendingFx.length = 0
  lastUiKey = ''
  lastTournament = ''
  saveSession(r)
  useUi.setState({
    screen: 'game',
    status: 'connected',
    error: null,
    roomCode: r.roomId,
    sessionId: r.sessionId,
  })

  r.onStateChange((s: unknown) => onState(r, s as StateView))
  r.onMessage(ServerMsg.fx, (e: FxMessage) => {
    if (e.court !== focus) return // other courts are seen, not heard
    const at = focused().displayTimeFor(e.tick * FIXED_DT) ?? nowSeconds()
    pendingFx.push({ ...e, at })
    for (const cb of fxListeners) cb(e)
  })
  r.onDrop(() => useUi.setState({ status: 'reconnecting' }))
  r.onReconnect(() => {
    saveSession(r)
    useUi.setState({ status: 'connected', sessionId: r.sessionId })
  })
  r.onError((_code: number, message?: string) => {
    console.warn('[pickleball] room error', message)
  })
  r.onLeave((code: number) => {
    const wasPurposeful = leavingOnPurpose || code === CloseCode.CONSENTED
    const inTournament = useUi.getState().tournament !== null
    const comeBack = { token: r.reconnectionToken, code: r.roomId, nickname: myNickname() }
    detach()
    clearSession()
    if (!wasPurposeful && inTournament) {
      startRejoining(comeBack)
      return
    }
    useUi.setState({
      ...initialUiState,
      cameraDistance: useUi.getState().cameraDistance,
      // What this computer can draw has not changed.
      dpr: useUi.getState().dpr,
      shadows: useUi.getState().shadows,
      crowd: useUi.getState().crowd,
      status: wasPurposeful ? 'idle' : 'disconnected',
      error: wasPurposeful ? null : 'Disconnected from the game server.',
    })
  })

  clearInterval(pingTimer)
  pingTimer = setInterval(() => {
    r.ping((ms: number) =>
      useUi.setState({
        pingMs: Math.round(ms),
        jitterMs: lastingJitter(),
      }),
    )
  }, 2000)
}

/** Loading a page or an arena delays a few updates too; only lasting trouble counts. */
let jitterReadings: number[] = []
function lastingJitter(): number {
  jitterReadings = [...jitterReadings, focused().link.jitter * 1000].slice(-3)
  return jitterReadings.length < 3 ? 0 : Math.round(Math.min(...jitterReadings))
}

function detach(): void {
  clearInterval(pingTimer)
  room = null
  resetCourts()
  prediction.reset()
  pendingFx.length = 0
}

/**
 * A tournament goes on for a long time, and laptops sleep and Wi-Fi drops while people
 * wait for their next match. When the automatic reconnect has given up, keep trying to
 * get back in: first into the place the server is still holding, then (once it has
 * let go) by name, which the tournament gives back. Joining or creating anything else
 * stops it.
 */
const REJOIN_FOR_MS = 10 * 60 * 1000
const REJOIN_EVERY_MS = 5000
let rejoining: { token: string; code: string; nickname: string; until: number } | null = null
let rejoinTimer: ReturnType<typeof setTimeout> | undefined
let rejoinBusy = false

function stopRejoining(): void {
  rejoining = null
  clearTimeout(rejoinTimer)
}

function startRejoining(target: { token: string; code: string; nickname: string }): void {
  rejoining = { ...target, until: Date.now() + REJOIN_FOR_MS }
  useUi.setState({
    ...initialUiState,
    cameraDistance: useUi.getState().cameraDistance,
    dpr: useUi.getState().dpr,
    shadows: useUi.getState().shadows,
    crowd: useUi.getState().crowd,
    status: 'reconnecting',
    error: 'Connection lost. Getting you back into the tournament…',
  })
  void tryRejoin()
}

const looksOffline = (err: unknown): boolean =>
  /fetch|network|ECONNREFUSED|Failed|timed? ?out|load failed/i.test(
    err instanceof Error ? err.message : String(err),
  ) ||
  (typeof navigator !== 'undefined' && navigator.onLine === false)

async function tryRejoin(): Promise<void> {
  const target = rejoining
  if (!target || rejoinBusy || room) return
  clearTimeout(rejoinTimer)
  rejoinBusy = true
  try {
    let joined: Room | null = null
    try {
      joined = await client.reconnect(target.token)
    } catch (err) {
      // The server has let go of the old place (or can't be reached).
      if (!looksOffline(err))
        joined = await client.joinById(target.code, { nickname: target.nickname })
      else throw err
    }
    if (rejoining !== target) {
      // Something else was chosen meanwhile.
      await joined.leave(true).catch(() => undefined)
      return
    }
    stopRejoining()
    attach(joined)
  } catch (err) {
    if (rejoining !== target) return
    const gone = !looksOffline(err)
    if (gone || Date.now() > target.until) {
      stopRejoining()
      useUi.setState({
        status: 'disconnected',
        error: gone ? 'The tournament has closed.' : 'Disconnected from the game server.',
      })
      return
    }
    rejoinTimer = setTimeout(() => void tryRejoin(), REJOIN_EVERY_MS)
  } finally {
    rejoinBusy = false
  }
}

if (typeof window !== 'undefined') {
  // Back online, or back at the computer: try at once.
  window.addEventListener('online', () => void tryRejoin())
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void tryRejoin()
  })
}

async function connect(action: () => Promise<Room>): Promise<boolean> {
  stopRejoining()
  useUi.setState({ screen: 'connecting', status: 'connecting', error: null })
  try {
    attach(await action())
    return true
  } catch (err) {
    console.warn('[pickleball] connection failed', err)
    useUi.setState({ screen: 'start', status: 'idle', error: friendlyError(err) })
    return false
  }
}

export async function createRoom(
  nickname: string,
  mode: GameMode,
  tournament = false,
): Promise<boolean> {
  const ok = await connect(() => client.create(ROOM_NAME, { nickname, mode, tournament }))
  // On a slow connection "New room" may be pressed before the first update says this.
  if (ok && lastUiKey === '') useUi.setState({ mode })
  return ok
}

export function joinRoom(code: string, nickname: string): Promise<boolean> {
  return connect(() => client.joinById(code, { nickname }))
}

/** After a page refresh, try to take back the seat we had (within the reconnect window). */
export async function resumeSavedSession(): Promise<boolean> {
  let saved: { token?: string } | null
  try {
    saved = JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? 'null') as { token?: string } | null
  } catch {
    saved = null
  }
  if (!saved?.token) return false
  const token = saved.token
  const ok = await connect(() => client.reconnect(token))
  if (!ok) {
    clearSession()
    useUi.setState({ error: null })
  }
  return ok
}

export async function leaveRoom(): Promise<void> {
  const r = room
  if (!r) return
  leavingOnPurpose = true
  clearSession()
  await r.leave(true).catch(() => undefined)
}

/** Leaves this room and opens a fresh one (same name and mode) with a new code. */
export async function newRoom(): Promise<void> {
  const { mode } = useUi.getState()
  const nickname = myNickname()
  await leaveRoom()
  await createRoom(nickname, mode)
}

function myNickname(): string {
  const { players, spectators, sessionId } = useUi.getState()
  return [...players, ...spectators].find((p) => p.id === sessionId)?.nickname ?? 'Player'
}

/** Opens a private training court, remembering the room (if any) to come back to. */
export async function startPractice(nickname = myNickname()): Promise<void> {
  const { roomCode, practice } = useUi.getState()
  const returnTo = practice ? null : roomCode
  await leaveRoom()
  const ok = await connect(() => client.create(ROOM_NAME, { nickname, practice: true }))
  if (ok) useUi.setState({ returnTo })
}

/** Back from training to the room we came from. */
export async function backToRoom(): Promise<void> {
  const { returnTo } = useUi.getState()
  if (!returnTo) return
  const nickname = myNickname()
  await leaveRoom()
  await joinRoom(returnTo, nickname)
}

export function sendPractice(drill: PracticeDrill, level: PracticeLevel): void {
  room?.send(ClientMsg.practice, { drill, level })
}

export function sendTournament(msg: TournamentMessage): void {
  room?.send(ClientMsg.tournament, msg)
}

export function sendInputs(frames: InputFrame[]): void {
  if (frames.length > 0) room?.send(ClientMsg.input, { frames })
}

export function sendSwing(
  ax: number,
  az: number,
  power: number,
  spin: number,
  jump: boolean,
): void {
  // Tell the server which moment we were looking at, so it can check the hit
  // against the ball we actually saw (it is drawn slightly in the past).
  const seen = focused().renderServerTime(nowSeconds())
  const viewTick = seen === null ? undefined : Math.round(seen / FIXED_DT)
  room?.send(ClientMsg.swing, { ax, az, power, spin, jump, viewTick })
}

export function sendServe(ax: number, az: number, spin: number): void {
  room?.send(ClientMsg.serve, { ax, az, spin })
}

export function sendReady(ready: boolean): void {
  room?.send(ClientMsg.ready, { ready })
}

export function sendSwitchTeam(team: Slot): void {
  room?.send(ClientMsg.switchTeam, { team })
}

/** Take an open seat, or give yours up to watch (not during a game). */
export function sendSeat(play: boolean): void {
  room?.send(ClientMsg.seat, { play })
}

export function sendChat(text: string): void {
  room?.send(ClientMsg.chat, { text })
}
