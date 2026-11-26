import { BufferAttribute, BufferGeometry, Color, type ColorRepresentation, Object3D } from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

/** One cross-section of a sculpted shape: an ellipse (or rounder-cornered) at height y. */
export interface Ring {
  y: number
  /** Half-width (x) and half-depth (z). */
  rx: number
  rz: number
  /** Center offset. */
  cx?: number
  cz?: number
}

/** Short form: [y, rx, rz, cz]. */
export function rings(rows: ReadonlyArray<readonly [number, number, number, number?]>): Ring[] {
  return rows.map(([y, rx, rz, cz = 0]) => ({ y, rx, rz, cz }))
}

export type Paint = ColorRepresentation | ((angle: number, y: number) => ColorRepresentation)

interface LoftOptions {
  segments?: number
  /** 2 = ellipse; higher = squarer (a chest is not a tube). */
  squareness?: number
  /** Pushes the surface in or out at a spot (factor). */
  bulge?: (angle: number, y: number) => number
  /** Color, by angle (0 is +x, PI/2 the front) and height. */
  paint: Paint
  /** Sharp edges between colors (cloth) instead of blending them (skin). */
  crisp?: boolean
}

const scratch = new Color()

/**
 * A smooth skin over cross-sections, closed at both ends. Angles go around the
 * vertical: 0 at +x, PI/2 at the front (+z).
 */
export function loft(sections: Ring[], o: LoftOptions): BufferGeometry {
  const segments = o.segments ?? 18
  const power = 2 / (o.squareness ?? 2)
  const position: number[] = []
  const color: number[] = []
  const index: number[] = []
  const round = (v: number): number => Math.sign(v) * Math.abs(v) ** power

  const put = (x: number, y: number, z: number, angle: number): void => {
    position.push(x, y, z)
    const c = typeof o.paint === 'function' ? o.paint(angle, y) : o.paint
    scratch.set(c)
    color.push(scratch.r, scratch.g, scratch.b)
  }
  for (const r of sections) {
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2
      const k = o.bulge?.(a, r.y) ?? 1
      put(
        (r.cx ?? 0) + round(Math.cos(a)) * r.rx * k,
        r.y,
        (r.cz ?? 0) + round(Math.sin(a)) * r.rz * k,
        a,
      )
    }
  }
  // Which way round the triangles go depends on whether the rings go up or down.
  const last = sections[sections.length - 1] as Ring
  const first = sections[0] as Ring
  const up = last.y > first.y
  const tri = (a: number, b: number, c: number): void => {
    if (up) index.push(a, b, c)
    else index.push(a, c, b)
  }
  for (let j = 0; j + 1 < sections.length; j++) {
    for (let i = 0; i < segments; i++) {
      const n = (i + 1) % segments
      const a = j * segments + i
      const b = j * segments + n
      tri(a, a + segments, b)
      tri(b, a + segments, b + segments)
    }
  }
  // Closed ends.
  const cap = (j: number, r: Ring, top: boolean): void => {
    const center = position.length / 3
    put(r.cx ?? 0, r.y, r.cz ?? 0, 0)
    for (let i = 0; i < segments; i++) {
      const a = j * segments + i
      const b = j * segments + ((i + 1) % segments)
      if (top) tri(a, center, b)
      else tri(b, center, a)
    }
  }
  cap(0, first, false)
  cap(sections.length - 1, last, true)

  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(new Float32Array(position), 3))
  g.setAttribute('color', new BufferAttribute(new Float32Array(color), 3))
  g.setIndex(index)
  g.computeVertexNormals()
  const flat = g.toNonIndexed()
  g.dispose()
  if (o.crisp && typeof o.paint === 'function') paintTriangles(flat, sections, o.paint)
  return flat
}

/** One color per triangle, so cloth has clean edges. */
function paintTriangles(
  g: BufferGeometry,
  sections: Ring[],
  paint: (angle: number, y: number) => ColorRepresentation,
): void {
  const pos = g.getAttribute('position')
  const col = g.getAttribute('color')
  const centerAt = (y: number): { cx: number; cz: number } => {
    let best = sections[0] as Ring
    for (const r of sections) if (Math.abs(r.y - y) < Math.abs(best.y - y)) best = r
    return { cx: best.cx ?? 0, cz: best.cz ?? 0 }
  }
  // Both triangles of a quad get the color of its middle.
  const quads = Math.floor(pos.count / 6)
  for (let i = 0; i < pos.count; i += 3) {
    const pair = Math.min(Math.floor(i / 6), quads - 1) * 6
    let x = 0
    let y = 0
    let z = 0
    for (let k = 0; k < 6; k++) {
      x += pos.getX(pair + k) / 6
      y += pos.getY(pair + k) / 6
      z += pos.getZ(pair + k) / 6
    }
    const { cx, cz } = centerAt(y)
    scratch.set(paint(Math.atan2(z - cz, x - cx), y))
    for (let k = 0; k < 3; k++) col.setXYZ(i + k, scratch.r, scratch.g, scratch.b)
  }
}

/** A ready-made three.js shape in one color, placed, ready to be merged. */
export function piece(
  geo: BufferGeometry,
  color: ColorRepresentation,
  place?: (o: Object3D) => void,
): BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo
  if (g !== geo) geo.dispose()
  if (place) moved(g, place)
  scratch.set(color)
  const count = g.getAttribute('position').count
  const colors = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) scratch.toArray(colors, i * 3)
  g.setAttribute('color', new BufferAttribute(colors, 3))
  g.deleteAttribute('uv')
  return g
}

export function moved(g: BufferGeometry, place: (o: Object3D) => void): BufferGeometry {
  const o = new Object3D()
  place(o)
  o.updateMatrix()
  g.applyMatrix4(o.matrix)
  return g
}

/** Merges pieces into a single draw call. */
export function merged(parts: BufferGeometry[]): BufferGeometry {
  const g = mergeGeometries(parts)
  for (const p of parts) p.dispose()
  return g
}

const a = new Color()
const b = new Color()
/** A color between two others. */
export function tint(from: ColorRepresentation, to: ColorRepresentation, t: number): string {
  return `#${a.set(from).lerp(b.set(to), t).getHexString()}`
}
