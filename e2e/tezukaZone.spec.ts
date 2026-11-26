/**
 * TEZUKA ZONE in a real two-browser match (docs/tezuka.md): Bob, an ordinary player,
 * aims away from Tezuka; the server bends the ball toward him; both browsers see the
 * same ball. Tezuka still has to swing himself. The e2e server runs with
 * PICKLEBALL_ZONE_DEBUG=1, so Tezuka's browser also gets the zone's diagnostics.
 */
import { type Browser, type Page, expect, test } from '@playwright/test'
import { E2E_DEV_KEY } from '../playwright.config'

// Older tests in the suite close their browser windows only when they pass; one that
// failed leaves its pages open, still drawing (in software here) and still connected.
// Start from a clean browser so those leftovers can't disturb these tests.
test.beforeEach(async ({ browser }) => {
  for (const context of browser.contexts()) await context.close()
})

interface Ball {
  x: number
  y: number
  z: number
  vx: number
  vz: number
  steerX: number
  steerZ: number
  visible: boolean
  held: boolean
  bounced: boolean
  mustBounce: boolean
}
interface Seen {
  phase: string
  tick: number
  serverId: string
  lastHitSlot: number
  scores: [number, number]
  players: { id: string; nickname: string; slot: number; x: number; z: number; look: string }[]
  ball: Ball
}
interface Zone {
  active: boolean
  reason: string
  target: { x: number; y: number; z: number } | null
  timeToContact: number
  steerX: number
  steerZ: number
  preset: string
  tick: number
}
type PB = {
  ballLog(): Record<string, Ball>
  state(): Seen | null
  zone(): Zone | null
  project(x: number, z: number): { x: number; y: number } | null
}
const pb = (page: Page) => page.evaluate(() => (window as unknown as { __PB__: PB }).__PB__.state())

async function open(browser: Browser, path: string) {
  const context = await browser.newContext()
  const page = await context.newPage()
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  await page.goto(path)
  return { context, page, errors }
}

/** Starts recording every server tick of the ball this browser decodes (and the zone). */
async function record(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as {
      __PB__: PB
      __rec__: { ticks: Record<number, Ball & { phase: string; hit: number }>; zone: Zone[] }
    }
    w.__rec__ = { ticks: {}, zone: [] }
    w.__PB__.ballLog() // starts the log of every decoded ball state
    setInterval(() => {
      const s = w.__PB__.state()
      if (s) w.__rec__.ticks[s.tick] = { ...s.ball, phase: s.phase, hit: s.lastHitSlot }
      const z = w.__PB__.zone()
      if (z && w.__rec__.zone.at(-1)?.tick !== z.tick) w.__rec__.zone.push(z)
    }, 4)
  })
}
const recorded = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as {
      __rec__: { ticks: Record<string, Ball & { phase: string; hit: number }>; zone: Zone[] }
    }
    return w.__rec__
  })

/** Bob returns whatever reaches him, aimed at `aim` (a ground point), by pressing Space. */
async function bobReturns(page: Page, bobId: string): Promise<void> {
  await page.evaluate((id) => {
    const w = window as unknown as { __PB__: PB }
    let lastShot = -1
    setInterval(() => {
      const s = w.__PB__.state()
      const me = s?.players.find((p) => p.id === id)
      if (!s || !me || s.phase !== 'rally' || s.lastHitSlot === me.slot) return
      const near = Math.hypot(s.ball.x - me.x, s.ball.z - me.z) < 1.1
      const key = `${s.tick >> 5}`
      if (near && Number(key) !== lastShot) {
        lastShot = Number(key)
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', cancelable: true }))
        setTimeout(
          () =>
            window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space', cancelable: true })),
          30,
        )
      }
    }, 8)
  }, bobId)
}

/** Points Bob's mouse at a spot on the court (his aim). */
async function aimAt(page: Page, x: number, z: number): Promise<void> {
  const p = await page.evaluate(
    ([x, z]) => (window as unknown as { __PB__: PB }).__PB__.project(x!, z!),
    [x, z],
  )
  if (p) await page.mouse.move(p.x, p.y)
}

async function match(browser: Browser, tezukaSide: 0 | 1, shots: string) {
  const t = await open(browser, '/?e2e=1')
  await t.page.getByTestId('nickname').fill('Tezuka')
  await t.page.getByTestId('dev-key').fill(E2E_DEV_KEY)
  await t.page.getByTestId('dev-room').check()
  await t.page.getByTestId('create-room').click()
  await expect(t.page.getByTestId('room-code')).toHaveText(/^[A-Z2-9]{5}$/)
  const code = (await t.page.getByTestId('room-code').textContent()) ?? ''
  // For the other side of the net: Tezuka watches while Bob takes the first seat (team
  // 0), then takes the one left (team 1). The server knows him by his session.
  if (tezukaSide === 1) await t.page.getByTestId('lobby-sit-out').click()
  const bob = await open(browser, `/?room=${code}&e2e=1`)
  await bob.page.getByTestId('nickname').fill('Bob')
  await bob.page.getByTestId('join-room').click()
  if (tezukaSide === 1) {
    await expect.poll(async () => (await pb(bob.page))?.players[0]?.slot).toBe(0)
    await t.page.getByTestId('take-seat').click()
  }
  await expect.poll(async () => (await pb(bob.page))?.players.length).toBe(2)
  const ids = (await pb(bob.page))!.players
  const tz = ids.find((p) => p.nickname === 'Tezuka')!
  const bobId = ids.find((p) => p.nickname === 'Bob')!.id
  expect(tz.look).toBe('x1')
  expect(tz.slot).toBe(tezukaSide)
  await t.page.getByTestId('ready').click()
  await bob.page.getByTestId('ready').click()
  await expect.poll(async () => (await pb(t.page))?.phase).toBe('serving')
  for (const p of [t.page, bob.page]) await record(p)
  await bobReturns(bob.page, bobId)

  const side = tezukaSide === 0 ? 1 : -1
  const rallies: {
    server: string
    aimX: number
    samples: number
    reached: number
    steered: boolean
    hitByTezuka: boolean
  }[] = []
  for (let r = 0; r < 4; r++) {
    await expect.poll(async () => (await pb(t.page))?.phase, { timeout: 20_000 }).toBe('serving')
    const s = (await pb(t.page))!
    const me = s.players.find((p) => p.nickname === 'Tezuka')!
    // Bob aims for the far corner from where Tezuka stands, every time.
    const aimX = me.x >= 0 ? -3.6 : 3.6
    await aimAt(bob.page, aimX, side * 4.8)
    const serving = s.serverId === me.id ? t.page : bob.page
    const startTick = s.tick
    await serving.waitForTimeout(400)
    await serving.keyboard.press('Space')
    await expect.poll(async () => (await pb(t.page))?.phase, { timeout: 15_000 }).toBe('pointOver')
    // The last rally: Tezuka swings himself as the ball comes (Space, as any player).
    const rec = await recorded(t.page)
    const flight = Object.entries(rec.ticks)
      .map(([k, v]) => ({ tick: Number(k), ...v }))
      .filter((q) => q.tick > startTick && q.phase === 'rally')
    // The shot coming to Tezuka: from Bob's hit until the rally ended.
    const firstIn = flight.findIndex((q) => q.hit === 1 - tezukaSide)
    const toTezuka = firstIn < 0 ? [] : flight.slice(firstIn)
    // Closest approach: each decoded state carries the ball's speed, so between two
    // states the ball's path is known (the page only samples when it gets to run).
    let reached = 99
    toTezuka.forEach((q, i) => {
      const gap = ((toTezuka[i + 1]?.tick ?? q.tick + 2) - q.tick) / 60
      const dx = q.x - me.x
      const dz = q.z - me.z
      const v2 = q.vx * q.vx + q.vz * q.vz
      const tt = v2 > 0 ? Math.min(gap, Math.max(0, -(dx * q.vx + dz * q.vz) / v2)) : 0
      reached = Math.min(reached, Math.hypot(dx + q.vx * tt, dz + q.vz * tt))
    })
    rallies.push({
      server: serving === t.page ? 'Tezuka' : 'Bob',
      aimX,
      samples: toTezuka.length,
      reached,
      steered: toTezuka.some((q) => q.steerX !== 0 || q.steerZ !== 0),
      // Never hit for him: after Bob's shot, the last hitter stays Bob's side.
      hitByTezuka: toTezuka.some((q) => q.hit === tezukaSide),
    })
  }

  // Tezuka swings himself (Space, as any player) at the balls the zone brings him. The
  // test browsers here draw in software and get to run only now and then, so a swing
  // can come too late for its 0.3 s window: he gets up to three rallies to land one.
  await t.page.evaluate(
    ([id, slot]) => {
      const w = window as unknown as { __PB__: PB }
      let last = 0
      setInterval(() => {
        const st = w.__PB__.state()
        const z = st?.players.find((p) => p.id === id)
        if (!st || !z || st.phase !== 'rally' || st.lastHitSlot === slot) return
        // As a player would: once it is in reach, and has bounced if it has to; again
        // after a miss, once the miss recovery (0.8 s) is over.
        const legal = !st.ball.mustBounce || st.ball.bounced
        const near = Math.hypot(st.ball.x - z.x, st.ball.z - z.z) < 1.3 && st.ball.y < 2
        if (legal && near && performance.now() - last > 900) {
          last = performance.now()
          window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', cancelable: true }))
          window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space', cancelable: true }))
        }
      }, 4)
    },
    [tz.id, tezukaSide] as const,
  )
  let swung = false
  let attempts = 0
  for (; attempts < 3 && !swung; attempts++) {
    await expect.poll(async () => (await pb(t.page))?.phase, { timeout: 20_000 }).toBe('serving')
    const s = (await pb(t.page))!
    const me = s.players.find((p) => p.nickname === 'Tezuka')!
    await aimAt(bob.page, me.x >= 0 ? -3.6 : 3.6, side * 4.8)
    const serving = s.serverId === me.id ? t.page : bob.page
    const startTick = s.tick
    await serving.waitForTimeout(400)
    await serving.keyboard.press('Space')
    if (attempts === 0) {
      await bob.page.waitForTimeout(500)
      await bob.page.screenshot({ path: test.info().outputPath(`${shots}-bob-view.png`) })
      await t.page.screenshot({ path: test.info().outputPath(`${shots}-tezuka-view.png`) })
    }
    await expect.poll(async () => (await pb(t.page))?.phase, { timeout: 15_000 }).toBe('pointOver')
    const rec = await recorded(t.page)
    swung = Object.entries(rec.ticks).some(
      ([k, q]) => Number(k) > startTick && q.hit === tezukaSide && q.phase !== 'serving',
    )
    // A serve by Tezuka is his own shot, not a return: only count rallies Bob served.
    if (swung && s.serverId === me.id) swung = false
  }

  // Both browsers decoded the same ball at every server tick both received.
  const [a] = await Promise.all([recorded(t.page)])
  const logs = await Promise.all(
    [t.page, bob.page].map((p) =>
      p.evaluate(() => (window as unknown as { __PB__: PB }).__PB__.ballLog()),
    ),
  )
  const [la, lb] = logs as [Record<string, Ball>, Record<string, Ball>]
  let common = 0
  let worst = 0
  let steeredTicks = 0
  for (const [tick, q] of Object.entries(la)) {
    const o = lb[tick]
    if (!o || !q.visible || q.held) continue
    common += 1
    if (q.steerX !== 0 || q.steerZ !== 0) steeredTicks += 1
    worst = Math.max(
      worst,
      Math.hypot(q.x - o.x, q.y - o.y, q.z - o.z),
      Math.abs(q.steerX - o.steerX),
      Math.abs(q.steerZ - o.steerZ),
    )
  }
  const zoneSeen = a.zone.filter((z) => z.active)
  for (const p of [t, bob]) expect(p.errors, p.errors.join('\n')).toEqual([])
  for (const p of [t, bob]) await p.context.close()
  return {
    rallies,
    swung,
    attempts,
    common,
    worst,
    steeredTicks,
    ticksA: Object.keys(la).length,
    ticksB: Object.keys(lb).length,
    sampled: Object.keys(a.ticks).length,
    zoneSeen: zoneSeen.length,
    preset: zoneSeen[0]?.preset,
  }
}

for (const side of [0, 1] as const) {
  test(`TEZUKA ZONE, Tezuka on side ${side}: Bob aims away, the ball comes to Tezuka, both see the same`, async ({
    browser,
  }) => {
    const m = await match(browser, side, `side${side}`)
    console.log(`[zone e2e] side ${side}`, JSON.stringify(m))
    // Every rally with a shot to Tezuka (Bob's return of a serve can miss): the ball was
    // pulled and came within his reach.
    const judged = m.rallies.filter((r) => r.samples >= 3)
    expect(judged.length).toBeGreaterThanOrEqual(3)
    for (const r of judged) {
      expect(r.steered, JSON.stringify(r)).toBe(true)
      expect(r.reached, JSON.stringify(r)).toBeLessThan(1.4)
      // He never swung, so it was never hit for him.
      expect(r.hitByTezuka, JSON.stringify(r)).toBe(false)
    }
    // And when he does swing, he returns it.
    expect(m.swung).toBe(true)
    expect(m.preset).toBe('anime')
    expect(m.common).toBeGreaterThan(50)
    expect(m.steeredTicks).toBeGreaterThan(10)
    expect(m.worst).toBe(0)
  })
}
