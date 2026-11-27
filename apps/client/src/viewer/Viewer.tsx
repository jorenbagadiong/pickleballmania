import { Canvas, createPortal, useFrame, useThree } from '@react-three/fiber'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AxesHelper,
  type Camera,
  type Material,
  type Mesh,
  NeutralToneMapping,
  type Object3D,
  type Texture,
  Vector3,
  type WebGLRenderer,
} from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { Lights } from '../court/Arena'
import { type Athlete, loadAthlete, loadMotions } from '../players/athlete/assets'
import { Controller, type Input } from '../players/athlete/controller'
import { PADDLE_SCALE } from '../players/athlete/grip'
import type { Hand } from '../players/athlete/handedness'
import type { Motions } from '../players/athlete/locomotion'
import type { ShotInfo } from '../players/athlete/strokes'
import { type VrmAthlete, loadVrmAthlete } from '../players/athlete/vrm'
import { Paddle } from '../players/Paddle'
import { type ZoneBall, ZoneField } from '../players/zone/ZoneField'
import type { ZoneState, ZoneTarget, ZoneTier } from '../players/zone/zoneFx'
import { useUi } from '../state/store'

/*
 * Development-only character viewer (`?viewer`, in a dev build or with `?e2e`). It shows
 * one body with the game's lights, renderer settings, controller and paddle. It never
 * connects to the game server, so it can't give anyone anything in a game.
 */

const DEFAULT_VRM = '/models/private/x1.vrm'

/** TEZUKA ZONE preview: drawn here only, never in a game ('off' = not in the scene). */
type ZonePreview = 'off' | ZoneState
const ZONE_PREVIEWS: ZonePreview[] = ['off', 'inactive', 'available', 'attracting']

/** Where the preview ball is (D2): around the athlete, or flying in on a loop. */
interface BallPreview {
  distance: number
  /** Degrees round the athlete: 0 = in front (+z). */
  angle: number
  height: number
  moving: boolean
  /** Direction of the pull in degrees (0 = +x), or null: straight at the athlete. */
  pullAngle: number | null
}
const BALL_PREVIEW: BallPreview = {
  distance: 4,
  angle: 25,
  height: 0.9,
  moving: false,
  pullAngle: null,
}
/** A full approach of the moving preview ball (s). */
const FLY_IN_SECONDS = 1.8

/** The preview ball: placed from the controls, or flying in toward the athlete on a bend. */
function PreviewBall({
  at,
  paused,
  object,
}: {
  at: { current: BallPreview }
  paused: boolean
  object: { current: Mesh | null }
}) {
  const t = useRef(0)
  useFrame((_s, delta) => {
    const m = object.current
    if (!m) return
    if (!paused) t.current += Math.min(delta, 0.1)
    const b = at.current
    let distance = b.distance
    let angle = b.angle
    let height = b.height
    if (b.moving) {
      const k = (t.current % FLY_IN_SECONDS) / FLY_IN_SECONDS
      distance = 7 - 5.8 * k
      angle = b.angle + 35 * (1 - k)
      height = 0.6 + 0.9 * Math.sin(Math.PI * Math.min(1, k * 1.2))
    }
    const a = (angle * Math.PI) / 180
    m.position.set(Math.sin(a) * distance, height, Math.cos(a) * distance)
  })
  return (
    <mesh ref={object} name="preview-ball">
      <sphereGeometry args={[0.063, 20, 14]} />
      <meshStandardMaterial color="#d9f99d" roughness={0.6} />
    </mesh>
  )
}

type Anim =
  | 'idle'
  | 'ready'
  | 'walk'
  | 'run'
  | 'strafe left'
  | 'strafe right'
  | 'backpedal'
  | 'direction changes'
  | 'serve'
  | 'forehand'
  | 'backhand'
  | 'dink'
  | 'volley'
  | 'smash'
  | 'jump smash'
const ANIMS: Anim[] = [
  'idle',
  'ready',
  'walk',
  'run',
  'strafe left',
  'strafe right',
  'backpedal',
  'direction changes',
  'serve',
  'forehand',
  'backhand',
  'dink',
  'volley',
  'smash',
  'jump smash',
]

/** Where each stroke meets the ball, for a right-hander (a left-hander gets x mirrored). */
export const STROKE_SPOTS: Record<string, [ShotInfo['contact'], Partial<ShotInfo>?]> = {
  serve: [
    { x: 0, y: 0.85, z: 0.45 },
    { serve: true, power: 0.3 },
  ],
  forehand: [{ x: -0.65, y: 0.9, z: 0.5 }],
  backhand: [{ x: 0.5, y: 0.95, z: 0.55 }],
  dink: [
    { x: -0.35, y: 0.5, z: 0.6 },
    { depth: 2.4, aimDepth: 1.5 },
  ],
  volley: [{ x: -0.4, y: 1.2, z: 0.6 }, { volley: true }],
  smash: [{ x: -0.2, y: 2.1, z: 0.4 }, { power: 1 }],
  'jump smash': [
    { x: -0.2, y: 2.6, z: 0.4 },
    { power: 1, jump: true },
  ],
  'in front': [{ x: -0.1, y: 1.1, z: 0.6 }],
  low: [{ x: -0.4, y: 0.3, z: 0.6 }],
  'low backhand': [{ x: 0.45, y: 0.3, z: 0.55 }],
  'wide forehand': [{ x: -1.25, y: 0.8, z: 0.2 }],
  'wide backhand': [{ x: 1.1, y: 0.85, z: 0.3 }],
  'shoulder high': [{ x: -0.5, y: 1.5, z: 0.45 }],
}

const STROKE_EVERY = 2.2
const CONTACT_AFTER = 0.25
const TURNS: [number, number][] = [
  [0, 5],
  [5, 0],
  [0, -3],
  [-5, 0],
  [3, 3],
]

function shot(name: string, hand: Hand): ShotInfo {
  const [c, extra] = STROKE_SPOTS[name]!
  return {
    power: 0.35,
    serve: false,
    jump: false,
    volley: false,
    pace: 7,
    depth: 6,
    aimDepth: 5,
    contact: { x: hand === 'left' ? -c.x : c.x, y: c.y, z: c.z },
    ...extra,
  }
}

function inputFor(anim: Anim, t: number, hand: Hand): Partial<Input> {
  switch (anim) {
    case 'idle':
      return { alert: 0 }
    case 'walk':
      return { vz: 1.4 }
    case 'run':
      return { vz: 5 }
    case 'strafe left':
      return { vx: 2.3 }
    case 'strafe right':
      return { vx: -2.3 }
    case 'backpedal':
      return { vz: -2.5 }
    case 'direction changes': {
      const [vx, vz] = TURNS[Math.floor(t / 1.2) % TURNS.length]!
      return { vx, vz }
    }
    case 'serve': {
      // Holding the ball out in the free hand until the swing.
      const into = t % STROKE_EVERY
      return into < 1 ? { serveBall: new Vector3(hand === 'left' ? -0.25 : 0.25, 0.9, 0.45) } : {}
    }
    default:
      return {}
  }
}

export interface ModelStats {
  file: string
  loadMs: number
  triangles: number
  vertices: number
  meshes: number
  materials: number
  outlineMaterials: number
  textures: { w: number; h: number }[]
  textureMB: number
  height: number
  missing: string[]
}

/** What a body is made of, counted from its scene. */
function measure(root: Object3D): Omit<ModelStats, 'file' | 'loadMs' | 'missing' | 'height'> {
  let triangles = 0
  let vertices = 0
  let meshes = 0
  const materials = new Set<Material>()
  const outlines = new Set<Material>()
  const textures = new Set<Texture>()
  root.traverse((o) => {
    const m = o as Mesh
    if (!m.isMesh) return
    meshes++
    const g = m.geometry
    vertices += g.attributes.position?.count ?? 0
    triangles += (g.index ? g.index.count : (g.attributes.position?.count ?? 0)) / 3
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
      if ((mat as { isOutline?: boolean }).isOutline) outlines.add(mat)
      else materials.add(mat)
      for (const v of Object.values(mat))
        if ((v as Texture | null)?.isTexture) textures.add(v as Texture)
      // MToon keeps its textures in shader uniforms.
      const uniforms = (mat as { uniforms?: Record<string, { value: unknown }> }).uniforms
      for (const u of Object.values(uniforms ?? {}))
        if ((u.value as Texture | null)?.isTexture) textures.add(u.value as Texture)
    }
  })
  const dims = [...textures].map((t) => {
    const img = t.image as { width?: number; height?: number } | undefined
    return { w: img?.width ?? 0, h: img?.height ?? 0 }
  })
  // RGBA8 with mipmaps: about 4/3 of the top level.
  const bytes = dims.reduce((s, d) => s + d.w * d.h * 4 * (4 / 3), 0)
  return {
    triangles,
    vertices,
    meshes,
    materials: materials.size,
    outlineMaterials: outlines.size,
    textures: dims,
    textureMB: Math.round((bytes / 1024 / 1024) * 10) / 10,
  }
}

interface Loaded {
  athlete: Athlete
  controller: Controller
  stats: ModelStats
}

async function loadModel(file: string, hand: Hand, motions: Motions): Promise<Loaded> {
  const t0 = performance.now()
  let athlete: Athlete | null
  if (file.endsWith('.vrm')) athlete = await loadVrmAthlete(file)
  else athlete = await loadAthlete(file)
  if (!athlete) throw new Error(`${file} could not be used as a body`)
  const loadMs = performance.now() - t0
  athlete.root.traverse((o) => {
    const m = o as Mesh
    if (m.isMesh) {
      m.castShadow = true
      m.receiveShadow = true
    }
  })
  const vrm = athlete as Partial<VrmAthlete>
  return {
    athlete,
    controller: new Controller(athlete, motions, hand),
    stats: {
      file,
      loadMs: Math.round(loadMs),
      ...measure(athlete.root),
      height: Math.round((athlete.rest[5]?.y ?? 0) * 100) / 100,
      missing: vrm.missing ?? [],
    },
  }
}

const VIEWS = {
  front: [0, 1.2, 3.2],
  wide: [0, 1.6, 5],
  side: [3.2, 1.2, 0],
  back: [0, 1.2, -3.2],
  'three-quarter': [2.3, 1.4, 2.3],
  face: [0, 1.45, 0.75],
} as const
type View = keyof typeof VIEWS

/** A pose held still for inspection (set by `__VIEWER__.pose`). */
const freeze: { on: boolean; ball: Vector3 | null } = { on: false, ball: null }

/** Live timings, read by the panel and by tests. */
const timing = { frameMs: 0, renderMs: 0, controllerMs: 0, vrmMs: 0, frames: 0 }

function Body({
  loaded,
  anim,
  speed,
  paused,
  hand,
  showAxes,
}: {
  loaded: Loaded
  anim: Anim
  speed: number
  paused: boolean
  hand: Hand
  showAxes: boolean
}) {
  const t = useRef(0)
  const last = useRef(-1)
  const ball = useRef<Mesh>(null)
  const { athlete, controller } = loaded
  const mount =
    athlete.paddleMount?.(controller.paddleBone) ?? athlete.all.get(controller.paddleBone)
  const grip = controller.paddleGrip
  const axes = useMemo(() => new AxesHelper(0.12), [])
  useEffect(() => () => axes.dispose(), [axes])

  useFrame((_s, delta) => {
    if (freeze.on) {
      if (ball.current && freeze.ball) {
        ball.current.visible = true
        ball.current.position.copy(freeze.ball)
      }
      return
    }
    if (!paused) t.current += Math.min(delta, 0.1) * speed
    const now = t.current
    const stroke = STROKE_SPOTS[anim] ? anim : null
    if (stroke) {
      const round = Math.floor(now / STROKE_EVERY)
      if (round !== last.current && now % STROKE_EVERY > 1) {
        last.current = round
        controller.hit(now, shot(stroke, hand), now + CONTACT_AFTER)
      }
      const c = shot(stroke, hand).contact
      if (ball.current) {
        ball.current.visible = true
        ball.current.position.set(c.x, c.y, c.z)
      }
    } else if (ball.current) ball.current.visible = false
    const c0 = performance.now()
    controller.update({
      now,
      delta: paused ? 0 : Math.min(delta, 0.1) * speed,
      vx: 0,
      vz: 0,
      yaw: 0,
      alert: 1,
      look: null,
      serveBall: null,
      mood: 'none',
      x: 0,
      z: 0,
      ...inputFor(anim, now, hand),
    })
    const spent = performance.now() - c0
    const vrmMs = (athlete as Partial<VrmAthlete>).lastUpdateMs ?? 0
    timing.vrmMs = timing.vrmMs * 0.95 + vrmMs * 0.05
    timing.controllerMs = timing.controllerMs * 0.95 + (spent - vrmMs) * 0.05
    timing.frames++
  })

  return (
    <>
      <primitive object={athlete.root} dispose={null} />
      {mount &&
        createPortal(
          <group
            name="paddle"
            position={grip.position}
            quaternion={grip.rotation}
            scale={PADDLE_SCALE}
          >
            <Paddle faceRef={() => {}} />
            {showAxes && <primitive object={axes} />}
          </group>,
          mount,
        )}
      <mesh ref={ball} castShadow>
        <sphereGeometry args={[0.037, 20, 14]} />
        <meshStandardMaterial color="#e8f04a" />
      </mesh>
    </>
  )
}

/**
 * The camera for a view, sized to the body (`head`: the head joint's height at rest);
 * the face view looks at the head where it is now (`headNow`).
 */
function Orbit({
  view,
  head,
  headNow,
}: {
  view: View
  head: number
  headNow: () => Vector3 | null
}) {
  const { camera, gl } = useThree()
  const controls = useMemo(() => new OrbitControls(camera, gl.domElement), [camera, gl])
  useEffect(() => {
    const k = head / 1.65
    const [x, y, z] = VIEWS[view]
    if (view === 'face') {
      const h = headNow() ?? new Vector3(0, head, 0)
      // The face is a little above the head joint, which sits at the top of the neck.
      controls.target.set(h.x, h.y + 0.08, h.z)
      camera.position.set(h.x, h.y + 0.1, h.z + 0.62)
    } else {
      camera.position.set(x * k, y * k, z * k)
      controls.target.set(0, head * 0.55, 0)
    }
    controls.update()
  }, [view, camera, controls, head, headNow])
  useEffect(() => () => controls.dispose(), [controls])
  return null
}

/** Frame time and renderer counters, for the panel and tests. */
function Meter({ onGl }: { onGl: (gl: WebGLRenderer, camera: Camera) => void }) {
  const { gl, camera } = useThree()
  const last = useRef(performance.now())
  useEffect(() => {
    onGl(gl, camera)
    // How long drawing a frame takes on the main thread (the GPU's own time is not seen).
    const render = gl.render.bind(gl)
    gl.render = (scene, cam) => {
      const t0 = performance.now()
      render(scene, cam)
      timing.renderMs = timing.renderMs * 0.95 + (performance.now() - t0) * 0.05
    }
    return () => {
      gl.render = render
    }
  }, [gl, camera, onGl])
  useFrame(() => {
    const now = performance.now()
    timing.frameMs = timing.frameMs * 0.9 + (now - last.current) * 0.1
    last.current = now
  })
  return null
}

export function Viewer() {
  const params = new URLSearchParams(location.search)
  const [file, setFile] = useState(params.get('model') ?? DEFAULT_VRM)
  const [hand, setHand] = useState<Hand>((params.get('hand') as Hand) ?? 'left')
  const [anim, setAnim] = useState<Anim>('ready')
  const [view, setView] = useState<View>('three-quarter')
  const [speed, setSpeed] = useState(1)
  const [paused, setPaused] = useState(false)
  const [axes, setAxes] = useState(true)
  const [quality, setQuality] = useState({ outlines: true, springs: true })
  const shadows = useUi((s) => s.shadows)
  const [zone, setZone] = useState<ZonePreview>('off')
  const [zoneIntensity, setZoneIntensity] = useState(1)
  const [zoneTierChoice, setZoneTier] = useState<ZoneTier>('high')
  const [zoneReduced, setZoneReduced] = useState(false)
  /** D2 ribbons on (off: the D1 field alone, for comparing). */
  const [zoneRibbons, setZoneRibbons] = useState(true)
  const [ballPreview, setBallPreview] = useState<BallPreview>(BALL_PREVIEW)
  const ballAt = useRef(ballPreview)
  ballAt.current = ballPreview
  const previewBall = useRef<Mesh | null>(null)
  const zoneNow = useRef({ zone, zoneIntensity })
  zoneNow.current = { zone, zoneIntensity }
  const readZone = useCallback((): ZoneTarget => {
    const z = zoneNow.current
    if (z.zone !== 'attracting')
      return { state: z.zone === 'available' ? 'available' : 'inactive', pull: 0, dirX: 0, dirZ: 0 }
    // Pull direction: the chosen angle, or from the ball straight at the athlete.
    const b = ballAt.current
    const p = previewBall.current?.position
    let dirX = 0
    let dirZ = 0
    if (b.pullAngle !== null) {
      dirX = Math.cos((b.pullAngle * Math.PI) / 180)
      dirZ = Math.sin((b.pullAngle * Math.PI) / 180)
    } else if (p) {
      const d = Math.hypot(p.x, p.z) || 1
      dirX = -p.x / d
      dirZ = -p.z / d
    }
    return { state: 'attracting', pull: z.zoneIntensity, dirX, dirZ }
  }, [])
  const [ballSource] = useState(() => ({ object: null as unknown as Mesh, free: true }))
  const readBall = useCallback((): ZoneBall | null => {
    if (!previewBall.current) return null
    ballSource.object = previewBall.current
    return ballSource
  }, [ballSource])
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [error, setError] = useState('')
  const [, tick] = useState(0)
  const glRef = useRef<WebGLRenderer | null>(null)
  const headNow = useCallback((): Vector3 | null => {
    const head = loaded?.athlete.bones[5]
    return head ? head.getWorldPosition(new Vector3()) : null
  }, [loaded])
  const onGl = useCallback((gl: WebGLRenderer) => {
    glRef.current = gl
  }, [])
  const motions = useRef<Motions | null>(null)

  useEffect(() => {
    let gone = false
    let mine: Loaded | null = null
    setError('')
    ;(async () => {
      motions.current ??= await loadMotions()
      mine = await loadModel(file, hand, motions.current)
      if (gone) mine.athlete.dispose?.()
      else setLoaded(mine)
    })().catch((e: unknown) => setError(String(e)))
    return () => {
      gone = true
      setLoaded(null)
    }
  }, [file, hand])

  // Freed only once it is out of the scene (as the game does), or a last frame drawn with
  // it would upload it all again.
  useEffect(
    () => () => {
      // As the game does (useAthlete): a GLB body's own material copies, or all of a VRM.
      for (const m of Object.values(loaded?.athlete.materials ?? {})) m.dispose()
      loaded?.athlete.dispose?.()
    },
    [loaded],
  )

  useEffect(() => {
    ;(loaded?.athlete as Partial<VrmAthlete> | undefined)?.setQuality?.(quality)
  }, [loaded, quality])

  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 500)
    return () => clearInterval(id)
  }, [])

  // For tests and measurements (read-only apart from the viewer's own settings).
  useEffect(() => {
    Object.assign(window, {
      __VIEWER__: {
        ready: () => loaded !== null,
        error: () => error,
        stats: () => ({
          ...loaded?.stats,
          frameMs: timing.frameMs,
          renderMs: timing.renderMs,
          controllerMs: timing.controllerMs,
          vrmMs: timing.vrmMs,
          drawCalls: glRef.current?.info.render.calls,
          renderedTriangles: glRef.current?.info.render.triangles,
          memory: { ...glRef.current?.info.memory },
        }),
        set: (o: {
          anim?: Anim
          view?: View
          speed?: number
          paused?: boolean
          file?: string
          hand?: Hand
          outlines?: boolean
          springs?: boolean
          shadows?: boolean
          zone?: ZonePreview
          zoneIntensity?: number
          zoneTier?: ZoneTier
          zoneReduced?: boolean
          ball?: Partial<BallPreview>
          zoneRibbons?: boolean
        }) => {
          if (o.zoneRibbons !== undefined) setZoneRibbons(o.zoneRibbons)
          if (o.ball) setBallPreview((b) => ({ ...b, ...o.ball }))
          if (o.zone) setZone(o.zone)
          if (o.zoneIntensity !== undefined) setZoneIntensity(o.zoneIntensity)
          if (o.zoneTier) setZoneTier(o.zoneTier)
          if (o.zoneReduced !== undefined) setZoneReduced(o.zoneReduced)
          if (o.anim) setAnim(o.anim)
          if (o.view) setView(o.view)
          if (o.speed !== undefined) setSpeed(o.speed)
          if (o.paused !== undefined) setPaused(o.paused)
          if (o.file) setFile(o.file)
          if (o.hand) setHand(o.hand)
          if (o.outlines !== undefined || o.springs !== undefined)
            setQuality((q) => ({
              outlines: o.outlines ?? q.outlines,
              springs: o.springs ?? q.springs,
            }))
          if (o.shadows !== undefined) useUi.setState({ shadows: o.shadows })
        },
        /**
         * Plays every stroke at fixed steps on the loaded body, off the clock, and says
         * how far the drawn paddle's face is from the ball at contact (meters).
         */
        /**
         * Plays a stroke at fixed steps and holds the body still `after` seconds past
         * contact (negative: before it), with the ball where it is met.
         */
        pose: (stroke: string, after = 0) => {
          if (!loaded || !motions.current || !STROKE_SPOTS[stroke]) return false
          freeze.on = true
          const c = new Controller(loaded.athlete, motions.current, hand)
          // Hair starts from rest, not whipped by the jump into the new pose.
          c.update({
            now: 0,
            delta: 1 / 60,
            vx: 0,
            vz: 0,
            yaw: 0,
            alert: 1,
            look: null,
            serveBall: null,
            mood: 'none',
            x: 0,
            z: 0,
          })
          ;(loaded.athlete as Partial<VrmAthlete>).vrm?.springBoneManager?.reset()
          const s = shot(stroke, hand)
          const held = new Vector3(hand === 'left' ? -0.25 : 0.25, 0.9, 0.45)
          for (let now = 0, f = 0; now <= 1.25 + after + 1e-6; now += 1 / 60, f++) {
            if (f === 60) c.hit(now, s, 1.25)
            c.update({
              now,
              delta: 1 / 60,
              vx: 0,
              vz: 0,
              yaw: 0,
              alert: 1,
              look: null,
              serveBall: s.serve && f < 60 ? held : null,
              mood: 'none',
              x: 0,
              z: 0,
            })
          }
          freeze.ball = new Vector3(s.contact.x, s.contact.y, s.contact.z)
          return true
        },
        /** Spring bones back to rest (for a still picture right after a sudden pose). */
        settle: () => {
          ;(loaded?.athlete as Partial<VrmAthlete> | undefined)?.vrm?.springBoneManager?.reset()
        },
        /** Every texture the body's materials refer to (surface and outline), by uuid. */
        textures: () => {
          const seen = new Map<string, string>()
          loaded?.athlete.root.traverse((o) => {
            const m = (o as Mesh).material
            for (const mat of Array.isArray(m) ? m : m ? [m] : []) {
              const tag = (mat as { isOutline?: boolean }).isOutline ? 'outline' : 'surface'
              for (const v of Object.values(mat))
                if ((v as Texture | null)?.isTexture) seen.set((v as Texture).uuid, tag + ' prop')
              const u = (mat as { uniforms?: Record<string, { value: unknown }> }).uniforms
              for (const [k, x] of Object.entries(u ?? {}))
                if ((x.value as Texture | null)?.isTexture)
                  seen.set(
                    (x.value as Texture).uuid,
                    `${tag} ${k} src ${(x.value as Texture).source.uuid.slice(0, 6)}`,
                  )
            }
          })
          return [...seen.values()]
        },
        /** Back to playing the chosen animation. */
        unfreeze: () => {
          freeze.on = false
          freeze.ball = null
        },
        contacts: () => {
          if (!loaded || !motions.current) return null
          const out: Record<string, number> = {}
          for (const name of Object.keys(STROKE_SPOTS)) {
            const c = new Controller(loaded.athlete, motions.current, hand)
            const s = shot(name, hand)
            const spot = new Vector3(s.contact.x, s.contact.y, s.contact.z)
            let gap = Infinity
            for (let now = 0, f = 0; now < 2; now += 1 / 60, f++) {
              if (f === 60) c.hit(now, s, 1.25)
              c.update({
                now,
                delta: 1 / 60,
                vx: 0,
                vz: 0,
                yaw: 0,
                alert: 1,
                look: null,
                serveBall: null,
                mood: 'none',
                x: 0,
                z: 0,
              })
              if (Math.abs(now - 1.25) < 1.1 / 60) {
                const a = loaded.athlete
                a.root.updateMatrixWorld(true)
                const m = a.paddleMount?.(c.paddleBone) ?? a.all.get(c.paddleBone)!
                const at = m.localToWorld(c.paddleGrip.center.clone())
                gap = Math.min(gap, at.distanceTo(spot))
              }
            }
            out[name] = Math.round(gap * 1000) / 1000
          }
          return out
        },
      },
    })
  }, [loaded, error, hand])

  const s = loaded?.stats
  const live = glRef.current?.info
  const button = (on: boolean) =>
    `rounded px-2 py-0.5 ${on ? 'bg-lime-400 text-slate-900' : 'bg-slate-700 text-slate-100'}`
  return (
    <div className="fixed inset-0 bg-slate-200">
      <Canvas
        shadows="percentage"
        dpr={useUi.getState().dpr}
        camera={{ fov: 35, near: 0.05, far: 100, position: [2.3, 1.4, 2.3] }}
        gl={{ antialias: true, toneMapping: NeutralToneMapping, toneMappingExposure: 1 }}
      >
        <color attach="background" args={['#cfd6df']} />
        <Lights />
        <mesh rotation-x={-Math.PI / 2} receiveShadow>
          <planeGeometry args={[12, 12]} />
          <meshStandardMaterial color="#3d7cc9" roughness={0.9} />
        </mesh>
        <Orbit view={view} head={loaded?.stats.height || 1.65} headNow={headNow} />
        <Meter onGl={onGl} />
        {zone !== 'off' && (
          <>
            <ZoneField
              id="viewer"
              read={readZone}
              ball={zoneRibbons ? readBall : undefined}
              tier={zoneTierChoice}
              reducedMotion={zoneReduced}
              paused={paused}
            />
            <PreviewBall at={ballAt} paused={paused} object={previewBall} />
          </>
        )}
        {loaded && (
          <Body
            loaded={loaded}
            anim={anim}
            speed={speed}
            paused={paused}
            hand={hand}
            showAxes={axes}
          />
        )}
      </Canvas>
      <div
        data-testid="viewer-panel"
        className="absolute left-3 top-3 w-80 space-y-2 rounded-xl bg-slate-900/85 p-3 text-xs text-slate-100"
      >
        <div className="text-sm font-semibold">Character viewer (dev only)</div>
        <input
          className="w-full rounded bg-slate-800 px-2 py-1"
          defaultValue={file}
          onKeyDown={(e) => e.key === 'Enter' && setFile(e.currentTarget.value)}
        />
        <div className="flex flex-wrap gap-1">
          <button className={button(file === 'm1')} onClick={() => setFile('m1')}>
            m1 (GLB)
          </button>
          <button className={button(file === DEFAULT_VRM)} onClick={() => setFile(DEFAULT_VRM)}>
            x1.vrm
          </button>
          {(['left', 'right'] as const).map((h) => (
            <button key={h} className={button(hand === h)} onClick={() => setHand(h)}>
              {h}-handed
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1">
          {(Object.keys(VIEWS) as View[]).map((v) => (
            <button key={v} className={button(view === v)} onClick={() => setView(v)}>
              {v}
            </button>
          ))}
        </div>
        <select
          className="w-full rounded bg-slate-800 px-2 py-1"
          value={anim}
          onChange={(e) => setAnim(e.target.value as Anim)}
        >
          {ANIMS.map((a) => (
            <option key={a}>{a}</option>
          ))}
        </select>
        <div className="flex flex-wrap gap-1">
          <button className={button(paused)} onClick={() => setPaused((p) => !p)}>
            {paused ? 'paused' : 'pause'}
          </button>
          {[1, 0.5, 0.25, 0.1].map((x) => (
            <button key={x} className={button(speed === x)} onClick={() => setSpeed(x)}>
              {x}×
            </button>
          ))}
          <button className={button(axes)} onClick={() => setAxes((a) => !a)}>
            grip axes
          </button>
        </div>
        <div className="flex flex-wrap gap-1">
          <button
            className={button(quality.outlines)}
            onClick={() => setQuality((q) => ({ ...q, outlines: !q.outlines }))}
          >
            outlines
          </button>
          <button
            className={button(quality.springs)}
            onClick={() => setQuality((q) => ({ ...q, springs: !q.springs }))}
          >
            spring bones
          </button>
          <button className={button(shadows)} onClick={() => useUi.setState({ shadows: !shadows })}>
            shadows
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-1" data-testid="zone-preview">
          <span className="mr-1 font-semibold">Zone</span>
          {ZONE_PREVIEWS.map((z) => (
            <button key={z} className={button(zone === z)} onClick={() => setZone(z)}>
              {z}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {(['high', 'medium', 'low'] as const).map((t) => (
            <button key={t} className={button(zoneTierChoice === t)} onClick={() => setZoneTier(t)}>
              {t}
            </button>
          ))}
          <button className={button(zoneReduced)} onClick={() => setZoneReduced((r) => !r)}>
            reduced motion
          </button>
          <label className="flex items-center gap-1">
            pull
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={zoneIntensity}
              onChange={(e) => setZoneIntensity(Number(e.currentTarget.value))}
            />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-x-2 gap-y-1" data-testid="zone-ball">
          {(
            [
              ['ball distance', 'distance', 1, 8, 0.1],
              ['ball angle', 'angle', -180, 180, 5],
              ['ball height', 'height', 0.1, 2.2, 0.05],
            ] as const
          ).map(([label, key, min, max, step]) => (
            <label key={key} className="flex items-center gap-1">
              {label}
              <input
                type="range"
                min={min}
                max={max}
                step={step}
                value={ballPreview[key]}
                onChange={(e) =>
                  setBallPreview((b) => ({ ...b, [key]: Number(e.currentTarget.value) }))
                }
              />
            </label>
          ))}
          <label className="flex items-center gap-1">
            pull dir
            <input
              type="range"
              min={-180}
              max={180}
              step={5}
              disabled={ballPreview.pullAngle === null}
              value={ballPreview.pullAngle ?? 0}
              onChange={(e) =>
                setBallPreview((b) => ({ ...b, pullAngle: Number(e.currentTarget.value) }))
              }
            />
          </label>
          <button
            className={button(ballPreview.pullAngle === null)}
            onClick={() =>
              setBallPreview((b) => ({ ...b, pullAngle: b.pullAngle === null ? 0 : null }))
            }
          >
            pull at athlete
          </button>
          <button className={button(zoneRibbons)} onClick={() => setZoneRibbons((r) => !r)}>
            ribbons
          </button>
          <button
            className={button(ballPreview.moving)}
            onClick={() => setBallPreview((b) => ({ ...b, moving: !b.moving }))}
          >
            ball flying in
          </button>
        </div>
        {error && <div className="text-red-300">{error}</div>}
        {s && (
          <dl className="grid grid-cols-2 gap-x-2" data-testid="viewer-stats">
            <dt>load</dt>
            <dd>{s.loadMs} ms</dd>
            <dt>triangles / vertices</dt>
            <dd>
              {s.triangles.toLocaleString()} / {s.vertices.toLocaleString()}
            </dd>
            <dt>meshes / materials</dt>
            <dd>
              {s.meshes} / {s.materials} (+{s.outlineMaterials} outline)
            </dd>
            <dt>textures</dt>
            <dd>
              {s.textures.length}, ~{s.textureMB} MB
            </dd>
            <dt>height (head)</dt>
            <dd>{s.height} m</dd>
            <dt>draw calls</dt>
            <dd>{live?.render.calls}</dd>
            <dt>frame / draw (CPU)</dt>
            <dd>
              {timing.frameMs.toFixed(1)} / {timing.renderMs.toFixed(2)} ms
            </dd>
            <dt>controller / VRM</dt>
            <dd>
              {timing.controllerMs.toFixed(3)} / {timing.vrmMs.toFixed(3)} ms
            </dd>
            <dt>estimated bones</dt>
            <dd>{s.missing.length ? s.missing.join(', ') : 'none'}</dd>
          </dl>
        )}
      </div>
    </div>
  )
}
