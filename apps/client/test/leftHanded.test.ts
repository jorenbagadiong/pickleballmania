/**
 * Left-handed play (the secret athlete): the same motions, strokes and IK as everyone
 * else, through the mirror. See src/players/athlete/handedness.ts.
 */
import { SECRET_LOOK } from '@pickleball/shared'
import { type Group, type Object3D, Quaternion, Vector3 } from 'three'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ZONE_PRESETS } from '../../server/src/simulation/zone'
import { ATHLETES, type Athlete, modelFor } from '../src/players/athlete/assets'
import { Controller, type Input } from '../src/players/athlete/controller'
import { gripFor } from '../src/players/athlete/grip'
import {
  MIRROR_BONE,
  WorldMirror,
  handFor,
  mirrorPose,
  mirrorQuaternion,
  mirrorRest,
} from '../src/players/athlete/handedness'
import { BONE, BONES, Figure, Pose } from '../src/players/athlete/skeleton'
import type { ShotInfo } from '../src/players/athlete/strokes'
import { bodyOf, readMotions } from './fixtures/athletes'

const motions = readMotions()
const DT = 1 / 60
const FINGERS = ['index', 'middle', 'ring', 'pinky', 'thumb'].flatMap((f) =>
  [1, 2, 3].map((k) => `${f}_0${k}`),
)

/** The same random numbers every time a controller is made. */
function seedRandom(): void {
  let x = 7919
  vi.spyOn(Math, 'random').mockImplementation(
    () => ((x = (x * 16807) % 2147483647) - 1) / 2147483646,
  )
}

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

/** Spots as a right-hander sees them; a left-hander gets each with x the other way. */
const SPOTS: [string, ShotInfo['contact'], Partial<ShotInfo>?][] = [
  ['forehand', { x: -0.65, y: 0.9, z: 0.5 }],
  ['backhand', { x: 0.5, y: 0.95, z: 0.55 }],
  ['in front', { x: -0.1, y: 1.1, z: 0.6 }],
  ['low', { x: -0.4, y: 0.3, z: 0.6 }],
  ['low backhand', { x: 0.45, y: 0.3, z: 0.55 }],
  ['wide forehand', { x: -1.25, y: 0.8, z: 0.2 }],
  ['wide backhand', { x: 1.1, y: 0.85, z: 0.3 }],
  ['shoulder high', { x: -0.5, y: 1.5, z: 0.45 }],
  ['smash', { x: -0.2, y: 2.1, z: 0.4 }, { power: 1 }],
  ['jump smash', { x: -0.2, y: 2.6, z: 0.4 }, { power: 1, jump: true }],
  ['volley', { x: -0.4, y: 1.2, z: 0.6 }, { volley: true }],
  ['dink', { x: -0.35, y: 0.5, z: 0.6 }, { depth: 2.4, aimDepth: 1.5 }],
  ['serve', { x: 0, y: 0.85, z: 0.45 }, { serve: true, power: 0.3 }],
]
const flip = (c: ShotInfo['contact']) => ({ x: -c.x, y: c.y, z: c.z })

const still: Input = {
  now: 0,
  delta: DT,
  vx: 0,
  vz: 0,
  yaw: 0,
  alert: 1,
  look: null,
  serveBall: null,
  mood: 'none',
  x: 0,
  z: 0,
}

/** Where the middle of the paddle face is, in the world. */
function paddleAt(a: Athlete, c: Controller): Vector3 {
  a.root.updateMatrixWorld(true)
  const hand = a.all.get(c.paddleBone)!
  return hand
    .getWorldPosition(new Vector3())
    .add(c.paddleGrip.center.clone().applyQuaternion(hand.getWorldQuaternion(new Quaternion())))
}

/** The secret athlete's body (drawn with its stand-in model), left-handed. */
function lefty(): { a: Athlete; c: Controller } {
  const a = bodyOf(`${modelFor(SECRET_LOOK)}.glb`)
  return { a, c: new Controller(a, motions, handFor(SECRET_LOOK)) }
}

/**
 * A body's mirror image as a body of its own: every joint mirrored across the middle,
 * and left and right swapped, fingers included.
 */
function mirrorTwin(name: string): Athlete {
  const a = bodyOf(name)
  const root = a.root.clone(true) as Group
  const all = new Map<string, Object3D>()
  root.traverse((o) => {
    o.position.x = -o.position.x
    o.name = o.name.replace(/_([lr])$/, (_m, s: string) => (s === 'l' ? '_r' : '_l'))
    all.set(o.name, o)
  })
  root.updateMatrixWorld(true)
  return {
    root,
    all,
    materials: {},
    bones: BONES.map((b) => all.get(b)!),
    rest: BONES.map((b) => all.get(b)!.getWorldPosition(new Vector3())),
  }
}

/** A world input as seen in the mirror across the line a player faces along. */
function mirrored(input: Input): Input {
  const c = Math.cos(input.yaw)
  const s = Math.sin(input.yaw)
  const flipGround = (dx: number, dz: number) => {
    // Into the body's frame (x = its left), mirror, and back.
    const lx = -(dx * c - dz * s)
    const lz = dx * s + dz * c
    return { x: lx * c + lz * s, z: -lx * s + lz * c }
  }
  const point = (p: Vector3 | null) => {
    if (!p) return null
    const d = flipGround(p.x - input.x, p.z - input.z)
    return new Vector3(input.x + d.x, p.y, input.z + d.z)
  }
  const v = flipGround(input.vx, input.vz)
  return { ...input, vx: v.x, vz: v.z, look: point(input.look), serveBall: point(input.serveBall) }
}

const bonesOf = (a: Athlete): Float32Array =>
  Float32Array.from(BONES.flatMap((b) => a.all.get(b)!.quaternion.toArray()))

/**
 * How far apart two rotations are, component by component (q and -q are the same turn).
 * Not an angle: the arccos in Quaternion.angleTo turns float rounding near 1 into
 * milliradians, which would hide whether two poses really agree.
 */
function quatGap(a: Quaternion, b: Quaternion): number {
  const s = a.dot(b) < 0 ? -1 : 1
  return Math.max(
    Math.abs(a.x - s * b.x),
    Math.abs(a.y - s * b.y),
    Math.abs(a.z - s * b.z),
    Math.abs(a.w - s * b.w),
  )
}

/** Largest difference between a's bones and the mirror of b's. */
function mirrorGap(left: Athlete, right: Athlete): number {
  let worst = 0
  const q = new Quaternion()
  BONES.forEach((name, b) => {
    const other = right.all.get(BONES[MIRROR_BONE[b]!]!)!.quaternion
    worst = Math.max(worst, quatGap(left.all.get(name)!.quaternion, mirrorQuaternion(other, q)))
  })
  return worst
}

beforeEach(seedRandom)
afterEach(() => vi.restoreAllMocks())

describe('who is left-handed', () => {
  it('only the secret athlete; all six public athletes stay right-handed', () => {
    expect(handFor(SECRET_LOOK)).toBe('left')
    for (const name of ATHLETES) expect(handFor(name), name).toBe('right')
    expect(handFor('')).toBe('right')
    expect(handFor('nonsense')).toBe('right')
  })

  it('the paddle goes in the left hand for them, the right hand for everyone else', () => {
    expect(lefty().c.paddleBone).toBe('hand_l')
    for (const name of ATHLETES)
      expect(new Controller(bodyOf(`${name}.glb`), motions).paddleBone).toBe('hand_r')
  })
})

describe('the mirror', () => {
  it('mirroring a pose twice gives it back exactly', () => {
    const pose = new Pose()
    const q = new Quaternion()
    for (let b = 0; b < BONES.length; b++)
      pose.set(b, q.setFromAxisAngle(new Vector3(b, 1, -b / 2).normalize(), 0.1 * b - 1))
    pose.pelvis.set(0.12, -0.05, 0.3)
    const back = mirrorPose(mirrorPose(pose, new Pose()), new Pose())
    for (let i = 0; i < pose.q.length; i++) expect(back.q[i]).toBeCloseTo(pose.q[i]!, 6)
    expect(back.pelvis.distanceTo(pose.pelvis)).toBeLessThan(1e-9)
  })

  it('swaps every left bone with its right one and leaves the middle alone', () => {
    for (let b = 0; b < BONES.length; b++) {
      const name = BONES[b]!
      const other = BONES[MIRROR_BONE[b]!]!
      if (name.endsWith('_l')) expect(other).toBe(name.replace(/_l$/, '_r'))
      else if (name.endsWith('_r')) expect(other).toBe(name.replace(/_r$/, '_l'))
      else expect(other).toBe(name)
      expect(MIRROR_BONE[MIRROR_BONE[b]!]).toBe(b)
    }
  })

  it('a mirrored pose on a body puts every joint at the mirror of where it was', () => {
    const a = bodyOf('m1.glb')
    const pose = new Pose()
    const q = new Quaternion()
    for (let b = 0; b < BONES.length; b++)
      pose.set(b, q.setFromAxisAngle(new Vector3(1, b % 3, 2).normalize(), 0.07 * b))
    pose.pelvis.set(0.08, 0.02, -0.04)
    const real = new Figure(a.rest).solve(mirrorPose(pose, new Pose()))
    const inMirror = new Figure(mirrorRest(a.rest)).solve(pose)
    for (let b = 0; b < BONES.length; b++) {
      const there = inMirror.p[MIRROR_BONE[b]!]!
      expect(real.p[b]!.distanceTo(new Vector3(-there.x, there.y, there.z))).toBeLessThan(1e-6)
    }
  })

  it('mirrors the world across the line the player faces along', () => {
    const m = new WorldMirror().set(0.4, 2, -3)
    const input = { ...still, yaw: 0.4, x: 2, z: -3, vx: 1.5, vz: -0.7 }
    const expected = mirrored({ ...input, look: new Vector3(4, 1, 1) })
    const v = m.direction(input.vx, input.vz)
    expect(v.x).toBeCloseTo(expected.vx, 9)
    expect(v.z).toBeCloseTo(expected.vz, 9)
    expect(m.point(new Vector3(4, 1, 1), new Vector3()).distanceTo(expected.look!)).toBeLessThan(
      1e-9,
    )
    // Straight ahead stays straight ahead.
    const ahead = m.direction(Math.sin(0.4), Math.cos(0.4))
    expect(ahead.x).toBeCloseTo(Math.sin(0.4), 9)
    expect(ahead.z).toBeCloseTo(Math.cos(0.4), 9)
  })
})

describe('a left-hander is a right-hander in the mirror, frame by frame', () => {
  const run = (
    input: Partial<Input>,
    hit?: [ShotInfo['contact'], Partial<ShotInfo>?],
    seconds = 2.4,
  ): number => {
    // Making a body draws random numbers (object ids): seed just before each controller.
    const right = bodyOf('m1.glb')
    const left = mirrorTwin('m1.glb')
    seedRandom()
    const rc = new Controller(right, motions)
    seedRandom()
    const lc = new Controller(left, motions, 'left')
    let worst = 0
    let frame = 0
    for (let now = 0; now < seconds; now += DT, frame++) {
      if (hit && frame === 60) {
        rc.hit(now, shot(hit[0], hit[1]), now + 0.25)
        lc.hit(now, shot(flip(hit[0]), hit[1]), now + 0.25)
      }
      const i: Input = { ...still, yaw: 0.3, x: 1, z: -2, ...input, now }
      rc.update(i)
      lc.update(mirrored(i))
      worst = Math.max(worst, mirrorGap(left, right))
      expect(left.all.get('pelvis')!.position.x).toBeCloseTo(
        -right.all.get('pelvis')!.position.x,
        5,
      )
    }
    return worst
  }

  for (const [label, input] of [
    ['idle', { alert: 0 }],
    ['ready stance', {}],
    ['walking', { vz: 1.4 }],
    ['running', { vz: 5 }],
    ['sprinting', { vz: 6.5 }],
    ['strafing', { vx: 2.3 }],
    ['strafing the other way', { vx: -2.3 }],
    ['backpedaling', { vz: -2.5 }],
    ['running diagonally', { vx: -3, vz: 3 }],
    ['watching the ball', { look: new Vector3(3, 1.4, 4) }],
    ['holding the ball to serve', { serveBall: new Vector3(1.3, 0.9, -1.6) }],
    ['celebrating', { mood: 'won' as const }],
  ] as const) {
    it(`${label}`, () => {
      expect(run(input)).toBeLessThan(1e-5)
    })
  }

  for (const [label, contact, extra] of SPOTS) {
    it(`${label}, through the recovery`, () => {
      expect(run({}, [contact, extra], 2.6)).toBeLessThan(1e-5)
    })
  }

  it('a wide shot at a run', () => {
    expect(run({ vx: 4, vz: 1 }, [{ x: 1.1, y: 0.85, z: 0.3 }])).toBeLessThan(1e-5)
  })

  it('fingers: the left hand closes round the handle as the right hand did', () => {
    seedRandom()
    const right = bodyOf('m1.glb')
    new Controller(right, motions)
    const left = mirrorTwin('m1.glb')
    new Controller(left, motions, 'left')
    const q = new Quaternion()
    for (const f of FINGERS) {
      for (const [l, r] of [
        ['l', 'r'],
        ['r', 'l'],
      ]) {
        const mine = left.all.get(`${f}_${l}`)!.quaternion
        const theirs = right.all.get(`${f}_${r}`)!.quaternion
        expect(quatGap(mine, mirrorQuaternion(theirs, q)), `${f}_${l}`).toBeLessThan(1e-6)
      }
    }
  })

  it('the grip in the left hand is the mirror of the grip in the right', () => {
    const right = gripFor(bodyOf('m1.glb'), 'r')
    const left = gripFor(mirrorTwin('m1.glb'), 'l')
    expect(left.position.distanceTo(right.position.clone().setX(-right.position.x))).toBeLessThan(
      1e-6,
    )
    expect(quatGap(left.rotation, mirrorQuaternion(right.rotation))).toBeLessThan(1e-6)
    expect(left.center.distanceTo(right.center.clone().setX(-right.center.x))).toBeLessThan(1e-6)
  })
})

describe('the secret athlete, left-handed on its stand-in body', () => {
  it('curls the left fingers round the handle and relaxes the right', () => {
    const { a } = lefty()
    const curl = (b: string) => 2 * Math.acos(Math.min(1, Math.abs(a.all.get(b)!.quaternion.w)))
    for (const f of ['index', 'middle', 'ring', 'pinky']) {
      expect(curl(`${f}_02_l`), f).toBeGreaterThan(1.1)
      expect(curl(`${f}_02_r`), f).toBeLessThan(0.75)
    }
    expect(curl('thumb_03_l')).toBeGreaterThan(curl('thumb_03_r'))
  })

  it('holds the paddle on the palm side of the left hand', () => {
    const { a, c } = lefty()
    const grip = c.paddleGrip
    // In the hand's frame: out along the fingers, and to the body's left of the wrist.
    const wrist = a.all.get('hand_l')!.getWorldPosition(new Vector3())
    const knuckles = a.all.get('middle_01_l')!.getWorldPosition(new Vector3())
    expect(grip.position.dot(knuckles.sub(wrist).normalize())).toBeGreaterThan(0.05)
    // The paddle face reaches past the hand, as on the right for a right-hander.
    expect(grip.center.length()).toBeGreaterThan(0.25)
    const right = gripFor(a, 'r')
    expect(grip.center.length()).toBeCloseTo(right.center.length(), 1)
  })

  it('a ball on the left is a forehand, on the right a backhand', () => {
    for (const [contact, want] of [
      [{ x: 0.6, y: 0.9, z: 0.5 }, 'forehandDrive'],
      [{ x: -0.5, y: 0.9, z: 0.5 }, 'backhandDrive'],
      [{ x: 1.2, y: 0.9, z: 0.2 }, 'forehandReach'],
      [{ x: -1.2, y: 0.9, z: 0.2 }, 'backhandReach'],
      [{ x: 0.35, y: 0.5, z: 0.6 }, 'forehandDink'],
      [{ x: -0.35, y: 0.5, z: 0.6 }, 'backhandDink'],
      [{ x: 0.4, y: 0.2, z: 0.5 }, 'forehandScoop'],
      [{ x: -0.3, y: 1.2, z: 0.5 }, 'backhandVolley'],
    ] as const) {
      const { c } = lefty()
      const deep = want.includes('Dink') ? { depth: 2.4, aimDepth: 1.5 } : {}
      const volley = want.includes('Volley') ? { volley: true } : {}
      c.hit(0, shot(contact, { ...deep, ...volley }), 0.25)
      expect(c.stroke, JSON.stringify(contact)).toBe(want)
    }
    // A right-hander still sees them the other way round.
    const right = new Controller(bodyOf('m1.glb'), motions)
    right.hit(0, shot({ x: 0.6, y: 0.9, z: 0.5 }), 0.25)
    expect(right.stroke).toBe('backhandDrive')
  })

  for (const [label, contact, extra] of SPOTS) {
    it(`the paddle is on the ball at contact (${label}, mirrored)`, () => {
      const { a, c } = lefty()
      const spot = new Vector3(-contact.x, contact.y, contact.z)
      let gap = Infinity
      for (let now = 0, f = 0; now < 2; now += DT, f++) {
        if (f === 60) c.hit(now, shot(flip(contact), extra), 1.25)
        c.update({ ...still, now })
        if (Math.abs(now - 1.25) < DT * 1.1) gap = Math.min(gap, paddleAt(a, c).distanceTo(spot))
      }
      // Within the face of the paddle (about 18 cm across), as for right-handers.
      expect(gap).toBeLessThan(0.14)
    })
  }

  it('jump smash: up off the ground with the left arm over the top, and back down', () => {
    const { a, c } = lefty()
    let standing = 0
    let top = 0
    let handTop = -Infinity
    for (let now = 0, f = 0; now < 2.6; now += DT, f++) {
      if (f === 60) c.hit(now, shot({ x: 0.2, y: 2.6, z: 0.4 }, { power: 1, jump: true }), 1.22)
      c.update({ ...still, now })
      a.root.updateMatrixWorld(true)
      const head = a.all.get('head')!.getWorldPosition(new Vector3()).y
      if (f === 50) standing = head
      top = Math.max(top, head)
      if (Math.abs(now - 1.22) < 0.05) {
        const l = a.all.get('hand_l')!.getWorldPosition(new Vector3()).y
        const r = a.all.get('hand_r')!.getWorldPosition(new Vector3()).y
        handTop = Math.max(handTop, l - r)
      }
    }
    expect(c.stroke).toBe('jumpSmash')
    expect(top).toBeGreaterThan(standing + 0.4)
    // At contact the paddle hand (left) is high above the other.
    expect(handTop).toBeGreaterThan(0.5)
    a.root.updateMatrixWorld(true)
    expect(Math.abs(a.all.get('head')!.getWorldPosition(new Vector3()).y - standing)).toBeLessThan(
      0.06,
    )
  })

  it('goes back to ready after any swing, without snapping', () => {
    for (const [, contact, extra] of SPOTS) {
      const { a, c } = lefty()
      let rest: Vector3 | null = null
      let before: Float32Array | null = null
      let worst = 0
      let last = new Vector3()
      for (let now = 0, f = 0; now < 3.4; now += DT, f++) {
        if (f === 60) c.hit(now, shot(flip(contact), extra), 1.25)
        c.update({ ...still, now })
        if (f === 55) rest = paddleAt(a, c)
        const q = bonesOf(a)
        if (before && f > 60) {
          for (let i = 0; i < q.length; i += 4) {
            let d = 0
            for (let k = 0; k < 4; k++) d += q[i + k]! * before[i + k]!
            worst = Math.max(worst, 2 * Math.acos(Math.min(1, Math.abs(d))))
          }
        }
        before = q
        last = paddleAt(a, c)
      }
      expect(last.distanceTo(rest!)).toBeLessThan(0.08)
      expect(worst).toBeLessThan(1.3)
    }
  })

  it('feet stay planted while running, strafing and backpedaling', () => {
    for (const [vx, vz] of [
      [0, 5],
      [2.3, 0],
      [-2.3, 0],
      [0, -2.5],
    ] as const) {
      const { a, c } = lefty()
      const speed = Math.hypot(vx, vz)
      const slips: number[] = []
      let before: Vector3[] | null = null
      for (let now = 0, f = 0; now < 4; now += DT, f++) {
        c.update({ ...still, now, vx, vz })
        a.root.updateMatrixWorld(true)
        const feet = ['foot_l', 'foot_r', 'ball_l', 'ball_r'].map((b) =>
          a.all.get(b)!.getWorldPosition(new Vector3()),
        )
        if (before && f > 130) {
          for (const s of [0, 1]) {
            const planted = [s, s + 2].flatMap((k) => {
              const ux = (feet[k]!.x - before![k]!.x) / DT
              const uz = (feet[k]!.z - before![k]!.z) / DT
              const ground = a.rest[k < 2 ? BONE.foot_l : BONE.ball_l]!.y
              return feet[k]!.y < ground + 0.06 && (ux * vx + uz * vz) / speed < -0.5 * speed
                ? [Math.hypot(ux + vx, uz + vz) / speed]
                : []
            })
            if (planted.length > 0) slips.push(Math.min(...planted))
          }
        }
        before = feet
      }
      slips.sort((x, y) => x - y)
      expect(slips.length).toBeGreaterThan(20)
      // The same limit the right-handed athletes are held to.
      expect(slips[slips.length >> 1], `${vx},${vz}`).toBeLessThan(0.3)
    }
  })

  it('never breaks, whatever it is told', () => {
    for (const bad of [
      { x: 40, y: -3, z: 9 },
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 9, z: -2 },
    ]) {
      const { a, c } = lefty()
      for (let now = 0, f = 0; now < 1.6; now += DT, f++) {
        if (f === 30) c.hit(now, shot(bad, { power: 1 }), 0.4)
        c.update({ ...still, now, vx: 60, look: new Vector3(0, 0, 0) })
        for (const v of bonesOf(a)) expect(Number.isFinite(v)).toBe(true)
      }
    }
  })
})

describe('TEZUKA ZONE and the left hand agree', () => {
  // The zone (server) brings a ball to a disk beside the paddle hand: contactSide to the
  // player's left, contactAhead toward the net, radius contactRadius.
  const zone = ZONE_PRESETS.anime

  it('the zone aims at the side the paddle is held on in the ready stance', () => {
    const { a, c } = lefty()
    for (let now = 0; now < 1.5; now += DT) c.update({ ...still, now })
    const paddle = paddleAt(a, c)
    expect(zone.contactSide).toBeGreaterThan(0)
    // Ready, the left-hander's paddle is on their left, inside the zone's disk.
    expect(paddle.x).toBeGreaterThan(0)
    expect(Math.hypot(paddle.x - zone.contactSide, paddle.z - zone.contactAhead)).toBeLessThan(
      zone.contactRadius,
    )
    // All presets share the disk.
    for (const p of Object.values(ZONE_PRESETS)) expect(p.contactSide).toBe(zone.contactSide)
  })

  for (const height of [0.6, 0.95, 1.3]) {
    it(`a ball brought to the middle of the disk at ${height} m is a forehand, met cleanly`, () => {
      const { a, c } = lefty()
      const spot = new Vector3(zone.contactSide, height, zone.contactAhead + 0.3)
      let gap = Infinity
      for (let now = 0, f = 0; now < 2; now += DT, f++) {
        if (f === 60) c.hit(now, shot({ x: spot.x, y: spot.y, z: spot.z }), 1.25)
        c.update({ ...still, now })
        if (Math.abs(now - 1.25) < DT * 1.1) gap = Math.min(gap, paddleAt(a, c).distanceTo(spot))
      }
      expect(c.stroke).toMatch(/^forehand/)
      expect(gap).toBeLessThan(0.14)
    })
  }
})
