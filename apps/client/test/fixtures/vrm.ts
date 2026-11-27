/**
 * A small VRM 1.0 humanoid made in code, for tests: `m1`'s skeleton raised into a
 * T-pose (as VRoid exports), with VRoid-like non-identity rest rotations on many raw
 * bones, a skinned box per bone, an MToon material with outlines, and one spring-bone
 * chain of "hair". No textures, so it loads without a browser.
 */
import { Matrix4, Quaternion, Vector3 } from 'three'
import { BONES, PARENT } from '../../src/players/athlete/skeleton'
import { FINGER_BONES, VRM_BONE_MAP } from '../../src/players/athlete/vrm'
import { bodyOf } from './athletes'

export interface SyntheticOptions {
  /** VRM humanoid bones to leave out (optional ones only). */
  drop?: string[]
  /** 'none': a plain glTF; '0': an old VRM 0.x file. */
  kind?: '1' | '0' | 'none'
}

const ALL = [...BONES, ...FINGER_BONES]
function parentOf(name: string): string | null {
  const i = BONES.indexOf(name as (typeof BONES)[number])
  if (i >= 0) return PARENT[i]! >= 0 ? BONES[PARENT[i]!]! : null
  const [f, k, s] = name.split('_') as [string, string, string]
  return k === '01' ? `hand_${s}` : `${f}_0${Number(k) - 1}_${s}`
}
function subtree(root: string): string[] {
  const out = [root]
  for (let i = 0; i < out.length; i++) for (const n of ALL) if (parentOf(n) === out[i]) out.push(n)
  return out
}

/** `m1`'s joints in its A-pose, then with the arms straightened and raised: a T-pose. */
export function tPoseOfM1(): Map<string, Vector3> {
  const a = bodyOf('m1.glb')
  const at = new Map(ALL.map((n) => [n, a.all.get(n)!.getWorldPosition(new Vector3())]))
  for (const s of ['l', 'r']) {
    for (const [joint, next] of [
      [`lowerarm_${s}`, `hand_${s}`],
      [`upperarm_${s}`, `lowerarm_${s}`],
    ] as const) {
      const pivot = at.get(joint)!.clone()
      const from = at.get(next)!.clone().sub(pivot).normalize()
      // Straight along the arm above, then level.
      const to = joint.startsWith('lower')
        ? pivot
            .clone()
            .sub(at.get(`upperarm_${s}`)!)
            .normalize()
        : new Vector3(Math.sign(from.x), 0, from.z).normalize()
      const turn = new Quaternion().setFromUnitVectors(from, to)
      for (const n of subtree(joint))
        if (n !== joint) at.get(n)!.sub(pivot).applyQuaternion(turn).add(pivot)
    }
  }
  return at
}

/** A rest rotation like VRoid gives raw bones (any will do: the positions don't move). */
function rawRest(name: string): Quaternion {
  let h = 0
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 997
  if (h % 3 === 0) return new Quaternion()
  return new Quaternion().setFromAxisAngle(
    new Vector3(h % 5, 1, (h % 7) - 3).normalize(),
    (h % 13) / 7,
  )
}

export function syntheticVrm(o: SyntheticOptions = {}): ArrayBuffer {
  const kind = o.kind ?? '1'
  const at = tPoseOfM1()
  const vrmName = (n: string) => VRM_BONE_MAP[n]!
  const keep = ALL.filter((n) => !o.drop?.includes(vrmName(n)))
  const extra = ['hair_1', 'hair_2']
  at.set(
    'hair_1',
    at
      .get('head')!
      .clone()
      .add(new Vector3(0, 0.12, -0.06)),
  )
  at.set(
    'hair_2',
    at
      .get('hair_1')!
      .clone()
      .add(new Vector3(0, -0.1, -0.02)),
  )
  const names = [...keep, ...extra]
  const index = new Map(names.map((n, i) => [n, i + 1]))
  /** The nearest kept ancestor (VRM bones may be missing in between). */
  const parentKept = (n: string): string | null => {
    if (n === 'hair_1') return 'head'
    if (n === 'hair_2') return 'hair_1'
    let p = parentOf(n)
    while (p && !index.has(p)) p = parentOf(p)
    return p
  }
  const worldRot = new Map(names.map((n) => [n, rawRest(n)]))

  const nodes: Record<string, unknown>[] = [{ name: 'Root', children: [] as number[] }]
  for (const n of names) {
    const p = parentKept(n)
    const pr = p ? worldRot.get(p)! : new Quaternion()
    const local = at
      .get(n)!
      .clone()
      .sub(p ? at.get(p)! : new Vector3())
      .applyQuaternion(pr.clone().invert())
    const r = pr.clone().invert().multiply(worldRot.get(n)!)
    nodes.push({ name: n, translation: local.toArray(), rotation: r.toArray(), children: [] })
    ;(nodes[p ? index.get(p)! : 0]!.children as number[]).push(index.get(n)!)
  }
  const meshNode = nodes.length
  nodes.push({ name: 'Body', mesh: 0, skin: 0 })
  ;(nodes[0]!.children as number[]).push(meshNode)

  // One small box per joint, all of it on that joint.
  const pos: number[] = []
  const joints: number[] = []
  const weights: number[] = []
  const idx: number[] = []
  names.forEach((n, j) => {
    const c = at.get(n)!
    const base = pos.length / 3
    for (let k = 0; k < 8; k++) {
      pos.push(
        c.x + (k & 1 ? 0.015 : -0.015),
        c.y + (k & 2 ? 0.015 : -0.015),
        c.z + (k & 4 ? 0.015 : -0.015),
      )
      joints.push(j, 0, 0, 0)
      weights.push(1, 0, 0, 0)
    }
    for (const [a, b, d, e] of [
      [0, 1, 3, 2],
      [4, 6, 7, 5],
      [0, 4, 5, 1],
      [2, 3, 7, 6],
      [0, 2, 6, 4],
      [1, 5, 7, 3],
    ] as const)
      idx.push(base + a, base + b, base + d, base + a, base + d, base + e)
  })
  const ibm: number[] = []
  for (const n of names)
    ibm.push(
      ...new Matrix4().compose(at.get(n)!, worldRot.get(n)!, new Vector3(1, 1, 1)).invert()
        .elements,
    )

  // Binary chunk: positions, joints, weights, indices, inverse binds.
  const parts: ArrayBuffer[] = [
    new Float32Array(pos).buffer,
    new Uint16Array(joints).buffer,
    new Float32Array(weights).buffer,
    new Uint16Array(idx.length % 2 ? [...idx, 0] : idx).buffer,
    new Float32Array(ibm).buffer,
  ]
  const views: { byteOffset: number; byteLength: number }[] = []
  let offset = 0
  for (const p of parts) {
    views.push({ byteOffset: offset, byteLength: p.byteLength })
    offset += Math.ceil(p.byteLength / 4) * 4
  }
  const bin = new Uint8Array(offset)
  parts.forEach((p, i) => bin.set(new Uint8Array(p), views[i]!.byteOffset))
  const min = [0, 1, 2].map((k) => Math.min(...pos.filter((_, i) => i % 3 === k)))
  const max = [0, 1, 2].map((k) => Math.max(...pos.filter((_, i) => i % 3 === k)))

  const humanBones = Object.fromEntries(keep.map((n) => [vrmName(n), { node: index.get(n)! }]))
  const json: Record<string, unknown> = {
    asset: { version: '2.0', generator: 'pickleball test fixture' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes,
    meshes: [
      {
        primitives: [
          { attributes: { POSITION: 0, JOINTS_0: 1, WEIGHTS_0: 2 }, indices: 3, material: 0 },
        ],
      },
    ],
    skins: [{ joints: names.map((n) => index.get(n)!), inverseBindMatrices: 4 }],
    buffers: [{ byteLength: bin.byteLength }],
    bufferViews: views.map((v) => ({ buffer: 0, ...v })),
    accessors: [
      { bufferView: 0, componentType: 5126, count: pos.length / 3, type: 'VEC3', min, max },
      { bufferView: 1, componentType: 5123, count: joints.length / 4, type: 'VEC4' },
      { bufferView: 2, componentType: 5126, count: weights.length / 4, type: 'VEC4' },
      { bufferView: 3, componentType: 5123, count: idx.length, type: 'SCALAR' },
      { bufferView: 4, componentType: 5126, count: names.length, type: 'MAT4' },
    ],
    materials: [
      {
        name: 'Body (MToon)',
        pbrMetallicRoughness: { baseColorFactor: [0.9, 0.8, 0.7, 1] },
        extensions:
          kind === '1'
            ? {
                VRMC_materials_mtoon: {
                  specVersion: '1.0',
                  shadeColorFactor: [0.7, 0.5, 0.45],
                  outlineWidthMode: 'worldCoordinates',
                  outlineWidthFactor: 0.004,
                  outlineColorFactor: [0.1, 0.1, 0.15],
                },
              }
            : {},
      },
    ],
  }
  if (kind === '1') {
    json.extensionsUsed = ['VRMC_vrm', 'VRMC_materials_mtoon', 'VRMC_springBone']
    json.extensions = {
      VRMC_vrm: {
        specVersion: '1.0',
        meta: {
          name: 'Synthetic test body',
          version: '1',
          authors: ['pickleball tests'],
          licenseUrl: 'https://vrm.dev/licenses/1.0/',
          avatarPermission: 'onlyAuthor',
          commercialUsage: 'personalNonProfit',
          creditNotation: 'required',
          modification: 'prohibited',
          allowRedistribution: false,
        },
        humanoid: { humanBones },
      },
      VRMC_springBone: {
        specVersion: '1.0',
        colliders: [],
        colliderGroups: [],
        springs: [
          {
            name: 'hair',
            joints: extra.map((n) => ({
              node: index.get(n)!,
              hitRadius: 0.02,
              stiffness: 0.6,
              gravityPower: 0.2,
              gravityDir: [0, -1, 0],
              dragForce: 0.3,
            })),
          },
        ],
      },
    }
  } else if (kind === '0') {
    json.extensionsUsed = ['VRM']
    json.extensions = {
      VRM: {
        specVersion: '0.0',
        meta: { title: 'Old', version: '1', author: 'tests' },
        humanoid: {
          humanBones: Object.entries(humanBones).map(([bone, v]) => ({ bone, node: v.node })),
        },
      },
    }
  }

  const text = new TextEncoder().encode(JSON.stringify(json))
  const jsonLength = Math.ceil(text.length / 4) * 4
  const out = new Uint8Array(12 + 8 + jsonLength + 8 + bin.byteLength)
  const dv = new DataView(out.buffer)
  dv.setUint32(0, 0x46546c67, true)
  dv.setUint32(4, 2, true)
  dv.setUint32(8, out.byteLength, true)
  dv.setUint32(12, jsonLength, true)
  dv.setUint32(16, 0x4e4f534a, true)
  out.fill(0x20, 20, 20 + jsonLength)
  out.set(text, 20)
  dv.setUint32(20 + jsonLength, bin.byteLength, true)
  dv.setUint32(24 + jsonLength, 0x004e4942, true)
  out.set(bin, 28 + jsonLength)
  return out.buffer
}
