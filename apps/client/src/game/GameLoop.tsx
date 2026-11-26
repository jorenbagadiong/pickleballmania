import { useFrame, useThree } from '@react-three/fiber'
import {
  FIXED_DT,
  type InputFrame,
  type Phase,
  SWING_COOLDOWN,
  type Slot,
  canSwing,
  forwardShare,
  movementBounds,
  sideOf,
  yawToward,
} from '@pickleball/shared'
import { useEffect, useRef } from 'react'
import { type Camera, Plane, Raycaster, Vector2, Vector3 } from 'three'
import { playSwish, unlockAudio } from '../audio/sfx'
import {
  controls,
  installControls,
  movementIntent,
  plannedSpin,
  spaceAction,
  updateBend,
} from '../input/controls'
import { wantsJump } from '../input/jump'
import { swipe } from '../input/swipe'
import {
  focusCourt,
  latestState,
  nowSeconds,
  prediction,
  sendInputs,
  sendServe,
  sendSwing,
  sampleCourts,
} from '../net/session'
import { cycleSpectatorView, useUi } from '../state/store'
import { frame } from './frame'

const groundPlane = new Plane(new Vector3(0, 1, 0), 0)
const raycaster = new Raycaster()
const hit = new Vector3()
const ndc = new Vector2()

/** Sets `aim` to where a ray through the mouse position meets the ground. */
function aimAt(
  pointer: { x: number; y: number },
  camera: Camera,
  aim: { x: number; z: number },
): void {
  raycaster.setFromCamera(ndc.set(pointer.x, pointer.y), camera)
  if (!raycaster.ray.intersectPlane(groundPlane, hit)) return
  aim.x = Math.max(-40, Math.min(40, hit.x))
  aim.z = Math.max(-40, Math.min(40, hit.z))
}

function currentBounds(slot: Slot) {
  const ui = useUi.getState()
  const isServer = ui.serverId !== '' && ui.serverId === ui.sessionId
  return movementBounds(slot, ui.phase, isServer, ui.serveParity)
}

const ACTIVE_PHASES: ReadonlySet<Phase> = new Set([
  'waiting',
  'lobby',
  'serving',
  'rally',
  'pointOver',
  'gameOver',
])

/**
 * Runs before everything else each frame: samples the interpolated world,
 * updates the aim point, and produces fixed-step (60 Hz) inputs that are
 * applied to local prediction and sent to the server.
 */
export function GameLoop() {
  const gl = useThree((s) => s.gl)
  const accumulator = useRef(0)
  const lastSwing = useRef(-10)
  /** Rally shot the last swing was aimed at (-1 outside a rally). */
  const lastShot = useRef(-1)
  const shotSwings = useRef(0)

  // Held curves are on only while the server says so for this player.
  useEffect(() => {
    const check = (): void => {
      const cheats = useUi.getState().cheats
      if (cheats === controls.cheats) return
      controls.cheats = cheats
      updateBend()
    }
    check()
    return useUi.subscribe(check)
  }, [])

  // Shot numbers start over every rally.
  useEffect(
    () =>
      useUi.subscribe((s, prev) => {
        if (s.phase === 'serving' && prev.phase !== 'serving') lastShot.current = -1
      }),
    [],
  )

  useEffect(() => {
    const surface = gl.domElement.parentElement ?? gl.domElement
    const swingReady = (now: number): boolean => {
      const ui = useUi.getState()
      return canSwing({
        sinceLast: now - lastSwing.current,
        inRally: ui.phase === 'rally',
        ownTeamHitLast: ui.lastHitSlot === ui.mySlot,
        swingsThisShot: lastShot.current === ui.rallyShots ? shotSwings.current : 0,
      })
    }
    frame.swingReady = swingReady
    const planShot = (now: number) => {
      const { spin, pointer } = plannedSpin(now)
      const aim = { x: controls.aim.x, z: controls.aim.z }
      if (pointer && frame.camera) aimAt(pointer, frame.camera, aim)
      frame.localShot = { at: now, spin, aim, mouseSpeed: swipe.speed(now) }
      return frame.localShot
    }
    const swing = (power: number): void => {
      const now = nowSeconds()
      const ui = useUi.getState()
      if (ui.mySlot === null) return // spectators only watch
      if (!ACTIVE_PHASES.has(ui.phase) || !swingReady(now)) return
      lastSwing.current = now
      const shot = ui.phase === 'rally' ? ui.rallyShots : -1
      shotSwings.current = shot >= 0 && lastShot.current === shot ? shotSwings.current + 1 : 1
      lastShot.current = shot
      frame.localSwingAt = now
      frame.localSwingPower = power
      const side = sideOf(ui.mySlot)
      const jump = wantsJump(
        power,
        forwardShare(movementIntent(side).mz, side),
        frame.local,
        frame.world?.ball ?? null,
      )
      frame.localSwingJump = jump
      playSwish(power)
      const shotPlan = planShot(now)
      sendSwing(shotPlan.aim.x, shotPlan.aim.z, power, shotPlan.spin, jump)
    }
    const serve = (): void => {
      const now = nowSeconds()
      if (now - lastSwing.current < SWING_COOLDOWN) return
      lastSwing.current = now
      frame.localSwingAt = now
      frame.localSwingPower = 0.3
      frame.localSwingJump = false
      const shotPlan = planShot(now)
      sendServe(shotPlan.aim.x, shotPlan.aim.z, shotPlan.spin)
    }
    return installControls(surface, {
      onSwing: (power) => {
        unlockAudio()
        swing(power)
      },
      onSpace: (power) => {
        unlockAudio()
        const ui = useUi.getState()
        if (spaceAction(ui.phase, ui.serverId === ui.sessionId) === 'serve') serve()
        else swing(power)
      },
      onCycleView: cycleSpectatorView,
    })
  }, [gl])

  useFrame((state, delta) => {
    const now = nowSeconds()
    frame.now = now
    frame.courts = sampleCourts(now)
    frame.world = frame.courts[focusCourt()] ?? null
    frame.camera = state.camera

    // Aim: where the mouse ray meets the ground. While a curve is held it stays put, as
    // the mouse is busy choosing the bend.
    if (!controls.bend) aimAt(state.pointer, state.camera, controls.aim)

    const ui = useUi.getState()
    const slot = ui.mySlot
    if (slot === null || !latestState() || !prediction.ready) {
      frame.local.valid = false
      return
    }

    const bounds = currentBounds(slot)
    accumulator.current = Math.min(accumulator.current + delta, 0.25)
    const outbox: InputFrame[] = []
    while (accumulator.current >= FIXED_DT) {
      accumulator.current -= FIXED_DT
      const intent = movementIntent(sideOf(slot))
      const f: InputFrame = {
        seq: prediction.nextSeq(),
        mx: intent.mx,
        mz: intent.mz,
        ax: controls.aim.x,
        az: controls.aim.z,
      }
      prediction.applyLocal(f, bounds)
      outbox.push(f)
    }
    sendInputs(outbox)

    prediction.display(delta, frame.local)
    frame.local.vx = prediction.pos.vx
    frame.local.yaw = yawToward(frame.local, controls.aim.x, controls.aim.z, frame.local.yaw)
    frame.local.valid = true
  }, -1)

  return null
}
