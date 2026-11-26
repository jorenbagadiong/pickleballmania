import type { RoomSummary } from '@pickleball/shared'
import { useEffect, useState } from 'react'
import { SERVER_URL } from './config'

const REFRESH_MS = 2000

/** Short description of what is happening in a room. */
export function roomStatus(r: RoomSummary): string {
  if (r.tournament) {
    if (r.tournament.status === 'playing') return '🏆 Tournament being played'
    if (r.tournament.status === 'done') return '🏆 Tournament over'
    return `🏆 Tournament sign-up — ${r.players.length} in${r.canPlay ? '' : ', full'}`
  }
  const seats = `${r.players.length}/${r.seats}`
  if (r.canPlay) return `Open — ${seats} players`
  if (r.inGame) return `Playing ${r.scores[0]}–${r.scores[1]}`
  return `Full — ${seats} players`
}

/** The server's live room list, refreshed while mounted (null = not loaded / unreachable). */
export function useRoomList(): RoomSummary[] | null {
  const [rooms, setRooms] = useState<RoomSummary[] | null>(null)
  useEffect(() => {
    let stopped = false
    const load = async (): Promise<void> => {
      try {
        const res = await fetch(`${SERVER_URL}/rooms`, { cache: 'no-store' })
        const body = (await res.json()) as { rooms?: RoomSummary[] }
        if (!stopped) setRooms(res.ok && Array.isArray(body.rooms) ? body.rooms : null)
      } catch {
        if (!stopped) setRooms(null)
      }
    }
    void load()
    const timer = setInterval(() => void load(), REFRESH_MS)
    return () => {
      stopped = true
      clearInterval(timer)
    }
  }, [])
  return rooms
}
