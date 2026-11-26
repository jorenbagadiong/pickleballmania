import { randomInt } from 'node:crypto'
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from '@pickleball/shared'

/** Room codes currently in use by this server process. */
const active = new Set<string>()

export function reserveRoomCode(): string {
  for (let attempt = 0; attempt < 1000; attempt++) {
    let code = ''
    for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
      code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)]
    }
    if (!active.has(code)) {
      active.add(code)
      return code
    }
  }
  throw new Error('Could not allocate a room code')
}

export function releaseRoomCode(code: string): void {
  active.delete(code)
}
