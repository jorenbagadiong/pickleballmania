/**
 * Real multi-browser tests (1v1 and 2v2): independent browser contexts (separate
 * storage, separate WebSocket connections) play against the real game server.
 * Everything goes through the actual UI and input handlers; the `__PB__`
 * debug hook (enabled by `?e2e`) is only used to READ state for assertions.
 */
import { type Browser, type Page, expect, test } from '@playwright/test'

interface PlayerView {
  id: string
  slot: number
  nickname: string
  look: string
  x: number
  z: number
  spot: number
  ready: boolean
  connected: boolean
  swingSeq: number
  swingJump: boolean
}
interface StateView {
  phase: string
  message: string
  lastHitSlot: number
  servingSlot: number
  mode: string
  scores: [number, number]
  serverId: string
  players: PlayerView[]
  ball: {
    x: number
    y: number
    z: number
    vx: number
    vy: number
    vz: number
    visible: boolean
    held: boolean
  }
}

declare global {
  interface Window {
    __PB__: {
      state(): StateView | null
      ui(): { sessionId: string | null; roomCode: string | null; mySlot: number | null }
      project(x: number, z: number): { x: number; y: number } | null
      camera(): { x: number; y: number; z: number; court: number } | null
    }
  }
}

const state = (page: Page): Promise<StateView | null> => page.evaluate(() => window.__PB__.state())
const player = async (page: Page, nickname: string): Promise<PlayerView | undefined> =>
  (await state(page))?.players.find((p) => p.nickname === nickname)

async function openPlayer(browser: Browser, path: string) {
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

async function holdKey(page: Page, key: string, ms: number): Promise<void> {
  await page.keyboard.down(key)
  await page.waitForTimeout(ms)
  await page.keyboard.up(key)
}

test('two players create/join, move, serve, rally, and survive refresh/disconnect', async ({
  browser,
}) => {
  // --- Alice creates a room -------------------------------------------------
  const alice = await openPlayer(browser, '/?e2e=1')
  await alice.page.getByTestId('nickname').fill('Alice')
  await alice.page.getByTestId('create-room').click()
  const codeEl = alice.page.getByTestId('room-code')
  await expect(codeEl).toHaveText(/^[A-Z2-9]{5}$/)
  const code = (await codeEl.textContent()) ?? ''
  const invite = await alice.page.getByTestId('invite-url').inputValue()
  expect(invite).toContain(`room=${code}`)

  // --- Bob joins through the invite link --------------------------------------
  const bob = await openPlayer(browser, `/?room=${code}&e2e=1`)
  await expect(bob.page.getByTestId('room-code-input')).toHaveValue(code)
  await bob.page.getByTestId('nickname').fill('Bob')
  await bob.page.getByTestId('join-room').click()
  await expect(bob.page.getByTestId('room-code')).toHaveText(code)

  // Both see both players, on opposite sides.
  await expect
    .poll(async () => (await state(alice.page))?.players.length, { timeout: 15000 })
    .toBe(2)
  await expect.poll(async () => (await state(bob.page))?.players.length, { timeout: 15000 }).toBe(2)
  const aliceOnBob = await player(bob.page, 'Alice')
  const bobOnAlice = await player(alice.page, 'Bob')
  expect(aliceOnBob?.slot).toBe(0)
  expect(bobOnAlice?.slot).toBe(1)
  expect(aliceOnBob!.z).toBeGreaterThan(0)
  expect(bobOnAlice!.z).toBeLessThan(0)

  // --- A third person finds the room in the list and watches -------------------
  const carol = await openPlayer(browser, '/?e2e=1')
  await carol.page.getByTestId('nickname').fill('Carol')
  await expect(carol.page.getByTestId(`room-${code}`)).toContainText('Alice, Bob')
  await expect(carol.page.getByTestId(`join-${code}`)).toHaveText('Watch')
  await carol.page.getByTestId(`join-${code}`).click()
  await expect(carol.page.getByTestId('spectating')).toBeVisible()
  await expect(alice.page.getByTestId('watchers')).toContainText('1 watching')
  expect(await carol.page.evaluate(() => window.__PB__.ui().mySlot)).toBeNull()

  // --- Independent movement, synchronized to the other browser ---------------
  await alice.page.locator('canvas').click({ position: { x: 820, y: 300 } }) // focus page
  const aliceX0 = aliceOnBob!.x
  await holdKey(alice.page, 'd', 600) // Alice's right is +x
  await expect
    .poll(async () => (await player(bob.page, 'Alice'))!.x, { timeout: 3000 })
    .toBeGreaterThan(aliceX0 + 1.5)

  await bob.page.locator('canvas').click({ position: { x: 820, y: 300 } })
  const bobZ0 = bobOnAlice!.z
  await holdKey(bob.page, 'w', 400) // W = toward the net (+z for Bob)
  await expect
    .poll(async () => (await player(alice.page, 'Bob'))!.z, { timeout: 3000 })
    .toBeGreaterThan(bobZ0 + 1)
  // Alice did not move while Bob did.
  const aliceNow = (await player(bob.page, 'Alice'))!.x
  await bob.page.waitForTimeout(300)
  expect((await player(bob.page, 'Alice'))!.x).toBeCloseTo(aliceNow, 3)

  // --- Ready up -> serving ----------------------------------------------------
  await alice.page.getByTestId('ready').click()
  await bob.page.getByTestId('ready').click()
  await expect(alice.page.getByTestId('serve-prompt')).toBeVisible()
  await expect.poll(async () => (await state(bob.page))?.phase).toBe('serving')

  // The spectator sees the game, cannot act in it, and can change camera.
  await expect.poll(async () => (await state(carol.page))?.phase).toBe('serving')
  await carol.page.keyboard.press('Space')
  await carol.page.locator('canvas').click({ position: { x: 480, y: 250 } })
  await expect(carol.page.getByTestId('camera-view')).toContainText('Side')
  await carol.page.keyboard.press('c')
  await expect(carol.page.getByTestId('camera-view')).toContainText('Orange end')
  expect((await state(carol.page))?.phase).toBe('serving')

  // --- Spectator chat: players see it, and it cannot get in their way ----------
  await expect(alice.page.getByTestId('chat-input')).toHaveCount(0) // players only read
  await carol.page.getByTestId('chat-input').fill('c space <b>nice</b>')
  await carol.page.keyboard.press('Enter')
  for (const p of [alice.page, bob.page, carol.page])
    await expect(p.getByText('c space <b>nice</b>')).toBeVisible()
  // Typing (including C) does not move the spectator's camera.
  await carol.page.getByTestId('chat-input').pressSequentially('ccc')
  await expect(carol.page.getByTestId('camera-view')).toContainText('Orange end')
  await carol.page.keyboard.press('Escape')
  // The caption neither takes clicks nor focus: the canvas is what is under the mouse.
  const under = await alice.page.evaluate(() => {
    const r = document.querySelector('[data-testid="chat-feed"] li')!.getBoundingClientRect()
    const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
    return { tag: el?.tagName, focus: document.activeElement?.tagName }
  })
  expect(under).toEqual({ tag: 'CANVAS', focus: 'BODY' })
  // Players can turn it off and on.
  await alice.page.getByTestId('chat-toggle').click()
  await expect(alice.page.getByTestId('chat-feed')).toHaveCount(0)
  await alice.page.getByTestId('chat-toggle').click()
  await expect(alice.page.getByTestId('chat-feed')).toHaveCount(1)

  // --- Alice serves toward Bob, Bob returns with a real click ----------------
  const bobPos = (await player(alice.page, 'Bob'))!
  // Aim the serve so it lands in the box just in front of Bob and carries to him.
  const aimX = bobPos.x
  const aimZ = bobPos.z + 2.2
  await alice.page.waitForTimeout(300)
  const screen = await alice.page.evaluate(([x, z]) => window.__PB__.project(x, z), [
    aimX,
    aimZ,
  ] as const)
  expect(screen).not.toBeNull()
  await alice.page.mouse.move(screen!.x, screen!.y)
  await alice.page.waitForTimeout(200)

  // Bob aims back at the middle of Alice's court.
  const bobAim = await bob.page.evaluate(() => window.__PB__.project(0, 4))
  await bob.page.mouse.move(bobAim!.x, bobAim!.y)

  // Bob's page swings (dispatches a real click on the canvas) when the ball, after
  // bouncing on his side, comes within reach.
  const bobSwing = bob.page.evaluate(
    () =>
      new Promise<string>((resolve) => {
        const canvas = document.querySelector('canvas') as HTMLCanvasElement
        const surface = canvas.parentElement ?? canvas
        let bounced = false
        let lastVy = 0
        const started = performance.now()
        const timer = setInterval(() => {
          const s = window.__PB__.state()
          const me = s?.players.find((p) => p.nickname === 'Bob')
          if (!s || !me) return
          if (s.phase === 'rally' && s.ball.z < 0 && lastVy < 0 && s.ball.vy > 0) bounced = true
          lastVy = s.ball.vy
          const dist = Math.hypot(s.ball.x - me.x, s.ball.z - me.z)
          if (bounced && dist < 1.2) {
            clearInterval(timer)
            surface.dispatchEvent(new PointerEvent('pointerdown', { button: 0, bubbles: true }))
            setTimeout(() => {
              window.dispatchEvent(new PointerEvent('pointerup', { button: 0, bubbles: true }))
              resolve(`swung at dist ${dist.toFixed(2)}`)
            }, 60)
          }
          if (performance.now() - started > 6000) {
            clearInterval(timer)
            resolve('no swing')
          }
        }, 8)
      }),
  )

  await alice.page.keyboard.press('Space')
  await expect.poll(async () => (await state(alice.page))?.phase).toBe('rally')

  // Both browsers see the same ball crossing to Bob's side.
  await expect.poll(async () => (await state(bob.page))!.ball.z, { timeout: 3000 }).toBeLessThan(0)
  const [sa, sb] = await Promise.all([state(alice.page), state(bob.page)])
  expect(Math.abs(sa!.ball.z - sb!.ball.z)).toBeLessThan(1.0)

  const swing = await bobSwing
  expect(swing).toMatch(/swung/)
  // Server validated Bob's hit; both clients see the ball coming back to Alice.
  await expect.poll(async () => (await state(alice.page))?.lastHitSlot, { timeout: 3000 }).toBe(1)
  await expect
    .poll(async () => (await state(alice.page))!.ball.z, { timeout: 3000 })
    .toBeGreaterThan(0)

  // Alice doesn't return it; both see the same rally result and score.
  await expect
    .poll(async () => (await state(alice.page))?.phase, { timeout: 8000 })
    .toBe('pointOver')
  await expect.poll(async () => (await state(bob.page))?.phase, { timeout: 3000 }).toBe('pointOver')
  const scores = async (p: Page) => (await state(p))!.scores.join('-')
  // Bob won the rally but wasn't serving: side out, no point, and both are told why.
  expect(await scores(alice.page)).toBe('0-0')
  expect((await state(alice.page))!.servingSlot).toBe(1)
  expect(await scores(alice.page)).toBe(await scores(bob.page))
  for (const p of [alice.page, bob.page]) {
    await expect(p.getByTestId('rally-reason')).toHaveText('Double bounce')
    await expect(p.getByTestId('rally-detail')).toContainText('Alice')
    await expect(p.getByTestId('rally-result')).toContainText('Side out')
  }

  await expect(carol.page.getByTestId('rally-reason')).toHaveText('Double bounce')

  // Rally resets to a new serve.
  await expect.poll(async () => (await state(alice.page))?.phase, { timeout: 5000 }).toBe('serving')

  // --- Refresh: Bob reloads and gets his seat back ---------------------------
  const scoreBefore = await scores(alice.page)
  await bob.page.reload()
  await expect.poll(async () => (await state(bob.page))?.players.length, { timeout: 8000 }).toBe(2)
  expect(await bob.page.evaluate(() => window.__PB__.ui().mySlot)).toBe(1)
  await expect.poll(async () => (await state(alice.page))?.phase, { timeout: 5000 }).toBe('serving')
  expect(await scores(alice.page)).toBe(scoreBefore)

  // A spectator can refresh and keeps watching.
  await carol.page.reload()
  await expect(carol.page.getByTestId('spectating')).toBeVisible({ timeout: 8000 })
  expect((await state(alice.page))?.phase).toBe('serving')
  expect(carol.errors, carol.errors.join('\n')).toEqual([])
  await carol.context.close()

  // --- Disconnect: Bob's browser goes away -> Alice is told and play pauses ---
  await bob.context.close()
  await expect(alice.page.getByTestId('paused')).toBeVisible({ timeout: 8000 })
  expect((await player(alice.page, 'Bob'))?.connected).toBe(false)

  // No uncaught page errors in either browser.
  expect(alice.errors, alice.errors.join('\n')).toEqual([])
  expect(bob.errors.filter((e) => !/WebSocket|ERR_CONNECTION/i.test(e))).toEqual([])
  await alice.context.close()
})

test('four players pick teams and play doubles', async ({ browser }) => {
  test.setTimeout(120_000)
  const alice = await openPlayer(browser, '/?e2e=1')
  await alice.page.getByTestId('nickname').fill('Alice')
  await alice.page.getByTestId('mode-2v2').click()
  await alice.page.getByTestId('create-room').click()
  const codeEl = alice.page.getByTestId('room-code')
  await expect(codeEl).toHaveText(/^[A-Z2-9]{5}$/)
  const code = (await codeEl.textContent()) ?? ''
  await expect(alice.page.getByTestId('mode')).toContainText('2v2')

  const join = async (name: string) => {
    const p = await openPlayer(browser, `/?room=${code}&e2e=1`)
    await p.page.getByTestId('nickname').fill(name)
    await p.page.getByTestId('join-room').click()
    await expect(p.page.getByTestId('room-code')).toHaveText(code)
    return p
  }
  const bob = await join('Bob')
  const carol = await join('Carol')
  expect((await player(carol.page, 'Carol'))?.slot).toBe(0) // fills the smaller/first team

  // Carol switches to Bob's team; Dave then takes the seat she left.
  await carol.page.getByTestId('join-team-1').click()
  await expect.poll(async () => (await player(alice.page, 'Carol'))?.slot).toBe(1)
  const dave = await join('Dave')
  const all = [alice, bob, carol, dave]
  for (const p of all)
    await expect.poll(async () => (await state(p.page))?.players.length, { timeout: 15000 }).toBe(4)
  expect((await player(alice.page, 'Dave'))?.slot).toBe(0)

  // A fifth person joining by link watches.
  const eve = await openPlayer(browser, `/?room=${code}&e2e=1`)
  await eve.page.getByTestId('nickname').fill('Eve')
  await eve.page.getByTestId('join-room').click()
  await expect(eve.page.getByTestId('spectating')).toBeVisible()
  await eve.context.close()

  for (const p of all) await p.page.getByTestId('ready').click()
  for (const p of all)
    await expect.poll(async () => (await state(p.page))?.phase, { timeout: 8000 }).toBe('serving')

  // Exactly one browser is told to serve, and everyone agrees who it is.
  const ids = await Promise.all(all.map((p) => p.page.evaluate(() => window.__PB__.ui().sessionId)))
  const serverId = (await state(alice.page))!.serverId
  for (const p of all) expect((await state(p.page))!.serverId).toBe(serverId)
  const serverIndex = ids.indexOf(serverId)
  expect(serverIndex).toBeGreaterThanOrEqual(0)
  for (const [i, p] of all.entries())
    await expect(p.page.getByTestId('serve-prompt')).toHaveCount(i === serverIndex ? 1 : 0)

  // Partners stand apart rather than on top of each other.
  const team0 = (await state(alice.page))!.players.filter((p) => p.slot === 0)
  expect(Math.hypot(team0[0].x - team0[1].x, team0[0].z - team0[1].z)).toBeGreaterThan(1)

  // The serve starts a rally everyone sees, and nobody returns it: one point, same score everywhere.
  const server = all[serverIndex]
  const me = (await state(server.page))!.players.find((p) => p.id === serverId)!
  const spot = await server.page.evaluate(([x, z]) => window.__PB__.project(x, z), [
    -Math.sign(me.x) * 1.5,
    -Math.sign(me.z) * 4.5,
  ] as const)
  await server.page.mouse.move(spot!.x, spot!.y)
  await server.page.waitForTimeout(200)
  await server.page.keyboard.press('Space')
  for (const p of all)
    await expect
      .poll(async () => (await state(p.page))?.phase, { timeout: 12000 })
      .toBe('pointOver')
  for (const p of all) expect((await state(p.page))!.scores).toEqual([1, 0])

  // The serving side scored, so the same player serves again from the other court.
  await expect.poll(async () => (await state(alice.page))?.phase, { timeout: 6000 }).toBe('serving')
  const next = (await state(alice.page))!
  expect(next.serverId).toBe(serverId)
  const again = next.players.find((p) => p.id === serverId)!
  expect(Math.sign(again.x)).toBe(-Math.sign(me.x))

  for (const p of all) {
    expect(p.errors, p.errors.join('\n')).toEqual([])
    await p.context.close()
  }
})

test('Space serves on your serve and swings (Shift smashes) otherwise', async ({ browser }) => {
  const alice = await openPlayer(browser, '/?e2e=1')
  await alice.page.getByTestId('nickname').fill('Alice')
  await alice.page.getByTestId('create-room').click()
  const codeEl = alice.page.getByTestId('room-code')
  await expect(codeEl).toHaveText(/^[A-Z2-9]{5}$/)
  const code = (await codeEl.textContent()) ?? ''
  const bob = await openPlayer(browser, `/?room=${code}&e2e=1`)
  await bob.page.getByTestId('nickname').fill('Bob')
  await bob.page.getByTestId('join-room').click()
  await expect(bob.page.getByTestId('room-code')).toHaveText(code)
  await alice.page.getByTestId('ready').click()
  await bob.page.getByTestId('ready').click()
  await expect(alice.page.getByTestId('serve-prompt')).toBeVisible()

  const aimAt = async (page: Page, x: number, z: number) => {
    const p = await page.evaluate(([px, pz]) => window.__PB__.project(px, pz), [x, z] as const)
    await page.mouse.move(p!.x, p!.y)
  }
  const bobPos = (await player(alice.page, 'Bob'))!
  await alice.page.waitForTimeout(500) // let the camera settle
  await aimAt(alice.page, bobPos.x, bobPos.z + 2.2)
  await aimAt(bob.page, 0, 4)
  await alice.page.waitForTimeout(200)

  // Bob presses Shift+Space once the ball is close; nothing else swings for him.
  const swung = bob.page.evaluate(
    () =>
      new Promise<boolean>((resolve) => {
        const started = performance.now()
        const timer = setInterval(() => {
          const s = window.__PB__.state()
          const me = s?.players.find((p) => p.nickname === 'Bob')
          const near = s && me && Math.hypot(s.ball.x - me.x, s.ball.z - me.z) < 1.2
          if (s?.phase === 'rally' && near) {
            clearInterval(timer)
            window.dispatchEvent(
              new KeyboardEvent('keydown', { code: 'Space', shiftKey: true, cancelable: true }),
            )
            resolve(true)
          } else if (performance.now() - started > 8000) {
            clearInterval(timer)
            resolve(false)
          }
        }, 8)
      }),
  )
  await alice.page.keyboard.press('Space') // her serve: Space serves
  expect(await swung).toBe(true)
  await expect.poll(async () => (await state(alice.page))?.lastHitSlot, { timeout: 3000 }).toBe(1)
  expect(alice.errors, alice.errors.join('\n')).toEqual([])
  expect(bob.errors, bob.errors.join('\n')).toEqual([])
  await alice.context.close()
  await bob.context.close()
})

test('swiping the mouse while serving curves the ball to the right', async ({ browser }) => {
  const alice = await openPlayer(browser, '/?e2e=1')
  await alice.page.getByTestId('nickname').fill('Alice')
  await alice.page.getByTestId('create-room').click()
  const codeEl = alice.page.getByTestId('room-code')
  await expect(codeEl).toHaveText(/^[A-Z2-9]{5}$/)
  const code = (await codeEl.textContent()) ?? ''
  const bob = await openPlayer(browser, `/?room=${code}&e2e=1`)
  await bob.page.getByTestId('nickname').fill('Bob')
  await bob.page.getByTestId('join-room').click()
  await expect(bob.page.getByTestId('room-code')).toHaveText(code)
  await alice.page.getByTestId('ready').click()
  await bob.page.getByTestId('ready').click()
  await expect(alice.page.getByTestId('serve-prompt')).toBeVisible()

  // Bob's browser watches how the ball's sideways speed changes before it bounces.
  const seen = bob.page.evaluate(
    () =>
      new Promise<{ vx: number[]; x: number }>((resolve) => {
        const vx: number[] = []
        const started = performance.now()
        const timer = setInterval(() => {
          const s = window.__PB__.state()
          const flying = s?.phase === 'rally' && !s.ball.held
          if (flying && s.ball.z < -4.5) {
            clearInterval(timer)
            resolve({ vx, x: s.ball.x })
          } else if (performance.now() - started > 15000) {
            clearInterval(timer)
            resolve({ vx: [], x: 99 })
          } else if (flying && vx.at(-1) !== s.ball.vx) vx.push(s.ball.vx)
        }, 8)
      }),
  )
  await alice.page.waitForTimeout(500) // let the camera settle
  const aim = await alice.page.evaluate(() => window.__PB__.project(-1.8, -5.5))
  await alice.page.mouse.move(aim!.x, aim!.y)
  await alice.page.waitForTimeout(200)
  // A real-time swipe with the real mouse: to the right, serving partway through it.
  const width = alice.page.viewportSize()!.width
  const started = Date.now()
  for (let t = 0; t < 0.15; t = (Date.now() - started) / 1000) {
    await alice.page.mouse.move(aim!.x + width * 2.5 * t, aim!.y)
  }
  await alice.page.keyboard.press('Space')
  const { vx, x } = await seen
  expect(vx.length).toBeGreaterThan(3)
  expect(vx.at(-1)! - vx[0]!).toBeGreaterThan(2) // pushed toward +x, her right
  expect(x).toBeLessThan(-0.5) // and still heading for the box she aimed at, on her left
  expect(alice.errors, alice.errors.join('\n')).toEqual([])
  expect(bob.errors, bob.errors.join('\n')).toEqual([])
  await alice.context.close()
  await bob.context.close()
})

test('the lobby panel can be minimized, and you can still get ready', async ({ browser }) => {
  const alice = await openPlayer(browser, '/?e2e=1')
  await alice.page.getByTestId('nickname').fill('Alice')
  await alice.page.getByTestId('create-room').click()
  const codeEl = alice.page.getByTestId('room-code')
  await expect(codeEl).toHaveText(/^[A-Z2-9]{5}$/)
  const code = (await codeEl.textContent()) ?? ''
  const bob = await openPlayer(browser, `/?room=${code}&e2e=1`)
  await bob.page.getByTestId('nickname').fill('Bob')
  await bob.page.getByTestId('join-room').click()
  await expect(bob.page.getByTestId('room-code')).toHaveText(code)

  await alice.page.getByTestId('minimize').click()
  await expect(alice.page.getByTestId('copy-invite')).toBeHidden()
  await expect(alice.page.getByTestId('mini-bar')).toContainText(code)
  // Space must not press the button that was just used.
  await alice.page.keyboard.press('Space')
  await expect(alice.page.getByTestId('mini-bar')).toBeVisible()
  await alice.page.getByTestId('restore').click()
  await expect(alice.page.getByTestId('copy-invite')).toBeVisible()
  await alice.page.getByTestId('minimize').click()
  await alice.page.getByTestId('ready').click()
  await expect(alice.page.getByTestId('mini-bar')).toContainText('1/2 ready')
  await bob.page.getByTestId('ready').click()
  await expect(alice.page.getByTestId('serve-prompt')).toBeVisible()
  await expect(alice.page.getByTestId('mini-bar')).toBeHidden()
  for (const p of [alice, bob]) {
    expect(p.errors, p.errors.join('\n')).toEqual([])
    await p.context.close()
  }
})

test('a smash while moving forward is a jump smash, seen by the other player', async ({
  browser,
}) => {
  const alice = await openPlayer(browser, '/?e2e=1')
  await alice.page.getByTestId('nickname').fill('Alice')
  await alice.page.getByTestId('create-room').click()
  const codeEl = alice.page.getByTestId('room-code')
  await expect(codeEl).toHaveText(/^[A-Z2-9]{5}$/)
  const bob = await openPlayer(browser, `/?room=${(await codeEl.textContent()) ?? ''}&e2e=1`)
  await bob.page.getByTestId('nickname').fill('Bob')
  await bob.page.getByTestId('join-room').click()
  await bob.page.getByTestId('ready').click()
  await alice.page.getByTestId('ready').click()
  await expect(alice.page.getByTestId('serve-prompt')).toBeVisible()

  // Alice's browser sees how each of Bob's swings went. He swings while she has yet to serve.
  const swing = async (move: 'w' | 's' | null): Promise<boolean> => {
    const before = (await player(alice.page, 'Bob'))!.swingSeq
    if (move) await bob.page.keyboard.down(move)
    await bob.page.waitForTimeout(250)
    await bob.page.keyboard.down('Shift')
    await bob.page.keyboard.press('Space')
    await bob.page.keyboard.up('Shift')
    if (move) await bob.page.keyboard.up(move)
    await expect.poll(async () => (await player(alice.page, 'Bob'))!.swingSeq).not.toBe(before)
    const { swingJump } = (await player(alice.page, 'Bob'))!
    await bob.page.waitForTimeout(700)
    return swingJump
  }
  expect(await swing(null)).toBe(false)
  expect(await swing('w')).toBe(true)
  expect(await swing('s')).toBe(false)
  expect(alice.errors, alice.errors.join('\n')).toEqual([])
  expect(bob.errors, bob.errors.join('\n')).toEqual([])
  await alice.context.close()
  await bob.context.close()
})

test('New room opens a fresh room with a new code, in one click from the lobby', async ({
  browser,
}) => {
  const alice = await openPlayer(browser, '/?e2e=1')
  await alice.page.getByTestId('nickname').fill('Alice')
  await alice.page.getByTestId('mode-2v2').click()
  await alice.page.getByTestId('create-room').click()
  const codeEl = alice.page.getByTestId('room-code')
  await expect(codeEl).toHaveText(/^[A-Z2-9]{5}$/)
  const first = (await codeEl.textContent()) ?? ''
  await alice.page.getByTestId('lobby-new-room').click()
  await expect(codeEl).toHaveText(/^[A-Z2-9]{5}$/)
  await expect(codeEl).not.toHaveText(first)
  await expect(alice.page.getByTestId('mode')).toContainText('2v2') // same mode and name
  await expect.poll(async () => (await player(alice.page, 'Alice'))?.slot).toBe(0)
  expect(alice.errors, alice.errors.join('\n')).toEqual([])
  await alice.context.close()
})

test('everyone picks a character, sees the others as they chose, and can change in the lobby', async ({
  browser,
}) => {
  const alice = await openPlayer(browser, '/?e2e=1')
  await alice.page.getByTestId('nickname').fill('Alice')
  await alice.page.getByTestId('look-f2').click()
  await expect(alice.page.getByTestId('look-f2')).toHaveAttribute('aria-checked', 'true')
  await alice.page.getByTestId('create-room').click()
  const code = (await alice.page.getByTestId('room-code').textContent()) ?? ''

  const bob = await openPlayer(browser, `/?room=${code}&e2e=1`)
  await bob.page.getByTestId('nickname').fill('Bob')
  await bob.page.getByTestId('look-m3').click()
  await bob.page.getByTestId('join-room').click()
  await expect.poll(async () => (await player(bob.page, 'Alice'))?.look).toBe('f2')
  await expect.poll(async () => (await player(alice.page, 'Bob'))?.look).toBe('m3')

  // Changed in the lobby: everyone sees it, and it is remembered for next time.
  await bob.page.getByTestId('look-m1').click()
  await expect.poll(async () => (await player(alice.page, 'Bob'))?.look).toBe('m1')
  expect(await bob.page.evaluate(() => localStorage.getItem('pickleball.look'))).toBe('m1')
  await bob.page.reload()
  await expect.poll(async () => (await player(alice.page, 'Bob'))?.look).toBe('m1')

  for (const p of [alice, bob]) expect(p.errors, p.errors.join('\n')).toEqual([])
  for (const p of [alice, bob]) await p.context.close()
})

test('a room with an open seat can be joined from the list, and spectators can take a freed seat', async ({
  browser,
}) => {
  const alice = await openPlayer(browser, '/?e2e=1')
  await alice.page.getByTestId('nickname').fill('Alice')
  await alice.page.getByTestId('create-room').click()
  const codeEl = alice.page.getByTestId('room-code')
  await expect(codeEl).toHaveText(/^[A-Z2-9]{5}$/)
  const code = (await codeEl.textContent()) ?? ''

  const fromList = async (name: string, label: 'Play' | 'Watch') => {
    const p = await openPlayer(browser, '/?e2e=1')
    const button = p.page.getByTestId(`join-${code}`)
    await expect(button).toBeDisabled() // a nickname is needed first
    await p.page.getByTestId('nickname').fill(name)
    await expect(button).toHaveText(label)
    await button.click()
    await expect(p.page.getByTestId('room-code')).toHaveText(code)
    return p
  }
  const bob = await fromList('Bob', 'Play')
  await expect.poll(async () => (await player(alice.page, 'Bob'))?.slot).toBe(1)
  const carol = await fromList('Carol', 'Watch')
  await expect(carol.page.getByTestId('take-seat')).toBeDisabled()

  await bob.page.getByTestId('lobby-sit-out').click()
  await carol.page.getByTestId('take-seat').click()
  await expect.poll(async () => (await player(alice.page, 'Carol'))?.slot).toBe(1)
  await expect(bob.page.getByTestId('spectating')).toBeVisible()

  // Carol can really play: movement works after taking the seat.
  await expect(async () => {
    const x0 = (await player(alice.page, 'Carol'))!.x
    await holdKey(carol.page, 'a', 500)
    await holdKey(carol.page, 'd', 900)
    await expect
      .poll(async () => Math.abs((await player(alice.page, 'Carol'))!.x - x0), { timeout: 3000 })
      .toBeGreaterThan(0.5)
  }).toPass({ timeout: 30_000 })
  for (const p of [alice, bob, carol]) {
    expect(p.errors, p.errors.join('\n')).toEqual([])
    await p.context.close()
  }
})

test('training: alone from the start, or while a game is on, and back to that room', async ({
  browser,
}) => {
  // Straight from the start screen: the machine feeds, and a hit is judged.
  const dan = await openPlayer(browser, '/?e2e=1')
  await dan.page.getByTestId('nickname').fill('Dan')
  await dan.page.getByTestId('practice').click()
  await expect(dan.page.getByTestId('practice-panel')).toBeVisible()
  await expect.poll(async () => (await state(dan.page))?.phase).toBe('rally')
  await dan.page.getByTestId('drill-serve').click()
  await expect(dan.page.getByTestId('serve-prompt')).toBeVisible()
  await dan.page.waitForTimeout(800) // let the camera settle
  const me = (await player(dan.page, 'Dan'))!
  const aim = await dan.page.evaluate(([x, z]) => window.__PB__.project(x, z), [
    -Math.sign(me.x) * 2,
    -4.6,
  ] as const)
  await dan.page.mouse.move(aim!.x, aim!.y)
  await dan.page.waitForTimeout(300)
  await dan.page.keyboard.press('Space')
  await expect(dan.page.getByTestId('practice-tally')).toContainText('1 / 1')
  await expect(dan.page.getByTestId('practice-shot')).toContainText('from your aim')
  await expect(dan.page.getByTestId('practice-shot')).toContainText('Straight')
  await expect(dan.page.getByTestId('swipe-verdict')).toContainText('not moving')
  await dan.page.getByTestId('drill-rally').click()
  await dan.page.getByTestId('level-hard').click()
  await expect(dan.page.getByTestId('level-hard')).toHaveAttribute('aria-pressed', 'true')

  // While others play: Carol watches a game, trains, sees the game's state, and returns.
  const alice = await openPlayer(browser, '/?e2e=1')
  await alice.page.getByTestId('nickname').fill('Alice')
  await alice.page.getByTestId('create-room').click()
  const codeEl = alice.page.getByTestId('room-code')
  await expect(codeEl).toHaveText(/^[A-Z2-9]{5}$/)
  const code = (await codeEl.textContent()) ?? ''
  const join = async (name: string) => {
    const p = await openPlayer(browser, `/?room=${code}&e2e=1`)
    await p.page.getByTestId('nickname').fill(name)
    await p.page.getByTestId('join-room').click()
    return p
  }
  const bob = await join('Bob')
  await bob.page.getByTestId('ready').click()
  await alice.page.getByTestId('ready').click()
  await expect(alice.page.getByTestId('serve-prompt')).toBeVisible()
  const carol = await join('Carol')
  await expect(carol.page.getByTestId('spectating')).toBeVisible()
  await carol.page.getByTestId('practice-meanwhile').click()
  await expect(carol.page.getByTestId('practice-panel')).toBeVisible()
  await expect(carol.page.getByTestId('room-status')).toContainText('Alice · Bob: 0–0')
  await expect(alice.page.getByTestId('serve-prompt')).toBeVisible() // their game goes on
  await carol.page.getByTestId('back-to-room').click()
  await expect(carol.page.getByTestId('spectating')).toBeVisible()
  await expect(carol.page.getByTestId('practice-panel')).toBeHidden()
  for (const p of [dan, alice, bob, carol]) {
    expect(p.errors, p.errors.join('\n')).toEqual([])
    await p.context.close()
  }
})

test('tournament: sign-up, a match, training meanwhile, a walkover and a champion', async ({
  browser,
}) => {
  const alice = await openPlayer(browser, '/?e2e=1')
  await alice.page.getByTestId('nickname').fill('Alice')
  await alice.page.getByTestId('tournament').check()
  await alice.page.getByTestId('create-room').click()
  const codeEl = alice.page.getByTestId('room-code')
  await expect(codeEl).toHaveText(/^[A-Z2-9]{5}$/)
  const code = (await codeEl.textContent()) ?? ''
  await expect(alice.page.getByTestId('start-tournament')).toBeDisabled()
  const join = async (name: string) => {
    const p = await openPlayer(browser, `/?room=${code}&e2e=1`)
    await p.page.getByTestId('nickname').fill(name)
    await p.page.getByTestId('join-room').click()
    await expect(p.page.getByTestId('tournament-signup')).toBeVisible()
    return p
  }
  const bob = await join('Bob')
  const carol = await join('Carol')
  await expect(alice.page.getByTestId('entrants')).toContainText('Carol')
  await expect(alice.page.getByTestId('tournament-plan')).toContainText('one group')
  await carol.page.getByTestId('toggle-entry').click() // Carol would rather watch
  await expect(alice.page.getByTestId('tournament-plan')).toContainText('Straight to the final')
  await alice.page.getByTestId('start-tournament').click()

  // The match is called: only its players can get ready.
  await expect(carol.page.getByTestId('match-call')).toBeVisible()
  await expect(carol.page.getByTestId('ready')).toBeHidden()
  await carol.page.getByTestId('practice-meanwhile').click({ force: true })
  await expect(carol.page.getByTestId('room-status')).toContainText(code)
  await alice.page.getByTestId('ready').click()
  await bob.page.getByTestId('ready').click()
  await expect(alice.page.getByTestId('match-header')).toContainText('Game 1 of 3')
  await expect(alice.page.getByTestId('match-call')).toBeHidden()
  await expect.poll(async () => (await state(alice.page))?.phase).toBe('serving')
  await expect(alice.page.getByTestId('back-to-lobby')).toBeHidden()

  // Moving works in the match; standings only when asked for.
  const before = (await player(alice.page, 'Bob'))!.x
  await holdKey(bob.page, 'a', 600)
  await expect
    .poll(async () => Math.abs((await player(alice.page, 'Bob'))!.x - before))
    .toBeGreaterThan(0.3)
  await alice.page.getByTestId('toggle-standings').click()
  await expect(alice.page.getByTestId('standings-overlay')).toBeVisible()
  await alice.page.getByTestId('toggle-standings').click()
  await expect(alice.page.getByTestId('standings-overlay')).toBeHidden()

  await carol.page.getByTestId('back-to-room').click()
  await expect(carol.page.getByTestId('spectating')).toBeVisible()

  // Bob leaves (it takes two clicks): Alice wins the final and the tournament.
  await bob.page.getByTestId('hud-leave').click()
  await expect(bob.page.getByTestId('hud-leave')).toHaveText('Lose this match?')
  await bob.page.getByTestId('hud-leave').click()
  await expect(alice.page.getByTestId('match-result')).toContainText('Alice won')
  await expect(carol.page.getByTestId('champion-name')).toHaveText('Alice')
  await alice.page.getByTestId('tournament-again').click()
  await expect(carol.page.getByTestId('tournament-signup')).toBeVisible()
  for (const p of [alice, bob, carol]) {
    expect(p.errors, p.errors.join('\n')).toEqual([])
    await p.context.close()
  }
})

test('tournament courts side by side, and a spectator looking around 360°', async ({ browser }) => {
  const alice = await openPlayer(browser, '/?e2e=1')
  await alice.page.getByTestId('nickname').fill('Alice')
  await alice.page.getByTestId('tournament').check()
  await alice.page.getByTestId('create-room').click()
  const codeEl = alice.page.getByTestId('room-code')
  await expect(codeEl).toHaveText(/^[A-Z2-9]{5}$/)
  const code = (await codeEl.textContent()) ?? ''
  const players = [alice]
  for (const name of ['Bob', 'Carol', 'Dave']) {
    const p = await openPlayer(browser, `/?room=${code}&e2e=1`)
    await p.page.getByTestId('nickname').fill(name)
    await p.page.getByTestId('join-room').click()
    await expect(p.page.getByTestId('tournament-signup')).toBeVisible()
    players.push(p)
  }
  await expect(alice.page.getByTestId('tournament-plan')).toContainText('2 courts at once')
  await alice.page.getByTestId('start-tournament').click()

  // Everyone is on one of two courts, and both matches run at the same time.
  for (const p of players) await p.page.getByTestId('ready').click()
  for (const p of players) await expect(p.page.getByTestId('match-header')).toContainText('Court')
  const courts = await Promise.all(
    players.map((p) => p.page.evaluate(() => window.__PB__.camera()!.court)),
  )
  expect([...courts].sort()).toEqual([0, 0, 1, 1])
  for (const p of players) expect((await state(p.page))!.players).toHaveLength(2)

  // The player on the second court can really play: moving and serving work there.
  const i = courts.indexOf(1)
  const there = players[i]!
  const name = ['Alice', 'Bob', 'Carol', 'Dave'][i]!
  const x0 = (await player(there.page, name))!.x
  await holdKey(there.page, 'a', 400)
  await holdKey(there.page, 'd', 250)
  await expect.poll(async () => (await player(there.page, name))!.x).not.toBe(x0)
  const server = players.find((p, j) => courts[j] === 1 && p !== there)!
  for (const p of [there, server]) await p.page.keyboard.press('Space')
  await expect.poll(async () => (await state(there.page))?.phase).not.toBe('serving')

  // Erin watches: switches court, turns all the way round, zooms, and goes back.
  const erin = await openPlayer(browser, `/?room=${code}&e2e=1`)
  await erin.page.getByTestId('nickname').fill('Erin')
  await erin.page.getByTestId('join-room').click()
  await expect(erin.page.getByTestId('spectating')).toBeVisible()
  await erin.page.getByTestId('court-2').click()
  await expect.poll(() => erin.page.evaluate(() => window.__PB__.camera()!.court)).toBe(1)
  const camera = () => erin.page.evaluate(() => window.__PB__.camera()!)
  await erin.page.waitForTimeout(800)
  const quadrants = new Set<string>()
  for (let turn = 0; turn < 8; turn++) {
    await erin.page.mouse.move(300, 250)
    await erin.page.mouse.down()
    await erin.page.mouse.move(460, 250, { steps: 8 })
    await erin.page.mouse.up()
    await erin.page.waitForTimeout(350)
    const c = await camera()
    quadrants.add(`${Math.sign(c.x)},${Math.sign(c.z)}`)
  }
  expect(quadrants.size).toBe(4)
  await expect(erin.page.getByTestId('camera-view')).toContainText('Free')
  const far = await camera()
  await erin.page.mouse.move(300, 250)
  for (let k = 0; k < 6; k++) await erin.page.mouse.wheel(0, -300)
  await expect
    .poll(async () => {
      const c = await camera()
      return Math.hypot(c.x, c.z)
    })
    .toBeLessThan(Math.hypot(far.x, far.z) * 0.7)
  await erin.page.getByTestId('camera-view').click()
  await expect(erin.page.getByTestId('camera-view')).not.toContainText('Free')
  for (const p of [...players, erin]) {
    expect(p.errors, p.errors.join('\n')).toEqual([])
    await p.context.close()
  }
})
