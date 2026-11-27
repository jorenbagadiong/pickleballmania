import { WIRE, fromWire } from '@pickleball/shared'
import { type Object3D, Vector3 } from 'three'
import { frame } from '../game/frame'
import { SERVER_URL } from '../net/config'
import {
  focusCourt,
  focusedCourt,
  latestState,
  latestZoneDebug,
  onFx,
  pendingFx,
  prediction,
  startBallLog,
} from '../net/session'
import { FACE_CENTER } from '../players/athlete/grip'
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
            steerX: fromWire((b as { steerX?: number }).steerX ?? 0, WIRE.steer),
            steerZ: fromWire((b as { steerZ?: number }).steerZ ?? 0, WIRE.steer),
            bounced: (b as { bounced?: boolean }).bounced ?? false,
            mustBounce: (b as { mustBounce?: boolean }).mustBounce ?? false,
            visible: b.visible,
            held: b.held,
          },
        }
      },
      /** TEZUKA ZONE diagnostics (the secret athlete only, with PICKLEBALL_ZONE_DEBUG=1). */
      zone: () => latestZoneDebug(),
      /** Every ball state decoded from now on, by server tick (court 1). */
      ballLog: () => Object.fromEntries(startBallLog()),
      /**
       * Every paddle drawn: whose it is, which bone holds it, and where it and both
       * hands are in the world.
       */
      paddles: () => {
        const out: { player: string; bone: string; paddle: number[]; hands: number[][] }[] = []
        const at = (o: Object3D | undefined): number[] =>
          o ? o.getWorldPosition(new Vector3()).toArray() : []
        frame.scene?.traverse((o) => {
          if (o.name !== 'paddle' || !o.parent) return
          let body: Object3D | null = o.parent
          while (body && !body.getObjectByName('hand_l')) body = body.parent
          out.push({
            player: String(o.userData.player ?? ''),
            bone: o.parent.name,
            paddle: at(o),
            hands: [at(body?.getObjectByName('hand_l')), at(body?.getObjectByName('hand_r'))],
          })
        })
        return out
      },
      /**
       * From the first call on: for every hit the server confirms, how far the hitter's
       * drawn paddle face is from the contact point when the hit is shown (meters).
       */
      hits: () => startHitLog(),
      /** Since `hits()` was first called: the worst drawn-versus-controller paddle gap (m). */
      fidelity: () => worstFidelity,
      /** Renderer counters for the last frame. */
      render: () => {
        const info = frame.gl?.info
        return info
          ? { calls: info.render.calls, triangles: info.render.triangles, ...info.memory }
          : null
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

interface HitRecord {
  id: string
  /** Drawn paddle face to the contact point (m). */
  gap: number
  /** The controller's own paddle face to the contact point (m). */
  intendedGap: number
  /** Drawn to controller's own paddle face (m): 0 unless a body draws a copy (VRM). */
  fidelity: number
  /** Contact height (m). */
  y: number
  at: number
  late: number
  swing: number
}
const hitLog: HitRecord[] = []
/** The largest drawn-versus-controller paddle difference seen on any frame (m). */
let worstFidelity = 0
let hitLogOn = false

/** A player's paddle face as drawn, and where their controller put it, in the world. */
function paddleFaces(id: string): { drawn: Vector3; intended: Vector3 } | null {
  let found: { drawn: Vector3; intended: Vector3 } | null = null
  frame.scene?.traverse((o) => {
    if (found || o.name !== 'paddle' || o.userData.player !== id) return
    const drawn = o.localToWorld(new Vector3(0, -FACE_CENTER, 0))
    const intended = (o.userData.intended as (() => Vector3) | null)?.() ?? drawn.clone()
    found = { drawn, intended }
  })
  return found
}

/** Every paddle drawn as a copy of its controller's (VRM): drawn against controller (m). */
function allFidelities(): number[] {
  const out: number[] = []
  frame.scene?.traverse((o) => {
    if (o.name !== 'paddle' || !o.userData.intended) return
    const drawn = o.localToWorld(new Vector3(0, -FACE_CENTER, 0))
    out.push(drawn.distanceTo((o.userData.intended as () => Vector3)()))
  })
  return out
}

function startHitLog() {
  if (!hitLogOn) {
    hitLogOn = true
    const waiting: { id: string; x: number; y: number; z: number; at: number }[] = []
    onFx((e) => {
      if (e.kind !== 'hit') return
      // The session has just queued it with the time it will be shown.
      const shown = pendingFx[pendingFx.length - 1]
      waiting.push({ id: e.id, x: e.x, y: e.y, z: e.z, at: shown?.at ?? frame.now })
    })
    const check = () => {
      for (let i = waiting.length - 1; i >= 0; i--) {
        const w = waiting[i]!
        if (frame.now < w.at) continue
        waiting.splice(i, 1)
        const faces = paddleFaces(w.id)
        if (faces) {
          const contact = new Vector3(w.x, w.y, w.z)
          hitLog.push({
            id: w.id,
            gap: faces.drawn.distanceTo(contact),
            intendedGap: faces.intended.distanceTo(contact),
            fidelity: faces.drawn.distanceTo(faces.intended),
            y: w.y,
            at: w.at,
            // How late this frame is past the shown moment, and how long since the local
            // player last swung (s): context for a miss.
            late: frame.now - w.at,
            swing: frame.now - frame.localSwingAt,
          })
        }
      }
      for (const f of allFidelities()) worstFidelity = Math.max(worstFidelity, f)
      requestAnimationFrame(check)
    }
    requestAnimationFrame(check)
  }
  return hitLog.slice()
}
