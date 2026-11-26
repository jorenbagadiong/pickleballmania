import { type FxEvent, sideOf } from '@pickleball/shared'
import { useUi } from '../state/store'
import { frame } from './frame'

type Hit = Extract<FxEvent, { kind: 'hit' }>
type Bounce = Extract<FxEvent, { kind: 'bounce' }>

/** Whose shot is in the air, so its first bounce can be judged. */
let mineInAir = false

/** Training: remembers how the player's shot was hit. */
export function notePracticeHit(e: Hit): void {
  const { practice, sessionId, mySlot } = useUi.getState()
  if (!practice) return
  mineInAir = e.id === sessionId
  if (!mineInAir || mySlot === null) return
  useUi.setState((s) => ({
    practiceShot: {
      perfect: e.perfect,
      serve: s.rallyShots <= 1 && s.serverId === sessionId,
      timing: e.timing,
      spin: e.spin * sideOf(mySlot),
      landed: null,
    },
  }))
}

/** Training: where the player's shot came down, compared with the aim. */
export function notePracticeBounce(e: Bounce): void {
  if (!mineInAir) return
  mineInAir = false
  const { practice, practiceShot } = useUi.getState()
  if (!practice || !practiceShot) return
  const { aim } = frame.localShot
  const off = Math.hypot(e.x - aim.x, e.z - aim.z)
  useUi.setState({ practiceShot: { ...practiceShot, landed: { off, inBounds: e.inBounds } } })
}
