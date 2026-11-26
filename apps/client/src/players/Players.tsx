import { isOnFire } from '@pickleball/shared'
import { useUi } from '../state/store'
import { castFor } from './athlete/assets'
import { PlayerAvatar } from './PlayerAvatar'

export function Players() {
  const players = useUi((s) => s.players)
  const sessionId = useUi((s) => s.sessionId)
  const cast = castFor(players)
  return (
    <>
      {players.map((p) => (
        <PlayerAvatar
          key={p.id}
          id={p.id}
          slot={p.slot}
          spot={p.spot}
          nickname={p.nickname}
          look={cast.get(p.id) ?? 'm1'}
          isLocal={p.id === sessionId}
          connected={p.connected}
          onFire={isOnFire(p.streak)}
        />
      ))}
    </>
  )
}
