/**
 * Real-network integration test: boots the actual Colyseus game server on a
 * local port and connects independent SDK clients over WebSocket.
 */
import type { Server } from '@colyseus/core'
import { Client, type Room } from '@colyseus/sdk'
import {
  CHAT_MAX_LENGTH,
  ClientMsg,
  ROOM_NAME,
  type RoomSummary,
  type TournamentView,
  WIRE,
} from '@pickleball/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createGameServer } from '../src/app'

const PORT = 25670 + Math.floor(Math.random() * 200)
const URL = `http://127.0.0.1:${PORT}`

interface PlayerView {
  slot: number
  spot: number
  nickname: string
  look: string
  x: number
  z: number
  connected: boolean
  lastSeq: number
}
interface StateView {
  roomCode: string
  mode: string
  score0: number
  score1: number
  serverId: string
  phase: string
  servingSlot: number
  lastHitSlot: number
  spectators: Map<string, { nickname: string }>
  chat: { seq: number; nickname: string; text: string }[] & { length: number }
  players: Map<string, PlayerView> & { size: number; values(): IterableIterator<PlayerView> }
  ball: { x: number; y: number; z: number; vz: number; held: boolean; visible: boolean }
}

let server: Server

async function waitFor(check: () => boolean, label: string, timeoutMs = 4000): Promise<void> {
  const start = Date.now()
  const safe = (): boolean => {
    try {
      return check()
    } catch {
      return false
    }
  }
  while (!safe()) {
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for: ${label}`)
    await new Promise((r) => setTimeout(r, 20))
  }
}

function state(room: Room): StateView {
  return room.state as unknown as StateView
}

function players(room: Room): PlayerView[] {
  return [...state(room).players.values()]
}

beforeAll(async () => {
  server = createGameServer({ allowedOrigins: [] })
  await server.listen(PORT, '127.0.0.1')
})

afterAll(async () => {
  await server.gracefullyShutdown(false)
})

describe('multiplayer room over real WebSockets', () => {
  it('two clients play a synchronized match; a third watches; disconnects are handled', async () => {
    const alice = new Client(URL)
    const bob = new Client(URL)
    const carol = new Client(URL)

    // Create a private room and receive a room code.
    const ra = await alice.create(ROOM_NAME, { nickname: 'Alice' })
    const code = ra.roomId
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{5}$/)
    await waitFor(() => state(ra).roomCode === code, 'room code in state')
    expect(state(ra).phase).toBe('waiting')

    // Join by code; both see two players on opposite sides.
    const rb = await bob.joinById(code, { nickname: 'Bob' })
    await waitFor(() => state(ra).players.size === 2 && state(rb).players.size === 2, 'two players')
    const slots = players(rb)
      .map((p) => p.slot)
      .sort()
    expect(slots).toEqual([0, 1])
    expect(state(rb).phase).toBe('lobby')

    // Seats are full, so a third person watches. Their game commands do nothing.
    const rw = await carol.joinById(code, { nickname: 'Carol' })
    await waitFor(() => state(ra).spectators.size === 1, 'Carol is watching')
    expect(state(ra).players.size).toBe(2)
    rw.send(ClientMsg.seat, { play: true }) // no seat free
    rw.send(ClientMsg.ready, { ready: true })
    await new Promise((r) => setTimeout(r, 150))
    expect(state(rw).players.size).toBe(2)

    // Alice moves; Bob sees the authoritative position change and Alice gets her ack.
    const aliceOnBob = () => players(rb).find((p) => p.nickname === 'Alice') as PlayerView
    const startX = aliceOnBob().x
    for (let seq = 1; seq <= 20; seq++) {
      ra.send(ClientMsg.input, { frames: [{ seq, mx: 1, mz: 0, ax: 0, az: -3 }] })
    }
    // Positions travel in millimeters (WIRE).
    await waitFor(() => aliceOnBob().x > startX + WIRE.position, 'Alice position synced to Bob')
    await waitFor(
      () => players(ra).find((p) => p.nickname === 'Alice')?.lastSeq === 20,
      'Alice input ack',
    )

    // Both ready → serving; Alice serves; both see the same ball in flight.
    ra.send(ClientMsg.ready, { ready: true })
    rb.send(ClientMsg.ready, { ready: true })
    await waitFor(() => state(ra).phase === 'serving' && state(rb).phase === 'serving', 'serving')
    expect(state(rb).ball.held).toBe(true)

    // Bob cannot serve out of turn.
    rb.send(ClientMsg.serve, { ax: 1.5, az: 4.5 })
    await new Promise((r) => setTimeout(r, 150))
    expect(state(rb).phase).toBe('serving')

    // Nor can a spectator serve, and nobody can swap seats mid-game.
    rw.send(ClientMsg.serve, { ax: -1.5, az: -4.5 })
    rb.send(ClientMsg.seat, { play: false })
    await new Promise((r) => setTimeout(r, 150))
    expect(state(rb).phase).toBe('serving')
    expect(state(rb).players.size).toBe(2)

    ra.send(ClientMsg.serve, { ax: -1.5, az: -4.5 })
    await waitFor(() => state(ra).phase === 'rally' && state(rb).phase === 'rally', 'rally')
    await waitFor(() => state(rw).phase === 'rally' && state(rw).ball.z < 0, 'spectator sees it')
    await waitFor(() => state(rb).ball.z < 0, 'ball crossed the net on Bob’s screen')
    expect(state(ra).ball.vz).toBeLessThan(0)
    expect(Math.abs(state(ra).ball.z - state(rb).ball.z)).toBeLessThan(WIRE.position)

    // The rally resolves identically on both clients.
    await waitFor(() => state(ra).phase === 'pointOver', 'rally resolved', 6000)
    await waitFor(() => state(rb).phase === 'pointOver', 'rally resolved for Bob')
    const scoreA = [state(ra).score0, state(ra).score1]
    const scoreB = [state(rb).score0, state(rb).score1]
    expect(scoreA).toEqual(scoreB)
    expect(scoreA).toEqual([1, 0]) // Bob never returned it → it bounced twice; Alice's team scores

    // Bob drops (network loss, not a consented leave) → paused for Alice.
    const bobToken = rb.reconnectionToken
    rb.reconnection.enabled = false
    rb.connection.close()
    await waitFor(() => state(ra).phase === 'paused', 'paused after drop')
    expect(players(ra).find((p) => p.nickname === 'Bob')?.connected).toBe(false)

    // While Bob's seat is held, nobody else can take it.
    rw.send(ClientMsg.seat, { play: true })
    await new Promise((r) => setTimeout(r, 150))
    expect(state(ra).players.size).toBe(2)

    // Bob reconnects (e.g. after a refresh) into the same seat; scores are kept.
    const rb2 = await bob.reconnect(bobToken)
    await waitFor(() => state(ra).phase === 'serving', 'resumed after reconnect')
    await waitFor(() => state(rb2).players.size === 2, 'Bob has state again')
    expect(state(rb2).score0).toBe(1)

    // Bob leaves for good → Alice is back to waiting, room stays usable.
    await rb2.leave(true)
    await waitFor(() => state(ra).phase === 'waiting' && state(ra).players.size === 1, 'waiting')
    rw.send(ClientMsg.seat, { play: true })
    await waitFor(() => state(rw).players.size === 2, 'spectator took the freed seat')
    expect(players(rw).find((p) => p.nickname === 'Carol')?.slot).toBe(1)
    expect(state(rw).spectators.size).toBe(0)

    // Everyone leaves → room is disposed and the code no longer works.
    await rw.leave(true)
    await ra.leave(true)
    await new Promise((r) => setTimeout(r, 300))
    await expect(new Client(URL).joinById(code, { nickname: 'Late' })).rejects.toThrow()
  }, 20000)
})

describe('2v2 room over real WebSockets', () => {
  it('seats four players on two teams, lets a fifth watch, and starts a doubles match', async () => {
    const clients = ['A', 'B', 'C', 'D', 'E'].map(() => new Client(URL))
    const [ca, cb, cc, cd, ce] = clients as [Client, Client, Client, Client, Client]
    const ra = await ca.create(ROOM_NAME, { nickname: 'Ann', mode: '2v2' })
    const code = ra.roomId
    await waitFor(() => state(ra).mode === '2v2', 'mode synced')

    // A joiner can't change the mode.
    const rb = await cb.joinById(code, { nickname: 'Ben', mode: '1v1' })
    const rc = await cc.joinById(code, { nickname: 'Cat' })
    await waitFor(() => state(ra).players.size === 3, 'three players')
    expect(state(rb).mode).toBe('2v2')
    expect(state(ra).phase).toBe('waiting')

    const rd = await cd.joinById(code, { nickname: 'Dan' })
    const re = await ce.joinById(code, { nickname: 'Eve' })
    await waitFor(() => state(ra).spectators.size === 1, 'Eve is watching')

    const rooms = [ra, rb, rc, rd]
    await waitFor(() => rooms.every((r) => state(r).players.size === 4), 'everyone sees four')
    const teamOf = (r: Room, name: string) => players(r).find((p) => p.nickname === name)?.slot
    expect([teamOf(rd, 'Ann'), teamOf(rd, 'Ben'), teamOf(rd, 'Cat'), teamOf(rd, 'Dan')]).toEqual([
      0, 1, 0, 1,
    ])

    // Switching into a full team is refused.
    rc.send(ClientMsg.switchTeam, { team: 1 })
    await new Promise((r) => setTimeout(r, 150))
    expect(teamOf(ra, 'Cat')).toBe(0)

    for (const r of rooms) r.send(ClientMsg.ready, { ready: true })
    await waitFor(() => rooms.every((r) => state(r).phase === 'serving'), 'doubles match started')
    const serverId = state(ra).serverId
    expect(serverId).toBe(ra.sessionId) // team 0, first seat, score 0
    expect(rooms.every((r) => state(r).serverId === serverId)).toBe(true)

    // Only the serving player can serve — not their partner.
    rc.send(ClientMsg.serve, { ax: -1.5, az: -4.5 })
    await new Promise((r) => setTimeout(r, 150))
    expect(state(ra).phase).toBe('serving')
    ra.send(ClientMsg.serve, { ax: -1.5, az: -4.5 })
    await waitFor(() => rooms.every((r) => state(r).phase === 'rally'), 'everyone sees the rally')

    for (const r of [...rooms, re]) await r.leave(true)
  }, 20000)
})

describe('room list', () => {
  const list = async (): Promise<RoomSummary[]> =>
    ((await (await fetch(`${URL}/rooms`)).json()) as { rooms: RoomSummary[] }).rooms

  it('shows open seats, running games and watchers, and forgets closed rooms', async () => {
    const ra = await new Client(URL).create(ROOM_NAME, { nickname: 'Ann' })
    const code = ra.roomId
    const entry = async () => (await list()).find((r) => r.code === code)
    expect(await entry()).toMatchObject({
      mode: '1v1',
      canPlay: true,
      inGame: false,
      players: ['Ann'],
      seats: 2,
      spectators: 0,
    })

    const rb = await new Client(URL).joinById(code, { nickname: 'Ben' })
    ra.send(ClientMsg.ready, { ready: true })
    rb.send(ClientMsg.ready, { ready: true })
    await waitFor(() => state(ra).phase === 'serving', 'game started')
    const rc = await new Client(URL).joinById(code, { nickname: 'Cat' })
    await waitFor(() => state(rc).phase === 'serving', 'joined the running game')
    expect(await entry()).toMatchObject({
      canPlay: false,
      inGame: true,
      players: ['Ann', 'Ben'],
      spectators: 1,
    })

    for (const r of [rc, rb, ra]) await r.leave(true)
    await new Promise((r) => setTimeout(r, 300))
    expect(await entry()).toBeUndefined()
  }, 20000)

  it('players can give up a seat in the lobby to watch', async () => {
    const ra = await new Client(URL).create(ROOM_NAME, { nickname: 'Ann' })
    const rb = await new Client(URL).joinById(ra.roomId, { nickname: 'Ben' })
    rb.send(ClientMsg.seat, { play: false })
    await waitFor(
      () => state(ra).players.size === 1 && state(ra).spectators.size === 1,
      'Ben sat out',
    )
    expect(state(ra).phase).toBe('waiting')
    await rb.leave(true)
    await waitFor(() => state(ra).spectators.size === 0, 'Ben left')
    await ra.leave(true)
  }, 20000)
})

describe('spectator chat', () => {
  const texts = (r: Room): string[] => [...state(r).chat].map((m) => m.text)

  it('spectators send, everyone sees it, players cannot send, and late joiners get recent messages', async () => {
    const ra = await new Client(URL).create(ROOM_NAME, { nickname: 'Ann' })
    const rb = await new Client(URL).joinById(ra.roomId, { nickname: 'Ben' })
    const rc = await new Client(URL).joinById(ra.roomId, { nickname: 'Cat' })
    await waitFor(() => state(ra).spectators.size === 1, 'Cat is watching')

    ra.send(ClientMsg.chat, { text: 'players stay quiet' })
    rc.send(ClientMsg.chat, { text: '  nice   shot!\u0007 ' })
    await waitFor(() => texts(ra).length === 1 && texts(rb).length === 1, 'players see the message')
    expect([...state(ra).chat][0]).toMatchObject({ nickname: 'Cat', text: 'nice shot!' })
    expect(texts(rc)).toEqual(['nice shot!'])

    // Garbage and empty messages are ignored; long ones are cut.
    rc.send(ClientMsg.chat, null)
    rc.send(ClientMsg.chat, { text: 42 })
    rc.send(ClientMsg.chat, { text: '    ' })
    rc.send(ClientMsg.chat, { text: 'x'.repeat(500) })
    await waitFor(() => texts(ra).length === 2, 'long message arrived')
    expect(texts(ra)[1]?.length).toBe(CHAT_MAX_LENGTH)

    const rd = await new Client(URL).joinById(ra.roomId, { nickname: 'Dan' })
    await waitFor(() => texts(rd).length === 2, 'late joiner sees recent chat')
    for (const r of [rd, rc, rb, ra]) await r.leave(true)
  }, 20000)

  it('limits flooding and keeps only recent messages', async () => {
    const ra = await new Client(URL).create(ROOM_NAME, { nickname: 'Ann' })
    const rb = await new Client(URL).joinById(ra.roomId, { nickname: 'Ben' })
    const rc = await new Client(URL).joinById(ra.roomId, { nickname: 'Cat' })
    await waitFor(() => state(ra).spectators.size === 1, 'Cat is watching')
    for (let i = 0; i < 50; i++) rc.send(ClientMsg.chat, { text: `spam ${i}` })
    await new Promise((r) => setTimeout(r, 400))
    expect(texts(ra).length).toBeGreaterThan(0)
    expect(texts(ra).length).toBeLessThanOrEqual(5)
    for (const r of [rc, rb, ra]) await r.leave(true)
  }, 20000)
})

describe('choosing a character', () => {
  it('is seen by everyone, from joining and when changed', async () => {
    const ra = await new Client(URL).create(ROOM_NAME, { nickname: 'Ann', look: 'f3' })
    const rb = await new Client(URL).joinById(ra.roomId, { nickname: 'Bob', look: 'not-a-look' })
    const lookOf = (r: Room, name: string) => players(r).find((p) => p.nickname === name)?.look
    await waitFor(() => lookOf(rb, 'Ann') === 'f3', 'Bob sees Ann as she chose')
    // Nonsense: picked by name.
    await waitFor(() => lookOf(ra, 'Bob') === '', 'Ann sees Bob, picked by name')

    rb.send(ClientMsg.look, { look: 'm1' })
    await waitFor(() => lookOf(ra, 'Bob') === 'm1', 'Ann sees Bob change')
    rb.send(ClientMsg.look, { look: '' })
    await waitFor(() => lookOf(ra, 'Bob') === '', 'back to picked by name')
    for (const r of [rb, ra]) await r.leave(true)
  }, 20000)
})

describe('training', () => {
  it('is a private court: not listed, one person, and works without anyone else', async () => {
    const ra = await new Client(URL).create(ROOM_NAME, { nickname: 'Ann', practice: true })
    const drill = () => (ra.state as unknown as { drill: string; level: string }).drill
    await waitFor(() => drill() === 'machine' && state(ra).players.size === 2, 'training started')
    expect(players(ra).map((p) => p.nickname)).toEqual(['Ann', 'Coach Erwin'])
    expect(players(ra).find((p) => p.nickname === 'Coach Erwin')?.look).toBe('m2')
    await waitFor(() => state(ra).phase === 'rally', 'the machine feeds a ball')

    const { rooms } = (await (await fetch(`${URL}/rooms`)).json()) as { rooms: RoomSummary[] }
    expect(rooms.some((r) => r.code === ra.roomId)).toBe(false)
    await expect(new Client(URL).joinById(ra.roomId, { nickname: 'Eve' })).rejects.toThrow()

    ra.send(ClientMsg.practice, { drill: 'serve', level: 'easy' })
    await waitFor(() => drill() === 'serve' && state(ra).phase === 'serving', 'drill switched')
    expect(state(ra).serverId).toBe(ra.sessionId)
    ra.send(ClientMsg.ready, { ready: false })
    ra.send(ClientMsg.seat, { play: false })
    await new Promise((r) => setTimeout(r, 200))
    expect(state(ra).phase).toBe('serving')
    await ra.leave(true)
  }, 20000)

  it('a normal room ignores training commands', async () => {
    const ra = await new Client(URL).create(ROOM_NAME, { nickname: 'Ann' })
    await waitFor(() => state(ra).players.size === 1, 'joined')
    ra.send(ClientMsg.practice, { drill: 'serve', level: 'easy' })
    await new Promise((r) => setTimeout(r, 200))
    expect(state(ra).phase).toBe('waiting')
    expect((ra.state as unknown as { drill: string }).drill).toBe('')
    await ra.leave(true)
  }, 20000)
})

describe('tournament over real WebSockets', () => {
  it('sign-up, draw, a match, a player leaving and coming back', async () => {
    const view = (r: Room) =>
      JSON.parse((r.state as unknown as { tournament: string }).tournament) as TournamentView
    const ra = await new Client(URL).create(ROOM_NAME, { nickname: 'Ann', tournament: true })
    const rooms: Room[] = [ra]
    for (const n of ['Ben', 'Cat']) {
      rooms.push(await new Client(URL).joinById(ra.roomId, { nickname: n }))
    }
    await waitFor(() => view(ra).entrants.length === 3, 'everyone entered')
    const list = (await (await fetch(`${URL}/rooms`)).json()) as { rooms: RoomSummary[] }
    const row = list.rooms.find((r) => r.code === ra.roomId)
    expect(row).toMatchObject({ canPlay: true, tournament: { status: 'signup' } })
    expect(row?.players).toEqual(['Ann', 'Ben', 'Cat'])

    rooms[1]!.send(ClientMsg.tournament, { action: 'start' }) // not the host
    await new Promise((r) => setTimeout(r, 150))
    expect(view(ra).status).toBe('signup')
    ra.send(ClientMsg.tournament, { action: 'start' })
    await waitFor(() => state(ra).players.size === 2, 'first match seated')
    expect(view(ra).matches).toHaveLength(4)
    expect(state(ra).spectators.size).toBe(1)

    // Someone arriving now only watches.
    const late = await new Client(URL).joinById(ra.roomId, { nickname: 'Dan' })
    await waitFor(() => state(ra).spectators.size === 2, 'Dan watches')

    const onCourt = rooms.filter((r) => state(ra).players.has(r.sessionId))
    for (const r of onCourt) r.send(ClientMsg.ready, { ready: true })
    await waitFor(() => state(ra).phase === 'serving', 'match started')
    for (const r of onCourt) r.send(ClientMsg.ready, { ready: false }) // can't be stopped
    for (const r of onCourt) r.send(ClientMsg.seat, { play: false })
    await new Promise((r) => setTimeout(r, 200))
    expect(state(ra).phase).toBe('serving')

    // Leaving loses the match, but not the place in the tournament.
    const quitter = onCourt.find((r) => r !== ra) ?? onCourt[0]!
    const name = [...state(ra).players.values()].find(
      (p) => p === state(ra).players.get(quitter.sessionId),
    )!.nickname
    const witness = rooms.find((r) => r !== quitter)!
    await quitter.leave(true)
    await waitFor(() => view(witness).matches[0]!.walkover, 'walkover')
    const back = await new Client(URL).joinById(ra.roomId, { nickname: name })
    await waitFor(
      () => view(witness).entries.some((e) => e.ids.includes(back.sessionId)),
      'place taken up again',
    )
    for (const r of [back, late, ...rooms.filter((x) => x !== quitter)]) await r.leave(true)
  }, 30000)
})

describe('origin allow-list (GAME_ALLOWED_ORIGINS)', () => {
  it('rejects joins from pages not on the allow-list', async () => {
    const port = PORT + 300
    const restricted = createGameServer({ allowedOrigins: ['http://allowed.example:4173'] })
    await restricted.listen(port, '127.0.0.1')
    try {
      // Node's fetch sends no Origin header, like a script that isn't the game page.
      await expect(
        new Client(`http://127.0.0.1:${port}`).create(ROOM_NAME, { nickname: 'Eve' }),
      ).rejects.toThrow(/not allowed/)

      expect((await fetch(`http://127.0.0.1:${port}/rooms`)).status).toBe(403)
      const rooms = await fetch(`http://127.0.0.1:${port}/rooms`, {
        headers: { Origin: 'http://allowed.example:4173' },
      })
      expect(rooms.status).toBe(200)
      expect(rooms.headers.get('access-control-allow-origin')).toBe('http://allowed.example:4173')

      const res = await fetch(`http://127.0.0.1:${port}/matchmake/create/${ROOM_NAME}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://allowed.example:4173' },
        body: JSON.stringify({ nickname: 'Ok' }),
      })
      expect(res.status).toBe(200)
    } finally {
      await restricted.gracefullyShutdown(false)
    }
  })
})
