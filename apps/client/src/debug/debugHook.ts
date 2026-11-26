import { WIRE, fromWire } from '@pickleball/shared'
import { Vector3 } from 'three'
import { frame } from '../game/frame'
import { SERVER_URL } from '../net/config'
import { focusCourt, focusedCourt, latestState, prediction } from '../net/session'
import { useUi } from '../state/store'

interface PlayerView {
  slot: number
  spot: number
  nickname: string
  look: string
  x: number
  z: number
  ready: boolean
  connected: boolean
  lastSeq: number
  swingSeq: number
  swingJump: boolean
}

/**
 * Read-only inspection hook for automated two-browser tests (and debugging).
 * Installed in dev mode, or in any build when the URL contains `?e2e`.
 * It can only read state — it cannot send anything the normal UI can't.
 */
export function installDebugHook(): void {
  if (!import.meta.env.DEV && !new URLSearchParams(window.location.search).has('e2e')) return
  const v = new Vector3()
  Object.assign(window, {
    __PB__: {
      serverUrl: SERVER_URL,
      ui: () => useUi.getState(),
      state: () => {
        const room = latestState()
        const s = focusedCourt()
        if (!room || !s?.players || !s.ball) return null
        const players: Array<PlayerView & { id: string }> = []
        s.players.forEach((p, id) => {
          const pv = p as unknown as PlayerView
          players.push({
            id,
            slot: pv.slot,
            spot: pv.spot,
            nickname: pv.nickname,
            look: pv.look,
            x: fromWire(pv.x, WIRE.position),
            z: fromWire(pv.z, WIRE.position),
            ready: pv.ready,
            connected: pv.connected,
            lastSeq: pv.lastSeq,
            swingSeq: pv.swingSeq,
            swingJump: pv.swingJump,
          })
        })
        const b = s.ball
        return {
          phase: s.phase,
          tick: room.tick,
          message: s.message,
          lastHitSlot: s.lastHitSlot,
          servingSlot: s.servingSlot,
          mode: room.mode,
          scores: [s.score0, s.score1],
          serverId: s.serverId,
          players,
          ball: {
            x: fromWire(b.x, WIRE.position),
            y: fromWire(b.y, WIRE.position),
            z: fromWire(b.z, WIRE.position),
            vx: fromWire(b.vx, WIRE.ballSpeed),
            vy: fromWire(b.vy, WIRE.ballSpeed),
            vz: fromWire(b.vz, WIRE.ballSpeed),
            visible: b.visible,
            held: b.held,
          },
        }
      },
      /** Where the camera is, and which court is in focus. */
      camera: () => {
        const p = frame.camera?.position
        return p ? { x: p.x, y: p.y, z: p.z, court: focusCourt() } : null
      },
      predicted: () => ({
        x: prediction.pos.x,
        z: prediction.pos.z,
        pending: prediction.pendingCount,
        correction: prediction.correctionSize,
      }),
      /** Screen (CSS px, relative to the canvas) of a point on the ground. */
      project: (x: number, z: number) => {
        const cam = frame.camera
        const canvas = document.querySelector('canvas')
        if (!cam || !canvas) return null
        v.set(x, 0, z).project(cam)
        const r = canvas.getBoundingClientRect()
        return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height }
      },
    },
  })
}
