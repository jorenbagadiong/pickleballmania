/**
 * The secret athlete drawn with a VRM body (apps/client/src/players/athlete/vrm.ts), and
 * its fallbacks. The private model is never in the repository: each browser here is
 * served one by route (`?e2e&secretModel` makes the page ask for it). Tests that need
 * the real prototype sample skip themselves when it isn't on this computer.
 */
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { type Browser, type Page, expect, test } from '@playwright/test'
import { E2E_DEV_KEY } from '../playwright.config'

const SAMPLE = path.resolve(
  'apps/client/public/models/private/prototype/VRM1_Constraint_Twist_Sample.vrm',
)
const haveSample = existsSync(SAMPLE)

const { Client } = createRequire(path.resolve('apps/client/package.json'))('@colyseus/sdk') as {
  Client: new (url: string) => {
    joinById(code: string, o: object): Promise<{ leave(consented?: boolean): Promise<unknown> }>
  }
}

test.beforeEach(async ({ browser }) => {
  for (const context of browser.contexts()) await context.close()
})

interface Paddle {
  player: string
  bone: string
  paddle: [number, number, number]
  hands: [number[], number[]]
}
type Model = 'sample' | 'missing' | 'garbage' | 'page'

const pb = <T>(page: Page, call: string): Promise<T> =>
  page.evaluate(
    (c) => (window as unknown as { __PB__: Record<string, () => unknown> }).__PB__[c]!() as T,
    call,
  )

/** A browser whose request for the secret model gets `model`. */
async function open(browser: Browser, url: string, model: Model) {
  const context = await browser.newContext()
  const page = await context.newPage()
  const errors: string[] = []
  const asked: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  await page.route('**/models/private/x1.vrm', (r) => {
    asked.push(r.request().url())
    if (model === 'sample') return r.fulfill({ path: SAMPLE })
    if (model === 'garbage') return r.fulfill({ body: 'glTF and then nonsense, not a model' })
    if (model === 'page') return r.fulfill({ contentType: 'text/html', body: '<!doctype html>' })
    return r.fulfill({ status: 404, body: '' })
  })
  await page.goto(url)
  return { context, page, errors, asked }
}

/** By name: the bone each player's paddle hangs from. */
async function paddleBones(page: Page): Promise<Record<string, string>> {
  const s = await pb<{ players: { id: string; nickname: string }[] } | null>(page, 'state')
  const out: Record<string, string> = {}
  for (const p of await pb<Paddle[]>(page, 'paddles'))
    out[s?.players.find((x) => x.id === p.player)?.nickname ?? p.player] = p.bone
  return out
}

async function trainAsTezuka(browser: Browser, model: Model, query = '') {
  const t = await open(browser, `/?e2e=1${query}`, model)
  await t.page.getByTestId('nickname').fill('Tezuka')
  await t.page.getByTestId('dev-key').fill(E2E_DEV_KEY)
  await t.page.getByTestId('practice').click()
  await expect
    .poll(async () => Object.keys(await paddleBones(t.page)).sort(), { timeout: 30_000 })
    .toEqual(['Coach Erwin', 'Tezuka'])
  return t
}

test.describe('without its own model', () => {
  test('Tezuka is drawn with the stand-in, left-handed, and nothing is asked for', async ({
    browser,
  }) => {
    const t = await trainAsTezuka(browser, 'missing')
    expect((await paddleBones(t.page)).Tezuka).toBe('hand_l')
    expect(t.asked).toEqual([])
    expect(t.errors, t.errors.join('\n')).toEqual([])
    await t.context.close()
  })

  for (const model of ['garbage', 'page', 'missing'] as const) {
    test(`a ${model === 'missing' ? 'missing' : model === 'page' ? 'web page instead of a' : 'broken'} model falls back to the stand-in`, async ({
      browser,
    }) => {
      const t = await trainAsTezuka(browser, model, '&secretModel')
      expect(t.asked.length).toBe(1)
      const bones = await paddleBones(t.page)
      expect(bones.Tezuka).toBe('hand_l')
      expect(bones['Coach Erwin']).toBe('hand_r')
      // The match goes on: the ball machine keeps feeding.
      await expect
        .poll(async () => (await pb<{ phase: string }>(t.page, 'state')).phase)
        .toBe('rally')
      // A 404 is reported by the browser itself; nothing else may go wrong.
      expect(t.errors.filter((e) => !e.includes('404'))).toEqual([])
      await t.context.close()
    })
  }
})

test.describe('with the prototype VRM sample', () => {
  test.skip(!haveSample, 'the prototype sample is not on this computer')

  test('Tezuka plays in it: left-handed, and the drawn paddle meets the ball', async ({
    browser,
  }) => {
    test.setTimeout(120_000)
    const t = await trainAsTezuka(browser, 'sample', '&secretModel')
    expect(t.asked.length).toBe(1)
    expect((await paddleBones(t.page)).Tezuka).toBe('hand_l')
    await pb(t.page, 'hits')
    const me = (
      await pb<{ players: { id: string; nickname: string }[] }>(t.page, 'state')
    ).players.find((p) => p.nickname === 'Tezuka')!.id
    // Swing at what the ball machine sends (the zone brings it to the left hand).
    type Hit = { id: string; gap: number; intendedGap: number; fidelity: number }
    let mine: Hit[] = []
    for (let i = 0; i < 300 && mine.length < 4; i++) {
      await t.page.mouse.click(480, 270)
      await t.page.waitForTimeout(150)
      mine = (await pb<Hit[]>(t.page, 'hits')).filter((h) => h.id === me)
    }
    expect(mine.length).toBeGreaterThanOrEqual(3)
    const all = JSON.stringify(mine)
    // The adapter: the drawn VRM paddle is where the controller put it, at every confirmed
    // hit and on every frame since logging began (1 cm). No share of hits is excused.
    for (const h of mine) expect(h.fidelity, all).toBeLessThan(0.01)
    expect(await pb<number>(t.page, 'fidelity')).toBeLessThan(0.01)
    // The game: confirmed hits are met by the drawn paddle (14 cm, about its face). Any miss
    // is then the controller's own pose missing too (the checks above), which is the
    // existing animation's timing or this small sample's reach, not the VRM: see
    // docs/tezuka-vrm-prototype.md, "Contact".
    const met = mine.filter((h) => h.gap < 0.14)
    expect(met.length / mine.length, all).toBeGreaterThanOrEqual(0.75)
    expect(t.errors, t.errors.join('\n')).toEqual([])
    await t.context.close()
  })

  test('opponent, spectator and doubles all see it left-handed', async ({ browser }) => {
    test.setTimeout(120_000)
    const t = await open(browser, '/?e2e=1&secretModel', 'sample')
    await t.page.getByTestId('nickname').fill('Tezuka')
    await t.page.getByTestId('dev-key').fill(E2E_DEV_KEY)
    await t.page.getByTestId('dev-room').check()
    await t.page.getByTestId('create-room').click()
    await expect(t.page.getByTestId('room-code')).toHaveText(/^[A-Z2-9]{5}$/)
    const code = (await t.page.getByTestId('room-code').textContent()) ?? ''
    const bob = await open(browser, `/?room=${code}&e2e=1&secretModel`, 'sample')
    await bob.page.getByTestId('nickname').fill('Bob')
    await bob.page.getByTestId('join-room').click()
    const sam = await open(browser, `/?room=${code}&e2e=1&secretModel`, 'sample')
    await sam.page.getByTestId('nickname').fill('Sam')
    await sam.page.getByTestId('join-room').click()
    for (const p of [t, bob, sam]) {
      await expect
        .poll(async () => Object.keys(await paddleBones(p.page)).sort(), { timeout: 30_000 })
        .toEqual(['Bob', 'Tezuka'])
      const bones = await paddleBones(p.page)
      expect(bones.Tezuka).toBe('hand_l')
      expect(bones.Bob).toBe('hand_r')
      expect(p.asked.length).toBe(1)
    }
    for (const p of [t, bob, sam]) {
      expect(p.errors, p.errors.join('\n')).toEqual([])
      await p.context.close()
    }

    // Doubles.
    const d = await open(browser, '/?e2e=1&secretModel', 'sample')
    await d.page.getByTestId('nickname').fill('Tezuka')
    await d.page.getByTestId('dev-key').fill(E2E_DEV_KEY)
    await d.page.getByTestId('dev-room').check()
    await d.page.getByTestId('mode-2v2').click()
    await d.page.getByTestId('create-room').click()
    await expect(d.page.getByTestId('room-code')).toHaveText(/^[A-Z2-9]{5}$/)
    const room = (await d.page.getByTestId('room-code').textContent()) ?? ''
    const url = await d.page.evaluate(
      () => (window as unknown as { __PB__: { serverUrl: string } }).__PB__.serverUrl,
    )
    const others = []
    for (const nickname of ['Ann', 'Ben', 'Cal'])
      others.push(await new Client(url).joinById(room, { nickname }))
    await expect
      .poll(async () => Object.keys(await paddleBones(d.page)).sort(), { timeout: 30_000 })
      .toEqual(['Ann', 'Ben', 'Cal', 'Tezuka'])
    const bones = await paddleBones(d.page)
    expect(bones.Tezuka).toBe('hand_l')
    for (const n of ['Ann', 'Ben', 'Cal']) expect(bones[n]).toBe('hand_r')
    for (const o of others) await o.leave(true)
    expect(d.errors, d.errors.join('\n')).toEqual([])
    await d.context.close()
  })

  test('the viewer loads it and every reachable stroke meets the ball', async ({ browser }) => {
    test.setTimeout(120_000)
    const v = await open(browser, '/?viewer&e2e=1', 'missing')
    const call = <T>(f: string): Promise<T> =>
      v.page.evaluate(
        // The viewer installs its hook once its page has loaded.
        (f) =>
          (window as unknown as { __VIEWER__?: Record<string, () => unknown> }).__VIEWER__?.[
            f
          ]?.() as T,
        f,
      )
    await expect.poll(() => call<boolean>('ready'), { timeout: 60_000 }).toBe(true)
    const stats = await call<{ missing: string[]; triangles: number }>('stats')
    expect(stats.missing).toEqual([])
    expect(stats.triangles).toBeGreaterThan(1000)
    const gaps = await call<Record<string, number>>('contacts')
    // This sample is small (head at 1.39 m, against 1.65 m for m1): balls at 1.5 m and
    // up, and the serve's, are out of its reach. Everything else is met.
    for (const [stroke, gap] of Object.entries(gaps))
      if (!['shoulder high', 'smash', 'jump smash', 'serve'].includes(stroke))
        expect(gap, stroke).toBeLessThan(0.14)
    expect(v.errors, v.errors.join('\n')).toEqual([])
    await v.context.close()
  })
})

test('the viewer is not reachable in a normal page without ?e2e', async ({ browser }) => {
  const p = await open(browser, '/?viewer', 'missing')
  await expect(p.page.getByTestId('nickname')).toBeVisible()
  await expect(p.page.getByTestId('viewer-panel')).toHaveCount(0)
  await p.context.close()
})
