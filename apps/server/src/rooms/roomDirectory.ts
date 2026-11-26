import type { RoomSummary } from '@pickleball/shared'

/** Rooms running in this server process, for the room list on the start screen. */
const rooms = new Map<string, () => RoomSummary>()

export function listRoom(code: string, summarize: () => RoomSummary): void {
  rooms.set(code, summarize)
}

export function unlistRoom(code: string): void {
  rooms.delete(code)
}

/** Rooms with an open seat first, then games to watch. */
export function listRooms(): RoomSummary[] {
  return [...rooms.values()]
    .map((summarize) => summarize())
    .sort((a, b) => Number(b.canPlay) - Number(a.canPlay) || a.code.localeCompare(b.code))
}
