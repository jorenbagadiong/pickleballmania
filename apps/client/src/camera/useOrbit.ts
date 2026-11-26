import { useThree } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import type { Vector3 } from 'three'
import {
  HALL_HALF_LENGTH,
  HALL_HALF_WIDTH,
  extraHalfWidth,
  hallHeight,
  hallX,
} from '../court/layout'
import { useUi } from '../state/store'

/** Radians per pixel dragged. */
const TURN = 0.006
const MIN_PITCH = 0.04
const MAX_PITCH = 1.5
const MIN_RADIUS = 3
const MAX_RADIUS = 24
/** Stay this far from the walls and ceiling, and above the seats. */
const WALL_GAP = 0.8
const SEATS_FROM = 8.6
const SEATS_HEIGHT = 3.4
const LOOK_HEIGHT = 0.9

export interface OrbitState {
  /** Around the court: 0 looks from +z, growing toward +x. */
  yaw: number
  /** 0 = level with the court, PI/2 = straight down. */
  pitch: number
  radius: number
}

/** Where an orbiting camera is, kept inside a hall of this many courts. */
export function orbitPosition(o: OrbitState, courts: number, focus: number, out: Vector3): Vector3 {
  const flat = Math.cos(o.pitch) * o.radius
  out.set(
    Math.sin(o.yaw) * flat,
    LOOK_HEIGHT + Math.sin(o.pitch) * o.radius,
    Math.cos(o.yaw) * flat,
  )
  const middle = hallX(courts, focus)
  const halfWidth = HALL_HALF_WIDTH + extraHalfWidth(courts) - WALL_GAP
  out.x = Math.max(middle - halfWidth, Math.min(middle + halfWidth, out.x))
  const halfLength = HALL_HALF_LENGTH - WALL_GAP
  out.z = Math.max(-halfLength, Math.min(halfLength, out.z))
  const seats = SEATS_FROM + extraHalfWidth(courts)
  const floor = Math.abs(out.x - middle) > seats ? SEATS_HEIGHT : 0.5
  out.y = Math.max(floor, Math.min(hallHeight(courts) - WALL_GAP, out.y))
  return out
}

export function turnOrbit(o: OrbitState, dx: number, dy: number): void {
  o.yaw -= dx * TURN
  o.pitch = Math.max(MIN_PITCH, Math.min(MAX_PITCH, o.pitch + dy * TURN))
}

export function zoomOrbit(o: OrbitState, wheel: number): void {
  o.radius = Math.max(MIN_RADIUS, Math.min(MAX_RADIUS, o.radius * Math.exp(wheel * 0.0012)))
}

/**
 * Spectators look around freely: drag to turn (all the way round), wheel to zoom.
 * Starts from wherever the camera is.
 */
export function useOrbit() {
  const gl = useThree((s) => s.gl)
  const get = useThree((s) => s.get)
  const orbit = useMemo<OrbitState>(() => ({ yaw: 0, pitch: 0.5, radius: 14 }), [])

  useEffect(() => {
    const surface = gl.domElement.parentElement ?? gl.domElement
    let dragging = false
    const spectating = (): boolean => useUi.getState().mySlot === null

    /** Takes over from the current camera. */
    const begin = (): void => {
      if (useUi.getState().freeCamera) return
      const { x, y, z } = get().camera.position
      orbit.yaw = Math.atan2(x, z)
      orbit.radius = Math.max(MIN_RADIUS, Math.min(MAX_RADIUS, Math.hypot(x, y - LOOK_HEIGHT, z)))
      orbit.pitch = Math.max(
        MIN_PITCH,
        Math.min(MAX_PITCH, Math.atan2(y - LOOK_HEIGHT, Math.hypot(x, z))),
      )
      useUi.setState({ freeCamera: true })
    }
    const down = (e: PointerEvent): void => {
      if (!spectating() || (e.button !== 0 && e.button !== 2)) return
      dragging = true
      surface.setPointerCapture?.(e.pointerId)
    }
    const move = (e: PointerEvent): void => {
      if (!dragging) return
      if (!spectating()) {
        dragging = false
        return
      }
      if (e.movementX === 0 && e.movementY === 0) return
      begin()
      turnOrbit(orbit, e.movementX, e.movementY)
    }
    const up = (): void => {
      dragging = false
    }
    const wheel = (e: WheelEvent): void => {
      if (!spectating()) return
      e.preventDefault()
      begin()
      zoomOrbit(orbit, e.deltaY)
    }
    surface.addEventListener('pointerdown', down)
    surface.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    surface.addEventListener('wheel', wheel, { passive: false })
    return () => {
      surface.removeEventListener('pointerdown', down)
      surface.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      surface.removeEventListener('wheel', wheel)
    }
  }, [gl, get, orbit])

  return useMemo(
    () => ({
      place(position: Vector3, look: Vector3, courts: number, focus: number): void {
        orbitPosition(orbit, courts, focus, position)
        look.set(0, LOOK_HEIGHT, 0)
      },
    }),
    [orbit],
  )
}
