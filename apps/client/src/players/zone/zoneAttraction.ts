/**
 * TEZUKA ZONE attraction (Phase D2): thin energy ribbons from the drawn ball to the
 * targeted athlete's field, and motes flowing along them toward the athlete.
 *
 * - **Draw calls:** the ribbons are one instanced draw, the motes one points draw.
 * - **Path:** every point of every ribbon is computed on the GPU from a few uniforms: the
 *   ball's position in the field's own space, and the direction of the server's pull.
 * - **No prediction:** the ribbons connect where the ball is drawn now to the field. They
 *   never show a future path.
 */
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  InstancedBufferGeometry,
  ShaderMaterial,
  Vector2,
  Vector3,
  Vector4,
} from 'three'
import { TIERS, type TierConfig, ZONE_COLORS } from './zoneFx'

/** Columns along each ribbon. */
const SEGMENTS = 40
export const MAX_RIBBONS = 3
export const MAX_STREAM_MOTES = Math.max(...Object.values(TIERS).map((t) => t.streamMotes))
/** Where the ribbons land: the field's main ring (zoneResources' ground shader, 0.84 m). */
const RING = 0.84

/** The path shared by ribbons and motes: from the ball (u = 0) to the ring (u = 1). */
const pathChunk = /* glsl */ `
uniform vec3 uBall;
uniform vec2 uDir;
uniform float uTime;
uniform vec4 uSeeds[${MAX_RIBBONS}];

vec3 bez(vec3 a, vec3 b, vec3 c, vec3 d, float u) {
  float v = 1.0 - u;
  return v * v * v * a + 3.0 * v * v * u * b + 3.0 * v * u * u * c + u * u * u * d;
}
vec3 bezT(vec3 a, vec3 b, vec3 c, vec3 d, float u) {
  float v = 1.0 - u;
  return 3.0 * v * v * (b - a) + 6.0 * v * u * (c - b) + 3.0 * u * u * (d - c);
}
// Ribbon with seed s: it leaves the ball along the server's pull (blended with the way to
// the athlete), lands on the side of the ring facing the ball, and swirls slowly between.
vec3 path(float u, vec4 s, out vec3 tangent) {
  vec2 flat2 = uBall.xz;
  float d = max(length(flat2), 1e-3);
  vec2 radial = flat2 / d;
  float a = atan(radial.y, radial.x) + (s.x - 0.5) * 1.3;
  vec2 ring = vec2(cos(a), sin(a));
  vec3 p0 = uBall;
  vec3 p3 = vec3(ring.x * ${RING.toFixed(2)}, 0.03, ring.y * ${RING.toFixed(2)});
  float len = length(p3 - p0);
  vec3 toward = normalize(p3 - p0 + vec3(0.0, 1e-4, 0.0));
  vec3 pull = vec3(uDir.x, 0.0, uDir.y);
  vec3 lead = length(uDir) > 0.001 ? normalize(mix(toward, pull, 0.6) + toward * 0.05) : toward;
  vec3 p1 = p0 + lead * len * 0.35;
  vec3 p2 = p3 + vec3(ring.x, 0.0, ring.y) * len * 0.22
    + vec3(0.0, (0.25 + 0.35 * s.y) * min(1.0, len / 3.0), 0.0);
  vec3 p = bez(p0, p1, p2, p3, u);
  tangent = normalize(bezT(p0, p1, p2, p3, u) + vec3(1e-5));
  vec3 side = normalize(cross(tangent, vec3(0.0, 1.0, 0.0)) + vec3(1e-5, 0.0, 0.0));
  vec3 up = cross(side, tangent);
  float ph = s.z * 6.2831853 + uTime * (1.1 + s.w) + u * 4.0;
  float amp = 0.09 * sin(3.14159265 * u) * (0.5 + s.y) * min(1.0, len / 2.0);
  return p + (side * cos(ph) + up * sin(ph)) * amp;
}
`

const ribbonVertex = /* glsl */ `
${pathChunk}
uniform float uLevel;
varying float vU;
varying float vV;
varying float vS;
void main() {
  vec4 s = uSeeds[gl_InstanceID];
  float u = position.x;
  float v = position.y;
  vec3 t;
  vec3 p = path(u, s, t);
  // Facing the camera: widen across the path, as seen from where the camera is.
  vec3 cam = cameraPosition - modelMatrix[3].xyz;
  vec3 across = normalize(cross(t, cam - p) + vec3(0.0, 1e-5, 0.0));
  float w = (0.007 + 0.006 * s.y) * pow(max(sin(3.14159265 * u), 0.0), 0.5) * (0.6 + 0.4 * uLevel);
  p += across * v * w;
  vU = u;
  vV = v;
  vS = s.z;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`

const ribbonFragment = /* glsl */ `
uniform float uLevel;
uniform float uPull;
uniform float uTime;
uniform vec3 uBlue;
uniform vec3 uCyan;
uniform vec3 uHighlight;
uniform vec3 uWhite;
varying float vU;
varying float vV;
varying float vS;
void main() {
  float edge = 1.0 - vV * vV;
  // Clear of the ball itself, and settling into the ring at the athlete's end.
  float a = edge * smoothstep(0.05, 0.2, vU) * (1.0 - 0.6 * smoothstep(0.9, 1.0, vU));
#if FLOW
  // Streaks travelling from the ball toward the athlete.
  float f = fract(vU * 2.2 - uTime * (1.3 + vS) + vS * 3.0);
  float streak = smoothstep(0.0, 0.2, f) * (1.0 - smoothstep(0.3, 0.55, f));
#else
  float streak = 0.35;
#endif
#if SHIMMER
  streak = clamp(streak + 0.15 * sin(vU * 40.0 - uTime * 9.0) * edge, 0.0, 1.0);
#endif
  vec3 col = mix(uBlue * 1.2, uCyan, 0.5 + 0.5 * streak);
  col = mix(col, uHighlight, streak * 0.6);
  col = mix(col, uWhite, pow(edge, 6.0) * streak * uPull * 0.5);
  gl_FragColor = vec4(col * a * (0.15 + 0.85 * streak) * uLevel * 0.6, 1.0);
  #include <colorspace_fragment>
}
`

const streamVertex = /* glsl */ `
${pathChunk}
attribute vec4 seed;
uniform float uLevel;
uniform float uScale;
uniform float uRibbons;
varying float vA;
void main() {
  int k = int(min(floor(seed.w * uRibbons), uRibbons - 1.0));
  float u = fract(uTime * (0.45 + 0.35 * seed.y) + seed.x);
  vec3 t;
  vec3 p = path(u, uSeeds[k], t);
  p += (seed.yzx - 0.5) * 0.05 * sin(3.14159265 * u);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  vA = sin(3.14159265 * u) * smoothstep(0.05, 0.2, u) * uLevel;
  gl_PointSize = max(1.0, uScale * (0.016 + 0.008 * seed.z) / -mv.z);
}
`

const streamFragment = /* glsl */ `
uniform vec3 uCyan;
uniform vec3 uHighlight;
varying float vA;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.1, d) * vA;
  if (a < 0.004) discard;
  gl_FragColor = vec4(mix(uCyan, uHighlight, 0.5) * a * 0.8, 1.0);
  #include <colorspace_fragment>
}
`

/** Fixed randomness, so every client draws the same ribbons. */
function rand(i: number, salt: number): number {
  const x = Math.sin((i + 1) * 91.345 + salt * 47.853) * 24634.6345
  return x - Math.floor(x)
}

/** Where the ribbons land along the ring, for each count: centred, then either side. */
const SPREAD: Record<1 | 2 | 3, number[]> = { 1: [0.5], 2: [0.32, 0.68], 3: [0.5, 0.18, 0.82] }

export interface AttractionResources {
  ribbonGeometry: InstancedBufferGeometry
  ribbons: ShaderMaterial
  streamGeometry: BufferGeometry
  stream: ShaderMaterial
  /** The ball in the field's space; written in place before each draw. */
  ball: Vector3
  configure(c: TierConfig): void
  set(time: number, level: number, pull: number, dirX: number, dirZ: number, scale: number): void
  dispose(): void
}

function defines(c: TierConfig) {
  return { FLOW: c.flow ? 1 : 0, SHIMMER: c.shimmer ? 1 : 0 }
}

export function createAttractionResources(initial: TierConfig): AttractionResources {
  // One strip, u along it (0 at the ball), v across it (-1..1); instanced per ribbon.
  const ribbonGeometry = new InstancedBufferGeometry()
  const pos = new Float32Array((SEGMENTS + 1) * 2 * 3)
  const index: number[] = []
  for (let i = 0; i <= SEGMENTS; i++) {
    const u = i / SEGMENTS
    pos.set([u, -1, 0, u, 1, 0], i * 6)
    if (i < SEGMENTS) index.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2)
  }
  ribbonGeometry.setAttribute('position', new BufferAttribute(pos, 3))
  ribbonGeometry.setIndex(index)

  const seeds = new Float32Array(MAX_STREAM_MOTES * 4)
  for (let i = 0; i < seeds.length; i++) seeds[i] = rand(i >> 2, i & 3)
  const streamGeometry = new BufferGeometry()
  streamGeometry.setAttribute(
    'position',
    new BufferAttribute(new Float32Array(MAX_STREAM_MOTES * 3), 3),
  )
  streamGeometry.setAttribute('seed', new BufferAttribute(seeds, 4))

  const ball = new Vector3()
  // Shared by both materials: one write per frame drives the ribbons and the motes.
  const uniforms = {
    uBall: { value: ball },
    uDir: { value: new Vector2() },
    uTime: { value: 0 },
    uLevel: { value: 0 },
    uPull: { value: 0 },
    uScale: { value: 600 },
    uRibbons: { value: 1 },
    uSeeds: { value: Array.from({ length: MAX_RIBBONS }, () => new Vector4()) },
    uBlue: { value: new Color(ZONE_COLORS.blue) },
    uCyan: { value: new Color(ZONE_COLORS.cyan) },
    uHighlight: { value: new Color(ZONE_COLORS.highlight) },
    uWhite: { value: new Color(ZONE_COLORS.white) },
  }
  const common = {
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    toneMapped: false,
    uniforms,
  }
  const ribbons = new ShaderMaterial({
    ...common,
    vertexShader: ribbonVertex,
    fragmentShader: ribbonFragment,
    defines: defines(initial),
  })
  const stream = new ShaderMaterial({
    ...common,
    vertexShader: streamVertex,
    fragmentShader: streamFragment,
  })

  let current = defines(initial)
  let count = 0
  const res: AttractionResources = {
    ribbonGeometry,
    ribbons,
    streamGeometry,
    stream,
    ball,
    configure(c) {
      const next = defines(c)
      if (next.FLOW !== current.FLOW || next.SHIMMER !== current.SHIMMER) {
        current = next
        ribbons.defines = next
        ribbons.needsUpdate = true
      }
      if (c.ribbons !== count) {
        count = c.ribbons
        SPREAD[c.ribbons].forEach((x, i) =>
          uniforms.uSeeds.value[i]!.set(x, rand(i, 7), rand(i, 8), rand(i, 9)),
        )
        uniforms.uRibbons.value = c.ribbons
        ribbonGeometry.instanceCount = c.ribbons
      }
      streamGeometry.setDrawRange(0, c.streamMotes)
    },
    set(time, level, pull, dirX, dirZ, scale) {
      uniforms.uTime.value = time
      uniforms.uLevel.value = level
      uniforms.uPull.value = pull
      uniforms.uDir.value.set(dirX, dirZ)
      uniforms.uScale.value = scale
    },
    dispose() {
      ribbonGeometry.dispose()
      ribbons.dispose()
      streamGeometry.dispose()
      stream.dispose()
    },
  }
  res.configure(initial)
  return res
}
