/**
 * A VRM body driven by the athletes' controller (src/players/athlete/vrm.ts), tested on
 * a VRM 1.0 humanoid made in code (fixtures/vrm.ts) from `m1`'s skeleton. Because it is
 * `m1`'s skeleton, the drawn VRM must end up exactly where `m1`'s own bones do.
 */
import { SECRET_LOOK } from '@pickleball/shared'
import { type Mesh, Quaternion, Vector3 } from 'three'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type Athlete, SECRET_MODEL_URL, loadBody } from '../src/players/athlete/assets'
import { Controller, type Input } from '../src/players/athlete/controller'
import { handFor } from '../src/players/athlete/handedness'
import { BONES } from '../src/players/athlete/skeleton'
import type { ShotInfo } from '../src/players/athlete/strokes'
import {
  FINGER_BONES,
  VRM_BONE_MAP,
  type VrmAthlete,
  loadVrmAthlete,
} from '../src/players/athlete/vrm'
import { bodyOf, readMotions } from './fixtures/athletes'
import { syntheticVrm } from './fixtures/vrm'

const motions = readMotions()
const DT = 1 / 60

function seedRandom(): void {
  let x = 7919
  vi.spyOn(Math, 'random').mockImplementation(
    () => ((x = (x * 16807) % 2147483647) - 1) / 2147483646,
  )
}

/** Serves `files` (by URL) to fetch; anything else is a 404. */
function serve(files: Record<string, ArrayBuffer | string>): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const body = files[url]
      return body === undefined
        ? new Response('not found', { status: 404 })
        : new Response(body, { status: 200 })
    }),
  )
}

let n = 0
/** A fresh URL each time: loadVrmAthlete remembers what it fetched. */
async function load(file: ArrayBuffer | string): Promise<VrmAthlete | null> {
  const url = `/test/${++n}.vrm`
  serve({ [url]: file })
  return loadVrmAthlete(url)
}

async function body(o?: Parameters<typeof syntheticVrm>[0]): Promise<VrmAthlete> {
  const v = await load(syntheticVrm(o))
  expect(v, 'the VRM loads').not.toBeNull()
  return v!
}

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

/** Where a drawn (raw, skinned) VRM bone is, in the body's frame. */
function drawn(v: VrmAthlete, ours: string): Vector3 {
  v.vrm.scene.updateMatrixWorld(true)
  return v.vrm.humanoid.getRawBoneNode(VRM_BONE_MAP[ours]!)!.getWorldPosition(new Vector3())
}

/** The middle of the paddle face as drawn: the paddle mount, then the grip. */
function paddleAt(a: Athlete, c: Controller): Vector3 {
  a.root.updateMatrixWorld(true)
  const mount = a.paddleMount?.(c.paddleBone) ?? a.all.get(c.paddleBone)!
  return mount
    .getWorldPosition(new Vector3())
    .add(c.paddleGrip.center.clone().applyQuaternion(mount.getWorldQuaternion(new Quaternion())))
}

beforeEach(seedRandom)
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('loading a VRM body', () => {
  it('maps every body and finger bone, with nothing missing', async () => {
    const v = await body()
    expect(v.missing).toEqual([])
    for (const b of [...BONES, ...FINGER_BONES]) {
      expect(VRM_BONE_MAP[b], b).toBeDefined()
      expect(v.vrm.humanoid.getNormalizedBoneNode(VRM_BONE_MAP[b]!), b).toBeTruthy()
    }
    expect(v.bones.map((b) => b.name)).toEqual([...BONES])
  })

  it("lowers the VRM's T-pose arms into our A-pose: the rest matches m1's", async () => {
    const v = await body()
    const m1 = bodyOf('m1.glb')
    let worst = 0
    BONES.forEach((_, b) => (worst = Math.max(worst, v.rest[b]!.distanceTo(m1.rest[b]!))))
    expect(worst).toBeLessThan(0.002)
  })

  it('refuses what is not a usable VRM 1.0 humanoid', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await load(syntheticVrm({ kind: 'none' }))).toBeNull()
    expect(await load(syntheticVrm({ kind: '0' }))).toBeNull()
    expect(await load('<!doctype html><title>a page, not a model</title>')).toBeNull()
    const broken = new Uint8Array(syntheticVrm()).slice(0, 4000)
    expect(await load(broken.buffer)).toBeNull()
    serve({})
    expect(await loadVrmAthlete('/nothing/here.vrm')).toBeNull()
  })
})

describe('the drawn VRM follows the controller', () => {
  /** Drives m1 and the VRM made from m1 identically; worst gap of the drawn joints (m). */
  const compare = async (
    hand: 'right' | 'left',
    input: Partial<Input>,
    hit?: [ShotInfo['contact'], Partial<ShotInfo>?],
  ): Promise<number> => {
    const v = await body()
    const m1 = bodyOf('m1.glb')
    seedRandom()
    const cm = new Controller(m1, motions, hand)
    seedRandom()
    const cv = new Controller(v, motions, hand)
    let worst = 0
    for (let now = 0, f = 0; now < 2.4; now += DT, f++) {
      if (hit && f === 60) for (const c of [cm, cv]) c.hit(now, shot(hit[0], hit[1]), now + 0.25)
      for (const c of [cm, cv]) c.update({ ...still, ...input, now })
      m1.root.updateMatrixWorld(true)
      for (const b of BONES) {
        const gap = drawn(v, b).distanceTo(m1.all.get(b)!.getWorldPosition(new Vector3()))
        worst = Math.max(worst, gap)
      }
    }
    return worst
  }

  for (const [label, input] of [
    ['standing ready', {}],
    ['running', { vz: 5 }],
    ['strafing', { vx: 2.3 }],
  ] as const) {
    it(`${label}: every drawn joint where m1's is`, async () => {
      expect(await compare('right', input)).toBeLessThan(0.005)
    })
  }

  it('a left-handed forehand and jump smash, too', async () => {
    expect(await compare('left', {}, [flip({ x: -0.65, y: 0.9, z: 0.5 })])).toBeLessThan(0.005)
    expect(
      await compare('left', {}, [flip({ x: -0.2, y: 2.6, z: 0.4 }), { power: 1, jump: true }]),
    ).toBeLessThan(0.005)
  })
})

describe('left-handed on a VRM body', () => {
  it('hangs the paddle from the drawn left hand', async () => {
    const v = await body()
    const c = new Controller(v, motions, handFor(SECRET_LOOK))
    expect(c.paddleBone).toBe('hand_l')
    const mount = v.paddleMount!('hand_l')!
    expect(mount.parent).toBe(v.vrm.humanoid.getNormalizedBoneNode('leftHand'))
    for (let now = 0; now < 1; now += DT) c.update({ ...still, now })
    // The drawn hand and the controller's hand agree.
    v.vrm.scene.updateMatrixWorld(true)
    expect(mount.getWorldPosition(new Vector3()).distanceTo(drawn(v, 'hand_l'))).toBeLessThan(1e-4)
  })

  for (const [label, contact, extra] of SPOTS) {
    it(`meets the ball with the drawn paddle (${label}, left-handed)`, async () => {
      const v = await body()
      const c = new Controller(v, motions, 'left')
      const spot = new Vector3(-contact.x, contact.y, contact.z)
      let gap = Infinity
      for (let now = 0, f = 0; now < 2; now += DT, f++) {
        if (f === 60) c.hit(now, shot(flip(contact), extra), 1.25)
        c.update({ ...still, now })
        if (Math.abs(now - 1.25) < DT * 1.1) gap = Math.min(gap, paddleAt(v, c).distanceTo(spot))
      }
      expect(gap).toBeLessThan(0.14)
    })
  }
})

describe('more than one controller on a body', () => {
  it('each measures the grip from the hand at rest, whatever the last one did', async () => {
    for (const a of [bodyOf('m1.glb'), await body()]) {
      const first = new Controller(a, motions, 'left')
      const grip = first.paddleGrip.center.clone()
      for (let now = 0, f = 0; now < 1.4; now += DT, f++) {
        if (f === 30) first.hit(now, shot({ x: 0.6, y: 1.5, z: 0.4 }), now + 0.25)
        first.update({ ...still, now, vx: 2 })
      }
      for (const hand of ['left', 'right'] as const) {
        const again = new Controller(a, motions, hand)
        const expected = hand === 'left' ? grip : grip.clone().setX(-grip.x)
        expect(again.paddleGrip.center.distanceTo(expected), hand).toBeLessThan(0.01)
      }
    }
  })
})

describe('a VRM missing optional bones', () => {
  const fingers = ['Thumb', 'Index', 'Middle', 'Ring', 'Little'].flatMap((f) =>
    ['left', 'right'].flatMap((s) =>
      (f === 'Thumb'
        ? ['Metacarpal', 'Proximal', 'Distal']
        : ['Proximal', 'Intermediate', 'Distal']
      ).map((k) => `${s}${f}${k}`),
    ),
  )
  const optional = [
    'upperChest',
    'leftShoulder',
    'rightShoulder',
    'leftToes',
    'rightToes',
    ...fingers,
  ]

  it('places them by estimate, lists them, and still plays and meets the ball', async () => {
    const v = await body({ drop: optional })
    expect(v.missing.sort()).toEqual(
      [...BONES, ...FINGER_BONES].filter((b) => optional.includes(VRM_BONE_MAP[b]!)).sort(),
    )
    const c = new Controller(v, motions, 'left')
    const spot = new Vector3(0.65, 0.9, 0.5)
    let gap = Infinity
    for (let now = 0, f = 0; now < 2; now += DT, f++) {
      if (f === 60) c.hit(now, shot({ x: 0.65, y: 0.9, z: 0.5 }), 1.25)
      c.update({ ...still, now, vx: f > 100 ? 3 : 0 })
      for (const b of v.bones)
        for (const x of b.quaternion.toArray()) expect(Number.isFinite(x)).toBe(true)
      if (Math.abs(now - 1.25) < DT * 1.1) gap = Math.min(gap, paddleAt(v, c).distanceTo(spot))
    }
    expect(gap).toBeLessThan(0.14)
  })
})

describe('looks, quality and clean-up', () => {
  it('outlines and spring bones switch off with the quality setting', async () => {
    const v = await body()
    const outlines: { visible: boolean }[] = []
    v.vrm.scene.traverse((o) => {
      const m = (o as { material?: unknown }).material
      if (Array.isArray(m)) for (const x of m) if (x.isOutline) outlines.push(x)
    })
    expect(outlines.length).toBeGreaterThan(0)
    const springs = vi.spyOn(v.vrm.springBoneManager!, 'update')
    const c = new Controller(v, motions)
    c.update({ ...still, now: 0 })
    expect(springs).toHaveBeenCalled()
    v.setQuality({ springs: false, outlines: false })
    springs.mockClear()
    c.update({ ...still, now: DT })
    expect(springs).not.toHaveBeenCalled()
    expect(outlines.every((m) => !m.visible)).toBe(true)
    v.setQuality({ springs: true, outlines: true })
    expect(outlines.every((m) => m.visible)).toBe(true)
  })

  it('the hair swings when the body moves (spring bones run)', async () => {
    const v = await body()
    const c = new Controller(v, motions)
    const hair = v.vrm.scene.getObjectByName('hair_2')!
    const head = v.vrm.humanoid.getRawBoneNode('head')!
    const offset = () => {
      v.vrm.scene.updateMatrixWorld(true)
      return hair.getWorldPosition(new Vector3()).sub(head.getWorldPosition(new Vector3()))
    }
    for (let now = 0; now < 1; now += DT) c.update({ ...still, now })
    const rest = offset()
    let most = 0
    for (let now = 1, f = 0; now < 2; now += DT, f++) {
      c.update({ ...still, now, vz: 5 })
      most = Math.max(most, offset().distanceTo(rest))
    }
    expect(most).toBeGreaterThan(0.005)
  })

  it('frees every geometry, material and texture of the body', async () => {
    const v = await body()
    const freed = { geometry: 0, material: 0 }
    const owned = { geometry: 0, material: 0 }
    v.vrm.scene.traverse((o) => {
      const mesh = o as Mesh
      if (mesh.geometry) {
        owned.geometry++
        mesh.geometry.addEventListener('dispose', () => freed.geometry++)
      }
      const mats = Array.isArray(mesh.material)
        ? mesh.material
        : mesh.material
          ? [mesh.material]
          : []
      for (const m of mats) {
        owned.material++
        m.addEventListener('dispose', () => freed.material++)
      }
    })
    v.paddleMount!('hand_l')
    v.dispose!()
    expect(owned.geometry).toBeGreaterThan(0)
    expect(freed.geometry).toBeGreaterThanOrEqual(owned.geometry)
    expect(freed.material).toBeGreaterThanOrEqual(owned.material)
    expect(
      v.vrm.humanoid.getNormalizedBoneNode('leftHand')!.getObjectByName('hand_l'),
    ).toBeUndefined()
  })
})

describe('only the secret athlete looks for its own model', () => {
  const standIn = vi.fn(async (look: string) => ({ ...bodyOf('m1.glb'), look }) as Athlete)

  it('a public athlete never asks for the private model', async () => {
    const fetch = vi.fn(async () => new Response('', { status: 404 }))
    vi.stubGlobal('fetch', fetch)
    for (const look of ['m1', 'f2', '', 'x2']) await loadBody(look, standIn, true)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('the secret athlete tries it, and without it gets its stand-in (still left-handed)', async () => {
    const fetch = vi.fn(async (_url: string) => new Response('', { status: 404 }))
    vi.stubGlobal('fetch', fetch)
    standIn.mockClear()
    const a = await loadBody(SECRET_LOOK, standIn, true)
    expect(fetch.mock.calls.map(([u]) => String(u))).toEqual([SECRET_MODEL_URL])
    expect(standIn).toHaveBeenCalledWith(SECRET_LOOK)
    expect(a).not.toHaveProperty('vrm')
    expect(new Controller(a, motions, handFor(SECRET_LOOK)).paddleBone).toBe('hand_l')
  })

  it('without a model in the build, nothing is asked for at all', async () => {
    const fetch = vi.fn(async () => new Response('', { status: 404 }))
    vi.stubGlobal('fetch', fetch)
    standIn.mockClear()
    await loadBody(SECRET_LOOK, standIn, false)
    expect(fetch).not.toHaveBeenCalled()
    expect(standIn).toHaveBeenCalledWith(SECRET_LOOK)
  })
})
