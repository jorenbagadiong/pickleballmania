import { createHash, timingSafeEqual } from 'node:crypto'
import { isTezukaName } from '@pickleball/shared'

/**
 * The developer's secret athlete. A name anyone can type, so it takes all of: the name,
 * the computer running the server, the developer key (PICKLEBALL_DEV_KEY, set where the
 * server runs and nowhere else), and a room that allows it.
 */

/** Shorter keys are too easy to guess: the feature stays off. */
export const MIN_DEV_KEY_LENGTH = 12
/** Anything longer than this is not a key worth hashing. */
const MAX_DEV_KEY_LENGTH = 256

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest()
}

/** The configured key, or null when it is missing or too short (the feature is off). */
export function configuredDevKey(env: NodeJS.ProcessEnv = process.env): string | null {
  const key = env.PICKLEBALL_DEV_KEY
  return typeof key === 'string' && key.length >= MIN_DEV_KEY_LENGTH ? key : null
}

/**
 * Whether `given` is the developer key. Both sides are hashed to the same length first,
 * so the comparison takes the same time whatever was sent.
 */
export function devKeyMatches(given: unknown, env: NodeJS.ProcessEnv = process.env): boolean {
  const expected = configuredDevKey(env)
  if (expected === null) return false
  if (typeof given !== 'string' || given.length === 0 || given.length > MAX_DEV_KEY_LENGTH) {
    return false
  }
  return timingSafeEqual(digest(given), digest(expected))
}

/** What the room knows about someone joining: from onAuth (never sent to anyone). */
export interface JoinAuth {
  /** Joined from the computer running the server. */
  onHost: boolean
  /** Sent the developer key. */
  devKey: boolean
}

/** Whether this person plays the secret athlete, with held curves. */
export function grantsTezuka(
  nickname: string,
  auth: Partial<JoinAuth> | undefined,
  roomAllows: boolean,
): boolean {
  return roomAllows && isTezukaName(nickname) && auth?.onHost === true && auth.devKey === true
}
