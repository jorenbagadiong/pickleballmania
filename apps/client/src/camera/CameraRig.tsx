import { useFrame } from '@react-three/fiber'
import { COURT, sideOf } from '@pickleball/shared'
import { useRef } from 'react'
import { PerspectiveCamera, Vector3 } from 'three'
import { frame } from '../game/frame'
import { useUi } from '../state/store'
import { hallHeight, hallX } from '../court/layout'
import { useOrbit } from './useOrbit'
import { ARENA_VIEW, PLAY_CAMERA, PLAY_FOV, arenaFov, spectatorViews } from './views'

const target = new Vector3()
const look = new Vector3()

/**
 * Stable third-person camera behind the local player's own baseline, looking
 * toward the opponent. It follows the player gently (heavily damped, partial
 * x/z follow) so the court stays framed and WASD always matches the screen.
 * Spectators get fixed cameras instead, or turn it themselves by dragging.
 */
export function CameraRig() {
  const currentLook = useRef(new Vector3())
  const base = useRef(new Vector3())
  const initialized = useRef(false)
  const viewName = useRef('player')
  const lead = useRef(0)
  const orbit = useOrbit()

  useFrame(({ camera }, delta) => {
    const { mySlot, spectatorView, freeCamera, courts, focusCourt, cameraDistance } =
      useUi.getState()
    const courtCount = Math.max(1, courts.length)
    const views = spectatorViews(courtCount)
    const view = mySlot === null ? (views[spectatorView] ?? views[0]) : undefined
    const s = sideOf(mySlot ?? 0)
    const baseZ = s * COURT.halfLength
    const px = frame.local.valid ? frame.local.x : 0
    const pz = frame.local.valid ? frame.local.z : baseZ
    const depth = pz - baseZ // how far the player has moved from their baseline

    const { height, back, ahead } = PLAY_CAMERA[cameraDistance]
    // Ahead of a run by a little, so there is room to see where it leads.
    const vx = frame.local.valid ? frame.local.vx : 0
    lead.current += (vx - lead.current) * (1 - Math.exp(-2.5 * delta))
    target.set(px * 0.45 + lead.current * 0.06, height, baseZ + s * back + depth * 0.35)
    look.set(px * 0.3 + lead.current * 0.1, 0.2, -s * ahead + depth * 0.2)

    if (view) {
      target.set(...view.position)
      look.set(...view.look)
      if (view === ARENA_VIEW) {
        const x = hallX(courtCount, focusCourt)
        target.set(x, hallHeight(courtCount) - 1.2, target.z)
        look.x = x
      }
    }
    const free = view !== undefined && freeCamera
    if (free) orbit.place(target, look, courtCount, focusCourt)
    // Cut between spectator cameras instead of flying through the stands.
    const name = free ? 'free' : view ? `${view.name} ${focusCourt}` : 'player'
    const cut = viewName.current !== name && !free
    viewName.current = name

    if (free) {
      // Follows the hand directly, with just enough smoothing to take off the edge.
      const k = 1 - Math.exp(-18 * delta)
      base.current.lerp(target, k)
      currentLook.current.lerp(look, k)
    } else if (!initialized.current || cut) {
      base.current.copy(target)
      currentLook.current.copy(look)
      initialized.current = true
    } else {
      const k = 1 - Math.exp(-4 * delta)
      base.current.lerp(target, k)
      currentLook.current.lerp(look, k)
    }
    frame.shake *= Math.exp(-9 * delta)
    const shake = frame.shake > 0.002 ? frame.shake : 0
    camera.position.set(
      base.current.x + Math.sin(frame.now * 83) * shake,
      base.current.y + Math.sin(frame.now * 71) * shake,
      base.current.z,
    )
    camera.lookAt(currentLook.current)
    const fov = view === ARENA_VIEW && !free ? arenaFov(courtCount) : PLAY_FOV
    if (camera instanceof PerspectiveCamera && camera.fov !== fov) {
      camera.fov = fov
      camera.updateProjectionMatrix()
    }
  })

  return null
}
