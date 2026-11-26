/**
 * How positions and speeds travel from the server: whole numbers in small units
 * (2 bytes each) instead of 4-byte decimals. A tournament sends every court to
 * everyone, so this is most of what the host uploads; far below what anyone can see.
 */
export const WIRE = {
  /** Millimeters. */
  position: 1000,
  /** Millimeters per second: players run at most a few meters per second. */
  runSpeed: 1000,
  /** Centimeters per second. */
  ballSpeed: 100,
  /** Centimeters per second², the sideways pull of spin. */
  curve: 100,
  /** Ten-thousandths of a radian. */
  angle: 10000,
} as const

const LIMIT = 32767

/** A value as sent (fits a signed 16-bit field). */
export function toWire(value: number, scale: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(-LIMIT, Math.min(LIMIT, Math.round(value * scale)))
}

/** A value as received. */
export function fromWire(value: number, scale: number): number {
  return value / scale
}
