import { COURT, otherSlot, serveCourtXSign, sideOf } from '@pickleball/shared'
import { playerColor } from '../game/colors'
import { useUi } from '../state/store'

/** While serving, highlights the diagonal service box the serve must land in. */
export function ServiceBoxHint() {
  const phase = useUi((s) => s.phase)
  const servingSlot = useUi((s) => s.servingSlot)
  const serveParity = useUi((s) => s.serveParity)
  const serverSpot = useUi((s) => s.players.find((p) => p.id === s.serverId)?.spot ?? 0)
  const fed = useUi((s) => s.practice?.drill === 'machine')
  if (phase !== 'serving' || fed) return null

  const receiverSide = sideOf(otherSlot(servingSlot))
  const xSign = -serveCourtXSign(servingSlot, serveParity)
  const depth = COURT.halfLength - COURT.kitchenDepth
  return (
    <mesh
      rotation-x={-Math.PI / 2}
      position={[
        (xSign * COURT.halfWidth) / 2,
        0.008,
        receiverSide * (COURT.kitchenDepth + depth / 2),
      ]}
    >
      <planeGeometry args={[COURT.halfWidth - 0.05, depth - 0.05]} />
      <meshBasicMaterial
        color={playerColor(servingSlot, serverSpot)}
        transparent
        opacity={0.22}
        depthWrite={false}
      />
    </mesh>
  )
}
