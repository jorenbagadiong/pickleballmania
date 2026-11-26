import { type AuthContext, type Client, Room, ServerError } from '@colyseus/core'
import {
  CHAT_HISTORY,
  ClientMsg,
  type GameMode,
  MAX_COURTS,
  MAX_SPECTATORS,
  MAX_TOURNAMENT_PEOPLE,
  PATCH_INTERVAL_MS,
  RECONNECT_GRACE_SECONDS,
  TOURNAMENT_WAIT_GRACE_SECONDS,
  WIRE,
  ServerMsg,
  TICK_RATE,
  maxPlayersFor,
  parseGameMode,
  teamSizeFor,
  sanitizeChat,
  sanitizeNickname,
  isCheaterName,
  parseLook,
  toWire,
} from '@pickleball/shared'
import { GameSimulation } from '../simulation/GameSimulation'
import { COACH_ID, COACH_LOOK, PracticeSimulation } from '../simulation/PracticeSimulation'
import { TournamentRunner } from '../tournament/TournamentRunner'
import { isHostMachine } from './hostMachine'
import { releaseRoomCode, reserveRoomCode } from './roomCodes'
import { listRoom, unlistRoom } from './roomDirectory'
import { ChatState, CourtState, GameState, PlayerState, SpectatorState } from './schema'

/** At most this many chat messages per person per window. */
const CHAT_PER_WINDOW = 4
const CHAT_WINDOW_MS = 5000

export interface RoomCreateOptions {
  allowedOrigins?: string[]
}

/**
 * Network adapter around GameSimulation: validates who may send what, feeds
 * commands into the simulation, runs it on a fixed timestep and mirrors its
 * state into the synchronized schema.
 */
interface JoinAuth {
  /** Joined from the computer running the server. */
  onHost: boolean
}

export class PickleballRoom extends Room<{ state: GameState }> {
  override maxClients = 2
  override patchRate = PATCH_INTERVAL_MS
  override state = new GameState()

  /** Court 1; a tournament has more. */
  private sim = new GameSimulation()
  private courts: GameSimulation[] = [this.sim]
  private allowedOrigins: string[] = []
  private code = ''
  private chatSeq = 0
  private runner: TournamentRunner | null = null
  /** People whose connection dropped but may come back. */
  private readonly dropped = new Set<string>()
  private readonly chatTimes = new Map<string, number[]>()
  /** The athlete each person chose, by session ('' = picked by name). */
  private readonly looks = new Map<string, string>()
  /** Players with held curves on (see onJoin). */
  private readonly cheaters = new Set<string>()

  override onCreate(options: RoomCreateOptions & Record<string, unknown>): void {
    this.allowedOrigins = Array.isArray(options.allowedOrigins) ? options.allowedOrigins : []
    // The creator picks 1v1 or 2v2; joiners can't change it.
    const mode = parseGameMode(options.mode)
    const training = options.practice === true ? new PracticeSimulation() : null
    this.maxClients = training ? 1 : maxPlayersFor(mode) + MAX_SPECTATORS
    this.sim = training ?? new GameSimulation(teamSizeFor(mode))
    this.state.mode = training ? '1v1' : mode
    if (!training && options.tournament === true) {
      this.maxClients = MAX_TOURNAMENT_PEOPLE
      this.courts = Array.from({ length: MAX_COURTS }, (_, i) =>
        i === 0 ? this.sim : new GameSimulation(teamSizeFor(mode)),
      )
      this.runner = new TournamentRunner(mode, this.courts, (id) => !this.dropped.has(id))
    } else this.courts = [this.sim]
    this.code = reserveRoomCode()
    this.roomId = this.code
    this.state.roomCode = this.code
    // Not in Colyseus matchmaking; people join by code, invite link or the room list.
    void this.setPrivate(true)
    if (training) {
      this.looks.set(COACH_ID, COACH_LOOK)
      this.onMessage(ClientMsg.practice, (_client, msg: unknown) => training.setDrill(msg))
    } else this.list(mode)

    // Anyone may change who they play as, at any time; everyone sees it.
    this.onMessage(ClientMsg.look, (client, msg: unknown) => {
      this.looks.set(client.sessionId, parseLook((msg as { look?: unknown } | null)?.look))
      this.syncState()
    })
    this.onMessage(ClientMsg.input, (client, msg: unknown) =>
      this.courtOf(client.sessionId).queueInputs(client.sessionId, msg),
    )
    this.onMessage(ClientMsg.swing, (client, msg: unknown) =>
      this.courtOf(client.sessionId).requestSwing(client.sessionId, msg),
    )
    this.onMessage(ClientMsg.serve, (client, msg: unknown) =>
      this.courtOf(client.sessionId).requestServe(client.sessionId, msg),
    )
    this.onMessage(ClientMsg.switchTeam, (client, msg: unknown) => {
      if (!this.runner) this.sim.switchTeam(client.sessionId, msg)
    })
    this.onMessage(ClientMsg.tournament, (client, msg: unknown) =>
      this.runner?.command(client.sessionId, msg),
    )
    this.onMessage(ClientMsg.seat, (client, msg: unknown) =>
      this.changeSeat(client.sessionId, (msg as { play?: unknown } | null)?.play),
    )
    this.onMessage(ClientMsg.chat, (client, msg: unknown) =>
      this.chat(client.sessionId, (msg as { text?: unknown } | null)?.text),
    )
    this.onMessage(ClientMsg.ready, (client, msg: unknown) => {
      // A tournament match, once begun, can't be stopped or restarted by its players.
      if (this.runner && !this.runner.mayReady(client.sessionId)) return
      const ready = (msg as { ready?: unknown } | null)?.ready
      this.courtOf(client.sessionId).setReady(client.sessionId, ready)
    })

    this.setFixedTimestep((ctx) => {
      this.courts.forEach((sim, court) => {
        for (const e of sim.step(ctx.dt)) {
          this.broadcast(ServerMsg.fx, { ...e, tick: sim.tick, court })
        }
      })
      this.runner?.step60(ctx.dt)
      this.syncState()
    }, TICK_RATE)
  }

  /** The court someone is playing on (court 1 for everyone else). */
  private courtOf(id: string): GameSimulation {
    return this.courts.find((c) => c.players.has(id)) ?? this.sim
  }

  /** Puts this room in the room list (training courts are private). */
  private list(mode: GameMode): void {
    listRoom(this.code, () => ({
      code: this.code,
      mode,
      canPlay: this.runner ? this.runner.hasRoom : !this.sim.isFull,
      inGame: this.runner ? this.runner.status === 'playing' : this.sim.inGame,
      players:
        this.runner && this.runner.status !== 'playing'
          ? this.runner.present().map((p) => p.name)
          : this.courts.flatMap((c) => [...c.players.values()].map((p) => p.nickname)),
      seats: this.sim.capacity,
      spectators: this.state.spectators.size,
      scores: [this.sim.scores[0], this.sim.scores[1]],
      tournament: this.runner && { status: this.runner.status, upNext: this.runner.upNext },
    }))
  }

  /** Becomes `client.auth`: whether they play on the computer running the server. */
  override onAuth(_client: Client, _options: unknown, context: AuthContext): JoinAuth {
    const auth = { onHost: isHostMachine(context.ip) }
    if (this.allowedOrigins.length === 0) return auth
    const origin = context.headers.get('origin')?.replace(/\/$/, '')
    if (origin && this.allowedOrigins.includes(origin)) return auth
    throw new ServerError(403, 'This page is not allowed to join games on this server')
  }

  override onJoin(client: Client, options: { nickname?: unknown; look?: unknown } = {}): void {
    const nickname = sanitizeNickname(options.nickname)
    this.looks.set(client.sessionId, parseLook(options.look))
    // Held curves: only for "cheater" on the host's own computer, told to them alone.
    if (isCheaterName(nickname) && (client.auth as JoinAuth | undefined)?.onHost === true) {
      this.cheaters.add(client.sessionId)
      client.send(ServerMsg.cheats, { on: true })
    }
    if (this.runner) {
      this.runner.join(client.sessionId, nickname)
      this.syncState()
      return
    }
    // Seats are only open while no game is running; everyone else watches.
    if (!this.sim.addPlayer(client.sessionId, nickname)) {
      if (this.state.spectators.size >= MAX_SPECTATORS) throw new ServerError(409, 'Room is full')
      this.addSpectator(client.sessionId, nickname)
    }
    this.syncState()
  }

  /** Spectators may write; players only read, so chat never competes with playing. */
  private chat(id: string, raw: unknown): void {
    const spectator = this.state.spectators.get(id)
    const text = sanitizeChat(raw)
    if (!spectator || text === '') return
    const now = Date.now()
    const recent = (this.chatTimes.get(id) ?? []).filter((t) => now - t < CHAT_WINDOW_MS)
    if (recent.length >= CHAT_PER_WINDOW) return
    recent.push(now)
    this.chatTimes.set(id, recent)

    const m = new ChatState()
    m.seq = ++this.chatSeq
    m.nickname = spectator.nickname
    m.text = text
    this.state.chat.push(m)
    while (this.state.chat.length > CHAT_HISTORY) this.state.chat.shift()
  }

  private addSpectator(id: string, nickname: string): void {
    const s = new SpectatorState()
    s.nickname = nickname
    this.state.spectators.set(id, s)
  }

  /** A spectator takes an open seat, or a player gives theirs up (not mid-game). */
  private changeSeat(id: string, play: unknown): void {
    if (this.runner) {
      this.runner.setEntered(id, play)
      return
    }
    const spectator = this.state.spectators.get(id)
    if (play === true && spectator) {
      if (this.sim.addPlayer(id, spectator.nickname)) this.state.spectators.delete(id)
    } else if (play === false && !this.sim.inGame) {
      const player = this.sim.players.get(id)
      if (!player || this.state.spectators.size >= MAX_SPECTATORS) return
      this.sim.removePlayer(id)
      this.addSpectator(id, player.nickname)
    }
    this.syncState()
  }

  override onDrop(client: Client): void {
    this.dropped.add(client.sessionId)
    const onCourt = this.courts.some((c) => c.players.has(client.sessionId))
    this.courtOf(client.sessionId).setConnected(client.sessionId, false)
    this.syncState()
    const grace = this.runner && !onCourt ? TOURNAMENT_WAIT_GRACE_SECONDS : RECONNECT_GRACE_SECONDS
    // Rejects when the grace period expires or the room shuts down; onLeave handles cleanup.
    this.allowReconnection(client, grace).catch(() => undefined)
  }

  override onReconnect(client: Client): void {
    this.dropped.delete(client.sessionId)
    if (this.cheaters.has(client.sessionId)) client.send(ServerMsg.cheats, { on: true })
    this.courtOf(client.sessionId).setConnected(client.sessionId, true)
    this.syncState()
  }

  override onLeave(client: Client): void {
    this.dropped.delete(client.sessionId)
    this.cheaters.delete(client.sessionId)
    if (this.runner) this.runner.leave(client.sessionId)
    else this.sim.removePlayer(client.sessionId)
    this.state.spectators.delete(client.sessionId)
    this.chatTimes.delete(client.sessionId)
    this.looks.delete(client.sessionId)
    this.syncState()
  }

  override onDispose(): void {
    unlistRoom(this.code)
    releaseRoomCode(this.code)
  }

  /** Whoever isn't on court is watching. */
  private syncTournament(runner: TournamentRunner): void {
    const s = this.state
    const here = runner.present()
    for (const { session, name } of here) {
      if (this.courts.some((c) => c.players.has(session))) s.spectators.delete(session)
      else if (!s.spectators.has(session)) this.addSpectator(session, name)
    }
    if (!runner.changed) return
    runner.changed = false
    s.tournament = JSON.stringify(runner.view())
  }

  /** Copies the simulations into the synchronized schema (only changed fields are sent). */
  private syncState(): void {
    const s = this.state
    const sim = this.sim
    s.tick = sim.tick
    if (sim instanceof PracticeSimulation) {
      s.drill = sim.drill
      s.level = sim.level
    }
    syncCourt(s, sim, this.looks)
    if (!this.runner) return
    // Extra courts appear when the tournament needs them.
    const extra = this.runner.courtCount - 1
    while (s.courts.length > extra) s.courts.pop()
    while (s.courts.length < extra) s.courts.push(new CourtState())
    for (let i = 0; i < extra; i++) {
      const court = s.courts[i]
      const simulation = this.courts[i + 1]
      if (court && simulation) syncCourt(court, simulation, this.looks)
    }
    this.syncTournament(this.runner)
  }
}

/** Copies one simulation into a court's state. */
function syncCourt(
  s: GameState | CourtState,
  sim: GameSimulation,
  looks: ReadonlyMap<string, string>,
): void {
  s.phase = sim.phase
  s.servingSlot = sim.servingSlot
  s.serverId = sim.serverId ?? ''
  s.serverNumber = sim.serverNumber
  s.receiverId = sim.receiverId ?? ''
  s.gameWinner = sim.gameWinner ?? -1
  s.rallyReason = sim.lastRally?.reason ?? ''
  s.rallyDetail = sim.lastRally?.detail ?? ''
  s.rallyResult = sim.lastRally?.result ?? ''
  s.rallyIgnited = sim.lastRally?.ignited ?? ''
  s.rallyShots = sim.rallyShots
  s.rallyWinner = sim.lastRally?.winner ?? -1
  s.score0 = sim.scores[0]
  s.score1 = sim.scores[1]
  s.lastHitSlot = sim.lastHitSlot
  s.message = sim.message

  for (const id of [...s.players.keys()]) if (!sim.players.has(id)) s.players.delete(id)
  for (const [id, p] of sim.players) {
    let ps = s.players.get(id)
    if (!ps) {
      ps = new PlayerState()
      s.players.set(id, ps)
    }
    ps.slot = p.slot
    ps.nickname = p.nickname
    ps.look = looks.get(id) ?? ''
    ps.x = toWire(p.x, WIRE.position)
    ps.z = toWire(p.z, WIRE.position)
    ps.vx = toWire(p.vx, WIRE.runSpeed)
    ps.vz = toWire(p.vz, WIRE.runSpeed)
    ps.yaw = toWire(p.yaw, WIRE.angle)
    ps.connected = p.connected
    ps.ready = p.ready
    ps.spot = p.spot
    ps.lastSeq = p.lastSeq
    ps.swingSeq = p.swingSeq
    ps.streak = p.streak
    ps.swingJump = p.swingJump
    ps.swingPower = p.swing?.power ?? ps.swingPower
  }

  const b = sim.ball
  const sb = s.ball
  sb.x = toWire(b.x, WIRE.position)
  sb.y = toWire(b.y, WIRE.position)
  sb.z = toWire(b.z, WIRE.position)
  sb.vx = toWire(b.vx, WIRE.ballSpeed)
  sb.vy = toWire(b.vy, WIRE.ballSpeed)
  sb.vz = toWire(b.vz, WIRE.ballSpeed)
  sb.curve = toWire(b.curve ?? 0, WIRE.curve)
  sb.visible = b.visible
  sb.held = b.held
  sb.bounced = sim.ballBounced
  sb.mustBounce = sim.mustBounce
}
