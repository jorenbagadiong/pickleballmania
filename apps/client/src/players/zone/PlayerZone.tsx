import type { Slot } from '@pickleball/shared'
import { useRef } from 'react'
import { frame } from '../../game/frame'
import { useUi } from '../../state/store'
import { ZoneField } from './ZoneField'
import { type ZoneTarget, zoneTarget, zoneTier } from './zoneFx'
import { useReducedMotion } from './useReducedMotion'

interface Props {
  id: string
  /** The look the server gave this player (only `x1` has the ability). */
  look: string
  connected: boolean
  slot: Slot
}

/**
 * The TEZUKA ZONE field for one player on the court in focus, driven by replicated
 * state only: the look and connection from the room, the phase and last hitter from the
 * court, and the pull from the ball as it is drawn this frame.
 */
export function PlayerZone({ id, look, connected, slot }: Props) {
  const tier = useUi((s) => zoneTier(s))
  const reducedMotion = useReducedMotion()
  const props = useRef({ look, connected, slot })
  props.current = { look, connected, slot }
  const read = useRef((): ZoneTarget => {
    const ui = useUi.getState()
    const p = props.current
    return zoneTarget({
      look: p.look,
      connected: p.connected,
      focused: true,
      slot: p.slot,
      phase: ui.phase,
      lastHitSlot: ui.lastHitSlot,
      ball: frame.world?.ball ?? null,
    })
  }).current
  return <ZoneField id={id} read={read} tier={tier} reducedMotion={reducedMotion} />
}
