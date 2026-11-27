/**
 * The secret athlete plays left-handed (apps/client/src/players/athlete/handedness.ts):
 * in every browser that draws them, the paddle is in their left hand, and everyone
 * else's is still in the right. Read-only checks through the `?e2e` debug hook.
 */
import { type Browser, type Page, expect, test } from '@playwright/test'
import { createRequire } from 'node:module'
import path from 'node:path'
import { E2E_DEV_KEY } from '../playwright.config'

// Extra players without browsers of their own.
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
interface Seen {
  players: { id: string; nickname: string; look: string }[]
}

const pb = <T>(page: Page, call: string): Promise<T> =>
  page.evaluate(
    (c) => (window as unknown as { __PB__: Record<string, () => unknown> }).__PB__[c]!() as T,
    call,
  )

/** For each player by name: the bone holding their paddle, and how far it is from it. */
async function handsSeen(page: Page): Promise<Record<string, { bone: string; gap: number }>> {
  const seen = await pb<Seen | null>(page, 'state')
  const paddles = await pb<Paddle[]>(page, 'paddles')
  const out: Record<string, { bone: string; gap: number }> = {}
  for (const p of paddles) {
    const who = seen?.players.find((x) => x.id === p.player)?.nickname ?? p.player
    const hand = p.hands[p.bone === 'hand_l' ? 0 : 1]!
    const gap = Math.hypot(...p.paddle.map((v, i) => v - hand[i]!))
    out[who] = { bone: p.bone, gap }
  }
  return out
}

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

test('Tezuka holds the paddle left-handed for the players and for a spectator; Bob right-handed', async ({
  browser,
}) => {
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
    .poll(async () => (await pb<{ mySlot: number | null }>(sam.page, 'ui')).mySlot)
    .toBe(null)

  for (const [who, p] of [
    ['Tezuka', t],
    ['Bob', bob],
    ['Sam (watching)', sam],
  ] as const) {
    await expect
      .poll(async () => Object.keys(await handsSeen(p.page)).sort(), { timeout: 20_000 })
      .toEqual(['Bob', 'Tezuka'])
    const hands = await handsSeen(p.page)
    expect(hands.Tezuka!.bone, `${who} sees Tezuka`).toBe('hand_l')
    expect(hands.Bob!.bone, `${who} sees Bob`).toBe('hand_r')
    // The paddle sits in that hand (the face is about 30 cm out from the wrist).
    for (const h of Object.values(hands)) expect(h.gap).toBeLessThan(0.45)
  }

  // Still so once the game is on and Tezuka has served.
  await t.page.getByTestId('ready').click()
  await bob.page.getByTestId('ready').click()
  await expect(t.page.getByTestId('serve-prompt')).toBeVisible()
  await t.page.keyboard.press('Space')
  await t.page.waitForTimeout(600)
  for (const p of [t, bob, sam]) {
    const hands = await handsSeen(p.page)
    expect(hands.Tezuka!.bone).toBe('hand_l')
    expect(hands.Bob!.bone).toBe('hand_r')
  }
  for (const p of [t, bob, sam]) {
    expect(p.errors, p.errors.join('\n')).toEqual([])
    await p.context.close()
  }
})

test('in training, Tezuka is left-handed and Coach Erwin right-handed; anyone else right-handed', async ({
  browser,
}) => {
  const t = await open(browser, '/?e2e=1')
  await t.page.getByTestId('nickname').fill('Tezuka')
  await t.page.getByTestId('dev-key').fill(E2E_DEV_KEY)
  await t.page.getByTestId('practice').click()
  await expect
    .poll(async () => Object.keys(await handsSeen(t.page)).sort(), { timeout: 20_000 })
    .toEqual(['Coach Erwin', 'Tezuka'])
  const hands = await handsSeen(t.page)
  expect(hands.Tezuka!.bone).toBe('hand_l')
  expect(hands['Coach Erwin']!.bone).toBe('hand_r')

  // The name alone, without the key, is an ordinary right-handed player.
  const a = await open(browser, '/?e2e=1')
  await a.page.getByTestId('nickname').fill('Tezuka')
  await a.page.getByTestId('practice').click()
  await expect
    .poll(async () => Object.keys(await handsSeen(a.page)).length, { timeout: 20_000 })
    .toBe(2)
  expect((await handsSeen(a.page)).Tezuka!.bone).toBe('hand_r')

  for (const p of [t, a]) {
    expect(p.errors, p.errors.join('\n')).toEqual([])
    await p.context.close()
  }
})

test('doubles: Tezuka left-handed, the other three right-handed', async ({ browser }) => {
  const t = await open(browser, '/?e2e=1')
  await t.page.getByTestId('nickname').fill('Tezuka')
  await t.page.getByTestId('dev-key').fill(E2E_DEV_KEY)
  await t.page.getByTestId('dev-room').check()
  await t.page.getByTestId('mode-2v2').click()
  await t.page.getByTestId('create-room').click()
  await expect(t.page.getByTestId('room-code')).toHaveText(/^[A-Z2-9]{5}$/)
  const code = (await t.page.getByTestId('room-code').textContent()) ?? ''
  const url = await t.page.evaluate(
    () => (window as unknown as { __PB__: { serverUrl: string } }).__PB__.serverUrl,
  )
  const others = []
  for (const nickname of ['Ann', 'Ben', 'Cal'])
    others.push(await new Client(url).joinById(code, { nickname }))
  await expect
    .poll(async () => Object.keys(await handsSeen(t.page)).sort(), { timeout: 20_000 })
    .toEqual(['Ann', 'Ben', 'Cal', 'Tezuka'])
  const hands = await handsSeen(t.page)
  expect(hands.Tezuka!.bone).toBe('hand_l')
  for (const n of ['Ann', 'Ben', 'Cal']) expect(hands[n]!.bone, n).toBe('hand_r')
  for (const o of others) await o.leave(true)
  expect(t.errors, t.errors.join('\n')).toEqual([])
  await t.context.close()
})
