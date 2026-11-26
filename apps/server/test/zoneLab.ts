/**
 * A deterministic lab for the TEZUKA ZONE: real shots (solveShot) fired by an opponent
 * at the zone player through the real GameSimulation and rally rules, measured tick by
 * tick. Used by zone.test.ts, and by `yarn workspace @pickleball/server zone:report`.
 */
import {
  COURT,
  FIXED_DT,
  GRAVITY,
  REACH_RADIUS,
  type Side,
  type Slot,
  isInKitchen,
  reachDistance,
  sideOf,
} from '@pickleball/shared'
import { GameSimulation, type SimPlayer } from '../src/simulation/GameSimulation'
import { solveShot } from '../src/simulation/shot'
import { ZONE_PRESETS, type ZonePreset } from '../src/simulation/zone'

export function seeded(seed = 1): () => number {
  let s = seed
  return () => {
    s = (s * 16807) % 2147483647
    return (s - 1) / 2147483646
  }
}

/** What kind of shot is coming: as the opponent hits it. */
export type Category =
  | 'straight'
  | 'crossLeft'
  | 'crossRight'
  | 'curveLeft'
  | 'curveRight'
  | 'dink'
  | 'drop'
  | 'deep'
  | 'lob'
  | 'smash'
  | 'jumpSmash'

export const ORDINARY: readonly Category[] = [
  'straight',
  'crossLeft',
  'crossRight',
  'curveLeft',
  'curveRight',
  'dink',
  'drop',
  'deep',
  'lob',
]
export const FAST: readonly Category[] = ['smash', 'jumpSmash']
export const CATEGORIES: readonly Category[] = [...ORDINARY, ...FAST]

/** Where the zone player stands: x, and depth from the net on their own side. */
export const STANDS: readonly { name: string; x: number; depth: number }[] = [
  { name: 'baseline middle', x: 0, depth: 6 },
  { name: 'baseline left', x: -2.5, depth: 5.6 },
  { name: 'baseline right', x: 2.5, depth: 5.6 },
  { name: 'mid court', x: 1, depth: 4 },
]

export type Motion = 'still' | 'left' | 'right'
export const MOTIONS: readonly Motion[] = ['still', 'left', 'right']

/** Which shot of the rally: the return of serve must bounce; later ones may be volleyed. */
export type Stage = 'return' | 'rally'
export const STAGES: readonly Stage[] = ['return', 'rally']

export interface Trial {
  category: Category
  zoneSlot: Slot
  stand: (typeof STANDS)[number]
  motion: Motion
  stage: Stage
  seed: number
  preset: ZonePreset | null
}

export interface Outcome {
  /** The ball was, at some tick, legally hittable inside the reach radius. */
  hittable: boolean
  /** Why the rally ended, if it did. */
  end: string
  maxSteer: number
  /** Largest per-tick change of the pull (m/s²). */
  maxSteerChange: number
  /** Largest displacement beyond what speed and the strongest allowed pull explain (m). */
  maxExcess: number
  /** The ball ever moved back toward the hitter while being pulled. */
  reversed: boolean
  /** Ticks with any pull. */
  steeredTicks: number
  finite: boolean
  /** The pull was still on after the rally ended. */
  leaked: boolean
}

/** A GameSimulation with a hand on the rally, to fire one shot as if mid-rally. */
export class Lab extends GameSimulation {
  fire(
    hitter: SimPlayer,
    receiver: SimPlayer,
    stage: Stage | 'serve',
    from: { x: number; y: number; z: number },
    target: { x: number; z: number },
    power: number,
    boost: number,
    spin: number,
  ): void {
    this.phase = 'rally'
    if (stage === 'serve') this.rally.startServe(hitter.slot, this.serveParity, receiver.id)
    else if (stage === 'return') {
      this.rally.startServe(receiver.slot, this.serveParity, hitter.id)
      this.rally.onHit(hitter.slot)
    } else {
      this.rally.startServe(hitter.slot, this.serveParity, receiver.id)
      this.rally.onHit(receiver.slot)
      this.rally.onHit(hitter.slot)
    }
    this.lastHitId = hitter.id
    this.lastHitSlot = hitter.slot
    // Each shot fired is a new shot of the rally, as in a game (swings are counted per shot).
    this.rallyShots = Math.max(this.rallyShots + 1, this.rally.shots)
    this.launch(from, solveShot(from, target, power, boost, spin))
  }

  get rallyState() {
    return this.rally
  }
}

/** The shot of a category, aimed away from where the zone player stands. */
export function shotFor(
  category: Category,
  zoneSide: Side,
  zoneX: number,
  rng: () => number,
): {
  from: { x: number; y: number; z: number }
  target: { x: number; z: number }
  power: number
  boost: number
  spin: number
} {
  const hitterSide = -zoneSide as Side
  const jitter = (r: number) => (rng() * 2 - 1) * r
  // Away from the player: the far side of the court from them.
  const away = zoneX >= 0 ? -1 : 1
  const at = (x: number, depth: number, y = 0.8) => ({ x, y, z: depth * hitterSide })
  const to = (x: number, depth: number) => ({
    x: x + jitter(0.4),
    z: (depth + jitter(0.4)) * zoneSide,
  })
  const p = (base: number) => Math.min(1, Math.max(0, base + jitter(0.1)))
  switch (category) {
    case 'straight':
      return {
        from: at(away * 3, 5.5),
        target: to(away * 3.2, 4.8),
        power: p(0.5),
        boost: 0,
        spin: 0,
      }
    case 'crossLeft':
      return { from: at(3, 5.5), target: to(-3.6, 4.5), power: p(0.5), boost: 0, spin: 0 }
    case 'crossRight':
      return { from: at(-3, 5.5), target: to(3.6, 4.5), power: p(0.5), boost: 0, spin: 0 }
    case 'curveLeft':
      return { from: at(0, 5.5), target: to(away * 2.5, 4.8), power: p(0.35), boost: 0, spin: -1 }
    case 'curveRight':
      return { from: at(0, 5.5), target: to(away * 2.5, 4.8), power: p(0.35), boost: 0, spin: 1 }
    case 'dink':
      return {
        from: at(away * -1, 2.3, 0.4),
        target: to(away * 2.5, 1.4),
        power: 0,
        boost: 0,
        spin: 0,
      }
    case 'drop':
      return {
        from: at(away * -1.5, 6, 0.6),
        target: to(away * 2.8, 1.8),
        power: p(0.1),
        boost: 0,
        spin: 0,
      }
    case 'deep':
      return { from: at(0, 5, 0.9), target: to(away * 3.3, 6.2), power: p(0.7), boost: 0, spin: 0 }
    case 'lob':
      return {
        from: at(away * -1, 2.4, 0.7),
        target: to(away * 3, 6.1),
        power: 0,
        boost: 0,
        spin: 0,
      }
    case 'smash':
      return {
        from: at(away * -1, 3, 2.2),
        target: to(away * 3.4, 4.5),
        power: 1,
        boost: 0,
        spin: 0,
      }
    case 'jumpSmash':
      return {
        from: at(away * -1, 2.5, 2.9),
        target: to(away * 3.4, 4.2),
        power: 1,
        boost: 0.3,
        spin: 0,
      }
  }
}

/** One shot at the zone player, who never swings: could they have hit it? */
export function runTrial(t: Trial): Outcome {
  const rng = seeded(t.seed)
  const sim = new Lab(1, rng)
  // The first player seated plays on team 0 (+z).
  const ids = t.zoneSlot === 0 ? ['z', 'o'] : ['o', 'z']
  for (const id of ids) sim.addPlayer(id, id === 'z' ? 'Tezuka' : 'Bob')
  for (const id of ids) sim.setReady(id, true)
  const z = sim.players.get('z') as SimPlayer
  const o = sim.players.get('o') as SimPlayer
  const side = sideOf(z.slot)
  if (t.preset) {
    sim.zoneIds = new Set(['z'])
    sim.zone.preset = t.preset
  }
  z.x = t.stand.x
  z.z = t.stand.depth * side
  const shot = shotFor(t.category, side, z.x, rng)
  o.x = shot.from.x
  o.z = shot.from.z
  sim.fire(o, z, t.stage, shot.from, shot.target, shot.power, shot.boost, shot.spin)

  const preset = t.preset ?? ZONE_PRESETS.anime
  const k = 1 - Math.exp(-preset.smoothing * FIXED_DT)
  const out: Outcome = {
    hittable: false,
    end: '',
    maxSteer: 0,
    maxSteerChange: 0,
    maxExcess: 0,
    reversed: false,
    steeredTicks: 0,
    finite: true,
    leaked: false,
  }
  const mx = t.motion === 'left' ? -0.5 : t.motion === 'right' ? 0.5 : 0
  let seq = 0
  let prev = { ...sim.ball }
  for (let i = 0; i < 360 && sim.phase === 'rally'; i++) {
    if (mx !== 0) {
      seq += 1
      sim.queueInputs('z', { frames: [{ seq, mx, mz: 0, ax: 0, az: -side * 3 }] })
    }
    sim.step(FIXED_DT)
    const b = sim.ball
    const sx = b.steerX ?? 0
    const sz = b.steerZ ?? 0
    const steer = Math.hypot(sx, sz)
    if (![b.x, b.y, b.z, b.vx, b.vy, b.vz, sx, sz].every(Number.isFinite)) out.finite = false
    if (sim.phase !== 'rally') {
      if (steer !== 0) out.leaked = true
      out.end = sim.lastRally?.reason ?? sim.phase
      break
    }
    out.maxSteer = Math.max(out.maxSteer, steer)
    out.maxSteerChange = Math.max(
      out.maxSteerChange,
      Math.hypot(sx - (prev.steerX ?? 0), sz - (prev.steerZ ?? 0)),
    )
    if (steer > 0) {
      out.steeredTicks += 1
      if (b.vz * side <= 0) out.reversed = true
    }
    // Continuity: no farther than the speed it had, and the strongest pull allowed by
    // gravity, spin and the zone, can take it in one tick.
    const speed = Math.hypot(prev.vx, prev.vy, prev.vz)
    const accel = GRAVITY + Math.abs(prev.curve ?? 0) + preset.maxAccel
    const moved = Math.hypot(b.x - prev.x, b.y - prev.y, b.z - prev.z)
    out.maxExcess = Math.max(
      out.maxExcess,
      moved - (speed * FIXED_DT + 0.5 * accel * FIXED_DT ** 2),
    )
    prev = { ...b }

    // Legally hittable now? Inside the reach radius, on their side, under the height
    // limit, and after the bounce when the rules (or the kitchen) say so.
    const r = sim.rallyState
    const mustWait = r.mustBounce || isInKitchen(z.x, z.z, side)
    if (r.canHit(z.slot, z.id) && (!mustWait || r.bounced) && reachDistance(z, side, b) !== null) {
      out.hittable = true
    }
  }
  if (!out.end) out.end = sim.phase
  // `k` bounds how quickly the pull may change (see zone.ts).
  void k
  return out
}

export function allTrials(preset: ZonePreset | null, seeds: readonly number[]): Trial[] {
  const out: Trial[] = []
  for (const category of CATEGORIES)
    for (const zoneSlot of [0, 1] as const)
      for (const stand of STANDS)
        for (const motion of MOTIONS)
          for (const stage of STAGES)
            for (const seed of seeds)
              out.push({ category, zoneSlot, stand, motion, stage, seed, preset })
  return out
}

export interface Row {
  category: Category
  trials: number
  hit: number
}

export function tally(results: { trial: Trial; outcome: Outcome }[]): Row[] {
  return CATEGORIES.map((category) => {
    const rows = results.filter((r) => r.trial.category === category)
    return { category, trials: rows.length, hit: rows.filter((r) => r.outcome.hittable).length }
  })
}

export const REACH = REACH_RADIUS
export const HALF = COURT
