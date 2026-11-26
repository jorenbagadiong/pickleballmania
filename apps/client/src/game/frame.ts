import type { Camera } from 'three'
import type { WorldSample } from '../net/snapshots'

/**
 * Per-frame view of the world, computed once at the start of each rendered
 * frame by <GameLoop/> and read by every 3D component. Rendering only reads;
 * it never decides game outcomes.
 */
export const frame = {
  /** performance.now() in seconds for this frame. */
  now: 0,
  /** Interpolated authoritative world (remote players + ball), or null before the first patch. */
  world: null as WorldSample | null,
  /** Every court's world; `world` is the one in focus. */
  courts: [] as (WorldSample | null)[],
  /** Predicted + smoothed local player pose. */
  local: { x: 0, z: 0, vx: 0, yaw: 0, valid: false },
  /** Most recent local swing (for instant animation), in frame.now seconds. */
  localSwingAt: -10,
  localSwingPower: 0,
  localSwingJump: false,
  /** The local player's last swing or serve: where it was aimed and how it curves. */
  localShot: { at: -10, spin: 0, aim: { x: 0, z: 0 }, mouseSpeed: 0 },
  /** Last time each player (by session id) hit the ball, for the paddle glow. */
  hitFlashAt: {} as Record<string, number>,
  /** True while the ball in flight was smashed (colors its trail). */
  ballSmashed: false,
  /** Sidespin on the ball in flight, toward +x (1) or -x (-1). */
  ballSpin: 0,
  /** True while the ball in flight was hit by a player who is on fire. */
  ballOnFire: false,
  /** Where each player last met the ball, so they visibly reach for it. */
  contact: {} as Record<string, { at: number; x: number; y: number; z: number }>,
  /** Whether the local player may swing right now. */
  swingReady: (_now: number): boolean => true,
  /** Camera shake (meters), fading quickly. */
  shake: 0,
  cheerAt: -100,
  cheerStrength: 0,
  /** The active camera (used by the debug hook to project world points). */
  camera: null as Camera | null,
}
