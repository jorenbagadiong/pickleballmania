/**
 * The secret developer athlete (docs/tezuka.md), through the real UI against the real
 * server. Every browser here is on the computer running the server, so the host check
 * passes for all of them: what tells them apart is the key and the room.
 */
import { type Browser, type Page, expect, test } from '@playwright/test'
import { E2E_DEV_KEY } from '../playwright.config'

const SECRET_LOOK = 'x1'

interface Seen {
  phase: string
  players: { nickname: string; look: string }[]
}
const state = (page: Page): Promise<Seen | null> =>
  page.evaluate(() => (window as unknown as { __PB__: { state(): Seen | null } }).__PB__.state())
const lookOf = async (page: Page, nickname: string): Promise<string | undefined> =>
  (await state(page))?.players.find((p) => p.nickname === nickname)?.look
const cheats = (page: Page): Promise<boolean> =>
  page.evaluate(
    () => (window as unknown as { __PB__: { ui(): { cheats: boolean } } }).__PB__.ui().cheats,
  )

/** A player's browser, recording everything that could leak the key. */
async function open(browser: Browser, path: string) {
  const context = await browser.newContext()
  const page = await context.newPage()
  const errors: string[] = []
  const console: string[] = []
  const urls: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    console.push(m.text())
    if (m.type() === 'error') errors.push(m.text())
  })
  page.on('request', (r) => urls.push(r.url()))
  page.on('websocket', (ws) => urls.push(ws.url()))
  await page.goto(path)
  return { context, page, errors, console, urls }
}
type Player = Awaited<ReturnType<typeof open>>

/** Nowhere a person, a log or a report could see it, other than the request that sends it. */
async function expectNoKey(p: Player): Promise<void> {
  const where = await p.page.evaluate(() => {
    const dump = (s: Storage) => JSON.stringify(Object.entries(s))
    const pb = (window as unknown as { __PB__: { ui(): unknown; state(): unknown } }).__PB__
    return {
      url: location.href,
      local: dump(localStorage),
      session: dump(sessionStorage),
      cookie: document.cookie,
      html: document.documentElement.outerHTML,
      ui: JSON.stringify(pb.ui()),
      state: JSON.stringify(pb.state()),
    }
  })
  for (const [name, text] of Object.entries(where)) {
    expect(text.includes(E2E_DEV_KEY), `key in ${name}`).toBe(false)
  }
  expect(
    p.console.some((t) => t.includes(E2E_DEV_KEY)),
    'key in the console',
  ).toBe(false)
  expect(
    p.urls.some((u) => u.includes(E2E_DEV_KEY)),
    'key in a URL',
  ).toBe(false)
}

async function startAs(p: Player, nickname: string, key: string | null, devRoom: boolean) {
  await p.page.getByTestId('nickname').fill(nickname)
  if (key !== null) {
    const field = p.page.getByTestId('dev-key')
    await expect(field).toHaveAttribute('type', 'password')
    await field.fill(key)
  }
  if (devRoom) await p.page.getByTestId('dev-room').check()
  await p.page.getByTestId('create-room').click()
  await expect(p.page.getByTestId('room-code')).toHaveText(/^[A-Z2-9]{5}$/)
  return (await p.page.getByTestId('room-code').textContent()) ?? ''
}

test('the key field shows only for the name Tezuka, and the picker never offers the secret look', async ({
  browser,
}) => {
  const p = await open(browser, '/?e2e=1')
  await p.page.getByTestId('nickname').fill('Alice')
  await expect(p.page.getByTestId('dev-key')).toHaveCount(0)
  await p.page.getByTestId('nickname').fill('  tEzUkA ')
  await expect(p.page.getByTestId('dev-key')).toBeVisible()
  await expect(p.page.getByTestId('dev-room')).not.toBeChecked()
  await expect(p.page.getByTestId(`look-${SECRET_LOOK}`)).toHaveCount(0)
  await p.page.getByTestId('tournament').check()
  await expect(p.page.getByTestId('dev-room')).toBeDisabled()
  expect(p.errors, p.errors.join('\n')).toEqual([])
  await p.context.close()
})

test('Tezuka with the key, in a room allowing it: the secret look and held curves; Bob plays normally', async ({
  browser,
}) => {
  const t = await open(browser, '/?e2e=1')
  const code = await startAs(t, 'Tezuka', E2E_DEV_KEY, true)
  const bob = await open(browser, `/?room=${code}&e2e=1`)
  await bob.page.getByTestId('nickname').fill('Bob')
  await bob.page.getByTestId('look-m3').click()
  await bob.page.getByTestId('join-room').click()

  await expect.poll(() => lookOf(bob.page, 'Tezuka')).toBe(SECRET_LOOK)
  await expect.poll(() => lookOf(bob.page, 'Bob')).toBe('m3')
  await expect.poll(() => cheats(t.page)).toBe(true)
  expect(await cheats(bob.page)).toBe(false)

  // Choosing someone in the lobby does not change the secret look.
  await t.page.getByTestId('look-f1').click()
  await t.page.waitForTimeout(300)
  expect(await lookOf(bob.page, 'Tezuka')).toBe(SECRET_LOOK)

  // A normal game: both ready, Tezuka serves with the held-curve help showing.
  await t.page.getByTestId('ready').click()
  await bob.page.getByTestId('ready').click()
  await expect(t.page.getByTestId('serve-prompt')).toBeVisible()
  await expect(t.page.getByTestId('cheat-help')).toHaveCount(1)
  await expect(bob.page.getByTestId('cheat-help')).toHaveCount(0)
  await t.page.keyboard.down('KeyE')
  await t.page.keyboard.press('Space')
  await t.page.keyboard.up('KeyE')
  await expect.poll(async () => (await state(bob.page))?.phase).toBe('rally')

  // A refresh takes the seat back, and the server still knows who this is (no key needed).
  await t.page.reload()
  await expect.poll(() => cheats(t.page), { timeout: 20_000 }).toBe(true)
  expect(await lookOf(bob.page, 'Tezuka')).toBe(SECRET_LOOK)

  for (const p of [t, bob]) {
    await expectNoKey(p)
    expect(p.errors, p.errors.join('\n')).toEqual([])
  }
  // The room list does not carry it either.
  const list = await bob.page.evaluate(async () => {
    const pb = (window as unknown as { __PB__: { serverUrl: string } }).__PB__
    return (await fetch(`${pb.serverUrl}/rooms`)).text()
  })
  expect(list.includes(E2E_DEV_KEY)).toBe(false)
  for (const p of [t, bob]) await p.context.close()
})

test('without the key, with a wrong one, or in a room not allowing it, Tezuka is a normal player', async ({
  browser,
}) => {
  const cases: { key: string | null; devRoom: boolean }[] = [
    { key: null, devRoom: true },
    { key: `${E2E_DEV_KEY}-wrong`, devRoom: true },
    { key: E2E_DEV_KEY, devRoom: false },
  ]
  for (const c of cases) {
    const p = await open(browser, '/?e2e=1')
    await startAs(p, 'Tezuka', c.key, c.devRoom)
    await expect.poll(() => lookOf(p.page, 'Tezuka')).toBe('')
    await p.page.waitForTimeout(300)
    expect(await cheats(p.page), JSON.stringify({ ...c, key: c.key && '…' })).toBe(false)
    await expectNoKey(p)
    expect(p.errors, p.errors.join('\n')).toEqual([])
    await p.context.close()
  }
})

test('training allows the secret athlete with the key', async ({ browser }) => {
  const p = await open(browser, '/?e2e=1')
  await p.page.getByTestId('nickname').fill('Tezuka')
  await p.page.getByTestId('dev-key').fill(E2E_DEV_KEY)
  await p.page.getByTestId('practice').click()
  await expect.poll(() => lookOf(p.page, 'Tezuka')).toBe(SECRET_LOOK)
  await expect.poll(() => cheats(p.page)).toBe(true)
  await expectNoKey(p)
  expect(p.errors, p.errors.join('\n')).toEqual([])
  await p.context.close()
})
