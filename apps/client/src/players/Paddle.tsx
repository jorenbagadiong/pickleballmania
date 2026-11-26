import {
  type BufferGeometry,
  CanvasTexture,
  CatmullRomCurve3,
  CylinderGeometry,
  ExtrudeGeometry,
  type MeshStandardMaterial,
  SRGBColorSpace,
  Shape,
  TubeGeometry,
  Vector3,
} from 'three'
import { loft, merged, piece, rings } from './sculpt'

/**
 * Pickleball paddle, about 1.35x life size so it reads from the camera: a raw-carbon
 * face with a printed design, an edge guard, a tapered throat and a wrapped grip.
 * The hand is at the origin; the paddle points down local -y, its face toward ±z.
 */
const FACE_WIDTH = 0.265
const FACE_LENGTH = 0.35
const CORNER = 0.08
const THROAT = 0.07
const GRIP_LENGTH = 0.17
const GRIP_RADIUS = 0.021
/** How far the grip sticks out above the hand. */
const BUTT = 0.045
const THICKNESS = 0.021
const RIM = 0.009

const BRIGHT = '#facc15'
const EDGE = '#1a1e25'
const GRIP = '#e9ebee'
const GRIP_SEAM = '#9aa3af'
/** Self-lit so the paddle stays bright even on its shaded side. */
export const PADDLE_GLOW = 0.4

/** Where the throat meets the grip, below the hand. */
const THROAT_Y = -(GRIP_LENGTH - BUTT)
const SHOULDER = THROAT_Y - THROAT
const TIP = SHOULDER - FACE_LENGTH

/** Paddle outline, grown outward by `grow`. */
function outline(target: Shape, grow: number): void {
  const w = FACE_WIDTH / 2 + grow
  const r = CORNER + grow
  const neck = GRIP_RADIUS + 0.004 + grow
  const top = THROAT_Y + grow
  const tip = TIP - grow
  target.moveTo(-neck, top)
  target.lineTo(neck, top)
  // Throat flares smoothly into the face.
  target.bezierCurveTo(neck, top - THROAT * 0.7, w, SHOULDER + 0.035, w, SHOULDER - 0.03)
  target.lineTo(w, tip + r)
  target.quadraticCurveTo(w, tip, w - r, tip)
  target.lineTo(-w + r, tip)
  target.quadraticCurveTo(-w, tip, -w, tip + r)
  target.lineTo(-w, SHOULDER - 0.03)
  target.bezierCurveTo(-w, SHOULDER + 0.035, -neck, top - THROAT * 0.7, -neck, top)
}

function extrude(shape: Shape, depth: number, bevel: number): ExtrudeGeometry {
  const geo = new ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevel > 0,
    bevelSize: bevel,
    bevelThickness: bevel,
    bevelSegments: 3,
    curveSegments: 14,
  })
  geo.translate(0, 0, -depth / 2)
  return geo
}

/** The edge guard and grip, merged into a single draw call. */
function buildTrim(): BufferGeometry {
  const rim = new Shape()
  outline(rim, RIM)

  // Overgrip wound around the handle: a seam spiralling down it.
  const turns = 6
  const top = BUTT - 0.012
  const bottom = THROAT_Y + 0.006
  const seam = new CatmullRomCurve3(
    Array.from({ length: turns * 12 + 1 }, (_, i) => {
      const t = i / (turns * 12)
      const a = t * turns * Math.PI * 2
      const r = GRIP_RADIUS + 0.0008
      return new Vector3(Math.cos(a) * r, top + (bottom - top) * t, Math.sin(a) * r)
    }),
  )
  return merged([
    // Solid, with the face standing just proud of it: what shows is a band around the edge.
    piece(extrude(rim, THICKNESS - 0.009, 0.0035), EDGE),
    // Slightly octagonal handle, as real ones are
    loft(
      rings([
        [BUTT - 0.002, GRIP_RADIUS * 1.06, GRIP_RADIUS * 1.06],
        [BUTT - 0.03, GRIP_RADIUS, GRIP_RADIUS],
        [THROAT_Y + 0.04, GRIP_RADIUS * 0.98, GRIP_RADIUS * 0.98],
        [THROAT_Y, GRIP_RADIUS * 1.04, GRIP_RADIUS * 0.86],
      ]),
      { segments: 16, squareness: 2.5, paint: GRIP },
    ),
    piece(new TubeGeometry(seam, turns * 24, 0.0021, 5), GRIP_SEAM),
    // Finishing tape where the wrap ends
    piece(new CylinderGeometry(GRIP_RADIUS * 1.1, GRIP_RADIUS * 1.12, 0.012, 18), EDGE, (o) =>
      o.position.set(0, THROAT_Y + 0.004, 0),
    ),
    // Flared butt cap
    loft(
      rings([
        [BUTT - 0.008, GRIP_RADIUS * 1.06, GRIP_RADIUS * 1.06],
        [BUTT + 0.004, GRIP_RADIUS * 1.3, GRIP_RADIUS * 1.3],
        [BUTT + 0.011, GRIP_RADIUS * 1.22, GRIP_RADIUS * 1.22],
      ]),
      { segments: 18, squareness: 2.5, paint: EDGE },
    ),
  ])
}

/** The printed face: woven carbon in the middle, bright design around it. */
function faceTexture(): CanvasTexture {
  const W = 256
  const H = 384
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const g = canvas.getContext('2d')
  if (g) {
    const base = g.createLinearGradient(0, 0, W, H)
    base.addColorStop(0, '#ffe04a')
    base.addColorStop(0.55, BRIGHT)
    base.addColorStop(1, '#f59e0b')
    g.fillStyle = base
    g.fillRect(0, 0, W, H)

    // Carbon hitting area, cut on a slant
    g.save()
    g.beginPath()
    g.moveTo(40, 112)
    g.lineTo(216, 76)
    g.quadraticCurveTo(230, 74, 230, 90)
    g.lineTo(230, 268)
    g.lineTo(58, 304)
    g.quadraticCurveTo(26, 310, 26, 280)
    g.lineTo(26, 130)
    g.quadraticCurveTo(26, 116, 40, 112)
    g.closePath()
    g.fillStyle = '#23272e'
    g.fill()
    g.clip()
    const cell = 6
    for (let y = 0; y < H; y += cell) {
      for (let x = 0; x < W; x += cell) {
        const over = ((x + y) / cell) % 4 < 2
        g.fillStyle = over ? 'rgba(255,255,255,0.075)' : 'rgba(0,0,0,0.16)'
        g.fillRect(x, y, cell - 1, cell - 1)
      }
    }
    // Sheen across the weave
    const sheen = g.createLinearGradient(20, 80, 230, 320)
    sheen.addColorStop(0, 'rgba(255,255,255,0.16)')
    sheen.addColorStop(0.45, 'rgba(255,255,255,0)')
    sheen.addColorStop(1, 'rgba(255,255,255,0.08)')
    g.fillStyle = sheen
    g.fillRect(0, 0, W, H)
    g.restore()

    g.strokeStyle = '#101318'
    g.lineWidth = 7
    for (const [y, w] of [
      [338, 1],
      [356, 0.6],
    ] as const) {
      g.beginPath()
      g.moveTo(W / 2 - 78 * w, y + 8 * w)
      g.lineTo(W / 2 + 78 * w, y - 8 * w)
      g.stroke()
    }
    // A ball, as a mark
    g.fillStyle = BRIGHT
    g.beginPath()
    g.arc(W / 2, 192, 30, 0, Math.PI * 2)
    g.fill()
    g.fillStyle = '#23272e'
    for (const [dx, dy] of [
      [0, 0],
      [-14, -9],
      [14, -9],
      [-14, 10],
      [14, 10],
      [0, -19],
      [0, 19],
    ] as const) {
      g.beginPath()
      g.arc(W / 2 + dx, 192 + dy, 4, 0, Math.PI * 2)
      g.fill()
    }
  }
  const t = new CanvasTexture(canvas)
  t.colorSpace = SRGBColorSpace
  t.anisotropy = 4
  return t
}

function buildFace(): BufferGeometry {
  const shape = new Shape()
  outline(shape, 0)
  const geo = extrude(shape, THICKNESS, 0)
  // The texture covers the face from the throat (bottom of the picture) to the tip.
  const pos = geo.getAttribute('position')
  const uv = geo.getAttribute('uv')
  const height = THROAT_Y - TIP
  for (let i = 0; i < pos.count; i++) {
    uv.setXY(i, pos.getX(i) / FACE_WIDTH + 0.5, 1 - (pos.getY(i) - TIP) / height)
  }
  return geo
}

/** Built once and shared by every paddle (so never disposed). */
let shared: { face: BufferGeometry; trim: BufferGeometry; print: CanvasTexture } | null = null
function paddleShapes() {
  shared ??= { face: buildFace(), trim: buildTrim(), print: faceTexture() }
  return shared
}

interface Props {
  faceRef: (m: MeshStandardMaterial | null) => void
}

/** Two draw calls per paddle: small parts add up with four players on court. */
export function Paddle({ faceRef }: Props) {
  const { face, trim, print } = paddleShapes()
  return (
    <group dispose={null}>
      <mesh geometry={face} castShadow>
        <meshStandardMaterial
          ref={faceRef}
          map={print}
          emissive={BRIGHT}
          emissiveMap={print}
          emissiveIntensity={PADDLE_GLOW}
          roughness={0.55}
        />
      </mesh>
      <mesh geometry={trim}>
        <meshStandardMaterial vertexColors roughness={0.7} />
      </mesh>
    </group>
  )
}
