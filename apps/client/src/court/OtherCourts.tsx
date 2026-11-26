import { useFrame } from '@react-three/fiber'
import { BALL_RADIUS, isOnFire } from '@pickleball/shared'
import { useRef } from 'react'
import type { Group, Mesh } from 'three'
import { playerColor } from '../game/colors'
import { frame } from '../game/frame'
import { NameTag } from '../players/NameTag'
import { castFor } from '../players/athlete/assets'
import { PlayerAvatar } from '../players/PlayerAvatar'
import { type PlayerSummary, useUi } from '../state/store'
import { Boards } from './Arena'
import { Court } from './Court'
import { courtX } from './layout'
import { Net } from './Net'

const RADIUS = BALL_RADIUS * 1.7

function DistantBall({ court }: { court: number }) {
  const ball = useRef<Mesh>(null)
  const shadow = useRef<Mesh>(null)
  useFrame(() => {
    const b = frame.courts[court]?.ball
    const on = !!b && b.visible
    if (ball.current) {
      ball.current.visible = on
      if (b) ball.current.position.set(b.x, Math.max(b.y, RADIUS), b.z)
    }
    if (shadow.current) {
      shadow.current.visible = on
      if (b) shadow.current.position.set(b.x, 0.011, b.z)
    }
  })
  return (
    <>
      <mesh ref={ball} visible={false}>
        <sphereGeometry args={[RADIUS, 12, 8]} />
        <meshBasicMaterial color="#d9f23a" />
      </mesh>
      <mesh ref={shadow} rotation-x={-Math.PI / 2} visible={false}>
        <circleGeometry args={[RADIUS * 1.2, 12]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.35} depthWrite={false} />
      </mesh>
    </>
  )
}

/** A player on another court, for computers that can't draw everyone in full. */
function SimpleFigure({ id, court, color }: { id: string; court: number; color: string }) {
  const group = useRef<Group>(null)
  useFrame(() => {
    const p = frame.courts[court]?.players.get(id)
    if (!group.current) return
    group.current.visible = !!p
    if (p) group.current.position.set(p.x, 0, p.z)
  })
  return (
    <group ref={group} visible={false}>
      <mesh position-y={0.55}>
        <capsuleGeometry args={[0.18, 0.7, 2, 8]} />
        <meshLambertMaterial color={color} />
      </mesh>
      <mesh position-y={1.25}>
        <sphereGeometry args={[0.13, 8, 6]} />
        <meshLambertMaterial color="#c99167" />
      </mesh>
    </group>
  )
}

function Others({
  players,
  court,
  full,
}: {
  players: PlayerSummary[]
  court: number
  full: boolean
}) {
  const cast = castFor(players)
  return players.map((p) =>
    full ? (
      <PlayerAvatar
        key={p.id}
        id={p.id}
        slot={p.slot}
        spot={p.spot}
        nickname={p.nickname}
        look={cast.get(p.id) ?? 'm1'}
        isLocal={false}
        connected={p.connected}
        onFire={isOnFire(p.streak)}
        court={court}
      />
    ) : (
      <SimpleFigure key={p.id} id={p.id} court={court} color={playerColor(p.slot, p.spot)} />
    ),
  )
}

/** The matches being played on the other courts of the arena. */
export function OtherCourts() {
  const courts = useUi((s) => s.courts)
  const focus = useUi((s) => s.focusCourt)
  // Goes together with the crowd when the computer is slow.
  const full = useUi((s) => s.crowd)
  return (
    <>
      {courts.map((c, i) =>
        i === focus ? null : (
          <group key={i} position-x={courtX(i, focus)}>
            <Court />
            <Net />
            <Boards />
            <Others players={c.players} court={i} full={full} />
            <DistantBall court={i} />
            <NameTag
              text={`Court ${i + 1}${c.players.length > 0 ? ` · ${c.scores[0]}–${c.scores[1]}` : ''}`}
              color="#0f172a"
              dimmed={false}
              y={2.6}
            />
          </group>
        ),
      )}
    </>
  )
}
