import { useRef } from 'react'
import { frame } from '../../game/frame'
import { useUi } from '../../state/store'
import { type ZoneBall, ZoneField } from './ZoneField'
import { type ZoneTarget, zoneTarget, zoneTier } from './zoneFx'
import { useReducedMotion } from './useReducedMotion'

interface Props {
  id: string
  /** The look the server gave this player (only `x1` has the ability). */
  look: string
  connected: boolean
}

/**
 * The TEZUKA ZONE field (and its attraction) for one player on the court in focus,
 * driven by replicated state only: the look and connection from the room, the phase from
 * the court, and the pull, and whom it is for, from the ball as it is drawn this frame.
 */
export function PlayerZone({ id, look, connected }: Props) {
  const tier = useUi((s) => zoneTier(s))
  const reducedMotion = useReducedMotion()
  const props = useRef({ look, connected })
  props.current = { look, connected }
  const read = useRef((): ZoneTarget => {
    const p = props.current
    const b = frame.world?.ball
    return zoneTarget({
      id,
      look: p.look,
      connected: p.connected,
      focused: true,
      phase: useUi.getState().phase,
      ball: b ?? null,
    })
  }).current
  const ballState = useRef({ object: null as unknown as ZoneBall['object'], free: false })
  const ball = useRef((): ZoneBall | null => {
    const mesh = frame.ballMesh
    const b = frame.world?.ball
    if (!mesh) return null
    ballState.current.object = mesh
    ballState.current.free = !!b && b.visible && !b.held
    return ballState.current
  }).current
  return <ZoneField id={id} read={read} ball={ball} tier={tier} reducedMotion={reducedMotion} />
}
