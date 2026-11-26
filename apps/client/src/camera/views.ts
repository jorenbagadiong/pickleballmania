import { COURT } from '@pickleball/shared'

export interface SpectatorView {
  name: string
  position: readonly [number, number, number]
  look: readonly [number, number, number]
}

/** Camera positions a spectator can switch between (C key or the HUD button). */
const VIEWS: readonly SpectatorView[] = [
  { name: 'Side', position: [10.5, 6.5, 0], look: [0, 0.2, 0] },
  { name: 'Orange end', position: [0, 6.8, COURT.halfLength + 7.5], look: [0, 0, -0.8] },
  { name: 'Purple end', position: [0, 6.8, -COURT.halfLength - 7.5], look: [0, 0, 0.8] },
]

/** Over the whole hall; placed relative to the middle of the hall by the camera. */
export const ARENA_VIEW: SpectatorView = {
  name: 'Whole arena',
  position: [0, 9, 19.5],
  look: [0, 0, 0],
}

export function spectatorViews(courts: number): readonly SpectatorView[] {
  return courts > 1 ? [...VIEWS, ARENA_VIEW] : VIEWS
}

export const PLAY_FOV = 50

/** A lens wide enough for all the courts of the arena. */
export function arenaFov(courts: number): number {
  return [PLAY_FOV, PLAY_FOV, 54, 66, 80][Math.min(courts, 4)] ?? PLAY_FOV
}

/** Behind a player: how high, how far back from their baseline, and where it looks. */
export const PLAY_CAMERA = {
  close: { height: 4.6, back: 5.6, ahead: 1.2 },
  normal: { height: 5.8, back: 6.8, ahead: 0.9 },
  far: { height: 7.2, back: 8, ahead: 0.6 },
} as const
