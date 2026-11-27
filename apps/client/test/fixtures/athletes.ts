/**
 * The real model and motion files the game loads, read without a browser, for tests.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Group, Object3D, Vector3 } from 'three'
import type { Athlete } from '../../src/players/athlete/assets'
import type { Motions } from '../../src/players/athlete/locomotion'
import { BONES } from '../../src/players/athlete/skeleton'

const file = (name: string): string =>
  fileURLToPath(new URL(`../../public/models/${name}`, import.meta.url))

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

export function bodyOf(name: string): Athlete {
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

export function readMotions(): Motions {
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
