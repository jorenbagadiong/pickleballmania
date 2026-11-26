import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import { DoubleSide, type Group } from 'three'
import { controls, plannedSpin } from '../input/controls'
import { useUi } from '../state/store'
import { SPIN_COLOR, playerColor } from './colors'
import { frame } from './frame'

/** After a curved swing the ring stays on its target this long (seconds). */
const SHOW_SHOT_SECONDS = 0.35

/** Ground marker showing where the mouse is aiming the next shot. */
export function AimReticle() {
  const slot = useUi((s) => s.mySlot)
  const spot = useUi((s) => s.players.find((p) => p.id === s.sessionId)?.spot ?? 0)
  const ref = useRef<Group>(null)
  const spinRef = useRef<Group>(null)

  useFrame(() => {
    const g = ref.current
    if (!g) return
    g.visible = frame.local.valid
    // A swipe carries the mouse away from the target, so show where the shot went.
    const last = frame.localShot
    const showLast = last.spin !== 0 && frame.now - last.at < SHOW_SHOT_SECONDS
    const spin = showLast ? last.spin : plannedSpin(frame.now).spin
    const aim = showLast ? last.aim : controls.aim
    g.position.set(aim.x, 0.014, aim.z)
    const pulse = 1 + Math.sin(frame.now * 6) * 0.08
    g.scale.setScalar(pulse)
    const s = spinRef.current
    if (s) {
      // A bent arrow along the shot's path, showing which way it will curve.
      s.visible = spin !== 0
      const side = slot === 1 ? -1 : 1
      s.rotation.y = side === 1 ? 0 : Math.PI
      // Longer and bolder the more it curves.
      const size = 0.6 + Math.abs(spin) * 0.6
      s.scale.set(Math.sign(spin) * size || 1, 1, size)
    }
  })

  if (slot === null) return null
  const color = playerColor(slot, spot)
  return (
    <group ref={ref} visible={false}>
      <mesh rotation-x={-Math.PI / 2}>
        <ringGeometry args={[0.22, 0.3, 32]} />
        <meshBasicMaterial color={color} transparent opacity={0.9} depthWrite={false} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2}>
        <circleGeometry args={[0.05, 12]} />
        <meshBasicMaterial color={color} depthWrite={false} />
      </mesh>
      {/* Drawn for a right-hand curve seen from the +z side; mirrored for a left one. */}
      <group ref={spinRef} visible={false}>
        <mesh rotation-x={-Math.PI / 2} position={[0.1, 0.002, 0.45]}>
          <ringGeometry args={[0.95, 1.08, 24, 1, Math.PI * 0.62, Math.PI * 0.42]} />
          <meshBasicMaterial
            color={SPIN_COLOR}
            side={DoubleSide}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, -Math.PI * 0.38]} position={[-0.17, 0.003, -0.58]}>
          <circleGeometry args={[0.26, 3, Math.PI / 2]} />
          <meshBasicMaterial
            color={SPIN_COLOR}
            side={DoubleSide}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      </group>
    </group>
  )
}
