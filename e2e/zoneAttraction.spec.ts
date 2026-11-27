/**
 * TEZUKA ZONE attraction (Phase D2, apps/client/src/players/zone): the ribbons from the
 * drawn ball to the athlete the server's pull is for (`BallState.steerTarget`), read
 * through the `?e2e` debug hook (`zoneFx()`, `state()`, read-only).
 *
 * - **Every check needs a genuine pull:** each test first requires the server's own
 *   replicated state to show the ball pulled for an athlete for a sustained stretch.
 * - **Doubles with two secret athletes:** bot players serve to them in turn; nobody
 *   returns, so each point is another serve.
 * - **No private model needed:** the ribbons don't depend on the body.
 */
import { type Browser, type Page, expect, test } from '@playwright/test'
import { createRequire } from 'node:module'
import path from 'node:path'
import { E2E_DEV_KEY } from '../playwright.config'

interface Room {
  sessionId: string
  roomId: string
  send(type: string, msg: unknown): void
  leave(consented?: boolean): Promise<unknown>
}
const { Client } = createRequire(path.resolve('apps/client/package.json'))('@colyseus/sdk') as {
  Client: new (url: string) => {
    create(name: string, o: object): Promise<Room>
    joinById(code: string, o: object): Promise<Room>
  }
}

test.beforeEach(async ({ browser }) => {
  for (const context of browser.contexts()) await context.close()
})

interface Field {
  id: string
  state: string
  ribbon: number
  ribbons: number
  streamMotes: number
  draws: number
  ribbonGap: number | null
  tier: string
  reducedMotion: boolean
}
/**
 * One look at a page, between two frames:
 *
 * - `target` and `pulled`: the server's pull in the newest update;
 * - `drawn*`: the ball as drawn on the frame the fields were drawn, which runs up to
 *   0.15 s behind the newest update. Each field's ribbons follow that ball;
 * - `at`: that frame's time (s).
 */
interface Sample {
  at: number
  target: string
  pulled: boolean
  phase: string
  held: boolean
  drawnTarget: string
  drawnPulled: boolean
  drawnFree: boolean
  fields: Record<string, Field>
}

async function open(
  browser: Browser,
  url: string,
  o: { tier?: 'high' | 'medium' | 'low'; reducedMotion?: 'reduce' | 'no-preference' } = {},
) {
  const context = await browser.newContext({ reducedMotion: o.reducedMotion ?? 'no-preference' })
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

function sample(page: Page): Promise<Sample> {
  return page.evaluate(() => {
    type Drawn = { held: boolean; visible: boolean; steerTarget: string; pull: number } | null
    const w = window as unknown as {
      __PB__: {
        zoneFx: () => { fields: Field[]; drawn: Drawn; at: number }
        ui: () => { phase: string }
        state: () => {
          ball: { steerX: number; steerZ: number; steerTarget: string; held: boolean }
        } | null
      }
    }
    const b = w.__PB__.state()?.ball
    const fx = w.__PB__.zoneFx()
    const fields: Record<string, Field> = {}
    for (const f of fx.fields) fields[f.id] = f
    const d = fx.drawn
    return {
      at: fx.at,
      target: b?.steerTarget ?? '',
      pulled: !!b && Math.hypot(b.steerX, b.steerZ) > 0,
      phase: w.__PB__.ui().phase,
      held: b?.held ?? false,
      drawnTarget: d?.steerTarget ?? '',
      drawnPulled: !!d && d.pull > 0,
      drawnFree: !!d && d.visible && !d.held,
      fields,
    }
  })
}

/** Runs of 5 or more samples in which the server pulled the ball for `id`, in a rally. */
function pullsFor(samples: Sample[], id: string): [number, number][] {
  const runs: [number, number][] = []
  samples.forEach((s, j) => {
    if (!(s.pulled && s.target === id && s.phase === 'rally' && !s.held)) return
    const last = runs[runs.length - 1]
    if (last && last[1] === j - 1) last[1] = j
    else runs.push([j, j])
  })
  return runs.filter(([a, b]) => b - a >= 4)
}

const brief = (samples: Sample[], ids: string[]) =>
  samples
    .map(
      (s) =>
        `${s.target ? ids.indexOf(s.target) : '-'}${s.drawnTarget ? ids.indexOf(s.drawnTarget) : '-'}` +
        `${s.phase[0]}${s.drawnFree ? '' : 'h'}:` +
        ids.map((id) => s.fields[id]?.ribbons ?? 'x').join(''),
    )
    .join(' ')

/** The ribbons' fade after a pull ends (0.3 s), with room for one frame and one sample. */
const FADE = 0.45
/** How long after the rally ends ribbons may still be drawn: drawing delay and fade. */
const AFTER_RALLY = 0.15 + FADE

/** What every page must show, whatever happened: no stale or misplaced ribbons. */
function checkRibbons(who: string, samples: Sample[], ids: string[]) {
  const trace = brief(samples, ids)
  let rallyEnded = -Infinity
  samples.forEach((s, j) => {
    if (s.phase === 'rally') rallyEnded = -Infinity
    else if (rallyEnded === -Infinity) rallyEnded = s.at
    for (const id of ids) {
      const f = s.fields[id]
      if (!f || f.ribbons === 0) continue
      const where = `${who} sample ${j} (${id})`
      // From the ball as drawn on this very frame (within 2 cm), and only while it is in
      // play: never on a ball held for a serve or hidden.
      expect(f.ribbonGap ?? 1, `${where}: ribbon start off the ball: ${trace}`).toBeLessThan(0.02)
      expect(s.drawnFree, `${where}: ribbons on a held or hidden ball: ${trace}`).toBe(true)
      // Only on the athlete the drawn ball was pulled for, now or within the fade. (The
      // server names a target only while it pulls; the client's prediction may clear the
      // pull itself at a predicted bounce, so the name is the signal.)
      const recent = samples.filter((r) => r.at <= s.at && r.at >= s.at - FADE)
      expect(
        recent.some((r) => r.drawnTarget === id),
        `${where}: ribbons with no pull for this athlete: ${trace}`,
      ).toBe(true)
      // Gone soon after the rally ends.
      if (s.phase !== 'rally')
        expect(s.at - rallyEnded, `${where}: ribbons long after the rally: ${trace}`).toBeLessThan(
          AFTER_RALLY,
        )
    }
  })
}

/** Every sustained server pull for `id` shows ribbons on `id`'s field in this page. */
function checkShown(who: string, samples: Sample[], id: string, ids: string[]) {
  const runs = pullsFor(samples, id)
  for (const [a, b] of runs) {
    const until = samples[b]!.at + 0.3
    const window = samples.slice(a).filter((s) => s.at <= until)
    expect(
      window.some((s) => s.fields[id]?.state === 'attracting' && (s.fields[id]?.ribbons ?? 0) > 0),
      `${who}: pull for ${id} at samples ${a}-${b} not drawn: ${brief(samples, ids)}`,
    ).toBe(true)
  }
  return runs.length
}

test('training: ribbons only on a genuine pull, from the drawn ball, gone at every reset', async ({
  browser,
}) => {
  test.setTimeout(120_000)
  const t = await open(browser, '/?e2e=1')
  await t.page.getByTestId('nickname').fill('Tezuka')
  await t.page.getByTestId('dev-key').fill(E2E_DEV_KEY)
  await t.page.getByTestId('practice').click()
  await expect
    .poll(async () => Object.keys((await sample(t.page)).fields).length, { timeout: 20_000 })
    .toBe(1)
  const me = Object.keys((await sample(t.page)).fields)[0]!

  const samples: Sample[] = []
  for (let i = 0; i < 1500; i++) {
    samples.push(await sample(t.page))
    const done = pullsFor(samples, me).filter(([, b]) => b < samples.length - 10)
    // Two pulls seen through, and the reset after the second.
    if (done.length >= 2 && samples.slice(done[1]![1]).some((s) => s.held)) break
    await t.page.waitForTimeout(40)
  }
  const trace = brief(samples, [me])
  expect(pullsFor(samples, me).length, `no sustained pull seen: ${trace}`).toBeGreaterThanOrEqual(1)
  expect(checkShown('Tezuka', samples, me, [me])).toBeGreaterThanOrEqual(1)
  checkRibbons('Tezuka', samples, [me])
  // The ball went back to a server's hand at least once, and no ribbon followed it there.
  expect(
    samples.some((s) => s.held),
    trace,
  ).toBe(true)
  expect(t.errors, t.errors.join('\n')).toEqual([])
  await t.context.close()
})

test('quality steps and reduced motion: ribbon and mote counts during a genuine pull', async ({
  browser,
}) => {
  test.setTimeout(180_000)
  const cases = [
    { tier: 'high', reduced: false, ribbons: 3, motes: 32, draws: 4 },
    { tier: 'medium', reduced: false, ribbons: 2, motes: 14, draws: 4 },
    { tier: 'low', reduced: false, ribbons: 1, motes: 0, draws: 2 },
    { tier: 'high', reduced: true, ribbons: 1, motes: 0, draws: 2 },
  ] as const
  for (const c of cases) {
    const t = await open(browser, '/?e2e=1', {
      tier: c.tier,
      reducedMotion: c.reduced ? 'reduce' : 'no-preference',
    })
    await t.page.getByTestId('nickname').fill('Tezuka')
    await t.page.getByTestId('dev-key').fill(E2E_DEV_KEY)
    await t.page.getByTestId('practice').click()
    const name = `${c.tier}${c.reduced ? ' reduced' : ''}`
    let seen: Field | null = null
    await expect(async () => {
      const s = await sample(t.page)
      const f = Object.values(s.fields)[0]
      // Drawn during a pull the server is making for this athlete, right now.
      if (f && f.ribbons > 0 && s.drawnTarget === f.id && s.drawnPulled) seen = f
      expect(seen, `${name}: no ribbons during a pull yet`).not.toBeNull()
    }).toPass({ timeout: 45_000, intervals: [30] })
    const f = seen as unknown as Field
    expect(
      {
        tier: f.tier,
        reduced: f.reducedMotion,
        ribbons: f.ribbons,
        motes: f.streamMotes,
        draws: f.draws,
      },
      name,
    ).toEqual({
      tier: c.tier,
      reduced: c.reduced,
      ribbons: c.ribbons,
      motes: c.motes,
      draws: c.draws,
    })
    expect(t.errors, t.errors.join('\n')).toEqual([])
    await t.context.close()
  }
})

test('doubles, two secret athletes: only the one pulled for shows ribbons, in every view', async ({
  browser,
}) => {
  test.setTimeout(240_000)
  // A spectator first, to learn the server's address.
  const sam = await open(browser, '/?e2e=1')
  const url = await sam.page.evaluate(
    () => (window as unknown as { __PB__: { serverUrl: string } }).__PB__.serverUrl,
  )
  // Ann creates the room, so her team serves first. Seats alternate teams in join order:
  // Ann (serving team), Tezuka (browser), Bob (browser), TEZUKA (bot): the two secret
  // athletes receive together.
  const ann = await new Client(url).create('pickleball', {
    nickname: 'Ann',
    mode: '2v2',
    devPerks: true,
  })
  const code = ann.roomId
  const tez = await open(browser, `/?room=${code}&e2e=1`)
  await tez.page.getByTestId('nickname').fill('Tezuka')
  await tez.page.getByTestId('dev-key').fill(E2E_DEV_KEY)
  await tez.page.getByTestId('join-room').click()
  const bob = await open(browser, `/?room=${code}&e2e=1`)
  await bob.page.getByTestId('nickname').fill('Bob')
  await bob.page.getByTestId('join-room').click()
  await expect
    .poll(async () => Object.keys((await sample(bob.page)).fields).length, { timeout: 20_000 })
    .toBe(1)
  const tez2 = await new Client(url).joinById(code, { nickname: 'TEZUKA', devKey: E2E_DEV_KEY })
  await sam.page.goto(`/?room=${code}&e2e=1`)
  await sam.page.getByTestId('nickname').fill('Sam')
  await sam.page.getByTestId('join-room').click()

  type Seen = {
    players: { id: string; nickname: string; slot: number; look: string; x: number; z: number }[]
  }
  const seen = () =>
    sam.page.evaluate(() =>
      (window as unknown as { __PB__: { state: () => Seen | null } }).__PB__.state(),
    )
  await expect.poll(async () => (await seen())?.players.length ?? 0, { timeout: 20_000 }).toBe(4)
  const players = (await seen())!.players
  const byName = (n: string) => players.find((p) => p.nickname === n)!
  const ids = [byName('Tezuka').id, byName('TEZUKA').id]
  // Both granted, both receiving, the opponents serving.
  expect(players.map((p) => [p.nickname, p.slot, p.look === 'x1'])).toEqual(
    expect.arrayContaining([
      ['Ann', 0, false],
      ['Tezuka', 1, true],
      ['Bob', 0, false],
      ['TEZUKA', 1, true],
    ]),
  )
  const pages = { 'Tezuka (own view)': tez, 'Bob (opponent)': bob, 'Sam (spectator)': sam }
  for (const p of Object.values(pages))
    await expect
      .poll(async () => Object.keys((await sample(p.page)).fields).sort(), { timeout: 20_000 })
      .toEqual([...ids].sort())

  await tez.page.getByTestId('ready').click()
  await bob.page.getByTestId('ready').click()
  ann.send('ready', { ready: true })
  tez2.send('ready', { ready: true })

  const ui = () =>
    sam.page.evaluate(() =>
      (
        window as unknown as {
          __PB__: {
            ui: () => { phase: string; serverId: string | null; receiverId: string | null }
          }
        }
      ).__PB__.ui(),
    )
  const all: Record<string, Sample[]> = Object.fromEntries(Object.keys(pages).map((k) => [k, []]))
  const receivers: string[] = []
  const aims: string[] = []
  /** Serves to each receiver that drew no pull: the next aim to try. */
  const tried = new Map<string, number>()
  for (let serve = 0; serve < 12; serve++) {
    await expect
      .poll(
        async () => {
          const u = await ui()
          return u.phase === 'serving' && u.serverId === ann.sessionId
        },
        { timeout: 20_000 },
      )
      .toBe(true)
    await sam.page.waitForTimeout(400)
    const receiver = (await ui()).receiverId!
    receivers.push(receiver)
    const now = (await seen())!.players
    const r = now.find((p) => p.id === receiver)!
    // Into the receiver's box: the -z half, across the centre line from the server (as
    // isInServiceBox decides it). At the corner farthest from where the receiver
    // stands, so the zone has to bring it to them.
    const sx = -Math.sign(now.find((p) => p.nickname === 'Ann')!.x || 1)
    // Well inside the lines: a fault would hand the serve to the athletes, who never serve.
    // Farthest from the receiver first; the zone aims at a contact disk toward the
    // athlete's left hand, so a serve may already arrive where they can hit it, and then
    // there is nothing to pull. After a serve to them that wasn't pulled, try the next.
    const corners = [0.5, 2.2]
      .flatMap((x) => [-2.9, -5.4].map((z) => ({ x: sx * x, z })))
      .sort((p, q) => Math.hypot(q.x - r.x, q.z - r.z) - Math.hypot(p.x - r.x, p.z - r.z))
    const tries = (tried.get(receiver) ?? 0) % corners.length
    const aim = corners[tries]!
    aims.push(`${ids.indexOf(receiver)}->${aim.x},${aim.z}`)
    ann.send('serve', { ax: aim.x, az: aim.z, spin: 0 })
    for (let i = 0; i < 90; i++) {
      const got = await Promise.all(Object.values(pages).map((p) => sample(p.page)))
      Object.keys(pages).forEach((k, n) => all[k]!.push(got[n]!))
      if (i > 10 && got.every((s) => s.phase !== 'rally')) break
      await sam.page.waitForTimeout(30)
    }
    const pulled = new Set(ids.filter((id) => pullsFor(all['Sam (spectator)']!, id).length > 0))
    if (!pulled.has(receiver)) tried.set(receiver, (tried.get(receiver) ?? 0) + 1)
    if (pulled.size === 2) break
  }

  for (const [who, samples] of Object.entries(all)) {
    checkRibbons(who, samples, ids)
    // Each athlete was pulled for at least once (the target changed), and drawn so here.
    for (const id of ids) {
      expect(
        checkShown(who, samples, id, ids),
        `${who}: no sustained pull for ${id}: serves ${aims.join(' ')}: ${brief(samples, ids)}`,
      ).toBeGreaterThanOrEqual(1)
    }
    // While the drawn ball is pulled for one athlete, the other shows no ribbons and does
    // not attract, unless it was itself the target within the fade (a change of target).
    samples.forEach((s, j) => {
      if (!ids.includes(s.drawnTarget)) return
      const other = ids.find((id) => id !== s.drawnTarget)!
      const wasOther = samples.some(
        (r) => r.at <= s.at && r.at >= s.at - FADE && r.drawnTarget === other,
      )
      if (wasOther) return
      expect(s.fields[other]?.ribbons ?? 0, `${who} sample ${j}: both lit`).toBe(0)
      expect(s.fields[other]?.state, `${who} sample ${j}: other attracting`).not.toBe('attracting')
    })
  }
  // Every pull the server made was for that serve's receiver (a serve is theirs alone).
  for (const s of all['Sam (spectator)']!) if (s.pulled && s.target) expect(ids).toContain(s.target)

  // TEZUKA's connection drops: in every view their field and ribbons go.
  const dropped = byName('TEZUKA').id
  // Not consented: a dropped connection (the SDK's promise for that never settles).
  void tez2.leave(false).catch(() => undefined)
  for (const [who, p] of Object.entries(pages)) {
    await expect
      .poll(
        async () => {
          const f = (await sample(p.page)).fields[dropped]
          return f ? [f.state, f.ribbons] : ['gone', 0]
        },
        { timeout: 10_000, message: who },
      )
      .toEqual(['inactive', 0])
  }
  for (const p of Object.values(pages)) {
    expect(p.errors, p.errors.join('\n')).toEqual([])
    await p.context.close()
  }
  await ann.leave(true)
})
