import {
  BoxGeometry,
  type BufferGeometry,
  CapsuleGeometry,
  CylinderGeometry,
  SphereGeometry,
  TorusGeometry,
} from 'three'
import { type Paint, type Ring, loft, merged, moved, piece, rings, tint } from './sculpt'

/*
 * The player's body, sculpted from cross-sections (meters) and merged into one shape
 * per joint. Faces +z. `side` is 1 for the left (+x) and -1 for the right.
 */

export const HIP_HEIGHT = 0.92
export const THIGH = 0.43
export const SHIN = 0.41
/** Ankle joint, above the ground. */
export const ANKLE = 0.08
export const UPPER_ARM = 0.27
export const FOREARM = 0.24

export type Style = 'cap' | 'headband' | 'ponytail'

export interface Look {
  skin: string
  hair: string
  eyes: string
  style: Style
  /** Stubble on the jaw. */
  stubble: boolean
  /** Team color. */
  color: string
}

const SHORTS = '#1b2433'
const SOCK = '#eef1f4'
const SHOE = '#f3f4f6'
const SOLE = '#c9b592'
const WHITE = '#f8fafc'

const FRONT = Math.PI / 2
/** Distance between two angles. */
function apart(x: number, y: number): number {
  return Math.abs(Math.atan2(Math.sin(x - y), Math.cos(x - y)))
}
const onSide = (angle: number): number => Math.min(apart(angle, 0), apart(angle, Math.PI))

/** Skin that is a little redder and darker at some heights (knees, elbows). */
function skinTone(skin: string, marks: ReadonlyArray<readonly [number, number, number]>): Paint {
  return (_angle, y) => {
    let t = 0
    for (const [at, width, strength] of marks) {
      t = Math.max(t, strength * Math.max(0, 1 - Math.abs(y - at) / width))
    }
    return t > 0 ? tint(skin, '#7c3a2a', t) : skin
  }
}

export interface BodyShapes {
  pelvis: BufferGeometry
  torso: BufferGeometry
  head: BufferGeometry
  thigh: Record<1 | -1, BufferGeometry>
  shin: Record<1 | -1, BufferGeometry>
  foot: Record<1 | -1, BufferGeometry>
  upperArm: Record<1 | -1, BufferGeometry>
  forearm: Record<1 | -1, BufferGeometry>
  /** The right hand, closed around the grip. */
  fist: BufferGeometry
}

function pelvis(): BufferGeometry {
  return merged([
    loft(
      rings([
        [-0.15, 0.06, 0.05],
        [-0.14, 0.12, 0.09],
        [-0.1, 0.164, 0.112, -0.004],
        [-0.04, 0.164, 0.112, -0.004],
        [0.0, 0.15, 0.1],
        [0.06, 0.125, 0.08],
      ]),
      {
        segments: 24,
        squareness: 2.3,
        crisp: true,
        paint: (an, y) => (y < -0.03 && onSide(an) < 0.2 ? WHITE : SHORTS),
      },
    ),
  ])
}

function torso(color: string): BufferGeometry {
  const shade = tint(color, '#000000', 0.16)
  const dark = tint(color, '#000000', 0.45)
  const shirt: Paint = (an, y) => {
    if (y > 0.43) return color
    if (onSide(an) < 0.34) return dark // side panels
    return y < -0.125 ? shade : color
  }
  return merged([
    loft(
      rings([
        [-0.135, 0.16, 0.115],
        [-0.14, 0.181, 0.131, -0.002],
        [-0.12, 0.18, 0.13, -0.002],
        [-0.07, 0.174, 0.124],
        [0.0, 0.162, 0.112],
        [0.07, 0.154, 0.105],
        [0.14, 0.157, 0.107, 0.002],
        [0.23, 0.172, 0.118, 0.006],
        [0.31, 0.184, 0.124, 0.009],
        [0.365, 0.187, 0.114, 0.004],
        [0.405, 0.176, 0.099, -0.002],
        [0.435, 0.145, 0.085, -0.006],
        [0.46, 0.1, 0.072, -0.008],
        [0.482, 0.07, 0.062, -0.006],
      ]),
      {
        segments: 32,
        squareness: 2.45,
        // Chest muscles and shoulder blades, and the hollow of the spine.
        bulge: (an, y) => {
          const chest = Math.max(0, 1 - Math.abs(y - 0.31) / 0.09)
          const left = Math.max(0, 1 - apart(an, FRONT - 0.5) / 0.45)
          const right = Math.max(0, 1 - apart(an, FRONT + 0.5) / 0.45)
          const spine = Math.max(0, 1 - apart(an, -FRONT) / 0.3)
          return 1 + 0.05 * chest * (left + right) - 0.05 * spine * Math.min(1, y * 5 + 0.4)
        },
        crisp: true,
        paint: shirt,
      },
    ),
    // Collar, open at the front
    loft(
      rings([
        [0.462, 0.09, 0.076, -0.007],
        [0.474, 0.08, 0.07, -0.006],
        [0.5, 0.064, 0.061, -0.006],
        [0.503, 0.06, 0.057, -0.006],
      ]),
      {
        segments: 28,
        bulge: (an, y) => (apart(an, FRONT) < 0.3 ? 0.86 - (y - 0.46) * 2 : 1),
        paint: tint(color, '#ffffff', 0.82),
      },
    ),
    // Button placket
    piece(new BoxGeometry(0.026, 0.1, 0.008), shade, (o) => {
      o.position.set(0, 0.4, 0.114)
      o.rotation.x = -0.2
    }),
    ...[0.375, 0.415].map((y) =>
      piece(new SphereGeometry(0.0045, 6, 5), WHITE, (o) => o.position.set(0, y, 0.122)),
    ),
    // Badge on the chest
    piece(new BoxGeometry(0.036, 0.02, 0.006), WHITE, (o) => {
      o.position.set(0.085, 0.33, 0.13)
      o.rotation.set(-0.04, 0.34, 0)
    }),
  ])
}

function thigh(side: 1 | -1, skin: string): BufferGeometry {
  return merged([
    loft(
      rings([
        [-0.1, 0.088, 0.09],
        [-0.2, 0.083, 0.087, 0.004],
        [-0.3, 0.07, 0.074, 0.005],
        [-0.36, 0.06, 0.063, 0.004],
        [-0.41, 0.0555, 0.0585, 0.003],
        [-0.45, 0.051, 0.054, 0.002],
        [-0.474, 0.038, 0.04, 0.001],
        [-0.484, 0.014, 0.014],
      ]),
      { segments: 22, paint: skinTone(skin, [[-0.43, 0.06, 0.1]]) },
    ),
    // Shorts leg, flaring at the hem
    loft(
      [
        { y: 0.04, rx: 0.05, rz: 0.06, cx: -side * 0.01, cz: -0.014 },
        { y: 0.0, rx: 0.074, rz: 0.084, cx: -side * 0.006, cz: -0.012 },
        { y: -0.05, rx: 0.09, rz: 0.1, cx: -side * 0.003, cz: -0.004 },
        { y: -0.1, rx: 0.1, rz: 0.11 },
        { y: -0.17, rx: 0.106, rz: 0.114 },
        { y: -0.235, rx: 0.112, rz: 0.117, cz: 0.004 },
        { y: -0.235, rx: 0.1, rz: 0.105, cz: 0.004 },
        { y: -0.19, rx: 0.07, rz: 0.07 },
      ],
      {
        segments: 28,
        crisp: true,
        paint: (an, y) =>
          y > -0.2 && apart(an, side === 1 ? 0 : Math.PI) < 0.22
            ? WHITE
            : y < -0.215
              ? tint(SHORTS, '#000000', 0.35)
              : SHORTS,
      },
    ),
  ])
}

function shin(side: 1 | -1, skin: string, color: string): BufferGeometry {
  return merged([
    loft(
      [
        { y: 0.045, rx: 0.02, rz: 0.02, cz: 0.006 },
        { y: 0.034, rx: 0.04, rz: 0.042, cz: 0.006 },
        { y: 0.012, rx: 0.0525, rz: 0.0545, cz: 0.005 },
        { y: -0.025, rx: 0.0525, rz: 0.0555, cz: 0.003 },
        { y: -0.07, rx: 0.053, rz: 0.057, cz: -0.006, cx: side * 0.002 },
        { y: -0.12, rx: 0.056, rz: 0.063, cz: -0.014, cx: side * 0.004 },
        { y: -0.18, rx: 0.051, rz: 0.056, cz: -0.012, cx: side * 0.003 },
        { y: -0.24, rx: 0.041, rz: 0.045, cz: -0.006 },
        { y: -0.3, rx: 0.034, rz: 0.038 },
        { y: -0.35, rx: 0.034, rz: 0.038 },
      ],
      {
        segments: 22,
        paint: skinTone(skin, [[0, 0.06, 0.1]]),
      },
    ),
    // Crew sock with a band in the team color
    loft(
      rings([
        [-0.205, 0.048, 0.053, -0.01],
        [-0.207, 0.0525, 0.0575, -0.01],
        [-0.216, 0.0515, 0.0565, -0.0095],
        [-0.226, 0.0495, 0.0545, -0.009],
        [-0.25, 0.046, 0.05, -0.006],
        [-0.3, 0.039, 0.043],
        [-0.36, 0.04, 0.046, 0.002],
      ]),
      { crisp: true, paint: (_an, y) => (y > -0.226 && y < -0.216 ? color : SOCK) },
    ),
  ])
}

/** A court shoe, around the ankle. */
function foot(color: string): BufferGeometry {
  const ground = -ANKLE
  // Cross-sections from heel to toe: [along, half-width, half-height, center height]
  const along = (rows: ReadonlyArray<readonly [number, number, number, number]>): Ring[] =>
    rows.map(([y, rx, rz, cz]) => ({ y, rx, rz, cz }))
  const lay = (o: { rotation: { x: number } }): void => {
    // y (along) becomes forward, z (height) becomes up.
    o.rotation.x = Math.PI / 2
  }
  const upper = loft(
    along([
      [-0.085, 0.018, 0.022, -(ground + 0.055)],
      [-0.076, 0.033, 0.04, -(ground + 0.06)],
      [-0.04, 0.04, 0.052, -(ground + 0.066)],
      [-0.02, 0.0405, 0.0525, -(ground + 0.0665)],
      [0.0, 0.041, 0.052, -(ground + 0.066)],
      [0.02, 0.042, 0.047, -(ground + 0.062)],
      [0.04, 0.043, 0.042, -(ground + 0.058)],
      [0.06, 0.0445, 0.037, -(ground + 0.053)],
      [0.085, 0.046, 0.032, -(ground + 0.048)],
      [0.11, 0.047, 0.028, -(ground + 0.044)],
      [0.13, 0.047, 0.025, -(ground + 0.041)],
      [0.165, 0.039, 0.021, -(ground + 0.038)],
      [0.188, 0.018, 0.013, -(ground + 0.034)],
    ]),
    {
      segments: 28,
      squareness: 2.3,
      crisp: true,
      paint: (an, y) => {
        // Toe cap, heel tab, and a slanted side stripe in the team color.
        if (y > 0.135 || y < -0.06) return tint(color, '#111827', 0.15)
        const stripe = onSide(an) < 0.8 && Math.abs(y - 0.02 - Math.sin(an) * 0.03) < 0.025
        return stripe ? color : SHOE
      },
    },
  )
  const sole = loft(
    along([
      [-0.09, 0.02, 0.011, -(ground + 0.012)],
      [-0.08, 0.037, 0.013, -(ground + 0.012)],
      [-0.03, 0.043, 0.013, -(ground + 0.012)],
      [0.04, 0.044, 0.013, -(ground + 0.012)],
      [0.11, 0.051, 0.013, -(ground + 0.012)],
      [0.165, 0.044, 0.013, -(ground + 0.013)],
      [0.195, 0.02, 0.01, -(ground + 0.016)],
    ]),
    {
      segments: 16,
      squareness: 4,
      paint: (_an, y) => (y > 0.12 ? tint(SOLE, '#000', 0.12) : SOLE),
    },
  )
  const midsole = loft(
    along([
      [-0.088, 0.02, 0.009, -(ground + 0.028)],
      [-0.078, 0.037, 0.01, -(ground + 0.028)],
      [-0.03, 0.043, 0.01, -(ground + 0.028)],
      [0.04, 0.0445, 0.01, -(ground + 0.027)],
      [0.11, 0.05, 0.009, -(ground + 0.027)],
      [0.165, 0.043, 0.009, -(ground + 0.027)],
      [0.193, 0.02, 0.008, -(ground + 0.027)],
    ]),
    { segments: 16, squareness: 4, paint: '#ffffff' },
  )
  const laces = [0.045, 0.065, 0.085, 0.105].map((z, i) =>
    piece(new CapsuleGeometry(0.0035, 0.036, 2, 6), '#64748b', (o) => {
      o.position.set(0, ground + 0.094 - i * 0.0085, z)
      o.rotation.set(0.3, 0, Math.PI / 2)
    }),
  )
  return merged([
    moved(upper, lay),
    moved(midsole, lay),
    moved(sole, lay),
    ...laces,
    // Ankle: sock into the shoe
    loft(
      rings([
        [-0.03, 0.04, 0.046, -0.004],
        [0.02, 0.037, 0.041],
        [0.05, 0.036, 0.04],
      ]),
      { paint: SOCK },
    ),
  ])
}

function upperArm(side: 1 | -1, skin: string, color: string): BufferGeometry {
  return merged([
    loft(
      [
        { y: -0.08, rx: 0.053, rz: 0.058 },
        { y: -0.14, rx: 0.052, rz: 0.06, cz: 0.004 },
        { y: -0.19, rx: 0.048, rz: 0.054, cz: 0.003 },
        { y: -0.24, rx: 0.042, rz: 0.045 },
        { y: -0.285, rx: 0.04, rz: 0.042 },
      ],
      { paint: skinTone(skin, [[-0.28, 0.05, 0.14]]) },
    ),
    // Shoulder and sleeve
    loft(
      [
        { y: 0.058, rx: 0.02, rz: 0.03, cx: -side * 0.03 },
        { y: 0.046, rx: 0.045, rz: 0.054, cx: -side * 0.016 },
        { y: 0.02, rx: 0.062, rz: 0.069, cx: -side * 0.005 },
        { y: -0.02, rx: 0.067, rz: 0.073 },
        { y: -0.07, rx: 0.066, rz: 0.072 },
        { y: -0.12, rx: 0.066, rz: 0.072 },
        { y: -0.146, rx: 0.067, rz: 0.073 },
        { y: -0.164, rx: 0.068, rz: 0.074 },
        { y: -0.165, rx: 0.06, rz: 0.065 },
        { y: -0.12, rx: 0.045, rz: 0.045 },
      ],
      {
        segments: 24,
        crisp: true,
        paint: (an, y) =>
          y < -0.146
            ? WHITE
            : apart(an, side === 1 ? 0 : Math.PI) < 0.3
              ? tint(color, '#000', 0.4)
              : color,
      },
    ),
  ])
}

/** Four fingers of an open, relaxed hand. */
function openHand(side: 1 | -1, skin: string): BufferGeometry[] {
  const parts: BufferGeometry[] = []
  for (let i = 0; i < 4; i++) {
    const z = 0.027 - i * 0.018
    const length = [0.034, 0.04, 0.037, 0.027][i] as number
    const x = -side * 0.004
    parts.push(
      piece(new CapsuleGeometry(0.0088, length, 3, 8), skin, (o) => {
        o.position.set(x, -0.335 - length / 2, z)
        o.rotation.z = -side * 0.12
      }),
      piece(new CapsuleGeometry(0.0078, length * 0.75, 3, 8), skin, (o) => {
        o.position.set(x - side * 0.014, -0.35 - length * 1.35, z * 0.95)
        o.rotation.z = -side * 0.62
      }),
    )
  }
  parts.push(
    piece(new CapsuleGeometry(0.0105, 0.04, 3, 8), skin, (o) => {
      o.position.set(-side * 0.008, -0.298, 0.046)
      o.rotation.set(-0.55, 0, -side * 0.2)
    }),
  )
  return parts
}

function forearm(side: 1 | -1, skin: string): BufferGeometry {
  const parts = [
    loft(
      rings([
        [0.035, 0.038, 0.04],
        [0.0, 0.041, 0.044, -0.002],
        [-0.05, 0.042, 0.048, 0.003],
        [-0.1, 0.038, 0.043, 0.003],
        [-0.16, 0.03, 0.034],
        [-0.22, 0.023, 0.03],
        [-0.25, 0.023, 0.031],
      ]),
      { paint: skinTone(skin, [[0.01, 0.05, 0.14]]) },
    ),
  ]
  if (side === -1) {
    // Wristband on the paddle arm
    parts.push(
      loft(
        rings([
          [-0.165, 0.032, 0.036],
          [-0.17, 0.036, 0.04],
          [-0.215, 0.033, 0.038],
          [-0.22, 0.028, 0.034],
        ]),
        { crisp: true, paint: WHITE },
      ),
    )
  } else {
    parts.push(
      // Watch
      loft(
        rings([
          [-0.2, 0.025, 0.032],
          [-0.202, 0.028, 0.035],
          [-0.222, 0.027, 0.034],
          [-0.224, 0.024, 0.031],
        ]),
        { paint: '#1f2937' },
      ),
      piece(new CylinderGeometry(0.016, 0.016, 0.008, 14), '#cbd5e1', (o) => {
        o.position.set(side * 0.028, -0.212, 0)
        o.rotation.z = Math.PI / 2
      }),
      // Palm
      loft(
        rings([
          [-0.235, 0.021, 0.028],
          [-0.265, 0.021, 0.037],
          [-0.3, 0.02, 0.042],
          [-0.33, 0.016, 0.039],
          [-0.342, 0.009, 0.03],
        ]),
        { squareness: 2.4, paint: skin },
      ),
      ...openHand(side, skin),
    )
  }
  return merged(parts)
}

/** The right hand around the grip, which runs along y through the origin. */
function fist(skin: string): BufferGeometry {
  const knuckle = tint(skin, '#7c3a2a', 0.18)
  const parts = [
    // Back of the hand
    loft(
      [
        { y: 0.05, rx: 0.024, rz: 0.03, cx: -0.004 },
        { y: 0.03, rx: 0.026, rz: 0.036, cx: -0.014 },
        { y: -0.01, rx: 0.026, rz: 0.04, cx: -0.02 },
        { y: -0.045, rx: 0.022, rz: 0.038, cx: -0.02 },
        { y: -0.062, rx: 0.012, rz: 0.026, cx: -0.018 },
      ],
      { squareness: 2.4, paint: skin },
    ),
  ]
  // Fingers curl around the front of the grip
  for (let i = 0; i < 4; i++) {
    parts.push(
      piece(
        new TorusGeometry(0.033, 0.0105, 8, 14, Math.PI * 1.25),
        i === 0 ? knuckle : skin,
        (o) => {
          o.position.set(0, 0.026 - i * 0.0225, 0)
          o.rotation.set(Math.PI / 2, 0, 0.9)
        },
      ),
    )
  }
  // Thumb, across the fingers
  parts.push(
    piece(new CapsuleGeometry(0.012, 0.045, 3, 8), skin, (o) => {
      o.position.set(0.012, -0.03, 0.037)
      o.rotation.set(0.15, 0, 0.75)
    }),
  )
  return merged(parts)
}

const HEAD: Ring[] = rings([
  [-0.034, 0.014, 0.014, 0.07],
  [-0.028, 0.034, 0.03, 0.064],
  [-0.008, 0.054, 0.05, 0.05],
  [0.02, 0.069, 0.072, 0.03],
  [0.05, 0.077, 0.09, 0.014],
  [0.085, 0.083, 0.101, 0.004],
  [0.12, 0.087, 0.106, 0],
  [0.155, 0.088, 0.106, -0.004],
  [0.185, 0.082, 0.1, -0.007],
  [0.21, 0.066, 0.082, -0.009],
  [0.228, 0.04, 0.05, -0.01],
  [0.234, 0.012, 0.016, -0.01],
])

/** Head cross-section at a height, for things worn on it. */
function headAt(y: number): Ring {
  for (let i = 0; i + 1 < HEAD.length; i++) {
    const p = HEAD[i] as Ring
    const q = HEAD[i + 1] as Ring
    if (y >= p.y && y <= q.y) {
      const t = (y - p.y) / (q.y - p.y)
      const mix = (m: number, n: number): number => m + (n - m) * t
      return { y, rx: mix(p.rx, q.rx), rz: mix(p.rz, q.rz), cz: mix(p.cz ?? 0, q.cz ?? 0) }
    }
  }
  return HEAD[HEAD.length - 1] as Ring
}

/** A layer over the head between two heights, `gap` thicker than it. */
function over(from: number, to: number, gap: number, steps = 10): Ring[] {
  return Array.from({ length: steps + 1 }, (_, i) => {
    const r = headAt(from + ((to - from) * i) / steps)
    // Thicker on top too, not just around.
    const lift = gap * Math.max(0, Math.min(1, (r.y - 0.15) / 0.07))
    return { ...r, y: r.y + lift, rx: r.rx + gap, rz: r.rz + gap }
  })
}

function face(look: Look): BufferGeometry[] {
  const { skin, hair, eyes } = look
  const lip = tint(skin, '#a03a3a', 0.45)
  const shade = tint(skin, '#4a2418', 0.22)
  const parts: BufferGeometry[] = [
    loft(HEAD, {
      segments: 30,
      squareness: 2.15,
      // Eye sockets, brow ridge, cheekbones.
      bulge: (an, y) => {
        const socket =
          Math.max(0, 1 - Math.abs(y - 0.104) / 0.024) *
          (Math.max(0, 1 - apart(an, FRONT - 0.42) / 0.28) +
            Math.max(0, 1 - apart(an, FRONT + 0.42) / 0.28))
        const cheek =
          Math.max(0, 1 - Math.abs(y - 0.065) / 0.035) *
          (Math.max(0, 1 - apart(an, FRONT - 0.75) / 0.35) +
            Math.max(0, 1 - apart(an, FRONT + 0.75) / 0.35))
        return 1 - 0.06 * socket + 0.03 * cheek
      },
      paint: (an, y) => {
        const front = apart(an, FRONT)
        if (look.stubble && y < 0.048 && front < 1.6) return tint(skin, hair, 0.34)
        if (y > 0.04 && y < 0.085 && front > 0.45 && front < 1.1) return tint(skin, '#c2503c', 0.13)
        return skin
      },
    }),
    // Nose: bridge, tip, nostrils
    loft(
      [
        { y: 0.112, rx: 0.008, rz: 0.008, cz: 0.1 },
        { y: 0.09, rx: 0.0095, rz: 0.013, cz: 0.105 },
        { y: 0.072, rx: 0.0135, rz: 0.018, cz: 0.11 },
        { y: 0.06, rx: 0.016, rz: 0.018, cz: 0.108 },
        { y: 0.054, rx: 0.01, rz: 0.01, cz: 0.104 },
      ],
      { segments: 12, paint: (_an, y) => (y < 0.058 ? shade : skin) },
    ),
    // Lips
    piece(new SphereGeometry(1, 14, 8), lip, (o) => {
      o.position.set(0, 0.0275, 0.0995)
      o.scale.set(0.0245, 0.0048, 0.007)
    }),
    piece(new SphereGeometry(1, 14, 8), lip, (o) => {
      o.position.set(0, 0.0195, 0.0985)
      o.scale.set(0.021, 0.006, 0.008)
    }),
    piece(new BoxGeometry(0.04, 0.0014, 0.006), tint(lip, '#000', 0.5), (o) =>
      o.position.set(0, 0.0237, 0.1035),
    ),
  ]
  for (const s of [1, -1] as const) {
    const x = s * 0.0365
    parts.push(
      piece(new SphereGeometry(0.0142, 12, 10), '#f5f3ee', (o) => {
        o.position.set(x, 0.104, 0.0885)
        o.scale.set(1.15, 0.84, 0.9)
      }),
      piece(new SphereGeometry(0.0066, 10, 8), eyes, (o) => {
        o.position.set(x, 0.104, 0.0985)
        o.scale.z = 0.5
      }),
      piece(new SphereGeometry(0.0034, 8, 6), '#0b0908', (o) => {
        o.position.set(x, 0.104, 0.1012)
        o.scale.z = 0.5
      }),
      // Glint
      piece(new SphereGeometry(0.0013, 6, 5), '#ffffff', (o) =>
        o.position.set(x + 0.002, 0.1065, 0.103),
      ),
      // Upper lid with lashes, lower lid
      piece(new SphereGeometry(0.0152, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.3), skin, (o) => {
        o.position.set(x, 0.1045, 0.0875)
        o.scale.set(1.16, 0.9, 0.96)
        o.rotation.x = 0.28
      }),
      piece(new CapsuleGeometry(0.0014, 0.024, 2, 6), '#1a120d', (o) => {
        o.position.set(x, 0.1145, 0.0985)
        o.rotation.z = Math.PI / 2
      }),
      piece(new CapsuleGeometry(0.0036, 0.028, 3, 8), hair, (o) => {
        o.position.set(s * 0.038, 0.1285, 0.0975)
        o.rotation.set(0, s * 0.35, Math.PI / 2 + s * 0.02)
        o.scale.set(1.15, 1, 0.8)
      }),
      // Ear: rim and hollow
      piece(new SphereGeometry(0.028, 12, 10), skin, (o) => {
        o.position.set(s * 0.086, 0.082, -0.012)
        o.scale.set(0.36, 1, 0.66)
        o.rotation.set(0.15, s * 0.35, 0)
      }),
      piece(new SphereGeometry(0.017, 10, 8), shade, (o) => {
        o.position.set(s * 0.0925, 0.084, -0.008)
        o.scale.set(0.3, 1, 0.65)
        o.rotation.y = s * 0.35
      }),
    )
  }
  return parts
}

function hairAndHeadwear(look: Look): BufferGeometry[] {
  const { hair, style, color } = look
  const streak = tint(hair, '#ffffff', 0.1)
  const long = style === 'ponytail'
  const parts: BufferGeometry[] = [
    loft(over(0.0, 0.234, 0.0105, 18), {
      segments: 36,
      squareness: 2.15,
      // Where there is no hair the layer dips under the skin: that edge is the hairline.
      bulge: (an, y) => {
        const front = apart(an, FRONT)
        const line =
          front < 0.75
            ? 0.172 - front * 0.02 // forehead
            : front < 1.35
              ? 0.15 - (front - 0.75) * 0.14 // temples
              : front < 1.75
                ? 0.066 // sideburns, above the ears
                : long
                  ? 0.02
                  : 0.028 // nape
        const t = Math.max(0, Math.min(1, (y - line) / 0.012))
        const waves = 1 + 0.012 * Math.sin(an * 14 + y * 40)
        return (0.72 + 0.28 * t) * (t > 0.9 ? waves : 1)
      },
      paint: (an, y) => (Math.sin(an * 11 + y * 30) > 0.55 ? streak : hair),
    }),
  ]
  if (long) {
    parts.push(
      loft(
        [
          { y: 0.16, rx: 0.02, rz: 0.02, cz: -0.112 },
          { y: 0.145, rx: 0.028, rz: 0.028, cz: -0.14 },
          { y: 0.1, rx: 0.034, rz: 0.034, cz: -0.165 },
          { y: 0.03, rx: 0.034, rz: 0.032, cz: -0.172 },
          { y: -0.04, rx: 0.026, rz: 0.024, cz: -0.165 },
          { y: -0.1, rx: 0.01, rz: 0.01, cz: -0.155 },
        ],
        { paint: (an) => (Math.sin(an * 7) > 0.5 ? streak : hair) },
      ),
      piece(new TorusGeometry(0.022, 0.008, 8, 16), color, (o) => {
        o.position.set(0, 0.152, -0.117)
        o.rotation.x = 0.5
      }),
    )
  }
  if (style === 'cap') {
    const seam = tint(color, '#000', 0.3)
    parts.push(
      loft(over(0.148, 0.234, 0.0175, 10), {
        segments: 36,
        squareness: 2.15,
        crisp: true,
        paint: (an, y) => (y < 0.156 || apart((an * 3) % Math.PI, FRONT) < 0.09 ? seam : color),
      }),
      piece(new SphereGeometry(0.009, 10, 8), seam, (o) => o.position.set(0, 0.251, -0.01)),
      // Curved peak
      loft(
        [
          { y: 0.152, rx: 0.084, rz: 0.1, cz: 0.085 },
          { y: 0.158, rx: 0.09, rz: 0.104, cz: 0.085 },
          { y: 0.163, rx: 0.084, rz: 0.1, cz: 0.085 },
        ],
        { segments: 28, paint: (_an, y) => (y < 0.155 ? seam : color) },
      ),
      piece(new BoxGeometry(0.04, 0.026, 0.004), WHITE, (o) => {
        o.position.set(0, 0.188, 0.112)
        o.rotation.x = -0.3
      }),
    )
  } else {
    // Sweatband
    parts.push(
      loft(
        over(0.142, 0.172, 0.0135, 4).map((r, i) =>
          i === 0 || i === 4 ? { ...r, rx: r.rx - 0.003, rz: r.rz - 0.003 } : r,
        ),
        {
          segments: 32,
          squareness: 2.15,
          crisp: true,
          paint: (_an, y) => (y > 0.152 && y < 0.163 ? WHITE : color),
        },
      ),
    )
  }
  return parts
}

function head(look: Look): BufferGeometry {
  const neck = loft(
    rings([
      [-0.12, 0.075, 0.066, -0.016],
      [-0.085, 0.058, 0.058, -0.014],
      [-0.03, 0.053, 0.056, -0.008],
      [0.03, 0.054, 0.058, -0.006],
    ]),
    {
      // Adam's apple and the two neck muscles
      bulge: (an, y) =>
        1 +
        0.07 *
          Math.max(0, 1 - apart(an, FRONT) / 0.3) *
          Math.max(0, 1 - Math.abs(y + 0.045) / 0.02),
      paint: (an, y) =>
        y > -0.02 && apart(an, FRONT) < 1.2 ? tint(look.skin, '#4a2418', 0.22) : look.skin,
    },
  )
  return merged([neck, ...face(look), ...hairAndHeadwear(look)])
}

export function buildBody(look: Look): BodyShapes {
  const { skin, color } = look
  const both = (make: (side: 1 | -1) => BufferGeometry): Record<1 | -1, BufferGeometry> => ({
    [1]: make(1),
    [-1]: make(-1),
  })
  return {
    pelvis: pelvis(),
    torso: torso(color),
    head: head(look),
    thigh: both((s) => thigh(s, skin)),
    shin: both((s) => shin(s, skin, color)),
    foot: both(() => foot(color)),
    upperArm: both((s) => upperArm(s, skin, color)),
    forearm: both((s) => forearm(s, skin)),
    fist: fist(skin),
  }
}

export function disposeBody(b: BodyShapes): void {
  for (const g of [b.pelvis, b.torso, b.head, b.fist]) g.dispose()
  for (const pair of [b.thigh, b.shin, b.foot, b.upperArm, b.forearm]) {
    pair[1].dispose()
    pair[-1].dispose()
  }
}
