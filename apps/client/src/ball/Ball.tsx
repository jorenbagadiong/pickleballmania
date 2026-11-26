import { useFrame } from '@react-three/fiber'
import { BALL_RADIUS, SERVE_HOLD_FORWARD, SERVE_HOLD_HEIGHT } from '@pickleball/shared'
import { useMemo, useRef } from 'react'
import { CanvasTexture, Color, type Group, type Mesh, type MeshBasicMaterial } from 'three'
import { SPIN_COLOR } from '../game/colors'
import { frame } from '../game/frame'
import { useUi } from '../state/store'

/** Drawn a bit larger than a real ball so it stays readable from the camera. */
const VISUAL_RADIUS = BALL_RADIUS * 1.7
const TRAIL_LENGTH = 10
/** A curving ball leaves a longer trail, so the bend shows. */
const SPIN_TRAIL_LENGTH = 22
/** Turns per second drawn for full sidespin. */
const SPIN_TURNS = 6
const TRAIL_COLOR = '#ecfccb'
const FIRE_HOT = new Color('#ffc02e')
const FIRE_COOL = new Color('#ff2200')
const SMASH_TRAIL_COLOR = '#ff7a1a'

/** A pickleball's holes, so you can see the ball turning. */
function holesTexture(): CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 128
  const g = canvas.getContext('2d')
  if (g) {
    g.fillStyle = '#ffffff'
    g.fillRect(0, 0, 256, 128)
    g.fillStyle = '#4d5a10'
    for (const [row, y] of [28, 64, 100].entries()) {
      for (let i = 0; i < 6; i++) {
        g.beginPath()
        g.ellipse(((i + (row % 2) / 2) / 6) * 256 + 12, y, 8, 9, 0, 0, Math.PI * 2)
        g.fill()
      }
    }
  }
  return new CanvasTexture(canvas)
}

export function Ball() {
  const holes = useMemo(holesTexture, [])
  const ball = useRef<Mesh>(null)
  const shadow = useRef<Mesh>(null)
  const shadowMat = useRef<MeshBasicMaterial>(null)
  const trail = useRef<Group>(null)
  const history = useRef<Array<{ x: number; y: number; z: number }>>([])

  useFrame((_, delta) => {
    const b = ball.current
    const s = shadow.current
    if (!b || !s) return
    const w = frame.world
    if (!w || !w.ball.visible) {
      b.visible = false
      s.visible = false
      if (trail.current) trail.current.visible = false
      history.current.length = 0
      return
    }

    let { x, y, z } = w.ball
    if (w.ball.held) {
      // If we are the server, attach the held ball to our predicted hand so it doesn't lag.
      const ui = useUi.getState()
      if (ui.serverId === ui.sessionId && frame.local.valid) {
        x = frame.local.x + Math.sin(frame.local.yaw) * SERVE_HOLD_FORWARD
        z = frame.local.z + Math.cos(frame.local.yaw) * SERVE_HOLD_FORWARD
        y = SERVE_HOLD_HEIGHT
      }
      y += Math.sin(frame.now * 4) * 0.03
    }

    b.visible = true
    b.position.set(x, Math.max(y, VISUAL_RADIUS), z)
    const spin = w.ball.held ? 0 : frame.ballSpin
    b.rotation.y -= spin * SPIN_TURNS * Math.PI * 2 * delta

    // Ground shadow: shrinks and fades with height, which makes depth easy to read.
    s.visible = true
    s.position.set(x, 0.011, z)
    const h = Math.max(0, y)
    s.scale.setScalar(1 + h * 0.35)
    if (shadowMat.current) shadowMat.current.opacity = Math.max(0.12, 0.55 - h * 0.12)

    // Motion trail (only while in flight).
    const hist = history.current
    if (w.ball.held) {
      hist.length = 0
    } else {
      hist.unshift({ x, y, z })
      const length = spin !== 0 ? SPIN_TRAIL_LENGTH : TRAIL_LENGTH
      if (hist.length > length) hist.length = length
    }
    const tg = trail.current
    if (tg) {
      tg.visible = hist.length > 1
      tg.children.forEach((child, i) => {
        const p = hist[i + 1]
        child.visible = !!p
        const mat = (child as Mesh).material as MeshBasicMaterial
        if (frame.ballOnFire) {
          // Yellow-hot at the ball, cooling to red along a fat, flickering tail.
          mat.color.lerpColors(FIRE_HOT, FIRE_COOL, Math.min(i / TRAIL_LENGTH, 1))
          mat.opacity = 0.95 * (1 - i / hist.length)
        } else if (spin !== 0) {
          mat.color.set(frame.ballSmashed ? SMASH_TRAIL_COLOR : SPIN_COLOR)
          mat.opacity = 0.8 * (1 - i / hist.length)
        } else {
          mat.color.set(frame.ballSmashed ? SMASH_TRAIL_COLOR : TRAIL_COLOR)
          mat.opacity = frame.ballSmashed ? 0.9 - i * 0.08 : 0.35 - i * 0.03
        }
        if (p) {
          child.position.set(p.x, Math.max(p.y, VISUAL_RADIUS), p.z)
          const fire = frame.ballOnFire ? 1.9 + Math.sin(frame.now * 40 + i * 2) * 0.35 : 1
          child.scale.setScalar((1 - (i + 1) / (hist.length + 2)) * fire)
        }
      })
    }
  })

  return (
    <group>
      <mesh ref={ball} visible={false}>
        <sphereGeometry args={[VISUAL_RADIUS, 20, 14]} />
        <meshStandardMaterial
          color="#d9f23a"
          map={holes}
          emissive="#a3c21a"
          emissiveIntensity={0.35}
          roughness={0.5}
        />
      </mesh>
      <mesh ref={shadow} rotation-x={-Math.PI / 2} visible={false}>
        <circleGeometry args={[VISUAL_RADIUS * 1.2, 20]} />
        <meshBasicMaterial
          ref={shadowMat}
          color="#000000"
          transparent
          opacity={0.45}
          depthWrite={false}
        />
      </mesh>
      <group ref={trail}>
        {Array.from({ length: SPIN_TRAIL_LENGTH - 1 }, (_, i) => (
          <mesh key={i} visible={false}>
            <sphereGeometry args={[VISUAL_RADIUS * 0.8, 8, 6]} />
            <meshBasicMaterial
              color={TRAIL_COLOR}
              transparent
              opacity={0}
              depthWrite={false}
              toneMapped={false}
            />
          </mesh>
        ))}
      </group>
    </group>
  )
}
