import { useFrame } from '@react-three/fiber'
import { COURT } from '@pickleball/shared'
import { useEffect, useLayoutEffect, useRef } from 'react'
import { Color, DoubleSide, type InstancedMesh, Object3D } from 'three'
import { playCheer, playHeartbeat } from '../audio/sfx'
import { useUi } from '../state/store'
import { frame } from './frame'
import { gamePointFor } from './gamePoint'

const CONFETTI = 220
const CONFETTI_SECONDS = 6
const COLORS = ['#f97316', '#8b5cf6', '#d9f23a', '#38bdf8', '#f43f5e', '#ffffff']
const HEARTBEAT_SECONDS = 0.95

function rand(i: number, salt: number): number {
  const x = Math.sin((i + 1) * 12.9898 + salt * 78.233) * 43758.5453
  return x - Math.floor(x)
}

/** Makes the crowd jump and shout; `strength` about 0.3 (polite) to 1.5 (wild). */
function cheer(strength: number): void {
  frame.cheerAt = frame.now
  frame.cheerStrength = strength
  playCheer(strength)
}

/** Crowd reactions, the game-point heartbeat, and confetti for the winner. */
export function Atmosphere() {
  const mesh = useRef<InstancedMesh>(null)
  const confettiAt = useRef(-100)
  const lastBeat = useRef(0)

  useEffect(
    () =>
      useUi.subscribe((s, prev) => {
        if (s.phase === 'pointOver' && prev.phase === 'rally') {
          // Longer rallies get louder crowds.
          cheer(Math.min(1.3, 0.35 + s.rallyShots * 0.08 + (s.lastRally?.ignited ? 0.4 : 0)))
        } else if (s.phase === 'gameOver' && prev.phase === 'pointOver') {
          cheer(1.5)
          confettiAt.current = frame.now
        } else if (s.phase === 'rally' && s.rallyShots > prev.rallyShots && s.rallyShots >= 8) {
          if (s.rallyShots % 4 === 0) cheer(0.4) // the crowd gets into a long rally
        }
      }),
    [],
  )

  useLayoutEffect(() => {
    const m = mesh.current
    if (!m) return
    const c = new Color()
    for (let i = 0; i < CONFETTI; i++) m.setColorAt(i, c.set(COLORS[i % COLORS.length] ?? '#fff'))
    if (m.instanceColor) m.instanceColor.needsUpdate = true
  }, [])

  const dummy = useRef(new Object3D())
  useFrame(() => {
    const now = frame.now
    const ui = useUi.getState()
    if (
      (ui.phase === 'serving' || ui.phase === 'rally') &&
      gamePointFor(ui.scores, ui.servingSlot) &&
      now - lastBeat.current > HEARTBEAT_SECONDS
    ) {
      lastBeat.current = now
      playHeartbeat()
    }

    const m = mesh.current
    if (!m) return
    const t = now - confettiAt.current
    m.visible = t < CONFETTI_SECONDS
    if (!m.visible) return
    const o = dummy.current
    for (let i = 0; i < CONFETTI; i++) {
      const delay = rand(i, 1) * 1.6
      const age = t - delay
      const y = 8.5 - Math.max(0, age) * (1.5 + rand(i, 2) * 1.2)
      const shown = age > 0 && y > 0
      o.position.set(
        (rand(i, 3) - 0.5) * COURT.width * 1.5 + Math.sin(age * 3 + i) * 0.3,
        Math.max(y, 0),
        (rand(i, 4) - 0.5) * COURT.length * 1.2,
      )
      o.rotation.set(age * (3 + rand(i, 5) * 4), age * 2, i)
      o.scale.setScalar(shown ? 1 : 0)
      o.updateMatrix()
      m.setMatrixAt(i, o.matrix)
    }
    m.instanceMatrix.needsUpdate = true
  })

  return (
    <instancedMesh
      ref={mesh}
      args={[undefined, undefined, CONFETTI]}
      frustumCulled={false}
      visible={false}
    >
      <planeGeometry args={[0.12, 0.07]} />
      <meshBasicMaterial side={DoubleSide} toneMapped={false} />
    </instancedMesh>
  )
}
