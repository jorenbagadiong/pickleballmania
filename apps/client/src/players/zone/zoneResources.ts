/**
 * The GPU side of the TEZUKA ZONE field: one ground disc whose rings, markings, pulse and
 * glow are all drawn by its shader, and one fixed buffer of motes moved entirely on the
 * GPU. Nothing is allocated per frame; animation is uniforms only. Every field owns its
 * resources and frees them with `dispose()`.
 */
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  PlaneGeometry,
  ShaderMaterial,
  Sphere,
  Vector3,
} from 'three'
import { FIELD_RADIUS, TIERS, type TierConfig, ZONE_COLORS } from './zoneFx'

/** Above the court, its lines, the player ring (0.012) and the fire glow (0.016). */
export const FIELD_HEIGHT = 0.018
export const MAX_PARTICLES = Math.max(...Object.values(TIERS).map((t) => t.particles))

const groundVertex = /* glsl */ `
varying vec2 vP;
void main() {
  vP = (uv - 0.5) * 2.0 * ${FIELD_RADIUS.toFixed(3)};
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const groundFragment = /* glsl */ `
uniform float uTime;
uniform float uPresence;
uniform float uPull;
uniform vec3 uDeep;
uniform vec3 uBlue;
uniform vec3 uCyan;
uniform vec3 uHighlight;
uniform vec3 uWhite;
varying vec2 vP;

const float TAU = 6.2831853;

// 1 on a ring of radius c and half width w, softened by one pixel.
float ring(float r, float c, float w, float aa) {
  return 1.0 - smoothstep(w - aa, w + aa, abs(r - c));
}
// 1 along n arcs round the circle, with gaps of share g, turned by s turns.
float arcs(float turn, float n, float g, float s) {
  float f = fract(turn * n + s);
  return smoothstep(0.0, 0.02, f - g * 0.5) * smoothstep(0.0, 0.02, 1.0 - g * 0.5 - f);
}

void main() {
  float r = length(vP);
  if (r > ${FIELD_RADIUS.toFixed(3)}) discard;
  float aa = max(fwidth(r), 1e-4);
  float turn = atan(vP.y, vP.x) / TAU + 0.5;
  float t = uTime;
  float pull = uPull;

  // Soft blue light on the ground, strongest in a band round the feet, never at the rim.
  float glow = (exp(-pow((r - 0.6) / 0.28, 2.0)) + 0.3 * exp(-pow(r / 0.45, 2.0)))
    * (1.0 - smoothstep(0.7, 0.98, r));
  vec3 col = mix(uDeep, uBlue, 0.4 + 0.5 * pull) * glow * (0.09 + 0.11 * pull);

  // The main ring: six long arcs, turning slowly.
  float main = ring(r, 0.84, 0.016 + 0.006 * pull, aa) * arcs(turn, 6.0, 0.07, t * 0.05);
  col += mix(uBlue * 1.3, uCyan, 0.3 + 0.7 * pull) * main * (0.45 + 0.75 * pull);

#if SECONDARY > 0
  // Inner dashed ring, turning the other way.
  float inner = ring(r, 0.68, 0.007, aa) * arcs(turn, 28.0, 0.42, -t * 0.09);
  col += uCyan * inner * (0.18 + 0.42 * pull);
#endif
#if SECONDARY > 1
  // Outer hairline in three arcs, turning the other way again.
  float outer = ring(r, 0.95, 0.0045, aa) * arcs(turn, 3.0, 0.22, -t * 0.03);
  col += uHighlight * outer * (0.16 + 0.4 * pull);
#endif
#if MARKINGS
  // Segmented markings just outside the main ring, turning with it.
  float ticks = (1.0 - smoothstep(0.0, aa * 2.0 + 0.004, abs(r - 0.895) - 0.018))
    * arcs(turn, 48.0, 0.78, t * 0.05);
  col += uHighlight * ticks * (0.12 + 0.45 * pull);
#endif
#if PULSE
  // A pulse travelling outward; quicker and brighter while pulling.
  float p = fract(t * mix(0.4, 1.1, pull));
  float wave = ring(r, mix(0.45, 0.97, p), 0.02, aa) * pow(1.0 - p, 2.0);
  col += mix(uHighlight, uWhite, pull) * wave * (0.15 + 0.65 * pull);
#endif

  // Fade out toward the rim so no hard edge sits on the court lines.
  col *= uPresence * (1.0 - smoothstep(0.97, ${FIELD_RADIUS.toFixed(3)}, r));
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`

const moteVertex = /* glsl */ `
attribute vec4 seed;
uniform float uTime;
uniform float uPresence;
uniform float uPull;
uniform float uScale;
varying float vAlpha;
void main() {
  float life = mix(2.8, 1.6, uPull);
  float age = fract(uTime / life + seed.x);
  float dir = seed.w > 0.5 ? 1.0 : -1.0;
  float angle = seed.y * 6.2831853 + uTime * (0.25 + 0.3 * seed.z) * dir;
  // Rising from the ring and drifting in toward the player, as if drawn in.
  float radius = mix(0.9, 0.5, age * (0.4 + 0.4 * uPull)) * (0.9 + 0.15 * seed.z);
  vec3 p = vec3(cos(angle) * radius, 0.05 + age * (0.55 + 0.35 * seed.w), sin(angle) * radius);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  vAlpha = smoothstep(0.0, 0.15, age) * (1.0 - smoothstep(0.65, 1.0, age))
    * uPresence * (0.35 + 0.65 * uPull);
  gl_PointSize = max(1.0, uScale * (0.022 + 0.01 * seed.z) / -mv.z);
}
`

const moteFragment = /* glsl */ `
uniform vec3 uCyan;
uniform vec3 uHighlight;
uniform float uPull;
varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.1, d) * vAlpha;
  if (a < 0.004) discard;
  gl_FragColor = vec4(mix(uCyan, uHighlight, 0.4 + 0.4 * uPull) * a, 1.0);
  #include <colorspace_fragment>
}
`

function sharedUniforms() {
  return {
    uTime: { value: 0 },
    uPresence: { value: 0 },
    uPull: { value: 0 },
    uDeep: { value: new Color(ZONE_COLORS.deep) },
    uBlue: { value: new Color(ZONE_COLORS.blue) },
    uCyan: { value: new Color(ZONE_COLORS.cyan) },
    uHighlight: { value: new Color(ZONE_COLORS.highlight) },
    uWhite: { value: new Color(ZONE_COLORS.white) },
  }
}

/** Fixed randomness, so every client draws the same field. */
function rand(i: number, salt: number): number {
  const x = Math.sin((i + 1) * 12.9898 + salt * 78.233) * 43758.5453
  return x - Math.floor(x)
}

export interface ZoneResources {
  groundGeometry: PlaneGeometry
  ground: ShaderMaterial
  moteGeometry: BufferGeometry
  motes: ShaderMaterial
  /** Applies a detail level (recompiles the ground shader only when it changes). */
  configure(c: TierConfig): void
  /** Every uniform the frame changes, written in place. */
  set(time: number, presence: number, pull: number, scale: number): void
  dispose(): void
}

function defines(c: TierConfig) {
  return {
    SECONDARY: c.secondaryRings,
    MARKINGS: c.markings ? 1 : 0,
    PULSE: c.pulse ? 1 : 0,
  }
}

export function createZoneResources(initial: TierConfig): ZoneResources {
  const groundGeometry = new PlaneGeometry(FIELD_RADIUS * 2, FIELD_RADIUS * 2)
  groundGeometry.rotateX(-Math.PI / 2)
  const common = {
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    toneMapped: false,
  }
  const ground = new ShaderMaterial({
    ...common,
    uniforms: sharedUniforms(),
    vertexShader: groundVertex,
    fragmentShader: groundFragment,
    defines: defines(initial),
    // Never fights the court, its lines or the other ground marks for depth.
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  })

  const seeds = new Float32Array(MAX_PARTICLES * 4)
  for (let i = 0; i < seeds.length; i++) seeds[i] = rand(i >> 2, i & 3)
  const moteGeometry = new BufferGeometry()
  // Positions are computed in the shader; this only gives the points a count and bounds.
  moteGeometry.setAttribute('position', new BufferAttribute(new Float32Array(MAX_PARTICLES * 3), 3))
  moteGeometry.setAttribute('seed', new BufferAttribute(seeds, 4))
  // Every mote stays within this of the field's centre.
  moteGeometry.boundingSphere = new Sphere(new Vector3(0, 0.6, 0), FIELD_RADIUS + 0.8)
  const motes = new ShaderMaterial({
    ...common,
    uniforms: { ...sharedUniforms(), uScale: { value: 600 } },
    vertexShader: moteVertex,
    fragmentShader: moteFragment,
  })

  let current = defines(initial)
  const res: ZoneResources = {
    groundGeometry,
    ground,
    moteGeometry,
    motes,
    configure(c) {
      const next = defines(c)
      if (
        next.SECONDARY !== current.SECONDARY ||
        next.MARKINGS !== current.MARKINGS ||
        next.PULSE !== current.PULSE
      ) {
        current = next
        ground.defines = next
        ground.needsUpdate = true
      }
      moteGeometry.setDrawRange(0, c.particles)
    },
    set(time, presence, pull, scale) {
      for (const m of [ground, motes]) {
        m.uniforms.uTime!.value = time
        m.uniforms.uPresence!.value = presence
        m.uniforms.uPull!.value = pull
      }
      motes.uniforms.uScale!.value = scale
    },
    dispose() {
      groundGeometry.dispose()
      ground.dispose()
      moteGeometry.dispose()
      motes.dispose()
    },
  }
  res.configure(initial)
  return res
}
