import type { VRM, VRMHumanBoneName, VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm'
import { Group, type Material, type Mesh, Object3D, Quaternion, Vector3 } from 'three'
import type { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import type { Athlete } from './assets'
import { BONES, PARENT } from './skeleton'
import { timed } from './timing'

/*
 * A VRM body (VRoid Studio's export) driven by the athletes' own controller, unchanged.
 *
 * The controller animates a hidden proxy skeleton with our bone names, built from the
 * VRM's own proportions. Each frame its pose is copied onto the VRM's normalized
 * humanoid bones (three-vrm: identity rest rotations, the same convention as ours),
 * and three-vrm's update turns that into the real, skinned skeleton, then runs the
 * constraints, expressions and spring bones. The controller never touches the VRM's
 * bones, and the VRM's raw bones are only ever set by three-vrm, so nothing is applied
 * twice.
 *
 * Rest pose: VRMs are in a T-pose; our motions are recorded relative to our A-pose
 * (upper arm 48.6° below horizontal, elbow bent about 45° so the forearm points forward
 * and down). The proxy's arms are turned into that pose at the shoulder and the elbow,
 * and every arm bone remembers the turn that took (`turns`). A VRM bone is set to the proxy bone's rotation times that turn, so the
 * mesh is never re-posed or re-skinned.
 *
 * VRM 1.0 bodies face +z with their left on +x, as ours do. VRM 0.x is not supported
 * (VRoid Studio exports 1.0); such a file is refused and the stand-in model is used.
 */

/**
 * The rest directions of the left upper arm and forearm (the right ones are mirrored),
 * measured on `m1`: the pose the captured motions are relative to.
 */
export const A_POSE_UPPER_ARM = new Vector3(0.6613, -0.7501, -0.0072).normalize()
export const A_POSE_FOREARM = new Vector3(0.5063, -0.4817, 0.7153).normalize()

const FINGER_NAMES = ['thumb', 'index', 'middle', 'ring', 'pinky'] as const
const VRM_FINGER = {
  thumb: ['ThumbMetacarpal', 'ThumbProximal', 'ThumbDistal'],
  index: ['IndexProximal', 'IndexIntermediate', 'IndexDistal'],
  middle: ['MiddleProximal', 'MiddleIntermediate', 'MiddleDistal'],
  ring: ['RingProximal', 'RingIntermediate', 'RingDistal'],
  pinky: ['LittleProximal', 'LittleIntermediate', 'LittleDistal'],
} as const

/** Finger bones, in the names the grip code uses (`index_01_l` …). */
export const FINGER_BONES: readonly string[] = (['l', 'r'] as const).flatMap((s) =>
  FINGER_NAMES.flatMap((f) => [1, 2, 3].map((k) => `${f}_0${k}_${s}`)),
)

/** Every bone of ours that has a VRM counterpart. */
export const VRM_BONE_MAP: Readonly<Record<string, VRMHumanBoneName>> = (() => {
  const map: Record<string, string> = {
    pelvis: 'hips',
    spine_01: 'spine',
    spine_02: 'chest',
    spine_03: 'upperChest',
    neck_01: 'neck',
    head: 'head',
  }
  for (const [s, side] of [
    ['l', 'left'],
    ['r', 'right'],
  ] as const) {
    Object.assign(map, {
      [`clavicle_${s}`]: `${side}Shoulder`,
      [`upperarm_${s}`]: `${side}UpperArm`,
      [`lowerarm_${s}`]: `${side}LowerArm`,
      [`hand_${s}`]: `${side}Hand`,
      [`thigh_${s}`]: `${side}UpperLeg`,
      [`calf_${s}`]: `${side}LowerLeg`,
      [`foot_${s}`]: `${side}Foot`,
      [`ball_${s}`]: `${side}Toes`,
    })
    for (const f of FINGER_NAMES)
      VRM_FINGER[f].forEach((v, k) => (map[`${f}_0${k + 1}_${s}`] = `${side}${v}`))
  }
  return map as Record<string, VRMHumanBoneName>
})()

/** Each finger bone's parent: the hand, or the joint before it. */
function fingerParent(name: string): string {
  const [f, k, s] = name.split('_') as [string, string, string]
  return k === '01' ? `hand_${s}` : `${f}_0${Number(k) - 1}_${s}`
}

const ALL = [...BONES, ...FINGER_BONES]
const parentOf = (name: string): string | null => {
  const i = BONES.indexOf(name as (typeof BONES)[number])
  if (i >= 0) return PARENT[i]! >= 0 ? BONES[PARENT[i]!]! : null
  return fingerParent(name)
}

export interface VrmQuality {
  /** Hair and clothing move (spring bones). */
  springs: boolean
  /** MToon's toon outlines. */
  outlines: boolean
}

export interface VrmAthlete extends Athlete {
  vrm: VRM
  /** Bones the VRM doesn't have, placed by estimate and not driven. */
  missing: string[]
  /** The rest turn of each bone, from the VRM's T-pose into our A-pose. */
  turns: ReadonlyMap<string, Quaternion>
  setQuality(q: VrmQuality): void
  /** The time the last frame's VRM update took (ms), spring bones included. */
  lastUpdateMs: number
}

const qa = new Quaternion()
const va = new Vector3()

/** Where each of our bones is at rest on this VRM, in its T-pose, and what it lacks. */
function tPoseRest(vrm: VRM): { at: Map<string, Vector3>; missing: string[] } {
  const humanoid = vrm.humanoid
  humanoid.resetNormalizedPose()
  vrm.scene.updateMatrixWorld(true)
  const toScene = vrm.scene.matrixWorld.clone().invert()
  const at = new Map<string, Vector3>()
  const missing: string[] = []
  for (const name of ALL) {
    const node = humanoid.getNormalizedBoneNode(VRM_BONE_MAP[name]!)
    if (node) at.set(name, node.getWorldPosition(new Vector3()).applyMatrix4(toScene))
    else missing.push(name)
  }
  const get = (n: string) => at.get(n)!
  const fill = (n: string, v: () => Vector3) => {
    if (!at.has(n)) at.set(n, v())
  }
  // The VRM requires hips, spine, head, both legs and both arms; the rest is optional.
  fill('spine_02', () => get('spine_01').clone().lerp(get('head'), 0.3))
  fill('spine_03', () => get('spine_02').clone().lerp(get('head'), 0.4))
  fill('neck_01', () => get('spine_03').clone().lerp(get('head'), 0.6))
  for (const s of ['l', 'r']) {
    fill(`clavicle_${s}`, () => {
      const v = get('spine_03')
        .clone()
        .lerp(get(`upperarm_${s}`), 0.35)
      v.y = get(`upperarm_${s}`).y
      return v
    })
    fill(`ball_${s}`, () =>
      get(`foot_${s}`)
        .clone()
        .add(va.set(0, -get(`foot_${s}`).y + 0.03, 0.12)),
    )
    // Missing fingers: along the arm from the hand, so the grip still has a palm.
    const along = get(`hand_${s}`)
      .clone()
      .sub(get(`lowerarm_${s}`))
      .normalize()
    FINGER_NAMES.forEach((f, i) => {
      const spread = (i - 2) * 0.018
      ;[0.03, 0.065, 0.09].forEach((d, k) =>
        fill(`${f}_0${k + 1}_${s}`, () =>
          get(`hand_${s}`)
            .clone()
            .addScaledVector(along, (f === 'thumb' ? 0.4 : 1) * (d + 0.04))
            .add(va.set(0, f === 'thumb' ? -0.02 : 0, spread)),
        ),
      )
    })
  }
  return { at, missing }
}

/** Every bone below `root` (and `root` itself). */
function subtree(root: string): string[] {
  const out = [root]
  for (let i = 0; i < out.length; i++) for (const n of ALL) if (parentOf(n) === out[i]) out.push(n)
  return out
}

/** Lowers the arms from the T-pose into our A-pose; returns each bone's rest turn. */
function intoAPose(at: Map<string, Vector3>): Map<string, Quaternion> {
  const turns = new Map(ALL.map((n) => [n, new Quaternion()]))
  for (const [s, out] of [
    ['l', 1],
    ['r', -1],
  ] as const) {
    for (const [joint, next, dir] of [
      [`upperarm_${s}`, `lowerarm_${s}`, A_POSE_UPPER_ARM],
      [`lowerarm_${s}`, `hand_${s}`, A_POSE_FOREARM],
    ] as const) {
      const pivot = at.get(joint)!.clone()
      const from = at.get(next)!.clone().sub(pivot).normalize()
      const to = dir.clone().setX(out * dir.x)
      const turn = new Quaternion().setFromUnitVectors(from, to)
      for (const n of subtree(joint)) {
        if (n !== joint) at.get(n)!.sub(pivot).applyQuaternion(turn).add(pivot)
        turns.get(n)!.premultiply(turn)
      }
    }
  }
  return turns
}

/** The VRM body with its proxy skeleton, ready for the controller. */
export function vrmAthlete(vrm: VRM): VrmAthlete {
  const { at, missing } = tPoseRest(vrm)
  const turns = intoAPose(at)
  const proxyRoot = new Group()
  proxyRoot.name = 'proxy'
  const proxy = new Map<string, Object3D>()
  for (const name of ALL) {
    const o = new Object3D()
    o.name = name
    const parent = parentOf(name)
    o.position.copy(at.get(name)!)
    if (parent) o.position.sub(at.get(parent)!)
    ;(parent ? proxy.get(parent)! : proxyRoot).add(o)
    proxy.set(name, o)
  }
  proxyRoot.updateMatrixWorld(true)

  const humanoid = vrm.humanoid
  // Parents before children: the VRM's own order is BONES, then the fingers.
  const driven = ALL.flatMap((name) => {
    const node = humanoid.getNormalizedBoneNode(VRM_BONE_MAP[name]!)
    return node ? [{ name, node, bone: proxy.get(name)!, turn: turns.get(name)! }] : []
  })
  const hips = humanoid.getNormalizedBoneNode('hips')!
  const world = new Map<Object3D, Quaternion>(driven.map((d) => [d.node, new Quaternion()]))
  const mounts = new Map<string, Object3D>()
  const quality: VrmQuality = { springs: true, outlines: true }
  let first = true

  const outlines = (): Material[] => {
    const list: Material[] = []
    vrm.scene.traverse((o) => {
      const m = (o as Mesh).material
      if (Array.isArray(m))
        for (const x of m) if ((x as { isOutline?: boolean }).isOutline) list.push(x)
    })
    return list
  }

  const athlete: VrmAthlete = {
    root: vrm.scene as Group,
    bones: BONES.map((b) => proxy.get(b)!),
    rest: BONES.map((b) => at.get(b)!.clone()),
    all: proxy,
    materials: {},
    vrm,
    missing,
    turns,
    lastUpdateMs: 0,

    paddleMount(bone) {
      let m = mounts.get(bone)
      if (!m) {
        const hand = humanoid.getNormalizedBoneNode(VRM_BONE_MAP[bone]!)
        if (!hand) return undefined
        // The proxy hand's frame, inside the VRM's normalized hand.
        m = new Object3D()
        m.name = bone
        m.quaternion.copy(turns.get(bone)!).invert()
        hand.add(m)
        mounts.set(bone, m)
      }
      return m
    },

    afterPose(delta) {
      const t0 = performance.now()
      proxyRoot.updateMatrixWorld(true)
      for (const d of driven) {
        const w = world.get(d.node)!
        d.bone.getWorldQuaternion(w).multiply(d.turn)
        const parent = d.node.parent ? world.get(d.node.parent) : undefined
        d.node.quaternion.copy(parent ? qa.copy(parent).invert().multiply(w) : w)
      }
      hips.position.copy(proxy.get('pelvis')!.position)
      if (quality.springs) vrm.update(delta)
      else {
        humanoid.update()
        vrm.lookAt?.update(delta)
        vrm.expressionManager?.update()
        vrm.nodeConstraintManager?.update()
      }
      if (first) {
        // Hair starts hanging from where the body is, not from the T-pose.
        vrm.springBoneManager?.reset()
        first = false
      }
      athlete.lastUpdateMs = performance.now() - t0
    },

    setQuality(q) {
      quality.springs = q.springs
      quality.outlines = q.outlines
      for (const m of outlines()) m.visible = q.outlines
    },

    dispose() {
      for (const m of mounts.values()) m.removeFromParent()
      disposeTree(vrm.scene)
    },
  }
  return athlete
}

/** Frees every geometry, material and texture under `root` (each VRM body is its own). */
export function disposeTree(root: Object3D): void {
  const textures = new Set<{ dispose(): void }>()
  const keep = (value: unknown) => {
    const t = value as { isTexture?: boolean; dispose?: () => void } | null
    if (t?.isTexture && t.dispose) textures.add(t as { dispose(): void })
  }
  const skeletons = new Set<{ dispose(): void }>()
  root.traverse((o) => {
    const mesh = o as Mesh
    mesh.geometry?.dispose()
    // A skinned mesh's bone matrices live in a texture of the skeleton's own.
    const skeleton = (o as { skeleton?: { dispose(): void } }).skeleton
    if (skeleton) skeletons.add(skeleton)
    const materials = Array.isArray(mesh.material)
      ? mesh.material
      : mesh.material
        ? [mesh.material]
        : []
    for (const m of materials) {
      for (const value of Object.values(m)) keep(value)
      // MToon keeps its textures in shader uniforms, not as properties.
      const uniforms = (m as { uniforms?: Record<string, { value: unknown }> }).uniforms
      for (const u of Object.values(uniforms ?? {})) keep(u.value)
      m.dispose()
    }
  })
  for (const t of textures) t.dispose()
  for (const k of skeletons) k.dispose()
}

/**
 * Loads a VRM file as an athlete, or null if it is missing, not a glTF file, not a VRM
 * 1.0 humanoid, or broken. three-vrm is only downloaded when a VRM file exists.
 */
export async function loadVrmAthlete(url: string): Promise<VrmAthlete | null> {
  if (refused.has(url)) return null
  const [buffer, libraries] = await Promise.all([
    timed('pb:vrm:download', fetchModel(url)),
    timed('pb:vrm:library', loadLibraries()),
  ])
  if (!buffer) return null
  try {
    const { GLTFLoader, VRMLoaderPlugin, VRMUtils } = libraries
    const loader = new GLTFLoader()
    loader.register((parser) => new VRMLoaderPlugin(parser))
    const gltf = await timed('pb:vrm:parse', loader.parseAsync(buffer, ''))
    const vrm = gltf.userData.vrm as VRM | undefined
    if (!vrm?.humanoid || vrm.meta.metaVersion !== '1') {
      disposeTree(gltf.scene)
      refused.add(url)
      return null
    }
    const t0 = performance.now()
    VRMUtils.removeUnnecessaryVertices(gltf.scene)
    VRMUtils.combineSkeletons(gltf.scene)
    vrm.scene.traverse((o) => (o.frustumCulled = false))
    const athlete = vrmAthlete(vrm)
    performance.measure('pb:vrm:setup', { start: t0, end: performance.now() })
    return athlete
  } catch (e) {
    console.warn('[pickleball] VRM model could not be used', e)
    refused.add(url)
    return null
  }
}

let libraries: Promise<{
  GLTFLoader: typeof GLTFLoader
  VRMLoaderPlugin: typeof VRMLoaderPlugin
  VRMUtils: typeof VRMUtils
}> | null = null

/** The glTF loader and three-vrm, downloaded once, only when a VRM is about to be used. */
function loadLibraries() {
  libraries ??= Promise.all([
    import('three/addons/loaders/GLTFLoader.js'),
    import('@pixiv/three-vrm'),
  ]).then(([gltf, vrm]) => ({
    GLTFLoader: gltf.GLTFLoader,
    VRMLoaderPlugin: vrm.VRMLoaderPlugin,
    VRMUtils: vrm.VRMUtils,
  }))
  return libraries
}

/** Files found not to be usable: not parsed again on this page. */
const refused = new Set<string>()
const fetched = new Map<string, Promise<ArrayBuffer | null>>()

/** The file, once per page, or null if it isn't a glTF binary (a 404 page, say). */
function fetchModel(url: string): Promise<ArrayBuffer | null> {
  let p = fetched.get(url)
  if (!p) {
    p = fetch(url)
      .then(async (r) => {
        if (!r.ok) return null
        const b = await r.arrayBuffer()
        return b.byteLength > 12 && new TextDecoder().decode(b.slice(0, 4)) === 'glTF' ? b : null
      })
      .catch(() => null)
    fetched.set(url, p)
  }
  return p
}
