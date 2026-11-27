import {
  type BallBody,
  COURT,
  FIXED_DT,
  WIRE,
  fromWire,
  isInServiceBox,
  reachDistance,
  sideOf,
  stepBall,
  toWire,
} from '@pickleball/shared'
import { describe, expect, it } from 'vitest'
import type { SimPlayer } from '../src/simulation/GameSimulation'
import {
  ZONE_PRESETS,
  type ZonePreset,
  type ZoneRally,
  parseZonePreset,
  zoneEligible,
} from '../src/simulation/zone'
import {
  CATEGORIES,
  FAST,
  Lab,
  ORDINARY,
  allTrials,
  runTrial,
  seeded,
  shotFor,
  tally,
} from './zoneLab'

const SEEDS = [11, 22, 33]
const changeLimit = (p: ZonePreset) => p.maxAccel * (1 - Math.exp(-p.smoothing * FIXED_DT))

/** A 1v1 lab: the zone player `z` on `slot`, the opponent `o` on the other side. */
function lab(slot: 0 | 1, preset: ZonePreset | null = ZONE_PRESETS.anime, teamSize: 1 | 2 = 1) {
  const sim = new Lab(teamSize, seeded(5))
  const ids =
    teamSize === 1
      ? slot === 0
        ? ['z', 'o']
        : ['o', 'z']
      : slot === 0
        ? ['z', 'o', 'p', 'q']
        : ['o', 'z', 'q', 'p']
  for (const id of ids) sim.addPlayer(id, id)
  for (const id of ids) sim.setReady(id, true)
  if (preset) {
    sim.zoneIds = new Set(['z'])
    sim.zone.preset = preset
  }
  const get = (id: string) => sim.players.get(id) as SimPlayer
  return { sim, z: get('z'), o: get('o'), side: sideOf(get('z').slot) }
}

function trace(sim: Lab, ticks = 400): BallBody[] {
  const out: BallBody[] = []
  for (let i = 0; i < ticks && sim.phase === 'rally'; i++) {
    sim.step(FIXED_DT)
    out.push({ ...sim.ball })
  }
  return out
}

describe('TEZUKA ZONE interception (deterministic matrix)', () => {
  const results = allTrials(ZONE_PRESETS.anime, SEEDS).map((trial) => ({
    trial,
    outcome: runTrial(trial),
  }))
  const rate = (cats: readonly string[]) => {
    const r = results.filter((x) => cats.includes(x.trial.category))
    return r.filter((x) => x.outcome.hittable).length / r.length
  }

  it('covers every category, both sides, standing and moving, returns and rally shots', () => {
    expect(results).toHaveLength(CATEGORIES.length * 2 * 4 * 3 * 2 * SEEDS.length) // 1584
    for (const row of tally(results)) expect(row.trials, row.category).toBe(144)
  })

  it('Anime brings at least 95% of ordinary returns into legal reach', () => {
    expect(rate(ORDINARY)).toBeGreaterThanOrEqual(0.95)
    // Measured at 99.2%; every category on its own stays above 90%.
    for (const row of tally(results).filter((r) => ORDINARY.includes(r.category))) {
      expect(row.hit / row.trials, row.category).toBeGreaterThan(0.9)
    }
  })

  it('Anime brings most smashes and jump smashes too (reported separately)', () => {
    expect(rate(['smash'])).toBeGreaterThanOrEqual(0.95)
    expect(rate(['jumpSmash'])).toBeGreaterThanOrEqual(0.85)
    expect(rate(FAST)).toBeGreaterThanOrEqual(0.9)
  })

  it('without the zone the same shots mostly go where they were aimed: away', () => {
    const none = allTrials(null, SEEDS).map((t) => runTrial(t))
    expect(none.filter((o) => o.hittable).length / none.length).toBeLessThan(0.25)
  })

  for (const preset of Object.values(ZONE_PRESETS)) {
    it(`${preset.name}: the pull is bounded and smooth, the ball continuous, finite and never turned back`, () => {
      const all =
        preset.name === 'anime'
          ? results.map((r) => r.outcome)
          : allTrials(preset, [11]).map(runTrial)
      for (const o of all) {
        expect(o.finite).toBe(true)
        expect(o.maxSteer).toBeLessThanOrEqual(preset.maxAccel + 1e-9)
        expect(o.maxSteerChange).toBeLessThanOrEqual(changeLimit(preset) + 1e-9)
        // No farther per tick than speed plus the strongest allowed pull explain.
        expect(o.maxExcess).toBeLessThanOrEqual(1e-9)
        expect(o.reversed).toBe(false)
        expect(o.leaked).toBe(false)
      }
    })
  }

  // 1,728 full flights with the zone planning every few ticks (432 ordinary trials of
  // seed 11, for normal, strong twice and anime): 4.9–6.1 s measured on the C1 machine,
  // at vitest's 5 s default. Its own limit; the assertions and trials are unchanged.
  it('presets get stronger in order', { timeout: 30_000 }, () => {
    const r = (p: ZonePreset) => {
      const o = allTrials(p, [11])
        .filter((t) => ORDINARY.includes(t.category))
        .map(runTrial)
      return o.filter((x) => x.hittable).length / o.length
    }
    expect(r(ZONE_PRESETS.normal)).toBeLessThan(r(ZONE_PRESETS.strong))
    expect(r(ZONE_PRESETS.strong)).toBeLessThan(r(ZONE_PRESETS.anime))
    expect(parseZonePreset('strong')).toBe(ZONE_PRESETS.strong)
    expect(parseZonePreset(undefined)).toBe(ZONE_PRESETS.anime)
    expect(parseZonePreset('nonsense')).toBe(ZONE_PRESETS.anime)
  })
})

describe('TEZUKA ZONE only for whom it is meant', () => {
  it('changes nothing at all when nobody (or nobody seated) has it', () => {
    const flight = (zoneIds: Set<string> | null) => {
      const { sim, z, o, side } = lab(0, null)
      if (zoneIds) sim.zoneIds = zoneIds
      const s = shotFor('crossLeft', side, z.x, seeded(3))
      sim.fire(o, z, 'rally', s.from, s.target, s.power, 0, 0.6)
      return trace(sim)
    }
    const plain = flight(null)
    expect(plain.length).toBeGreaterThan(30)
    for (const b of plain) expect([b.steerX ?? 0, b.steerZ ?? 0]).toEqual([0, 0])
    // A zone holder who isn't on this court (a spectator, or someone who left).
    expect(flight(new Set(['ghost']))).toEqual(plain)

    // And the shared flight is the one it always was: the same steps by hand.
    const { sim, z, o, side } = lab(0, null)
    const s = shotFor('crossLeft', side, z.x, seeded(3))
    sim.fire(o, z, 'rally', s.from, s.target, s.power, 0, 0.6)
    const b = { ...sim.ball }
    const byHand: BallBody[] = []
    for (let i = 0; i < plain.length; i++) {
      stepBall(b, FIXED_DT, [])
      byHand.push({ ...b })
    }
    expect(byHand.map((q) => [q.x, q.y, q.z, q.vx, q.vy, q.vz])).toEqual(
      plain.map((q) => [q.x, q.y, q.z, q.vx, q.vy, q.vz]),
    )
  })

  it('never pulls the zone player’s own shots: theirs go where they aim them', () => {
    for (const slot of [0, 1] as const) {
      const { sim, z, o } = lab(slot)
      const s = shotFor('straight', sideOf(o.slot), o.x, seeded(4))
      sim.fire(z, o, 'rally', { ...s.from }, s.target, s.power, 0, 0)
      for (const b of trace(sim)) expect([b.steerX ?? 0, b.steerZ ?? 0]).toEqual([0, 0])
    }
  })

  it('stops for a disconnected player, and says who is eligible: receiving, not hitting', () => {
    const { sim, z, o, side } = lab(0)
    const s = shotFor('crossRight', side, z.x, seeded(2))
    sim.fire(o, z, 'rally', s.from, s.target, s.power, 0, 0)
    for (let i = 0; i < 20; i++) sim.step(FIXED_DT)
    expect(Math.hypot(sim.ball.steerX ?? 0, sim.ball.steerZ ?? 0)).toBeGreaterThan(0)
    sim.setConnected('z', false)
    expect([sim.ball.steerX, sim.ball.steerZ]).toEqual([0, 0])
    expect(sim.phase).toBe('paused')

    const rally = (over: Partial<ZoneRally>): ZoneRally => ({
      lastHitter: o.slot,
      isServe: false,
      receiverId: null,
      mustBounce: false,
      bounced: false,
      touchedNet: false,
      serverSlot: o.slot,
      serveParity: 0,
      ...over,
    })
    const here = { ...z, connected: true }
    expect(zoneEligible(here, rally({}))).toBe(true)
    // Before its required bounce too: receiving it is what counts, not hitting it yet.
    expect(zoneEligible(here, rally({ mustBounce: true }))).toBe(true)
    expect(zoneEligible({ ...z, connected: false }, rally({}))).toBe(false)
    expect(zoneEligible(here, rally({ lastHitter: z.slot }))).toBe(false)
    expect(zoneEligible(here, rally({ lastHitter: null }))).toBe(false)
    expect(zoneEligible(here, rally({ touchedNet: true }))).toBe(false)
    // A serve: only its receiver.
    expect(zoneEligible(here, rally({ isServe: true, receiverId: 'z' }))).toBe(true)
    expect(zoneEligible(here, rally({ isServe: true, receiverId: 'p' }))).toBe(false)
  })

  it('a serve to the partner is left alone; a serve to the zone player is pulled, into its box', () => {
    for (const slot of [0, 1] as const) {
      for (const receiver of ['z', 'p'] as const) {
        const { sim, side } = lab(slot, ZONE_PRESETS.anime, 2)
        const server = sim.players.get('o') as SimPlayer
        const r = sim.players.get(receiver === 'z' ? 'z' : slot === 0 ? 'p' : 'q') as SimPlayer
        const z = sim.players.get('z') as SimPlayer
        // The zone player stands in the far corner of the box, away from the serve.
        z.x = -side * 3.6
        z.z = side * 6
        const from = { x: side * 2, y: 0.85, z: -side * 7.2 }
        const target = { x: side * 2.2, z: side * 4.5 }
        sim.fire(server, r, 'serve', from, target, 0.3, 0, 0)
        const parity = sim.rallyState.serveParity
        const flight = trace(sim)
        const steered = flight.some((b) => (b.steerX ?? 0) !== 0 || (b.steerZ ?? 0) !== 0)
        expect(steered, `${receiver} slot ${slot}`).toBe(receiver === 'z')
        // The serve still lands in its box: no fault was made by the pull.
        expect(sim.lastRally?.reason ?? '').not.toMatch(/Serve/)
        void parity
      }
    }
  })

  it('in doubles every return after the serve comes to the zone player, even one aimed at the partner', () => {
    for (const slot of [0, 1] as const) {
      const { sim, side } = lab(slot, ZONE_PRESETS.anime, 2)
      const z = sim.players.get('z') as SimPlayer
      const partner = sim.players.get(slot === 0 ? 'p' : 'q') as SimPlayer
      const o = sim.players.get('o') as SimPlayer
      z.x = -side * 2.5
      z.z = side * 5
      partner.x = side * 2.5
      partner.z = side * 5
      const target = { x: partner.x, z: partner.z - side * 0.5 }
      sim.fire(o, partner, 'rally', { x: 0, y: 0.8, z: -side * 5 }, target, 0.45, 0, 0)
      let reached = false
      for (const b of trace(sim)) {
        if (reachDistance(z, side, b) !== null && sim.rallyState.canHit(z.slot, z.id))
          reached = true
      }
      expect(reached, `slot ${slot}`).toBe(true)
    }
  })
})

describe('TEZUKA ZONE: whom the pull is for (zoneTargetId, read-only)', () => {
  it('two secret athletes on one team: a serve is pulled for its receiver only, by name', () => {
    for (const slot of [0, 1] as const) {
      for (const receiver of ['z', 'partner'] as const) {
        const { sim, side } = lab(slot, ZONE_PRESETS.anime, 2)
        // Seats alternate teams in join order, so `z`'s partner is `p` on either side.
        const partnerId = 'p'
        expect(sim.players.get(partnerId)!.slot).toBe(sim.players.get('z')!.slot)
        sim.zoneIds = new Set(['z', partnerId])
        const server = sim.players.get('o') as SimPlayer
        const r = sim.players.get(receiver === 'z' ? 'z' : partnerId) as SimPlayer
        // The receiver stands in the far corner of the box, away from the serve.
        r.x = -side * 3.6
        r.z = side * 6
        const from = { x: side * 2, y: 0.85, z: -side * 7.2 }
        sim.fire(server, r, 'serve', from, { x: side * 2.2, z: side * 4.5 }, 0.3, 0, 0)
        const seen = new Set<string>()
        let pulled = 0
        for (let i = 0; i < 400 && sim.phase === 'rally'; i++) {
          sim.step(FIXED_DT)
          const pulling = (sim.ball.steerX ?? 0) !== 0 || (sim.ball.steerZ ?? 0) !== 0
          if (pulling) {
            pulled++
            seen.add(sim.zoneTargetId)
          }
        }
        expect(pulled, `${receiver} slot ${slot}`).toBeGreaterThan(5)
        expect([...seen], `${receiver} slot ${slot}`).toEqual([r.id])
      }
    }
  })

  it('a rally shot: the target is the nearer eligible athlete, tick by tick', () => {
    const { sim, side } = lab(0, ZONE_PRESETS.anime, 2)
    sim.zoneIds = new Set(['z', 'p'])
    const z = sim.players.get('z') as SimPlayer
    const p = sim.players.get('p') as SimPlayer
    const o = sim.players.get('o') as SimPlayer
    z.x = -side * 2.5
    z.z = side * 5
    p.x = side * 2.5
    p.z = side * 5
    sim.fire(o, p, 'rally', { x: 0, y: 0.8, z: -side * 5 }, { x: p.x, z: p.z }, 0.45, 0, 0)
    let pulled = 0
    for (let i = 0; i < 400 && sim.phase === 'rally'; i++) {
      // Who is nearer before this tick: the one the simulation picks for the pull.
      const dz = Math.hypot(z.x - sim.ball.x, z.z - sim.ball.z)
      const dp = Math.hypot(p.x - sim.ball.x, p.z - sim.ball.z)
      sim.step(FIXED_DT)
      if ((sim.ball.steerX ?? 0) === 0 && (sim.ball.steerZ ?? 0) === 0) continue
      pulled++
      // Exactly as near (the ball midway): the simulation keeps the first; not judged here.
      if (Math.abs(dz - dp) < 1e-9) continue
      expect(sim.zoneTargetId).toBe(dz < dp ? 'z' : 'p')
    }
    expect(pulled).toBeGreaterThan(5)
  })

  it('nobody once the rally is over, and nothing changes for a court without the zone', () => {
    const { sim, side } = lab(0)
    const o = sim.players.get('o') as SimPlayer
    const z = sim.players.get('z') as SimPlayer
    sim.fire(o, z, 'rally', { x: 0, y: 0.8, z: -side * 5 }, { x: 2.5, z: side * 5 }, 0.45, 0, 0)
    trace(sim, 900)
    expect(sim.phase).not.toBe('rally')
    expect(sim.ball.steerX ?? 0).toBe(0)
    const plain = lab(0, null)
    expect(plain.sim.zoneTargetId).toBe('')
  })
})

describe('TEZUKA ZONE keeps the rules', () => {
  it('pulls before the required bounce, but a swing still waits for it', () => {
    for (const slot of [0, 1] as const) {
      const { sim, z, o, side } = lab(slot)
      const s = shotFor('deep', side, z.x, seeded(9))
      sim.fire(o, z, 'return', s.from, s.target, s.power, 0, 0)
      let steeredBeforeBounce = false
      let swungEarly = false
      for (let i = 0; i < 400 && sim.phase === 'rally'; i++) {
        sim.step(FIXED_DT)
        const b = sim.ball
        if (!sim.rallyState.bounced && ((b.steerX ?? 0) !== 0 || (b.steerZ ?? 0) !== 0))
          steeredBeforeBounce = true
        if (!sim.rallyState.bounced && !swungEarly && reachDistance(z, side, b) !== null) {
          // Swinging at it in the air: the two-bounce rule makes the swing wait.
          sim.requestSwing('z', { ax: 0, az: -side * 4, power: 0.4, spin: 0, viewTick: sim.tick })
          swungEarly = true
          expect(sim.lastHitSlot).toBe(o.slot)
        }
      }
      expect(steeredBeforeBounce).toBe(true)
    }
  })

  it('from the kitchen the ball is brought after its bounce, and returning it then is no fault', () => {
    for (const slot of [0, 1] as const) {
      const { sim, z, o, side } = lab(slot)
      z.x = 0.5
      z.z = side * 1.6 // in the kitchen
      // A soft ball aimed away: volleying it there would be a fault, so it comes after
      // its bounce. (A hard drive over the head of someone in the kitchen can't be: it
      // would have to be braked almost to a stop. See docs/tezuka.md.)
      const s = shotFor('drop', side, z.x, seeded(6))
      sim.fire(o, z, 'rally', s.from, s.target, s.power, 0, 0)
      let returned = false
      let swung = false
      for (let i = 0; i < 400 && sim.phase === 'rally' && !returned; i++) {
        sim.step(FIXED_DT)
        if (!swung && sim.rallyState.bounced && reachDistance(z, side, sim.ball) !== null) {
          sim.requestSwing('z', { ax: 0, az: -side * 4, power: 0.4, spin: 0, viewTick: sim.tick })
          swung = true
        }
        // The server meets the ball at its closest point, a tick or two later.
        returned = sim.lastHitSlot === z.slot
      }
      expect(returned, `slot ${slot}`).toBe(true)
      expect(sim.phase).toBe('rally')
    }
  })

  it('a ball into the net is let go of, and the rally is lost as always', () => {
    const { sim, z, o, side } = lab(0)
    const s = shotFor('straight', side, z.x, seeded(1))
    sim.fire(o, z, 'rally', s.from, s.target, s.power, 0, 0)
    for (let i = 0; i < 10; i++) sim.step(FIXED_DT)
    expect(Math.hypot(sim.ball.steerX ?? 0, sim.ball.steerZ ?? 0)).toBeGreaterThan(0)
    // Knock it down just short of the net, so it meets the tape.
    sim.ball.z = -side * 0.4
    sim.ball.y = 0.5
    sim.ball.vy = 0
    let afterNet = false
    for (let i = 0; i < 400 && sim.phase === 'rally'; i++) {
      sim.step(FIXED_DT)
      if (sim.rallyState.touchedNet) afterNet = true
      if (afterNet) expect([sim.ball.steerX ?? 0, sim.ball.steerZ ?? 0]).toEqual([0, 0])
    }
    expect(afterNet).toBe(true)
    expect(sim.lastRally?.winner).toBe(z.slot)
    expect([sim.ball.steerX ?? 0, sim.ball.steerZ ?? 0]).toEqual([0, 0])
  })

  it('consecutive returns: every shot comes, the player still has to swing, and their reply is never pulled', () => {
    for (const slot of [0, 1] as const) {
      const { sim, z, o, side } = lab(slot)
      const rng = seeded(77 + slot)
      const categories = [
        'crossLeft',
        'deep',
        'curveRight',
        'drop',
        'straight',
        'lob',
        'crossRight',
        'dink',
      ] as const
      let returned = 0
      for (const category of categories) {
        z.x = 0
        z.z = side * 5.5
        const s = shotFor(category, side, z.x, rng)
        sim.fire(o, z, 'rally', s.from, s.target, s.power, s.boost, s.spin)
        let hit = false
        let swung = false
        for (let i = 0; i < 400 && sim.phase === 'rally' && !hit; i++) {
          sim.step(FIXED_DT)
          const mustWait = sim.rallyState.mustBounce
          if (
            !swung &&
            (!mustWait || sim.rallyState.bounced) &&
            reachDistance(z, side, sim.ball) !== null
          ) {
            // Clicked a moment ago, as seen on a lagging screen: the history is checked.
            sim.requestSwing('z', {
              ax: 0,
              az: -side * 4,
              power: 0.4,
              spin: 0,
              viewTick: sim.tick - 3,
            })
            swung = true
          }
          hit = sim.lastHitSlot === z.slot
        }
        expect(hit, `${category} slot ${slot}`).toBe(true)
        returned += 1
        // The reply flies unpulled until the opponent's next shot.
        for (const b of trace(sim, 30)) expect([b.steerX ?? 0, b.steerZ ?? 0]).toEqual([0, 0])
      }
      expect(returned).toBe(categories.length)
    }
  })

  it('a serve kept in its box: every trial on both sides, standing anywhere in the box', () => {
    for (const slot of [0, 1] as const) {
      for (const x of [-1, 0, 1].map((k) => k * 1.6)) {
        const { sim, z, o, side } = lab(slot)
        const boxSign = Math.sign(z.x) || 1
        z.x = boxSign * Math.abs(x) + boxSign * 0.5
        z.z = side * 6.2
        const from = { x: -boxSign * 2, y: 0.85, z: -side * 7.2 }
        sim.fire(o, z, 'serve', from, { x: boxSign * 2, z: side * 4.6 }, 0.3, 0, 0)
        const { serverSlot, serveParity } = sim.rallyState
        let bounce: { x: number; z: number } | null = null
        let prev = { ...sim.ball }
        for (let i = 0; i < 400 && sim.phase === 'rally'; i++) {
          sim.step(FIXED_DT)
          if (!bounce && sim.rallyState.bounced) bounce = { x: prev.x, z: prev.z }
          prev = { ...sim.ball }
        }
        expect(bounce).not.toBeNull()
        expect(
          isInServiceBox(bounce!.x, bounce!.z, serverSlot, serveParity),
          JSON.stringify(bounce),
        ).toBe(true)
      }
    }
  })
})

describe('TEZUKA ZONE on the wire', () => {
  it('fits the wire fields; clients extrapolating it stay within 1 cm for 50 ms, 4 cm for 0.1 s', () => {
    // A client between updates keeps the last pull it was sent; the server changes it a
    // little every tick, so the guess drifts (measured: 0.13 cm one tick ahead, 0.93 cm
    // after three, 3.6 cm after six). Clients normally draw between two real updates.
    const worst = [0, 0, 0, 0, 0, 0, 0]
    let steered = 0
    for (const category of ORDINARY) {
      for (const slot of [0, 1] as const) {
        const { sim, z, o, side } = lab(slot)
        const s = shotFor(category, side, z.x, seeded(13))
        sim.fire(o, z, 'rally', s.from, s.target, s.power, s.boost, s.spin)
        const flight = trace(sim)
        for (let i = 0; i + 6 < flight.length; i += 2) {
          const t = flight[i]!
          if ((t.steerX ?? 0) !== 0 || (t.steerZ ?? 0) !== 0) steered += 1
          for (const v of [t.steerX ?? 0, t.steerZ ?? 0]) {
            expect(Math.abs(toWire(v, WIRE.steer))).toBeLessThan(32767)
          }
          // What a client gets (rounded to the wire), stepped forward as it does.
          const q = (v: number, scale: number) => fromWire(toWire(v, scale), scale)
          const c: BallBody = {
            x: q(t.x, WIRE.position),
            y: q(t.y, WIRE.position),
            z: q(t.z, WIRE.position),
            vx: q(t.vx, WIRE.ballSpeed),
            vy: q(t.vy, WIRE.ballSpeed),
            vz: q(t.vz, WIRE.ballSpeed),
            curve: q(t.curve ?? 0, WIRE.curve),
            steerX: q(t.steerX ?? 0, WIRE.steer),
            steerZ: q(t.steerZ ?? 0, WIRE.steer),
          }
          for (let k = 1; k <= 6; k++) {
            stepBall(c, FIXED_DT, [])
            const truth = flight[i + k]!
            worst[k] = Math.max(worst[k]!, Math.hypot(c.x - truth.x, c.y - truth.y, c.z - truth.z))
          }
        }
      }
    }
    expect(steered).toBeGreaterThan(100)
    expect(worst[3]).toBeLessThan(0.01)
    expect(worst[6]).toBeLessThan(0.04)
  })

  it('the court stays inside the numbers the wire can carry', () => {
    expect(COURT.halfLength * WIRE.position).toBeLessThan(32767)
    expect(ZONE_PRESETS.anime.maxAccel * WIRE.steer).toBeLessThan(32767)
  })
})
