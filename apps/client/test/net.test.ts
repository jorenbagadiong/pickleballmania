import { COURT, FIXED_DT, playBounds, stepPlayer } from '@pickleball/shared'
import { describe, expect, it } from 'vitest'
import { resolveServerUrl } from '../src/net/serverUrl'
import { LocalPrediction } from '../src/net/prediction'
import { MAX_DELAY, MIN_DELAY, type Snapshot, SnapshotBuffer } from '../src/net/snapshots'

describe('resolveServerUrl', () => {
  it('uses the page hostname, never the visitor’s localhost', () => {
    expect(resolveServerUrl({ protocol: 'http:', hostname: '192.168.1.50' }, {})).toBe(
      'http://192.168.1.50:2567',
    )
    expect(resolveServerUrl({ protocol: 'http:', hostname: 'my-mac.tail1234.ts.net' }, {})).toBe(
      'http://my-mac.tail1234.ts.net:2567',
    )
  })

  it('honors the configured port and https', () => {
    expect(
      resolveServerUrl({ protocol: 'https:', hostname: 'h' }, { GAME_SERVER_PORT: '3000' }),
    ).toBe('https://h:3000')
  })

  it('lets GAME_SERVER_URL override everything', () => {
    expect(
      resolveServerUrl(
        { protocol: 'http:', hostname: 'x' },
        { GAME_SERVER_URL: 'https://game.example.com/' },
      ),
    ).toBe('https://game.example.com')
  })

  it('brackets IPv6 hosts', () => {
    expect(resolveServerUrl({ protocol: 'http:', hostname: 'fd7a::1' }, {})).toBe(
      'http://[fd7a::1]:2567',
    )
  })
})

function snap(time: number, x: number): Snapshot {
  return {
    time,
    players: new Map([['p', { x, z: 1, yaw: 0, swingSeq: 0, swingPower: 0, swingJump: false }]]),
    ball: {
      x,
      y: 1,
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      curve: 0,
      steerX: 0,
      steerZ: 0,
      visible: true,
      held: false,
      bounced: false,
      mustBounce: false,
    },
  }
}

describe('SnapshotBuffer', () => {
  it('interpolates between snapshots slightly in the past', () => {
    const buf = new SnapshotBuffer()
    // Server time t arrives at local time t + 10.
    buf.push(snap(1.0, 0), 11.0)
    buf.push(snap(1.1, 1), 11.1)
    // Nothing is known about the connection yet, so 100 ms behind.
    const s = buf.sample(11.05 + 0.1)
    expect(s?.players.get('p')?.x).toBeCloseTo(0.5, 5)
    expect(s?.ball.x).toBeCloseTo(0.5, 5)
  })

  it('maps server event times onto the local display timeline', () => {
    const buf = new SnapshotBuffer()
    buf.push(snap(2.0, 0), 12.0)
    expect(buf.displayTimeFor(2.0)).toBeCloseTo(12.0 + 0.1, 5)
  })
})

/** Feeds a ball flying at 10 m/s through a connection, and records what is drawn. */
function watch(delay: (i: number) => number, seconds = 12) {
  const buf = new SnapshotBuffer()
  const updates: { at: number; snap: Snapshot }[] = []
  let previous = 0
  for (let i = 0; i < seconds * 30; i++) {
    const time = i / 30
    previous = Math.max(previous, time + delay(i)) // delivered in order, as TCP does
    const s = snap(time, 0)
    s.ball = { ...s.ball, y: 400, z: 20 + time * 10, vz: 10, vy: 0 }
    updates.push({ at: previous, snap: s })
  }
  const steps: number[] = []
  let last: number | null = null
  let behind = 0
  for (let f = 0; f < seconds * 60; f++) {
    const now = f / 60
    while (updates[0] && updates[0].at <= now) {
      const u = updates.shift()!
      buf.push(u.snap, u.at)
    }
    const w = buf.sample(now)
    if (!w || now < 5 || now > seconds - 1) continue
    if (last !== null) steps.push((w.ball.z - last) * 6) // 1 = exactly 10 m/s
    last = w.ball.z
    behind = now - buf.renderServerTime(now)!
  }
  return { slowest: Math.min(...steps), fastest: Math.max(...steps), behind, buf }
}

describe('connections', () => {
  it('a steady connection is drawn smoothly and close to live', () => {
    const r = watch((i) => 0.02 + (i % 3) * 0.002)
    expect(r.slowest).toBeGreaterThan(0.9)
    expect(r.fastest).toBeLessThan(1.1)
    expect(r.behind - 0.02).toBeLessThan(MIN_DELAY + 0.01)
  })

  it('an uneven connection is drawn further behind instead of stuttering', () => {
    const r = watch((i) => 0.02 + ((i * 7) % 10) * 0.009)
    expect(r.slowest).toBeGreaterThan(0.85)
    expect(r.fastest).toBeLessThan(1.15)
    expect(r.behind).toBeGreaterThan(0.1)
    expect(r.buf.link.delay).toBeLessThanOrEqual(MAX_DELAY)
  })

  it('the ball keeps flying through a 300 ms gap and never freezes or jumps', () => {
    const r = watch((i) => (i % 100 === 99 ? 0.32 : 0.02))
    expect(r.slowest).toBeGreaterThan(0.6)
    expect(r.fastest).toBeLessThan(1.5)
  })

  it('a predicted ball bounces off the floor', () => {
    const buf = new SnapshotBuffer()
    for (let i = 0; i < 3; i++) {
      const s = snap(1 + i / 30, 0)
      s.ball = { ...s.ball, y: 0.3, z: 3, vy: -5, vz: 1 }
      buf.push(s, 1 + i / 30)
    }
    const shown = Array.from({ length: 12 }, (_, i) => buf.sample(1.17 + i / 60)!.ball.y)
    expect(Math.min(...shown)).toBeGreaterThan(0)
    expect(shown.at(-1)!).toBeGreaterThan(Math.min(...shown) + 0.1)
  })
})

describe('LocalPrediction', () => {
  it('predicts locally and reconciles to the server without drift', () => {
    const pred = new LocalPrediction()
    const bounds = playBounds(0)
    const start = { x: 0, z: COURT.halfLength - 1, vx: 0, vz: 0 }
    pred.reconcile(start, 0, bounds)
    for (let i = 0; i < 40; i++) {
      // Off to the right, then a sharp turn back.
      pred.applyLocal({ seq: pred.nextSeq(), mx: i < 25 ? 1 : -1, mz: 0, ax: 0, az: -3 }, bounds)
    }
    const predicted = { x: pred.pos.x, vx: pred.pos.vx }

    // The server has applied the first 30 inputs; replaying the other 10 from there (with
    // the speed it had) lands on the same spot, at the same speed.
    const server = { ...start }
    for (let i = 0; i < 30; i++)
      stepPlayer(server, { mx: i < 25 ? 1 : -1, mz: 0 }, FIXED_DT, bounds)
    pred.reconcile(server, 30, bounds)
    expect(pred.pos.x).toBeCloseTo(predicted.x, 9)
    expect(pred.pos.vx).toBeCloseTo(predicted.vx, 9)
    expect(pred.pendingCount).toBe(10)
  })

  it('continues numbering after a reconnect', () => {
    const pred = new LocalPrediction()
    pred.reconcile({ x: 0, z: 5, vx: 0, vz: 0 }, 120, playBounds(0))
    expect(pred.nextSeq()).toBe(121)
  })
})
