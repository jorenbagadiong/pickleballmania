/**
 * The six public athletes are right-handed, and adding left-handed play must not change
 * a single joint of how they move. These snapshots were recorded before handedness
 * existed: every scenario is replayed with the same random numbers, and every bone
 * (fingers and the paddle grip included) must come out as it did then.
 */
import { createHash } from 'node:crypto'
import { Vector3 } from 'three'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ATHLETES } from '../src/players/athlete/assets'
import { Controller, type Input } from '../src/players/athlete/controller'
import { BONES } from '../src/players/athlete/skeleton'
import type { ShotInfo } from '../src/players/athlete/strokes'
import { bodyOf, readMotions } from './fixtures/athletes'

const motions = readMotions()
const DT = 1 / 60
const FINGERS = ['index', 'middle', 'ring', 'pinky', 'thumb'].flatMap((f) =>
  [1, 2, 3].flatMap((k) => [`${f}_0${k}_l`, `${f}_0${k}_r`]),
)
/** Frames looked at: before a swing, through it, and after. */
const LOOK_AT = [20, 58, 66, 72, 76, 84, 100, 130]

const round = (v: number): number => Math.round(v * 1e5) / 1e5 || 0

const shot = (contact: ShotInfo['contact'], o: Partial<ShotInfo> = {}): ShotInfo => ({
  power: 0.35,
  serve: false,
  jump: false,
  volley: false,
  pace: 7,
  depth: 6,
  aimDepth: 5,
  contact,
  ...o,
})

const SCENARIOS: [string, Partial<Input>, ShotInfo?][] = [
  ['idle', { alert: 0 }],
  ['ready', {}],
  ['walking', { vz: 1.4 }],
  ['running', { vz: 5 }],
  ['strafing left', { vx: 2.3 }],
  ['strafing right', { vx: -2.3 }],
  ['backpedaling', { vz: -2.5 }],
  ['diagonal', { vx: 2, vz: 2 }],
  ['looking at the ball', { look: new Vector3(2, 1.2, 4) }],
  [
    'serve',
    { serveBall: new Vector3(0.25, 0.9, 0.45) },
    shot({ x: 0, y: 0.85, z: 0.45 }, { serve: true, power: 0.3 }),
  ],
  ['forehand', {}, shot({ x: -0.65, y: 0.9, z: 0.5 })],
  ['backhand', {}, shot({ x: 0.5, y: 0.95, z: 0.55 })],
  ['dink', {}, shot({ x: -0.35, y: 0.5, z: 0.6 }, { depth: 2.4, aimDepth: 1.5 })],
  ['volley', {}, shot({ x: -0.4, y: 1.2, z: 0.6 }, { volley: true })],
  ['smash', {}, shot({ x: -0.2, y: 2.1, z: 0.4 }, { power: 1 })],
  ['jump smash', {}, shot({ x: -0.2, y: 2.6, z: 0.4 }, { power: 1, jump: true })],
  ['wide backhand on the run', { vx: 4, vz: 1 }, shot({ x: 1.1, y: 0.85, z: 0.3 })],
  ['won the point', { mood: 'won' }],
]

function record(name: string, input: Partial<Input>, hit?: ShotInfo) {
  const athlete = bodyOf(`${name}.glb`)
  const c = new Controller(athlete, motions)
  const g = c.paddleGrip
  const out: Record<string, number[]> = {
    grip: [...g.position.toArray(), ...g.rotation.toArray(), ...g.center.toArray()].map(round),
    fingers: FINGERS.flatMap((f) => athlete.all.get(f)!.quaternion.toArray()).map(round),
  }
  let frame = 0
  for (let now = 0; frame <= LOOK_AT.at(-1)!; now += DT, frame++) {
    if (hit && frame === 60) c.hit(now, hit, now + 0.25)
    c.update({
      now,
      delta: DT,
      vx: 0,
      vz: 0,
      yaw: 0.3,
      alert: 1,
      look: null,
      serveBall: null,
      mood: 'none',
      x: 1,
      z: -2,
      ...input,
    })
    if (LOOK_AT.includes(frame)) {
      out[`frame ${frame}`] = [
        ...BONES.flatMap((b) => athlete.all.get(b)!.quaternion.toArray()),
        ...athlete.all.get('pelvis')!.position.toArray(),
        c.lift,
      ].map(round)
    }
  }
  // One digest per part: any change of any joint, however small, changes it.
  return Object.fromEntries(
    Object.entries(out).map(([k, v]) => [
      k,
      createHash('sha256').update(v.join(',')).digest('hex').slice(0, 16),
    ]),
  )
}

describe('the six right-handed athletes move exactly as before', () => {
  beforeEach(() => {
    let x = 7919
    vi.spyOn(Math, 'random').mockImplementation(
      () => ((x = (x * 16807) % 2147483647) - 1) / 2147483646,
    )
  })
  afterEach(() => vi.restoreAllMocks())

  for (const [label, input, hit] of SCENARIOS) {
    it(`m1: ${label}`, () => {
      expect(record('m1', input, hit)).toMatchSnapshot()
    })
  }

  // Every body, through the strokes that use the paddle arm most.
  for (const name of ATHLETES) {
    it(`${name}: forehand, backhand and jump smash`, () => {
      expect({
        forehand: record(name, {}, SCENARIOS[10]![2]),
        backhand: record(name, {}, SCENARIOS[11]![2]),
        jumpSmash: record(name, {}, SCENARIOS[15]![2]),
      }).toMatchSnapshot()
    })
  }
})
