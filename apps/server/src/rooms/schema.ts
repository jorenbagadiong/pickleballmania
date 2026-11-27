import { Encoder, type SchemaType, schema, t } from '@colyseus/schema'

/** Room for a whole tournament and the chat in one message. */
Encoder.BUFFER_SIZE = 64 * 1024

/** Synchronized player state. Positions are authoritative server values. */
export const PlayerState = schema(
  {
    /** Team (0 = +z half, 1 = -z half). */
    slot: t.uint8().default(0),
    /** Position within the team (0 or 1). */
    spot: t.uint8().default(0),
    nickname: t.string().default(''),
    /** The athlete they chose to play as ('' = picked by name on each screen). */
    look: t.string().default(''),
    /** Position (mm), speed (mm/s) and facing (1e-4 rad): see WIRE. */
    x: t.int16().default(0),
    z: t.int16().default(0),
    vx: t.int16().default(0),
    vz: t.int16().default(0),
    yaw: t.int16().default(0),
    connected: t.boolean().default(true),
    ready: t.boolean().default(false),
    /** Last input sequence the server applied — used by the owner to reconcile prediction. */
    lastSeq: t.uint32().default(0),
    /** Increments on every swing so clients can play the animation. */
    swingSeq: t.uint16().default(0),
    swingPower: t.float32().default(0),
    swingJump: t.boolean().default(false),
    /** Rallies won in a row; on fire at FIRE_STREAK. */
    streak: t.uint8().default(0),
  },
  'PlayerState',
)
export type PlayerState = SchemaType<typeof PlayerState>

/** Someone watching; they have no place in the simulation. */
export const SpectatorState = schema({ nickname: t.string().default('') }, 'SpectatorState')
export type SpectatorState = SchemaType<typeof SpectatorState>

/** A spectator's chat message. */
export const ChatState = schema(
  {
    /** Counts up, so clients can tell messages apart. */
    seq: t.uint32().default(0),
    nickname: t.string().default(''),
    text: t.string().default(''),
  },
  'ChatState',
)
export type ChatState = SchemaType<typeof ChatState>

export const BallState = schema(
  {
    /** Position (mm) and speed (cm/s): see WIRE. */
    x: t.int16().default(0),
    y: t.int16().default(0),
    z: t.int16().default(0),
    vx: t.int16().default(0),
    vy: t.int16().default(0),
    vz: t.int16().default(0),
    /** Sideways acceleration from spin (cm/s²). */
    curve: t.int16().default(0),
    /** TEZUKA ZONE pull along the ground (cm/s²; 0 unless it is steering). */
    steerX: t.int16().default(0),
    steerZ: t.int16().default(0),
    /**
     * Session id of the player that pull is for ('' while there is no pull). Read-only,
     * for drawing the zone's attraction on the right player; it decides nothing.
     */
    steerTarget: t.string().default(''),
    visible: t.boolean().default(false),
    held: t.boolean().default(false),
    /** The shot in flight has bounced on the receiving side. */
    bounced: t.boolean().default(false),
    /** Two-bounce rule: this shot may not be volleyed. */
    mustBounce: t.boolean().default(false),
  },
  'BallState',
)
export type BallState = SchemaType<typeof BallState>

/** What one court shows (the room's main court, or another one of a tournament). */
function courtFields() {
  return {
    /** Points for team 0 and team 1 (only the serving team scores). */
    score0: t.uint16().default(0),
    score1: t.uint16().default(0),
    /** Session id of the player serving (empty outside a match). */
    serverId: t.string().default(''),
    /** Server 1 or 2 of the serving team (doubles). */
    serverNumber: t.uint8().default(1),
    /** Session id of the player who must return the serve. */
    receiverId: t.string().default(''),
    /** Team that won the game (-1 = still playing). */
    gameWinner: t.int8().default(-1),
    /** Why the last rally ended ('' = none yet) and what it was worth. */
    rallyReason: t.string().default(''),
    rallyDetail: t.string().default(''),
    rallyResult: t.string().default(''),
    rallyIgnited: t.string().default(''),
    /** Shots hit in the current rally. */
    rallyShots: t.uint16().default(0),
    rallyWinner: t.int8().default(-1),
    phase: t.string().default('waiting'),
    servingSlot: t.uint8().default(0),
    lastHitSlot: t.int8().default(-1),
    message: t.string().default(''),
    players: t.map(PlayerState),
    ball: t.ref(BallState),
  }
}

export const CourtState = schema(courtFields(), 'CourtState')
export type CourtState = SchemaType<typeof CourtState>

export const GameState = schema(
  {
    ...courtFields(),
    roomCode: t.string().default(''),
    /** '1v1' or '2v2'. */
    mode: t.string().default('1v1'),
    /** Solo training: the drill ('' = a normal game) and how hard it is. */
    drill: t.string().default(''),
    level: t.string().default(''),
    /** A TournamentView as JSON ('' = not a tournament). It changes rarely. */
    tournament: t.string().default(''),
    /** Server simulation tick (the same on every court); clients use it to timestamp snapshots. */
    tick: t.uint32().default(0),
    spectators: t.map(SpectatorState),
    chat: t.array(ChatState),
    /** Courts 2 and up of a tournament; court 1 is this state itself. */
    courts: t.array(CourtState),
  },
  'GameState',
)
export type GameState = SchemaType<typeof GameState>
