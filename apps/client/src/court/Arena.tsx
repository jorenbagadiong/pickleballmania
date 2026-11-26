import { useFrame } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import {
  CanvasTexture,
  CapsuleGeometry,
  Color,
  type InstancedMesh,
  Object3D,
  RepeatWrapping,
  SRGBColorSpace,
  Vector3,
} from 'three'
import { frame } from '../game/frame'
import { loft, merged, piece, rings } from '../players/sculpt'
import { useUi } from '../state/store'
import { APRON_HALF_LENGTH, APRON_HALF_WIDTH } from './Court'
import { HALL_HALF_LENGTH, HALL_HALF_WIDTH, extraHalfWidth, hallHeight, hallX } from './layout'

const WALL = '#e4e8ea'
const WALL_PAD = '#2f5f9e'
const BOARD_HEIGHT = 0.8
const STEPS = 4
const STEP_RISE = 0.55
const STEP_DEPTH = 0.95
const STAND_X = 9
const STAND_HALF_LENGTH = 11
const SEAT_GAP = 0.85
const CHEER_SECONDS = 2.4
const SHIRTS = ['#e2574c', '#f2b134', '#4fa3d1', '#6bbf59', '#f4f1ea', '#9b6bd3', '#30475e']
const SKINS = ['#f1c27d', '#c68642', '#8d5524', '#e0ac69']

/** Deterministic pseudo-random numbers so the hall is identical for everyone. */
function rand(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453
  return x - Math.floor(x)
}

/** Maple-style floorboards. */
function makeFloorTexture(halfWidth: number): CanvasTexture {
  const w = 256
  const h = 512
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const g = canvas.getContext('2d')
  if (g) {
    const boards = 8
    const bw = w / boards
    for (let i = 0; i < boards; i++) {
      const cut = Math.floor(rand(i + 5) * h)
      for (const [part, y0, y1] of [
        [0, 0, cut],
        [1, cut, h],
      ] as const) {
        const l = 60 + rand(i * 3 + part) * 8
        g.fillStyle = `hsl(33 48% ${l}%)`
        g.fillRect(i * bw, y0, bw, y1 - y0)
      }
      g.fillStyle = 'rgba(90, 55, 20, 0.35)'
      g.fillRect(i * bw, 0, 1, h)
      g.fillRect(i * bw, cut, bw, 1)
    }
  }
  const tex = new CanvasTexture(canvas)
  tex.colorSpace = SRGBColorSpace
  tex.wrapS = RepeatWrapping
  tex.wrapT = RepeatWrapping
  tex.repeat.set((halfWidth * 2) / 1.6, (HALL_HALF_LENGTH * 2) / 3.2)
  tex.anisotropy = 8
  return tex
}

function Floor({ halfWidth }: { halfWidth: number }) {
  const texture = useMemo(() => makeFloorTexture(halfWidth), [halfWidth])
  useEffect(() => () => texture.dispose(), [texture])
  return (
    <mesh rotation-x={-Math.PI / 2} position={[0, -0.01, 0]} receiveShadow>
      <planeGeometry args={[halfWidth * 2, HALL_HALF_LENGTH * 2]} />
      <meshStandardMaterial map={texture} roughness={0.55} />
    </mesh>
  )
}

/** Walls with crash pads below and a row of high windows, plus the ceiling. */
function Shell({ halfWidth, height }: { halfWidth: number; height: number }) {
  const walls = [
    { key: 'n', pos: [0, -HALL_HALF_LENGTH] as const, w: halfWidth * 2, rot: 0 },
    { key: 's', pos: [0, HALL_HALF_LENGTH] as const, w: halfWidth * 2, rot: Math.PI },
    { key: 'w', pos: [-halfWidth, 0] as const, w: HALL_HALF_LENGTH * 2, rot: Math.PI / 2 },
    { key: 'e', pos: [halfWidth, 0] as const, w: HALL_HALF_LENGTH * 2, rot: -Math.PI / 2 },
  ]
  const lampCount = Math.floor(halfWidth / 3.5)
  const lamps = Array.from({ length: lampCount }, (_, i) => (i - (lampCount - 1) / 2) * 5)
  return (
    <group>
      {walls.map((wall) => {
        const windows = Math.floor(wall.w / 4)
        return (
          <group key={wall.key} position={[wall.pos[0], 0, wall.pos[1]]} rotation-y={wall.rot}>
            <mesh position={[0, height / 2, 0]}>
              <planeGeometry args={[wall.w, height]} />
              <meshStandardMaterial
                color={WALL}
                emissive={WALL}
                emissiveIntensity={0.25}
                roughness={0.95}
              />
            </mesh>
            <mesh position={[0, 1.1, 0.06]}>
              <boxGeometry args={[wall.w, 2.2, 0.12]} />
              <meshStandardMaterial
                color={WALL_PAD}
                emissive={WALL_PAD}
                emissiveIntensity={0.35}
                roughness={0.8}
              />
            </mesh>
            <mesh position={[0, 2.35, 0.03]}>
              <boxGeometry args={[wall.w, 0.1, 0.08]} />
              <meshStandardMaterial color="#d9f23a" roughness={0.7} />
            </mesh>
            {Array.from({ length: windows }, (_, i) => (
              <mesh key={i} position={[(i - (windows - 1) / 2) * 4, height - 2.8, 0.03]}>
                <planeGeometry args={[3, 1.5]} />
                <meshBasicMaterial color="#e8f4ff" />
              </mesh>
            ))}
          </group>
        )
      })}
      <mesh rotation-x={Math.PI / 2} position={[0, height, 0]}>
        <planeGeometry args={[halfWidth * 2, HALL_HALF_LENGTH * 2]} />
        <meshStandardMaterial color="#3a4654" roughness={1} />
      </mesh>
      {[-15, -9, -3, 3, 9, 15].map((z) => (
        <group key={z} position={[0, height - 0.5, z]}>
          <mesh>
            <boxGeometry args={[halfWidth * 2, 0.35, 0.25]} />
            <meshStandardMaterial color="#566373" metalness={0.4} roughness={0.5} />
          </mesh>
          {lamps.map((x) => (
            <mesh key={x} position={[x, -0.3, 0]}>
              <boxGeometry args={[2.4, 0.1, 0.5]} />
              <meshBasicMaterial color="#fffdf2" toneMapped={false} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  )
}

/** Low boards around the playing area. */
export function Boards() {
  const w = APRON_HALF_WIDTH * 2
  const l = APRON_HALF_LENGTH * 2
  const panels = [
    { pos: [0, APRON_HALF_LENGTH] as const, size: [w, 0.08] as const },
    { pos: [0, -APRON_HALF_LENGTH] as const, size: [w, 0.08] as const },
    { pos: [APRON_HALF_WIDTH, 0] as const, size: [0.08, l] as const },
    { pos: [-APRON_HALF_WIDTH, 0] as const, size: [0.08, l] as const },
  ]
  return (
    <group>
      {panels.map((p, i) => (
        <group key={i} position={[p.pos[0], 0, p.pos[1]]}>
          <mesh position={[0, BOARD_HEIGHT / 2, 0]} receiveShadow>
            <boxGeometry args={[p.size[0], BOARD_HEIGHT, p.size[1]]} />
            <meshStandardMaterial
              color="#274b7a"
              emissive="#274b7a"
              emissiveIntensity={0.4}
              roughness={0.8}
            />
          </mesh>
          <mesh position={[0, BOARD_HEIGHT, 0]}>
            <boxGeometry args={[p.size[0] + 0.02, 0.07, p.size[1] + 0.02]} />
            <meshStandardMaterial color="#d9f23a" roughness={0.6} />
          </mesh>
        </group>
      ))}
    </group>
  )
}

/**
 * A seated person: clothes (tinted per person, trousers darker) and skin with hair. Low
 * detail, as there are many and they are far away.
 */
function spectatorShapes() {
  const dark = '#39414f'
  const limb = (
    x: number,
    from: [number, number, number],
    to: [number, number, number],
    r: number,
    color: string,
  ) => {
    const a = new Vector3(...from)
    const b = new Vector3(...to)
    const length = a.distanceTo(b)
    return piece(new CapsuleGeometry(r, length, 2, 7), color, (o) => {
      o.position.copy(a).lerp(b, 0.5)
      o.position.x += x
      o.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), b.clone().sub(a).normalize())
    })
  }
  const clothes = merged([
    loft(
      rings([
        [0.16, 0.1, 0.08],
        [0.18, 0.17, 0.125],
        [0.34, 0.15, 0.11],
        [0.5, 0.185, 0.12, 0.01],
        [0.6, 0.175, 0.1],
        [0.66, 0.08, 0.07],
        [0.68, 0.02, 0.02],
      ]),
      { segments: 10, paint: '#ffffff' },
    ),
    ...[1, -1].flatMap((k) => [
      limb(0, [k * 0.2, 0.58, 0], [k * 0.25, 0.36, 0.06], 0.05, '#ffffff'),
      limb(0, [k * 0.09, 0.2, 0.04], [k * 0.11, 0.2, 0.42], 0.075, dark),
      limb(0, [k * 0.11, 0.16, 0.44], [k * 0.11, -0.2, 0.46], 0.055, dark),
    ]),
  ])
  const hair = '#3a2c22'
  const skin = merged([
    loft(
      rings([
        [0.62, 0.05, 0.05],
        [0.72, 0.05, 0.055],
        [0.745, 0.065, 0.075, 0.02],
        [0.8, 0.085, 0.1, 0.01],
        [0.88, 0.09, 0.105],
        [0.94, 0.07, 0.085, -0.01],
        [0.965, 0.02, 0.02, -0.01],
      ]),
      {
        segments: 12,
        crisp: true,
        paint: (angle, y) => {
          const front = Math.abs(
            Math.atan2(Math.sin(angle - Math.PI / 2), Math.cos(angle - Math.PI / 2)),
          )
          return y > 0.9 || (y > 0.77 && front > 1.25) ? hair : '#ffffff'
        },
      },
    ),
    ...[1, -1].map((k) =>
      limb(0, [k * 0.25, 0.34, 0.08], [k * 0.13, 0.26, 0.32], 0.038, '#ffffff'),
    ),
  ])
  return { clothes, skin }
}

/** Stepped seating along both sides with a crowd. One draw call per body part. */
function Stands({ standX }: { standX: number }) {
  const seats = useMemo(() => {
    const out: Array<{ x: number; y: number; z: number; side: number; seed: number }> = []
    const perRow = Math.floor((STAND_HALF_LENGTH * 2) / SEAT_GAP)
    let seed = 0
    for (const side of [1, -1]) {
      for (let row = 0; row < STEPS; row++) {
        for (let i = 0; i < perRow; i++) {
          seed += 1
          if (rand(seed) > 0.6) continue // empty seat
          out.push({
            x: side * (standX + (row + 0.5) * STEP_DEPTH),
            y: (row + 1) * STEP_RISE,
            z: (i - (perRow - 1) / 2) * SEAT_GAP + (rand(seed + 900) - 0.5) * 0.2,
            side,
            seed,
          })
        }
      }
    }
    return out
  }, [standX])

  const shapes = useMemo(spectatorShapes, [])
  useEffect(
    () => () => {
      shapes.clothes.dispose()
      shapes.skin.dispose()
    },
    [shapes],
  )
  const bodies = useRef<InstancedMesh>(null)
  const heads = useRef<InstancedMesh>(null)
  useLayoutEffect(() => {
    const b = bodies.current
    const h = heads.current
    if (!b || !h) return
    const o = new Object3D()
    const c = new Color()
    seats.forEach((s, i) => {
      o.position.set(s.x, s.y, s.z)
      // Facing the court, each a little differently.
      o.rotation.y = -s.side * (Math.PI / 2) + (rand(s.seed + 400) - 0.5) * 0.5
      o.scale.setScalar(0.94 + rand(s.seed + 500) * 0.14)
      o.updateMatrix()
      b.setMatrixAt(i, o.matrix)
      b.setColorAt(i, c.set(SHIRTS[Math.floor(rand(s.seed + 50) * SHIRTS.length)] ?? '#ffffff'))
      h.setMatrixAt(i, o.matrix)
      h.setColorAt(i, c.set(SKINS[Math.floor(rand(s.seed + 70) * SKINS.length)] ?? '#ffffff'))
    })
    b.instanceMatrix.needsUpdate = true
    h.instanceMatrix.needsUpdate = true
    if (b.instanceColor) b.instanceColor.needsUpdate = true
    if (h.instanceColor) h.instanceColor.needsUpdate = true
  }, [seats])

  // The crowd jumps after points; each person at their own pace.
  const tmp = useRef(new Object3D())
  const still = useRef(true)
  useFrame(() => {
    const b = bodies.current
    const h = heads.current
    if (!b || !h) return
    const age = frame.now - frame.cheerAt
    const fade = Math.max(0, 1 - age / CHEER_SECONDS) * frame.cheerStrength
    if (fade <= 0 && still.current) return
    still.current = fade <= 0
    const o = tmp.current
    seats.forEach((s, i) => {
      const keen = 0.35 + rand(s.seed + 200) * 0.65
      const hop =
        Math.abs(Math.sin(frame.now * (6 + rand(s.seed + 300) * 3) + s.seed)) * 0.4 * fade * keen
      o.position.set(s.x, s.y + hop, s.z)
      o.rotation.y = -s.side * (Math.PI / 2) + (rand(s.seed + 400) - 0.5) * 0.5
      o.scale.setScalar(0.94 + rand(s.seed + 500) * 0.14)
      o.updateMatrix()
      b.setMatrixAt(i, o.matrix)
      h.setMatrixAt(i, o.matrix)
    })
    b.instanceMatrix.needsUpdate = true
    h.instanceMatrix.needsUpdate = true
  })

  return (
    <group>
      {[1, -1].map((side) =>
        Array.from({ length: STEPS }, (_, row) => (
          <mesh
            key={`${side}-${row}`}
            position={[side * (standX + (row + 0.5) * STEP_DEPTH), ((row + 1) * STEP_RISE) / 2, 0]}
          >
            <boxGeometry args={[STEP_DEPTH, (row + 1) * STEP_RISE, STAND_HALF_LENGTH * 2]} />
            <meshStandardMaterial color={row % 2 === 0 ? '#47566b' : '#3b4a5e'} roughness={0.9} />
          </mesh>
        )),
      )}
      <instancedMesh ref={bodies} args={[undefined, undefined, seats.length]} frustumCulled={false}>
        <primitive object={shapes.clothes} attach="geometry" />
        <meshStandardMaterial vertexColors roughness={0.9} />
      </instancedMesh>
      <instancedMesh ref={heads} args={[undefined, undefined, seats.length]} frustumCulled={false}>
        <primitive object={shapes.skin} attach="geometry" />
        <meshStandardMaterial vertexColors roughness={0.75} />
      </instancedMesh>
    </group>
  )
}

/** Indoor sports hall around the court, or around all the courts of a tournament. */
export function Arena() {
  const crowd = useUi((s) => s.crowd)
  const courts = useUi((s) => Math.max(1, s.courts.length))
  const focus = useUi((s) => s.focusCourt)
  const extra = extraHalfWidth(courts)
  const halfWidth = HALL_HALF_WIDTH + extra
  return (
    <>
      <Boards />
      <group position-x={hallX(courts, focus)}>
        <Floor halfWidth={halfWidth} />
        <Shell halfWidth={halfWidth} height={hallHeight(courts)} />
        {crowd && <Stands key={courts} standX={STAND_X + extra} />}
      </group>
    </>
  )
}

export function Lights() {
  const shadows = useUi((s) => s.shadows)
  return (
    <>
      <hemisphereLight args={['#fff8ea', '#8a6b45', 0.75]} />
      <directionalLight
        position={[3, 18, 3]}
        intensity={2}
        color="#fff6e5"
        castShadow={shadows}
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-12}
        shadow-camera-right={12}
        shadow-camera-top={14}
        shadow-camera-bottom={-14}
        shadow-camera-near={1}
        shadow-camera-far={45}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
      />
    </>
  )
}
