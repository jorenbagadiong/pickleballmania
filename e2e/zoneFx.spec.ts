/**
 * TEZUKA ZONE as drawn (Phase D1, apps/client/src/players/zone): the field under the
 * secret athlete, read through the `?e2e` debug hook (`zoneFx()`, read-only). It follows
 * the server's grant and replicated state only, in every browser that draws the player.
 * None of these tests needs the private model: the field doesn't depend on the body.
 */
import { type Browser, type Page, expect, test } from '@playwright/test'
import { createRequire } from 'node:module'
import path from 'node:path'
import { E2E_DEV_KEY } from '../playwright.config'

const { Client } = createRequire(path.resolve('apps/client/package.json'))('@colyseus/sdk') as {
  Client: new (url: string) => {
    joinById(code: string, o: object): Promise<{ leave(consented?: boolean): Promise<unknown> }>
  }
}

test.beforeEach(async ({ browser }) => {
  for (const context of browser.contexts()) await context.close()
})

interface Field {
  id: string
  state: 'inactive' | 'available' | 'attracting'
  presence: number
  pull: number
  tier: 'high' | 'medium' | 'low'
  reducedMotion: boolean
  visible: boolean
  draws: number
  particles: number
  log: { state: string; at: number }[]
  x?: number
  z?: number
  playerX?: number
  playerZ?: number
}
interface Fx {
  fields: Field[]
  mounted: number
  disposed: number
}
interface Seen {
  phase: string
  players: {
    id: string
    nickname: string
    look: string
    x: number
    z: number
    connected: boolean
  }[]
}

const pb = <T>(page: Page, call: string): Promise<T> =>
  page.evaluate(
    (c) => (window as unknown as { __PB__: Record<string, () => unknown> }).__PB__[c]!() as T,
    call,
  )
const fx = (page: Page) => pb<Fx>(page, 'zoneFx')
const seen = (page: Page) => pb<Seen | null>(page, 'state')

type Tier = 'high' | 'medium' | 'low'

async function open(
  browser: Browser,
  url: string,
  o: { tier?: Tier; reducedMotion?: 'reduce' | 'no-preference' } = {},
) {
  const context = await browser.newContext({ reducedMotion: o.reducedMotion ?? 'no-preference' })
  // The game's own remembered quality step (game/quality.ts), as a slower computer would have.
  if (o.tier)
    await context.addInitScript((t) => {
      const q = { dpr: 1, shadows: t === 'high', crowd: t !== 'low', at: Date.now() }
      localStorage.setItem('pickleball.quality', JSON.stringify(q))
    }, o.tier)
  const page = await context.newPage()
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  await page.goto(url)
  return { context, page, errors }
}

async function train(browser: Browser, key: string | null, o: Parameters<typeof open>[2] = {}) {
  const t = await open(browser, '/?e2e=1', o)
  await t.page.getByTestId('nickname').fill('Tezuka')
  if (key) await t.page.getByTestId('dev-key').fill(key)
  await t.page.getByTestId('practice').click()
  await expect
    .poll(async () => (await seen(t.page))?.players.length ?? 0, { timeout: 20_000 })
    .toBe(2)
  return t
}

async function idOf(page: Page, nickname: string): Promise<string> {
  const s = await seen(page)
  return s!.players.find((p) => p.nickname === nickname)!.id
}

/** Exactly one field, the athlete's, drawn where the athlete is drawn. */
async function expectOneFieldOn(page: Page, id: string, who: string) {
  await expect
    .poll(async () => (await fx(page)).fields.map((f) => [f.id, f.state]), { timeout: 20_000 })
    .toEqual([[id, 'available']])
  await expect.poll(async () => (await fx(page)).fields[0]!.visible).toBe(true)
  const f = (await fx(page)).fields[0]!
  // A child of the player's own group: on their drawn position exactly, on any side.
  expect(Math.hypot(f.x! - f.playerX!, f.z! - f.playerZ!), who).toBeLessThan(0.001)
  // And that is the player's server position, give or take the drawing delay.
  const me = (await seen(page))!.players.find((p) => p.id === id)!
  expect(Math.hypot(f.x! - me.x, f.z! - me.z), who).toBeLessThan(0.3)
}

test('only the granted athlete has a field: own, opponent and spectator views, and on disconnect', async ({
  browser,
}) => {
  test.setTimeout(120_000)
  const t = await open(browser, '/?e2e=1')
  await t.page.getByTestId('nickname').fill('Tezuka')
  await t.page.getByTestId('dev-key').fill(E2E_DEV_KEY)
  await t.page.getByTestId('dev-room').check()
  await t.page.getByTestId('create-room').click()
  await expect(t.page.getByTestId('room-code')).toHaveText(/^[A-Z2-9]{5}$/)
  const code = (await t.page.getByTestId('room-code').textContent()) ?? ''
  const bob = await open(browser, `/?room=${code}&e2e=1`)
  await bob.page.getByTestId('nickname').fill('Bob')
  await bob.page.getByTestId('join-room').click()
  const sam = await open(browser, `/?room=${code}&e2e=1`)
  await sam.page.getByTestId('nickname').fill('Sam')
  await sam.page.getByTestId('join-room').click()
  await expect
    .poll(async () => (await seen(sam.page))?.players.length ?? 0, { timeout: 20_000 })
    .toBe(2)
  const tezuka = await idOf(t.page, 'Tezuka')
  expect((await seen(t.page))!.players.find((p) => p.id === tezuka)!.look).toBe('x1')

  for (const [who, p] of [
    ['Tezuka', t],
    ['Bob', bob],
    ['Sam (watching)', sam],
  ] as const)
    await expectOneFieldOn(p.page, tezuka, who)

  // The game on: still exactly the one field, in every view.
  await t.page.getByTestId('ready').click()
  await bob.page.getByTestId('ready').click()
  await expect(t.page.getByTestId('serve-prompt')).toBeVisible()
  await t.page.keyboard.press('Space')
  await t.page.waitForTimeout(800)
  for (const p of [t, bob, sam]) {
    const f = await fx(p.page)
    expect(f.fields.map((x) => x.id)).toEqual([tezuka])
    expect(f.fields[0]!.state).not.toBe('inactive')
  }

  // Tezuka's browser goes away: the seat waits for a reconnect, the field fades out.
  await t.context.close()
  for (const p of [bob, sam]) {
    await expect
      .poll(async () => (await seen(p.page))?.players.find((x) => x.id === tezuka)?.connected, {
        timeout: 10_000,
      })
      .toBe(false)
    await expect
      .poll(async () => {
        const f = (await fx(p.page)).fields[0]
        return f && [f.state, f.visible]
      })
      .toEqual(['inactive', false])
    const f = (await fx(p.page)).fields[0]!
    expect(f.draws).toBe(0)
    expect(f.log.map((e) => e.state)).toContain('available')
  }
  for (const p of [bob, sam]) {
    expect(p.errors, p.errors.join('\n')).toEqual([])
    await p.context.close()
  }
})

test('the name alone, or a room that does not allow the athlete, draws no field', async ({
  browser,
}) => {
  test.setTimeout(90_000)
  // Training without the key.
  const a = await train(browser, null)
  await a.page.waitForTimeout(1500)
  expect((await seen(a.page))!.players.find((p) => p.nickname === 'Tezuka')!.look).not.toBe('x1')
  expect((await fx(a.page)).fields).toEqual([])
  await a.context.close()

  // The right key, but a casual room created without "Allow developer abilities".
  const b = await open(browser, '/?e2e=1')
  await b.page.getByTestId('nickname').fill('Tezuka')
  await b.page.getByTestId('dev-key').fill(E2E_DEV_KEY)
  await b.page.getByTestId('create-room').click()
  await expect(b.page.getByTestId('room-code')).toHaveText(/^[A-Z2-9]{5}$/)
  await expect
    .poll(async () => (await seen(b.page))?.players.length ?? 0, { timeout: 20_000 })
    .toBe(1)
  await b.page.waitForTimeout(1500)
  expect((await seen(b.page))!.players[0]!.look).not.toBe('x1')
  expect((await fx(b.page)).fields).toEqual([])
  for (const p of [a, b]) expect(p.errors, p.errors.join('\n')).toEqual([])
  await b.context.close()
})

test('training: every pulled shot lights the field, the rally end settles it, leaving frees it', async ({
  browser,
}) => {
  test.setTimeout(120_000)
  const t = await train(browser, E2E_DEV_KEY)
  const tezuka = await idOf(t.page, 'Tezuka')
  await expectOneFieldOn(t.page, tezuka, 'Tezuka')

  // Sample, together: the field, the court phase, and the pull the server last sent.
  type Sample = { state: string; pull: number; phase: string; pulled: boolean }
  const samples: Sample[] = []
  /** Runs of consecutive samples in which the server was pulling this shot to Tezuka. */
  const pulls = () => {
    const runs: [number, number][] = []
    samples.forEach((x, j) => {
      if (!x.pulled) return
      const last = runs[runs.length - 1]
      if (last && last[1] === j - 1) last[1] = j
      else runs.push([j, j])
    })
    return runs
  }
  for (let i = 0; i < 1500; i++) {
    const s = await t.page.evaluate((me) => {
      const w = window as unknown as {
        __PB__: {
          zoneFx: () => Fx
          ui: () => { phase: string }
          state: () => {
            lastHitSlot: number
            players: { id: string; slot: number }[]
            ball: { steerX: number; steerZ: number; visible: boolean; held: boolean }
          } | null
        }
      }
      const f = w.__PB__.zoneFx().fields[0]
      const st = w.__PB__.state()
      const phase = w.__PB__.ui().phase
      const mySlot = st?.players.find((p) => p.id === me)?.slot
      const b = st?.ball
      const pulled =
        !!b &&
        b.visible &&
        !b.held &&
        phase === 'rally' &&
        st!.lastHitSlot >= 0 &&
        st!.lastHitSlot !== mySlot &&
        Math.hypot(b.steerX, b.steerZ) > 0.01
      return { state: f?.state ?? 'none', pull: f?.pull ?? 0, phase, pulled }
    }, tezuka)
    samples.push(s)
    // Two sustained pulls seen through to their end, and a moment after.
    const done = pulls().filter(([a, b]) => b - a >= 5 && b < samples.length - 8)
    if (done.length >= 2) break
    await t.page.waitForTimeout(40)
  }
  const report = JSON.stringify(
    samples.map((x) => `${x.pulled ? 'P' : '-'}${x.state[0]}${x.phase[0]}`).join(' '),
  )
  // Every sustained pull from the server lights the field: within the pull or just after
  // it (the ball is drawn up to 0.15 s behind the newest update).
  const sustained = pulls().filter(([a, b]) => b - a >= 5)
  expect(sustained.length, `no pulled shot seen: ${report}`).toBeGreaterThanOrEqual(1)
  for (const [a, b] of sustained) {
    const window = samples.slice(a, b + 6)
    expect(
      window.some((x) => x.state === 'attracting'),
      `pull at samples ${a}-${b} not shown: ${report}`,
    ).toBe(true)
  }
  // Attracting shows strongly, and only in a rally (a sample read just as a rally ended
  // may still show the frame before; the one after must not).
  expect(Math.max(...samples.map((x) => x.pull)), report).toBeGreaterThan(0.5)
  samples.forEach((x, j) => {
    if (x.state === 'attracting' && x.phase !== 'rally')
      expect(samples[j + 1]?.state, `sample ${j}: ${report}`).not.toBe('attracting')
  })
  // Back to available after each pull, never off while the athlete is there.
  const log = (await fx(t.page)).fields[0]!.log.map((e) => e.state)
  // Drawn from the start as available (the grant is known when the player appears).
  expect(log[0], log.join(' ')).toBe('available')
  expect(
    log.every((x) => x !== 'inactive'),
    log.join(' '),
  ).toBe(true)
  expect(log.join(' '), log.join(' ')).toContain('attracting available')

  // Leaving the match removes the field and frees what it held.
  await t.page.getByTestId('hud-leave').click()
  await expect(t.page.getByTestId('nickname')).toBeVisible({ timeout: 10_000 })
  const after = await fx(t.page)
  expect(after.fields).toEqual([])
  expect(after.mounted).toBeGreaterThan(0)
  expect(after.disposed).toBe(after.mounted)
  expect(t.errors, t.errors.join('\n')).toEqual([])
  await t.context.close()
})

test('quality steps and reduced motion change only the drawing', async ({ browser }) => {
  test.setTimeout(120_000)
  const expected = {
    high: { draws: 2, particles: 24 },
    medium: { draws: 2, particles: 10 },
    low: { draws: 1, particles: 0 },
  }
  for (const tier of ['high', 'medium', 'low'] as const) {
    const t = await train(browser, E2E_DEV_KEY, { tier })
    // On failure, says what the field and the players looked like at the end.
    await expect(async () => {
      const now = await fx(t.page)
      const why = `${tier}: ${JSON.stringify(now)} ${JSON.stringify(await seen(t.page))}`
      expect(now.fields[0]?.visible ?? false, why).toBe(true)
    }).toPass({ timeout: 20_000 })
    const f = (await fx(t.page)).fields[0]!
    expect({ tier: f.tier, draws: f.draws, particles: f.particles }, tier).toEqual({
      tier,
      ...expected[tier],
    })
    expect(t.errors, t.errors.join('\n')).toEqual([])
    await t.context.close()
  }
  // Reduced motion: no motes or pulse at the highest step; the field is still there.
  const r = await train(browser, E2E_DEV_KEY, { tier: 'high', reducedMotion: 'reduce' })
  await expect
    .poll(async () => (await fx(r.page)).fields[0]?.visible ?? false, { timeout: 20_000 })
    .toBe(true)
  const f = (await fx(r.page)).fields[0]!
  expect([f.tier, f.reducedMotion, f.draws, f.particles]).toEqual(['high', true, 1, 0])
  expect(r.errors, r.errors.join('\n')).toEqual([])
  await r.context.close()
})

test('doubles: the partner sees the athlete’s field and has none', async ({ browser }) => {
  test.setTimeout(90_000)
  const t = await open(browser, '/?e2e=1')
  await t.page.getByTestId('nickname').fill('Tezuka')
  await t.page.getByTestId('dev-key').fill(E2E_DEV_KEY)
  await t.page.getByTestId('dev-room').check()
  await t.page.getByTestId('mode-2v2').click()
  await t.page.getByTestId('create-room').click()
  await expect(t.page.getByTestId('room-code')).toHaveText(/^[A-Z2-9]{5}$/)
  const code = (await t.page.getByTestId('room-code').textContent()) ?? ''
  // Seats alternate between the teams: Ann second (opponent), Ben third (partner).
  const url = await t.page.evaluate(
    () => (window as unknown as { __PB__: { serverUrl: string } }).__PB__.serverUrl,
  )
  const others = [await new Client(url).joinById(code, { nickname: 'Ann' })]
  await expect
    .poll(async () => (await seen(t.page))?.players.length ?? 0, { timeout: 20_000 })
    .toBe(2)
  const ben = await open(browser, `/?room=${code}&e2e=1`)
  await ben.page.getByTestId('nickname').fill('Ben')
  await ben.page.getByTestId('join-room').click()
  await expect
    .poll(async () => (await seen(ben.page))?.players.length ?? 0, { timeout: 20_000 })
    .toBe(3)
  others.push(await new Client(url).joinById(code, { nickname: 'Cal' }))
  await expect
    .poll(async () => (await seen(ben.page))?.players.length ?? 0, { timeout: 20_000 })
    .toBe(4)
  const s = (await seen(ben.page))!
  const tz = s.players.find((p) => p.nickname === 'Tezuka')!
  const bn = s.players.find((p) => p.nickname === 'Ben')!
  expect(Math.sign(tz.z)).toBe(Math.sign(bn.z))
  for (const [who, p] of [
    ['Tezuka', t],
    ['Ben (partner)', ben],
  ] as const)
    await expectOneFieldOn(p.page, tz.id, who)
  for (const o of others) await o.leave(true)
  for (const p of [t, ben]) {
    expect(p.errors, p.errors.join('\n')).toEqual([])
    await p.context.close()
  }
})
