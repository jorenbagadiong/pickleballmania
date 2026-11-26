/**
 * Colors by team (slot) and position in the team (spot). Team 0 (the +z half)
 * uses warm colors, team 1 (the -z half) cool ones, so partners read as a pair.
 */
export const TEAM_COLORS = [
  ['#f97316', '#ef4444'],
  ['#8b5cf6', '#d946ef'],
] as const
export const TEAM_NAMES = ['Orange team', 'Purple team'] as const

export function playerColor(slot: number, spot = 0): string {
  const team = TEAM_COLORS[slot === 1 ? 1 : 0]
  return team[spot === 1 ? 1 : 0]
}

/** The team's main color (its first player's color). */
export function teamColor(slot: number): string {
  return playerColor(slot, 0)
}

/** Trail and aim arrow of a shot with sidespin. */
export const SPIN_COLOR = '#22d3ee'
