import { type BallBody, FIXED_DT, SWING_ACTIVE_WINDOW, stepBall } from '@pickleball/shared'
import { pendingFx } from '../../net/session'

export interface Contact {
  x: number
  y: number
  z: number
  /** When (frame.now seconds). */
  at: number
}

/** The server's word on where and when a player hits the ball, if it has arrived. */
export function knownContact(id: string, now: number): Contact | null {
  for (const e of pendingFx) {
    if (e.kind === 'hit' && e.id === id && e.at > now - 0.05 && e.at < now + 0.5) {
      return { x: e.x, y: e.y, z: e.z, at: e.at }
    }
  }
  return null
}

/** Where a ball in flight comes closest to someone during a swing (null = nowhere near). */
export function predictContact(
  player: { x: number; z: number },
  ball: (BallBody & { visible: boolean; held: boolean }) | null | undefined,
  now: number,
): Contact | null {
  if (!ball || !ball.visible || ball.held) return null
  const b = { ...ball }
  let best: Contact | null = null
  let nearest = 2.2
  for (let t = 0; t <= SWING_ACTIVE_WINDOW; t += FIXED_DT) {
    const d = Math.hypot(b.x - player.x, b.z - player.z)
    if (d < nearest && b.y < 3.2) {
      nearest = d
      best = { x: b.x, y: b.y, z: b.z, at: now + t }
    }
    stepBall(b, FIXED_DT, [])
  }
  return best
}
