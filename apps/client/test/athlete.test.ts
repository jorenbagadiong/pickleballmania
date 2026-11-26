import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Group, Object3D, Quaternion, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { ATHLETES, type Athlete, castFor } from '../src/players/athlete/assets'
import { Controller, type Input } from '../src/players/athlete/controller'
import { type Motions, gaitFor } from '../src/players/athlete/locomotion'
import { BONE, BONES, Figure, Pose } from '../src/players/athlete/skeleton'
import { type ShotInfo, chooseStroke } from '../src/players/athlete/strokes'

/* The real files the game loads, read without a browser. */
const file = (name: string): string =>
  fileURLToPath(new URL(`../public/models/${name}`, import.meta.url))

interface Gltf {
  nodes: { name: string; translation?: number[]; children?: number[] }[]
  accessors: { bufferView: number; count: number; type: string; byteOffset?: number }[]
  bufferViews: { byteOffset: number; byteLength: number }[]
  animations?: {
    name: string
    channels: { sampler: number; target: { node: number; path: string } }[]
    samplers: { output: number }[]
  }[]
  images?: unknown[]
}

function readGlb(name: string): { json: Gltf; bin: Buffer } {
  const b = readFileSync(file(name))
  const n = b.readUInt32LE(12)
  return { json: JSON.parse(b.toString('utf8', 20, 20 + n)) as Gltf, bin: b.subarray(28 + n) }
}

function bodyOf(name: string): Athlete {
  const { json } = readGlb(name)
  const objects = json.nodes.map((n) => {
    const o = new Object3D()
    o.name = n.name
    if (n.translation) o.position.fromArray(n.translation)
    return o
  })
  const root = new Group()
  const all = new Map<string, Object3D>()
  json.nodes.forEach((n, i) => n.children?.forEach((c) => objects[i]!.add(objects[c]!)))
  for (const o of objects) {
    if (!o.parent) root.add(o)
    all.set(o.name, o)
  }
  root.updateMatrixWorld(true)
  return {
    root,
    all,
    materials: {},
    bones: BONES.map((b) => all.get(b)!),
    rest: BONES.map((b) => all.get(b)!.getWorldPosition(new Vector3())),
  }
}

function readMotions(): Motions {
  const { json, bin } = readGlb('motions.glb')
  const info = JSON.parse(readFileSync(file('motions.json'), 'utf8')) as Record<
    string,
    { seconds: number; loop: boolean; velocity: [number, number] }
  >
  const floats = (a: number): Float32Array => {
    const acc = json.accessors[a]!
    const v = json.bufferViews[acc.bufferView]!
    const size = { SCALAR: 1, VEC3: 3, VEC4: 4 }[acc.type] ?? 1
    return new Float32Array(
      bin.buffer.slice(
        bin.byteOffset + v.byteOffset,
        bin.byteOffset + v.byteOffset + acc.count * size * 4,
      ),
    )
  }
  const pelvisRest = new Vector3().fromArray(
    json.nodes.find((n) => n.name === 'pelvis')!.translation!,
  )
  const out: Motions = {}
  for (const a of json.animations ?? []) {
    const meta = info[a.name]!
    const data = new Map(
      a.channels.map((c) => [
        `${json.nodes[c.target.node]!.name}.${c.target.path}`,
        floats(a.samplers[c.sampler]!.output),
      ]),
    )
    const move = data.get('pelvis.translation')!
    const frames = move.length / 3
    const q = new Float32Array(frames * BONES.length * 4)
    BONES.forEach((b, i) => {
      const t = data.get(`${b}.rotation`)!
      for (let f = 0; f < frames; f++)
        q.set(t.subarray(f * 4, f * 4 + 4), (f * BONES.length + i) * 4)
    })
    out[a.name] = {
      name: a.name,
      frames,
      seconds: meta.seconds,
      loop: meta.loop,
      velocity: { x: meta.velocity[0], z: meta.velocity[1] },
      q,
      pelvis: move.map((v, i) => v - pelvisRest.toArray()[i % 3]!),
    }
  }
  return out
}

const motions = readMotions()
const DT = 1 / 60

/** Plays the game at a controller, and watches what the body does. */
function play(
  name: string,
  seconds: number,
  o: Partial<Input> & { each?: (now: number, c: Controller) => void } = {},
) {
  const athlete = bodyOf(`${name}.glb`)
  const c = new Controller(athlete, motions)
  const grip = c.paddleGrip
  const frames: {
    now: number
    feet: [Vector3, Vector3]
    toes: [Vector3, Vector3]
    head: Vector3
    paddle: Vector3
    hand: Vector3
    q: Float32Array
  }[] = []
  for (let now = 0; now < seconds; now += DT) {
    o.each?.(now, c)
    c.update({
      now,
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
      ...o,
    })
    athlete.root.updateMatrixWorld(true)
    const at = (b: string): Vector3 => athlete.all.get(b)!.getWorldPosition(new Vector3())
    const hand = athlete.all.get('hand_r')!
    frames.push({
      now,
      feet: [at('foot_l'), at('foot_r')],
      toes: [at('ball_l'), at('ball_r')],
      head: at('head'),
      hand: at('hand_r'),
      paddle: at('hand_r').add(
        grip.center.clone().applyQuaternion(hand.getWorldQuaternion(new Quaternion())),
      ),
      q: Float32Array.from(BONES.flatMap((b) => athlete.all.get(b)!.quaternion.toArray())),
    })
  }
  return { frames, athlete }
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

/** The biggest turn of any joint between two frames (radians). */
function biggestTurn(a: Float32Array, b: Float32Array): number {
  let most = 0
  for (let i = 0; i < a.length; i += 4) {
    let d = 0
    for (let k = 0; k < 4; k++) d += a[i + k]! * b[i + k]!
    most = Math.max(most, 2 * Math.acos(Math.min(1, Math.abs(d))))
  }
  return most
}

describe('athletes', () => {
  it('are adults with a full skeleton and real proportions', () => {
    for (const name of ATHLETES) {
      const a = bodyOf(`${name}.glb`)
      for (const b of BONES) expect(a.all.has(b), `${name} ${b}`).toBe(true)
      for (const f of ['index_03_r', 'thumb_03_l']) expect(a.all.has(f)).toBe(true)
      const head = a.rest[BONE.head]!.y
      expect(head, name).toBeGreaterThan(1.4)
      expect(head, name).toBeLessThan(1.72)
      // Hips about half way up, feet on the ground.
      expect(a.rest[BONE.thigh_l]!.y / (head + 0.2)).toBeGreaterThan(0.46)
      expect(a.rest[BONE.foot_l]!.y).toBeLessThan(0.16)
    }
  })

  it('look different from each other on one court', () => {
    const players = ['Al', 'Bo', 'Cy', 'Di'].map((nickname, i) => ({ id: `${i}`, nickname }))
    expect(new Set(castFor(players).values()).size).toBe(4)
    expect(castFor(players)).toEqual(castFor(players))
  })
})

describe('moving', () => {
  it('uses a motion made for the direction', () => {
    const top = (left: number, forward: number): string =>
      [...gaitFor(left, forward, motions, 1).weights].sort((a, b) => b.w - a.w)[0]!.name
    expect(top(0, 1.3)).toBe('walk')
    expect(top(0, 3.8)).toBe('run')
    expect(top(0, 6)).toBe('sprint')
    expect(top(0, -2.6)).toBe('backpedal')
    expect(top(2.3, 0)).toBe('shuffleLeft')
    expect(top(-1.1, 0)).toBe('sideRight')
    expect(top(0, 0)).toBe('ready')
    // Fast to the side: the hips turn and it becomes a run.
    expect(top(6, 0)).toMatch(/run|sprint/)
    expect(gaitFor(6, 0, motions, 1).hips).toBeGreaterThan(0.8)
    expect(gaitFor(-6, 0, motions, 1).hips).toBeLessThan(-0.8)
  })

  it('weights always add up, at any speed and direction', () => {
    for (let a = 0; a < 6.3; a += 0.1) {
      for (let v = 0; v <= 6; v += 0.25) {
        const g = gaitFor(Math.sin(a) * v, Math.cos(a) * v, motions, 1)
        expect(g.weights.reduce((s, w) => s + w.w, 0)).toBeCloseTo(1, 2)
        expect(g.rate).toBeLessThanOrEqual(3.2)
        for (const w of g.weights) expect(motions[w.name], w.name).toBeDefined()
      }
    }
  })

  for (const [label, vx, vz] of [
    ['walking', 0, 1.4],
    ['jogging', 0, 3],
    ['running', 0, 5],
    ['sprinting', 0, 6],
    ['backpedaling', 0, -2.5],
    ['shuffling', 2.3, 0],
    ['moving diagonally', 2, 2],
  ] as const) {
    it(`feet on the ground stay put while ${label}`, () => {
      const { frames, athlete } = play('m1', 4, { vx, vz })
      const floor = athlete.rest[BONE.foot_l]!.y
      const speed = Math.hypot(vx, vz)
      const slips: number[] = []
      for (let i = 130; i < frames.length; i++) {
        for (const s of [0, 1] as const) {
          // Not sunk into the court.
          expect(frames[i]!.feet[s].y).toBeGreaterThan(floor - 0.03)
          // A foot rolls: what stays put is the heel, or the ball of the foot.
          const parts = (['feet', 'toes'] as const).map((part) => {
            const now = frames[i]![part][s]
            const before = frames[i - 1]![part][s]
            const ground = athlete.rest[part === 'feet' ? BONE.foot_l : BONE.ball_l]!.y
            const ux = (now.x - before.x) / DT
            const uz = (now.z - before.z) / DT
            return {
              // On the ground and going back under the body: carrying weight, not swinging.
              planted: now.y < ground + 0.06 && (ux * vx + uz * vz) / speed < -0.5 * speed,
              slip: Math.hypot(ux + vx, uz + vz),
            }
          })
          const planted = parts.filter((p) => p.planted)
          if (planted.length > 0) slips.push(Math.min(...planted.map((p) => p.slip)) / speed)
        }
      }
      slips.sort((a, b) => a - b)
      expect(slips.length).toBeGreaterThan(20)
      // Diagonals mix two motions, so a little more.
      expect(slips[slips.length >> 1]).toBeLessThan(vx !== 0 && vz !== 0 ? 0.38 : 0.3)
    })
  }

  it('never snaps: starting, turning round and stopping are smooth', () => {
    const athlete = bodyOf('f1.glb')
    const c = new Controller(athlete, motions)
    let vx = 0
    let vz = 0
    let before: Float32Array | null = null
    let worst = 0
    for (let now = 0; now < 6; now += DT) {
      const goal =
        now < 1
          ? [0, 0]
          : now < 2
            ? [6, 0]
            : now < 3
              ? [-6, 0]
              : now < 4
                ? [0, -6]
                : now < 5
                  ? [3, 5]
                  : [0, 0]
      const step = 42 * DT
      const dx = goal[0]! - vx
      const dz = goal[1]! - vz
      const d = Math.hypot(dx, dz)
      const k = d > step ? step / d : 1
      vx += dx * k
      vz += dz * k
      c.update({
        now,
        delta: DT,
        vx,
        vz,
        yaw: 0,
        alert: 1,
        look: null,
        serveBall: null,
        mood: 'none',
        x: 0,
        z: 0,
      })
      const q = Float32Array.from(BONES.flatMap((b) => athlete.all.get(b)!.quaternion.toArray()))
      if (before && now > 0.3) worst = Math.max(worst, biggestTurn(before, q))
      before = q
    }
    expect(worst).toBeLessThan(0.75)
  })

  it('works the same at any frame rate', () => {
    const at = (fps: number): Vector3 => {
      const athlete = bodyOf('m2.glb')
      const c = new Controller(athlete, motions)
      ;(c as unknown as { phase: number }).phase = 0
      for (let now = 0; now < 1; now += 1 / fps) {
        c.update({
          now,
          delta: 1 / fps,
          vx: 0,
          vz: 3,
          yaw: 0,
          alert: 1,
          look: null,
          serveBall: null,
          mood: 'none',
          x: 0,
          z: 0,
        })
      }
      athlete.root.updateMatrixWorld(true)
      return athlete.all.get('foot_l')!.getWorldPosition(new Vector3())
    }
    expect(at(30).distanceTo(at(144))).toBeLessThan(0.16)
  })
})

describe('hitting', () => {
  const spots: [string, ShotInfo['contact'], Partial<ShotInfo>?][] = [
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
  for (const name of ['m1', 'f1', 'f3'] as const) {
    for (const [label, contact, extra] of spots) {
      it(`${name}: the paddle is on the ball at contact (${label})`, () => {
        const at = 1.25
        const { frames } = play(name, 2, {
          each: (now, c) => {
            if (Math.abs(now - 1) < DT / 2) c.hit(now, shot(contact, extra), at)
          },
        })
        const spot = new Vector3(contact.x, contact.y, contact.z)
        const gap = Math.min(
          ...frames
            .filter((f) => Math.abs(f.now - at) < DT * 1.1)
            .map((f) => f.paddle.distanceTo(spot)),
        )
        // Within the face of the paddle (about 18 cm across).
        expect(gap).toBeLessThan(0.14)
      })
    }
  }

  it('meets a ball the server puts elsewhere than expected', () => {
    const real = { x: -0.8, y: 1.15, z: 0.35 }
    const { frames } = play('m2', 2, {
      each: (now, c) => {
        if (Math.abs(now - 1) < DT / 2) c.hit(now, shot({ x: -0.5, y: 0.8, z: 0.6 }), 1.28)
        if (now > 1.08 && now < 1.3) c.correct(real, 1.25, now)
      },
    })
    const gap = Math.min(
      ...frames
        .filter((f) => Math.abs(f.now - 1.25) < 0.02)
        .map((f) => f.paddle.distanceTo(new Vector3(real.x, real.y, real.z))),
    )
    expect(gap).toBeLessThan(0.14)
  })

  it('hits at a full run, with the legs still running', () => {
    const contact = { x: -0.7, y: 0.9, z: 0.45 }
    const { frames } = play('m1', 2, {
      vx: -5,
      vz: 1,
      each: (now, c) => {
        if (Math.abs(now - 1) < DT / 2) c.hit(now, shot(contact), 1.2)
      },
    })
    const near = frames.filter((f) => Math.abs(f.now - 1.2) < DT * 1.1)
    expect(
      Math.min(...near.map((f) => f.paddle.distanceTo(new Vector3(-0.7, 0.9, 0.45)))),
    ).toBeLessThan(0.16)
    const stride = frames
      .filter((f) => f.now > 1 && f.now < 1.5)
      .map((f) => f.feet[0].distanceTo(f.feet[1]))
    expect(Math.max(...stride) - Math.min(...stride)).toBeGreaterThan(0.25)
  })

  it('goes back to ready after any swing, without snapping', () => {
    for (const [, contact, extra] of spots) {
      const { frames } = play('f2', 3.4, {
        each: (now, c) => {
          if (Math.abs(now - 1) < DT / 2) c.hit(now, shot(contact, extra), 1.25)
        },
      })
      const rest = frames[55]!.paddle
      expect(frames.at(-1)!.paddle.distanceTo(rest)).toBeLessThan(0.08)
      let worst = 0
      for (let i = 60; i < frames.length; i++)
        worst = Math.max(worst, biggestTurn(frames[i - 1]!.q, frames[i]!.q))
      // A swing is fast, but every joint takes several frames over it.
      expect(worst).toBeLessThan(1.3)
    }
  })

  it('jumps for a jump smash and lands again', () => {
    const { frames } = play('m3', 2.6, {
      each: (now, c) => {
        if (Math.abs(now - 1) < DT / 2)
          c.hit(now, shot({ x: -0.2, y: 2.6, z: 0.4 }, { power: 1, jump: true }), 1.22)
      },
    })
    const standing = frames[50]!.head.y
    expect(Math.max(...frames.map((f) => f.head.y))).toBeGreaterThan(standing + 0.4)
    expect(Math.abs(frames.at(-1)!.head.y - standing)).toBeLessThan(0.06)
  })

  it('never breaks, whatever it is told', () => {
    for (const bad of [
      { x: 40, y: -3, z: 9 },
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 9, z: -2 },
    ]) {
      const { frames } = play('m1', 1.6, {
        vx: 60,
        look: new Vector3(0, 0, 0),
        each: (now, c) => {
          if (Math.abs(now - 0.5) < DT / 2) c.hit(now, shot(bad, { power: 1 }), 0.4)
        },
      })
      for (const f of frames) for (const v of f.q) expect(Number.isFinite(v)).toBe(true)
    }
  })
})

describe('choosing a shot', () => {
  const pick = (c: ShotInfo['contact'], o: Partial<ShotInfo> = {}): string =>
    chooseStroke(shot(c, o))
  it('goes by side, height, speed and place', () => {
    expect(pick({ x: -0.6, y: 0.9, z: 0.5 })).toBe('forehandDrive')
    expect(pick({ x: 0.5, y: 0.9, z: 0.5 })).toBe('backhandDrive')
    expect(pick({ x: -0.4, y: 0.2, z: 0.5 })).toBe('forehandScoop')
    expect(pick({ x: 1.2, y: 0.9, z: 0.2 })).toBe('backhandReach')
    expect(pick({ x: -0.3, y: 1.2, z: 0.5 }, { volley: true })).toBe('forehandVolley')
    expect(pick({ x: 0.3, y: 1.2, z: 0.5 }, { volley: true, pace: 14 })).toBe('backhandBlock')
    expect(pick({ x: -0.3, y: 0.5, z: 0.5 }, { depth: 2.3, aimDepth: 1.5 })).toBe('forehandDink')
    expect(pick({ x: 0, y: 2, z: 0.4 }, { power: 1 })).toBe('smash')
    expect(pick({ x: 0, y: 2.5, z: 0.4 }, { power: 1, jump: true })).toBe('jumpSmash')
    expect(pick({ x: 0, y: 0.8, z: 0.4 }, { serve: true })).toBe('serve')
  })
})

describe('skeleton', () => {
  it('at rest, every joint is where the body was made', () => {
    const a = bodyOf('m1.glb')
    const fig = new Figure(a.rest).solve(new Pose())
    for (let b = 0; b < BONES.length; b++)
      expect(fig.p[b]!.distanceTo(a.rest[b]!)).toBeLessThan(1e-5)
  })
})
