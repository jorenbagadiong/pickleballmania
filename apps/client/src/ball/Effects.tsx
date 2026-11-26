import { useFrame } from '@react-three/fiber'
import { isOnFire } from '@pickleball/shared'
import { useRef } from 'react'
import type { Group, Mesh, MeshBasicMaterial } from 'three'
import { playBounce, playHit, playNet, playPerfect, playSmash } from '../audio/sfx'
import { playerColor } from '../game/colors'
import { frame } from '../game/frame'
import { pendingFx } from '../net/session'
import { notePracticeBounce, notePracticeHit } from '../game/practice'
import { isSmash } from '../players/swingPose'
import { useUi } from '../state/store'

const POOL = 16
const SMASH_COLOR = '#fb923c'
const SPARKS = 10
const SPARK_SECONDS = 0.35
const SPARK_SPEED = 4.5

interface Active {
  kind: 'hit' | 'bounce' | 'net'
  start: number
  duration: number
  x: number
  y: number
  z: number
  color: string
  maxScale: number
}

/**
 * Visual feedback for server events (successful hits, bounces, net cords).
 * Events are shown when the interpolated ball reaches the moment they happened,
 * so the flash lines up with what the player sees.
 */
export function Effects() {
  const meshes = useRef<Array<Mesh | null>>([])
  const active = useRef<Array<Active | null>>(Array.from({ length: POOL }, () => null))
  const next = useRef(0)
  const sparks = useRef<Group>(null)
  const smash = useRef({ at: -10, x: 0, y: 0, z: 0 })

  useFrame(({ camera }) => {
    const now = frame.now

    const show = (a: Active): void => {
      active.current[next.current] = a
      next.current = (next.current + 1) % POOL
    }

    // Activate due events.
    for (let i = pendingFx.length - 1; i >= 0; i--) {
      const e = pendingFx[i]
      if (!e || e.at > now) continue
      pendingFx.splice(i, 1)
      if (now - e.at > 1) continue // stale (tab was hidden)
      let a: Active
      if (e.kind === 'hit') {
        const slot = e.slot === 1 ? 1 : 0
        frame.hitFlashAt[e.id] = now
        const hitter = useUi.getState().players.find((p) => p.id === e.id)
        const spot = hitter?.spot ?? 0
        notePracticeHit(e)
        frame.ballOnFire = isOnFire(hitter?.streak ?? 0)
        frame.contact[e.id] = { at: now, x: e.x, y: e.y, z: e.z }
        playHit(e.power)
        if (e.perfect) {
          playPerfect()
          frame.shake = Math.max(frame.shake, 0.05)
          useUi.setState({
            callout: { text: e.jump ? 'PERFECT JUMP SMASH!' : 'PERFECT!', key: now },
          })
          show({
            kind: 'hit',
            start: now,
            duration: 0.45,
            x: e.x,
            y: e.y,
            z: e.z,
            color: '#fde047',
            maxScale: 2,
          })
        }
        frame.ballSpin = e.spin
        frame.ballSmashed = isSmash(e.power)
        if (frame.ballSmashed) {
          playSmash()
          frame.shake = Math.max(frame.shake, e.jump ? 0.22 : 0.15)
          if (e.jump && !e.perfect) {
            useUi.setState({ callout: { text: 'JUMP SMASH!', key: now } })
          }
          smash.current = { at: now, x: e.x, y: e.y, z: e.z }
          show({
            kind: 'hit',
            start: now,
            duration: 0.5,
            x: e.x,
            y: e.y,
            z: e.z,
            color: SMASH_COLOR,
            maxScale: e.jump ? 3.6 : 2.6,
          })
        }
        a = {
          kind: 'hit',
          start: now,
          duration: 0.4,
          x: e.x,
          y: e.y,
          z: e.z,
          color: playerColor(slot, spot),
          maxScale: 1.4 + e.power,
        }
      } else if (e.kind === 'bounce') {
        playBounce()
        notePracticeBounce(e)
        a = {
          kind: 'bounce',
          start: now,
          duration: 0.6,
          x: e.x,
          y: 0.015,
          z: e.z,
          color: e.inBounds ? '#ffffff' : '#ef4444',
          maxScale: e.inBounds ? 0.7 : 1.1,
        }
      } else {
        playNet()
        a = {
          kind: 'net',
          start: now,
          duration: 0.5,
          x: e.x,
          y: e.y,
          z: e.z,
          color: '#f59e0b',
          maxScale: 1.2,
        }
      }
      show(a)
    }

    // Sparks fly out from the point of a smash.
    const sg = sparks.current
    if (sg) {
      const t = now - smash.current.at
      sg.visible = t >= 0 && t < SPARK_SECONDS
      if (sg.visible) {
        sg.position.set(smash.current.x, smash.current.y, smash.current.z)
        sg.quaternion.copy(camera.quaternion)
        const p = t / SPARK_SECONDS
        const r = SPARK_SPEED * t * (1 - p * 0.5)
        sg.children.forEach((child, i) => {
          const angle = (i / SPARKS) * Math.PI * 2
          child.position.set(Math.cos(angle) * r, Math.sin(angle) * r, 0)
          child.rotation.z = angle
          child.scale.set(1 - p * 0.5, 1 - p, 1)
        })
      }
    }

    // Animate.
    for (let i = 0; i < POOL; i++) {
      const m = meshes.current[i]
      const a = active.current[i]
      if (!m) continue
      if (!a) {
        m.visible = false
        continue
      }
      const p = (now - a.start) / a.duration
      if (p >= 1) {
        active.current[i] = null
        m.visible = false
        continue
      }
      m.visible = true
      m.position.set(a.x, a.y, a.z)
      if (a.kind === 'bounce') m.rotation.set(-Math.PI / 2, 0, 0)
      else m.quaternion.copy(camera.quaternion)
      m.scale.setScalar(0.15 + p * a.maxScale)
      const mat = m.material as MeshBasicMaterial
      mat.color.set(a.color)
      mat.opacity = 1 - p
    }
  })

  return (
    <group>
      <group ref={sparks} visible={false}>
        {Array.from({ length: SPARKS }, (_, i) => (
          <mesh key={i}>
            <planeGeometry args={[0.28, 0.06]} />
            <meshBasicMaterial color={SMASH_COLOR} depthWrite={false} toneMapped={false} />
          </mesh>
        ))}
      </group>
      {Array.from({ length: POOL }, (_, i) => (
        <mesh
          key={i}
          ref={(m) => {
            meshes.current[i] = m
          }}
          visible={false}
        >
          <ringGeometry args={[0.32, 0.4, 32]} />
          <meshBasicMaterial transparent depthWrite={false} toneMapped={false} />
        </mesh>
      ))}
    </group>
  )
}
