/**
 * Court geometry in meters. Official pickleball dimensions, except that the court
 * is 28 ft wide instead of 20 ft, for more running and sharper angles.
 *
 * World axes: x runs across the court (sideline to sideline), z runs along the
 * court (baseline to baseline), y is up. The net sits on the plane z = 0.
 * Player slot 0 plays on the +z half, player slot 1 on the -z half.
 */
const FEET = 0.3048
const INCHES = 0.0254

export const COURT = {
  /** 28 ft wide (official: 20 ft), measured to the outside of the lines. */
  width: 28 * FEET,
  /** 44 ft long, measured to the outside of the lines. */
  length: 44 * FEET,
  halfWidth: 14 * FEET,
  halfLength: 22 * FEET,
  /** Non-volley zone ("kitchen") extends 7 ft from the net on each side. */
  kitchenDepth: 7 * FEET,
  /** All lines are 2 inches wide. */
  lineWidth: 2 * INCHES,
  /** Net height: 36 in at the posts, 34 in at the center. */
  netHeightPost: 36 * INCHES,
  netHeightCenter: 34 * INCHES,
  /** Posts sit 12 in outside each sideline (30 ft total net span). */
  netHalfWidth: 15 * FEET,
} as const

/**
 * A team, identified by its side of the net: team 0 plays the +z half, team 1
 * the -z half. In 1v1 each team has one player; in 2v2, two partners.
 */
export type Slot = 0 | 1
/** A player's position within their team (0 or 1). Decides who serves when. */
export type Spot = 0 | 1
/** +1 for the +z half, -1 for the -z half. */
export type Side = 1 | -1

export function sideOf(slot: Slot): Side {
  return slot === 0 ? 1 : -1
}

export function otherSlot(slot: Slot): Slot {
  return slot === 0 ? 1 : 0
}

/** Height of the top of the net at a given x (linear sag from posts to center). */
export function netHeightAt(x: number): number {
  const t = Math.min(Math.abs(x) / COURT.netHalfWidth, 1)
  return COURT.netHeightCenter + (COURT.netHeightPost - COURT.netHeightCenter) * t
}

/** Lines are in: a ball touching any part of a boundary line counts as in. */
export function isInsideCourt(x: number, z: number, side: Side): boolean {
  return Math.abs(x) <= COURT.halfWidth && z * side >= 0 && Math.abs(z) <= COURT.halfLength
}

/**
 * The x-sign of a player's right-hand side. A player on the +z half faces -z,
 * so their right is +x; a player on the -z half faces +z, so their right is -x.
 */
export function rightHandXSign(side: Side): 1 | -1 {
  return side
}

/**
 * Which court a player serves from: even = right-hand court, odd = left-hand.
 * In singles that is just their score. In doubles partners swap sides each time
 * they score, so the second partner (spot 1) is always on the opposite court.
 */
export function serveParityFor(teamScore: number, spot: Spot): number {
  return teamScore + spot
}

/** The x-sign of the court a team serves from (see `serveParityFor`). */
export function serveCourtXSign(serverSlot: Slot, serveParity: number): 1 | -1 {
  const right = rightHandXSign(sideOf(serverSlot))
  return serveParity % 2 === 0 ? right : (-right as 1 | -1)
}

/** The kitchen (non-volley zone) on one side of the net; its line is part of it. */
export function isInKitchen(x: number, z: number, side: Side): boolean {
  const depth = z * side
  return depth >= 0 && depth <= COURT.kitchenDepth && Math.abs(x) <= COURT.halfWidth
}

/**
 * The service box the serve must land in: diagonally opposite the server,
 * beyond the receiver's kitchen line (the kitchen line itself is a fault),
 * centerline and outer lines in.
 */
export function isInServiceBox(
  x: number,
  z: number,
  serverSlot: Slot,
  serveParity: number,
): boolean {
  const receiverSide = sideOf(otherSlot(serverSlot))
  const boxXSign = -serveCourtXSign(serverSlot, serveParity)
  const depth = z * receiverSide
  return (
    depth > COURT.kitchenDepth &&
    depth <= COURT.halfLength &&
    x * boxXSign >= 0 &&
    Math.abs(x) <= COURT.halfWidth
  )
}
