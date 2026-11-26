import { type Slot, WINNING_SCORE, WIN_BY, otherSlot } from '@pickleball/shared'

/** The serving team wins the game if it wins this rally (only the server can score). */
export function gamePointFor(scores: readonly [number, number], servingSlot: Slot): boolean {
  const next = scores[servingSlot] + 1
  return next >= WINNING_SCORE && next - scores[otherSlot(servingSlot)] >= WIN_BY
}
