import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import {
  AdditiveBlending,
  CanvasTexture,
  Color,
  type Group,
  type InstancedMesh,
  type Mesh,
  type MeshBasicMaterial,
  Object3D,
  SRGBColorSpace,
} from 'three'
import { frame } from '../game/frame'

const FLAMES = 44
const EMBERS = 14
const COUNT = FLAMES + EMBERS
/** Fire grows in and dies down over this long. */
const FADE_SECONDS = 0.4

const HOT = new Color('#ffc13d')
const MID = new Color('#ff6a00')
const COOL = new Color('#d81e00')

function makeGlow(): CanvasTexture {
  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const g = canvas.getContext('2d')
  if (g) {
    const r = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
    r.addColorStop(0, 'rgba(255,255,255,1)')
    r.addColorStop(0.35, 'rgba(255,255,255,0.65)')
    r.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = r
    g.fillRect(0, 0, size, size)
  }
  const tex = new CanvasTexture(canvas)
  tex.colorSpace = SRGBColorSpace
  return tex
}

/** Fixed per-particle randomness so the fire never repeats in step. */
function rand(i: number, salt: number): number {
  const x = Math.sin((i + 1) * 12.9898 + salt * 78.233) * 43758.5453
  return x - Math.floor(x)
}

/**
 * Fire around a player who is on a winning streak. Place it in a group that
 * follows the player but does not turn with them. One draw call, plus a glow on
 * the floor; purely visual.
 */
export function Flames({ active }: { active: boolean }) {
  const root = useRef<Group>(null)
  const mesh = useRef<InstancedMesh>(null)
  const floor = useRef<Mesh>(null)
  const strength = useRef(0)
  const texture = useMemo(makeGlow, [])
  const tmp = useMemo(() => ({ o: new Object3D(), c: new Color() }), [])
  useEffect(() => () => texture.dispose(), [texture])

  useFrame(({ camera }, delta) => {
    const g = root.current
    const m = mesh.current
    if (!g || !m) return
    const target = active ? 1 : 0
    const step = delta / FADE_SECONDS
    strength.current += Math.max(-step, Math.min(step, target - strength.current))
    const k = strength.current
    g.visible = k > 0.01
    if (!g.visible) return

    const t = frame.now
    const { o, c } = tmp
    for (let i = 0; i < COUNT; i++) {
      const ember = i >= FLAMES
      const life = ember ? 1.1 + rand(i, 1) * 0.6 : 0.5 + rand(i, 1) * 0.4
      const age = (t / life + rand(i, 2)) % 1
      const angle = rand(i, 3) * Math.PI * 2 + Math.sin(t * 2 + i) * 0.3
      const radius = (ember ? 0.2 + age * 0.35 : 0.14 + rand(i, 4) * 0.2) * (1 - age * 0.3)
      const y =
        (ember ? 0.5 + rand(i, 5) * 0.7 : 0.05 + rand(i, 5) * 0.95) + age * (ember ? 1.2 : 0.6)
      const sway = Math.sin(t * 7 + i * 1.7) * 0.06 * age
      o.position.set(Math.cos(angle) * radius + sway, y, Math.sin(angle) * radius)
      o.quaternion.copy(camera.quaternion)
      const size = ember ? 0.06 : (0.2 + rand(i, 6) * 0.2) * Math.sin(Math.PI * (0.15 + age * 0.85))
      // Taller than wide, so they read as licks of flame.
      o.scale.set(size * k, size * (ember ? 1 : 1.8) * k, 1)
      o.updateMatrix()
      m.setMatrixAt(i, o.matrix)
      if (age < 0.4) c.lerpColors(HOT, MID, age / 0.4)
      else c.lerpColors(MID, COOL, (age - 0.4) / 0.6)
      m.setColorAt(i, c)
    }
    m.instanceMatrix.needsUpdate = true
    if (m.instanceColor) m.instanceColor.needsUpdate = true

    if (floor.current) {
      const flicker = 0.8 + Math.sin(t * 17) * 0.08 + Math.sin(t * 29) * 0.06
      ;(floor.current.material as MeshBasicMaterial).opacity = 0.5 * k * flicker
      floor.current.scale.setScalar(0.95 + flicker * 0.15)
    }
  })

  return (
    <group ref={root} visible={false}>
      <mesh ref={floor} rotation-x={-Math.PI / 2} position={[0, 0.016, 0]}>
        <planeGeometry args={[2.2, 2.2]} />
        <meshBasicMaterial
          map={texture}
          color="#ff6a10"
          transparent
          blending={AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      <instancedMesh ref={mesh} args={[undefined, undefined, COUNT]} frustumCulled={false}>
        <planeGeometry args={[1, 1]} />
        {/* Normal blending: additive orange over a blue court turns pink. */}
        <meshBasicMaterial
          map={texture}
          transparent
          opacity={0.6}
          depthWrite={false}
          toneMapped={false}
        />
      </instancedMesh>
    </group>
  )
}
