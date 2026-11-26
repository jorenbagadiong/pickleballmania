import { ATHLETES, type Look, SECRET_LOOK, resolveLook } from '@pickleball/shared'
import { type Bone, Group, type Material, type Object3D, type SkinnedMesh, Vector3 } from 'three'
import { type GLTF, GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { clone } from 'three/addons/utils/SkeletonUtils.js'
import { BONES, type Motion, type Rest } from './skeleton'
import type { Motions } from './locomotion'

/** The people players can look like (see tools/characters). */
export { ATHLETES }

const loader = new GLTFLoader()
const load = (file: string): Promise<GLTF> => loader.loadAsync(`/models/${file}`)

let motions: Promise<Motions> | null = null

/** Loaded once, shared by everyone. */
export function loadMotions(): Promise<Motions> {
  motions ??= Promise.all([
    load('motions.glb'),
    fetch('/models/motions.json').then(
      (r) =>
        r.json() as Promise<
          Record<string, { seconds: number; loop: boolean; velocity: [number, number] }>
        >,
    ),
  ]).then(([gltf, info]) => {
    const out: Motions = {}
    const rest = new Map<string, Vector3>()
    gltf.scene.updateMatrixWorld(true)
    gltf.scene.traverse((o) => rest.set(o.name, o.getWorldPosition(new Vector3())))
    const pelvisRest = rest.get('pelvis') ?? new Vector3()
    for (const clip of gltf.animations) {
      const meta = info[clip.name]
      const first = clip.tracks[0]
      if (!meta || !first) continue
      const frames = first.times.length
      const q = new Float32Array(frames * BONES.length * 4)
      const pelvis = new Float32Array(frames * 3)
      BONES.forEach((bone, b) => {
        const t = clip.tracks.find((x) => x.name === `${bone}.quaternion`)
        for (let f = 0; f < frames; f++) {
          for (let e = 0; e < 4; e++) {
            q[(f * BONES.length + b) * 4 + e] = t
              ? (t.values[f * 4 + e] as number)
              : e === 3
                ? 1
                : 0
          }
        }
      })
      const t = clip.tracks.find((x) => x.name === 'pelvis.position')
      for (let f = 0; f < frames && t; f++) {
        pelvis[f * 3] = (t.values[f * 3] as number) - pelvisRest.x
        pelvis[f * 3 + 1] = (t.values[f * 3 + 1] as number) - pelvisRest.y
        pelvis[f * 3 + 2] = (t.values[f * 3 + 2] as number) - pelvisRest.z
      }
      out[clip.name] = {
        name: clip.name,
        frames,
        seconds: meta.seconds,
        loop: meta.loop,
        velocity: { x: meta.velocity[0], z: meta.velocity[1] },
        q,
        pelvis,
      } satisfies Motion
    }
    return out
  })
  return motions
}

const templates = new Map<string, Promise<GLTF>>()

/**
 * The secret developer athlete has no model of its own yet: until it does, it is drawn
 * as this public one (see docs/tezuka.md).
 */
export const SECRET_LOOK_FALLBACK = 'm1' satisfies (typeof ATHLETES)[number]

/** The model file a look is drawn with. */
export function modelFor(look: string): string {
  return look === SECRET_LOOK ? SECRET_LOOK_FALLBACK : look
}

function template(name: string): Promise<GLTF> {
  const file = modelFor(name)
  let t = templates.get(file)
  if (!t) {
    t = load(`${file}.glb`)
    templates.set(file, t)
    // A failed download may be tried again.
    t.catch(() => templates.delete(file))
  }
  return t
}

/**
 * Starts downloading everyone in the background, so nobody has to wait (or the
 * game stutter) when a player joins or a match starts. Failures are left for the
 * player's own load to report.
 */
export function preloadAthletes(): void {
  loadMotions().catch(() => {})
  for (const name of ATHLETES) template(name).catch(() => {})
}

/** One person on court: their own skeleton and shirt, sharing shapes and pictures. */
export interface Athlete {
  root: Group
  bones: Object3D[]
  rest: Rest
  all: Map<string, Object3D>
  materials: Record<string, Material>
}

export async function loadAthlete(name: string): Promise<Athlete> {
  const gltf = await template(name)
  const root = clone(gltf.scene) as Group
  const all = new Map<string, Object3D>()
  const materials: Record<string, Material> = {}
  const own = new Map<Material, Material>()
  root.updateMatrixWorld(true)
  root.traverse((o) => {
    if ((o as Bone).isBone) all.set(o.name, o)
    const mesh = o as SkinnedMesh
    if (!mesh.isSkinnedMesh) return
    // Bones move far from where the shape was measured; never cull by that.
    mesh.frustumCulled = false
    const m = mesh.material as Material
    const copy = own.get(m) ?? m.clone()
    own.set(m, copy)
    mesh.material = copy
    materials[m.name] = copy
  })
  const inverse = root.matrixWorld.clone().invert()
  const rest = BONES.map((b) => {
    const bone = all.get(b)
    return bone ? bone.getWorldPosition(new Vector3()).applyMatrix4(inverse) : new Vector3()
  })
  return {
    root,
    bones: BONES.map((b) => all.get(b) ?? new Group()),
    rest,
    all,
    materials,
  }
}

/**
 * Who everyone on a court looks like: whoever they chose, and otherwise by name, but
 * not like anyone else on the court while there are enough people to go round. `look`
 * comes from the server, which alone can give the secret one.
 */
export function castFor(
  players: readonly { id: string; nickname: string; look?: string }[],
): Map<string, Look> {
  const out = new Map<string, Look>()
  const taken = new Set<string>()
  for (const p of players) {
    const chosen = resolveLook(p.look)
    if (chosen) {
      out.set(p.id, chosen)
      // Nobody else looks like the model the secret athlete is drawn with, either.
      taken.add(modelFor(chosen))
    }
  }
  for (const p of players) {
    if (out.has(p.id)) continue
    let i = ATHLETES.indexOf(athleteFor(p.nickname))
    for (let k = 0; k < ATHLETES.length && taken.has(ATHLETES[i]!); k++)
      i = (i + 1) % ATHLETES.length
    const name = ATHLETES[i]!
    taken.add(name)
    out.set(p.id, name)
  }
  return out
}

/** Same name, same person on everyone's screen. */
export function athleteFor(nickname: string): (typeof ATHLETES)[number] {
  let h = 7
  for (let i = 0; i < nickname.length; i++) h = (h * 31 + nickname.charCodeAt(i)) >>> 0
  return ATHLETES[h % ATHLETES.length] ?? ATHLETES[0]
}
