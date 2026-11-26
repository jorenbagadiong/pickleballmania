import { COURT } from '@pickleball/shared'
import { useMemo } from 'react'
import { CanvasTexture, RepeatWrapping } from 'three'

const SURFACE = '#2364aa'
const KITCHEN = '#2f7dc4'
const APRON = '#2b5d63'
const LINE = '#f8fafc'

/** Outer playing area (apron) dimensions around the court. */
export const APRON_HALF_WIDTH = 7.8
export const APRON_HALF_LENGTH = 12

const { halfWidth: HW, halfLength: HL, kitchenDepth: KD, lineWidth: LW } = COURT

/** Fine grit of an acrylic court: a little rougher and darker here and there. Shared by all courts. */
let grit: CanvasTexture | null = null
function gritTexture(): CanvasTexture {
  if (grit) return grit
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const g = canvas.getContext('2d')
  if (g) {
    const image = g.createImageData(size, size)
    let seed = 7
    for (let i = 0; i < size * size; i++) {
      seed = (seed * 16807) % 2147483647
      const v = 226 + (seed % 30)
      image.data.set([v, v, v, 255], i * 4)
    }
    g.putImageData(image, 0, 0)
  }
  grit = new CanvasTexture(canvas)
  grit.wrapS = RepeatWrapping
  grit.wrapT = RepeatWrapping
  grit.repeat.set(14, 22)
  grit.anisotropy = 8
  return grit
}

interface LineProps {
  x: number
  z: number
  w: number
  l: number
}

/** A painted line, lying on the court (w along x, l along z). */
function Line({ x, z, w, l }: LineProps) {
  return (
    <mesh position={[x, 0.006, z]} rotation-x={-Math.PI / 2} receiveShadow>
      <planeGeometry args={[w, l]} />
      <meshStandardMaterial color={LINE} roughness={0.6} />
    </mesh>
  )
}

/**
 * 28 × 44 ft court (wider than the official 20 ft). Lines are 2 in wide and sit inside the court
 * dimensions (outer edges on the boundary), as on a real court.
 */
export function Court() {
  const texture = useMemo(gritTexture, [])
  const lines: LineProps[] = [
    // Sidelines and baselines.
    { x: -HW + LW / 2, z: 0, w: LW, l: COURT.length },
    { x: HW - LW / 2, z: 0, w: LW, l: COURT.length },
    { x: 0, z: HL - LW / 2, w: COURT.width, l: LW },
    { x: 0, z: -HL + LW / 2, w: COURT.width, l: LW },
    // Non-volley-zone (kitchen) lines, 7 ft from the net to their far edge.
    { x: 0, z: KD - LW / 2, w: COURT.width, l: LW },
    { x: 0, z: -KD + LW / 2, w: COURT.width, l: LW },
    // Centerlines from the kitchen line to the baseline, splitting the service courts.
    { x: 0, z: (KD + HL) / 2, w: LW, l: HL - KD },
    { x: 0, z: -(KD + HL) / 2, w: LW, l: HL - KD },
  ]

  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[APRON_HALF_WIDTH * 2, APRON_HALF_LENGTH * 2]} />
        <meshStandardMaterial
          color={APRON}
          map={texture}
          roughnessMap={texture}
          bumpMap={texture}
          bumpScale={0.35}
          roughness={0.82}
        />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.002, 0]} receiveShadow>
        <planeGeometry args={[COURT.width, COURT.length]} />
        <meshStandardMaterial
          color={SURFACE}
          map={texture}
          roughnessMap={texture}
          bumpMap={texture}
          bumpScale={0.35}
          roughness={0.66}
        />
      </mesh>
      {[1, -1].map((side) => (
        <mesh
          key={side}
          rotation-x={-Math.PI / 2}
          position={[0, 0.004, (side * KD) / 2]}
          receiveShadow
        >
          <planeGeometry args={[COURT.width, KD]} />
          <meshStandardMaterial
            color={KITCHEN}
            map={texture}
            roughnessMap={texture}
            bumpMap={texture}
            bumpScale={0.35}
            roughness={0.66}
          />
        </mesh>
      ))}
      {lines.map((l, i) => (
        <Line key={i} {...l} />
      ))}
    </group>
  )
}
