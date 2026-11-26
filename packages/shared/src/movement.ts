import { COURT, type Side, type Slot, serveCourtXSign, sideOf } from './court'
import type { Phase } from './protocol'

/** Player run speed in m/s. */
export const PLAYER_SPEED = 6
/** How quickly players get going, and stop or turn (m/s²): quick, but not instant. */
export const PLAYER_ACCELERATION = 42
export const PLAYER_BRAKING = 54

/** How far players may roam outside the court lines. */
const SIDE_MARGIN = 2.2
const BACK_MARGIN = 4
/** Players cannot get closer than this to the net plane. */
const NET_CLEARANCE = 0.35

export interface Bounds {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

export interface PlanarPosition {
  x: number
  z: number
}

/** Someone running: where, and how fast. */
export interface MovingBody extends PlanarPosition {
  vx: number
  vz: number
}

/** A movement intent in world space; each component is clamped to [-1, 1]. */
export interface MoveIntent {
  mx: number
  mz: number
}

function boundsForDepth(side: Side, near: number, far: number): Pick<Bounds, 'minZ' | 'maxZ'> {
  return side === 1 ? { minZ: near, maxZ: far } : { minZ: -far, maxZ: -near }
}

/** The region a player may move in during open play: their own half plus run-off. */
export function playBounds(slot: Slot): Bounds {
  return {
    minX: -COURT.halfWidth - SIDE_MARGIN,
    maxX: COURT.halfWidth + SIDE_MARGIN,
    ...boundsForDepth(sideOf(slot), NET_CLEARANCE, COURT.halfLength + BACK_MARGIN),
  }
}

/**
 * While serving, the server must stand behind the baseline on the correct half
 * (see serveParityFor).
 */
export function serveBounds(slot: Slot, serveParity: number): Bounds {
  const xSign = serveCourtXSign(slot, serveParity)
  const inner = 0.15
  const outer = COURT.halfWidth - 0.15
  return {
    minX: xSign === 1 ? inner : -outer,
    maxX: xSign === 1 ? outer : -inner,
    ...boundsForDepth(sideOf(slot), COURT.halfLength + 0.25, COURT.halfLength + 1.6),
  }
}

/**
 * Where a player may move given the match phase, or null if movement is frozen.
 * Only the player who is serving is held behind the baseline; partners and the
 * receiving team move freely on their own half.
 * Used by both the server and the client's prediction so they never disagree.
 */
export function movementBounds(
  slot: Slot,
  phase: Phase,
  isServer: boolean,
  serveParity: number,
): Bounds | null {
  if (phase === 'paused') return null
  if (phase === 'serving' && isServer) return serveBounds(slot, serveParity)
  return playBounds(slot)
}

export function clampToBounds(p: PlanarPosition, b: Bounds): void {
  p.x = Math.min(b.maxX, Math.max(b.minX, p.x))
  p.z = Math.min(b.maxZ, Math.max(b.minZ, p.z))
}

/** Sanitizes a movement intent: finite, each axis in [-1, 1], length <= 1. */
export function sanitizeIntent(mx: unknown, mz: unknown): MoveIntent {
  const x = typeof mx === 'number' && Number.isFinite(mx) ? Math.max(-1, Math.min(1, mx)) : 0
  const z = typeof mz === 'number' && Number.isFinite(mz) ? Math.max(-1, Math.min(1, mz)) : 0
  const len = Math.hypot(x, z)
  return len > 1 ? { mx: x / len, mz: z / len } : { mx: x, mz: z }
}

/**
 * Advances a player by one fixed step. This exact function runs on the server
 * (authoritative) and on the owning client (prediction + reconciliation), so
 * both sides agree on movement.
 */
export function stepPlayer(p: MovingBody, intent: MoveIntent, dt: number, b: Bounds): void {
  const tx = intent.mx * PLAYER_SPEED
  const tz = intent.mz * PLAYER_SPEED
  const dx = tx - p.vx
  const dz = tz - p.vz
  const change = Math.hypot(dx, dz)
  // Against the current motion (stopping, turning around) feet grip harder.
  const against = dx * p.vx + dz * p.vz < 0
  const most = (against ? PLAYER_BRAKING : PLAYER_ACCELERATION) * dt
  const k = change > most ? most / change : 1
  p.vx += dx * k
  p.vz += dz * k
  p.x += p.vx * dt
  p.z += p.vz * dt
  // A wall takes the speed toward it.
  if (p.x <= b.minX || p.x >= b.maxX) p.vx = 0
  if (p.z <= b.minZ || p.z >= b.maxZ) p.vz = 0
  clampToBounds(p, b)
}

/** Yaw (rotation about +y) that turns a model's local +z axis toward the target. */
export function yawToward(
  from: PlanarPosition,
  toX: number,
  toZ: number,
  fallback: number,
): number {
  const dx = toX - from.x
  const dz = toZ - from.z
  if (dx * dx + dz * dz < 1e-4) return fallback
  return Math.atan2(dx, dz)
}
