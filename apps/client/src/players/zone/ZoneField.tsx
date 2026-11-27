import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Group, PerspectiveCamera, Points } from 'three'
import {
  TIERS,
  VISIBLE_PRESENCE,
  type ZoneFxInfo,
  type ZoneTarget,
  type ZoneTier,
  logState,
  stepZone,
  tierConfig,
  zoneFields,
  zoneFxCounts,
} from './zoneFx'
import { FIELD_HEIGHT, createZoneResources } from './zoneResources'

interface Props {
  /** The player it belongs to (for the debug hook). */
  id: string
  /** What the field should show now; read once per frame, never through React state. */
  read: () => ZoneTarget
  tier: ZoneTier
  reducedMotion: boolean
  /** Freezes the animation clock (developer viewer). */
  paused?: boolean
}

/**
 * The TEZUKA ZONE field under the secret athlete. Put it in a group that follows the
 * player without turning with them. It fades in and out by itself; while fully faded it
 * draws nothing and does no work beyond reading its target.
 */
export function ZoneField({ id, read, tier, reducedMotion, paused = false }: Props) {
  const group = useRef<Group>(null)
  const points = useRef<Points>(null)
  const config = useMemo(() => tierConfig(tier, reducedMotion), [tier, reducedMotion])
  // Made once per field (the player's id never changes for one avatar); freed on unmount.
  const [res] = useState(() => createZoneResources(TIERS.low))
  const live = useRef({ presence: 0, pull: 0, time: 0 })
  const [info] = useState<ZoneFxInfo>(() => ({
    id,
    state: 'inactive',
    presence: 0,
    pull: 0,
    tier,
    reducedMotion,
    visible: false,
    draws: 0,
    particles: 0,
    log: [],
  }))

  useEffect(() => {
    res.configure(config)
    info.tier = tier
    info.reducedMotion = reducedMotion
  }, [res, config, info, tier, reducedMotion])

  useEffect(() => {
    zoneFxCounts.mounted += 1
    zoneFields.set(id, info)
    return () => {
      if (zoneFields.get(id) === info) zoneFields.delete(id)
      res.dispose()
      zoneFxCounts.disposed += 1
    }
  }, [id, info, res])

  useFrame((state, delta) => {
    const g = group.current
    if (!g) return
    const dt = Math.min(delta, 0.1)
    const target = read()
    const l = live.current
    stepZone(l, target, dt)
    logState(info, target.state, performance.now() / 1000)
    info.presence = l.presence
    info.pull = l.pull

    const visible = l.presence > VISIBLE_PRESENCE
    g.visible = visible
    info.visible = visible
    if (!visible) {
      info.draws = 0
      info.particles = 0
      return
    }
    // Reduced motion: a still field (nothing turns, pulses or drifts).
    if (!paused && !reducedMotion) l.time += dt
    const cam = state.camera as PerspectiveCamera
    const fov = ((cam.fov ?? 50) * Math.PI) / 180
    const scale = (state.size.height * state.viewport.dpr) / (2 * Math.tan(fov / 2))
    res.set(l.time, l.presence, l.pull, scale)
    const motes = config.particles > 0
    if (points.current) points.current.visible = motes
    info.draws = motes ? 2 : 1
    info.particles = motes ? config.particles : 0
  })

  return (
    <group
      ref={group}
      name="zone-field"
      userData={{ player: id }}
      position-y={FIELD_HEIGHT}
      visible={false}
    >
      <mesh geometry={res.groundGeometry} material={res.ground} renderOrder={1} />
      <points ref={points} geometry={res.moteGeometry} material={res.motes} renderOrder={2} />
    </group>
  )
}
