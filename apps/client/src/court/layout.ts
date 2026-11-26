import { APRON_HALF_WIDTH } from './Court'

/** Distance between the centers of neighboring courts. */
export const COURT_SPACING = APRON_HALF_WIDTH * 2 + 0.6

/**
 * Everything is drawn around the court in focus, which stays at the origin. This is
 * where the middle of the hall, and court `i`, are relative to it.
 */
export function courtX(i: number, focus: number): number {
  return (i - focus) * COURT_SPACING
}

export function hallX(courts: number, focus: number): number {
  return ((courts - 1) / 2 - focus) * COURT_SPACING
}

/** How much wider the hall is than one for a single court (half). */
export function extraHalfWidth(courts: number): number {
  return ((courts - 1) / 2) * COURT_SPACING
}

export const HALL_HALF_WIDTH = 14
export const HALL_HALF_LENGTH = 21

/** A hall with more courts gets a higher ceiling. */
export function hallHeight(courts: number): number {
  return 10 + Math.min(4, (courts - 1) * 1.5)
}
