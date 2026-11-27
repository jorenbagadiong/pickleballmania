import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  type Group,
  type Mesh,
  type Object3D,
  type PerspectiveCamera,
  type Points,
  Vector3,
} from 'three'
import {
  TIERS,
  VISIBLE_PRESENCE,
  type ZoneFxInfo,
  type ZoneTarget,
  type ZoneTier,
  ballJumped,
  logState,
  stepZone,
  tierConfig,
  zoneFields,
  zoneFxCounts,
  zoneLevels,
} from './zoneFx'
import { FIELD_HEIGHT, createZoneResources } from './zoneResources'

/** The ball as drawn, for the attraction ribbons: its mesh, and whether it is in flight. */
export interface ZoneBall {
  object: Object3D
  /** In play (not held for a serve, not hidden). */
  free: boolean
}

interface Props {
  /** The player it belongs to (for the debug hook). */
  id: string
  /** What the field should show now; read once per frame, never through React state. */
  read: () => ZoneTarget
  /** The drawn ball (D2 ribbons go to it); without one, no ribbons are drawn. */
  ball?: () => ZoneBall | null
  tier: ZoneTier
  reducedMotion: boolean
  /** Freezes the animation clock (developer viewer). */
  paused?: boolean
}

/** Below this the ribbons are imperceptible: stop drawing them (ends the fade in ~0.4 s). */
const RIBBON_VISIBLE = 0.02

/**
 * The TEZUKA ZONE field under the secret athlete, and (D2) the attraction ribbons from the
 * drawn ball to it while the server's pull is for this athlete. Put it in a group that
 * follows the player without turning with them. It fades in and out by itself; while fully
 * faded it draws nothing and does no work beyond reading its target.
 */
export function ZoneField({ id, read, ball, tier, reducedMotion, paused = false }: Props) {
  const group = useRef<Group>(null)
  const points = useRef<Points>(null)
  const ribbonMesh = useRef<Mesh>(null)
  const stream = useRef<Points>(null)
  const config = useMemo(() => tierConfig(tier, reducedMotion), [tier, reducedMotion])
  // Made once per field (the player's id never changes for one avatar); freed on unmount.
  const [res] = useState(() => createZoneResources(TIERS.low))
  const live = useRef({ ...zoneLevels(), time: 0, lastX: 0, lastY: 0, lastZ: 0, hasLast: false })
  const [scratch] = useState(() => ({
    at: new Vector3(),
    field: new Vector3(),
    from: { x: 0, y: 0, z: 0 },
  }))
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
    ribbon: 0,
    ribbons: 0,
    streamMotes: 0,
    ribbonFrom: null,
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

  // Right before the ribbons are drawn, after every frame update: the ball exactly where it
  // is drawn this frame, in the field's own space (the field only moves, never turns).
  const placeRibbons = useMemo(
    () => () => {
      const b = ball?.()
      const g = group.current
      if (!b || !g) return
      const at = scratch.at.setFromMatrixPosition(b.object.matrixWorld)
      scratch.from.x = at.x
      scratch.from.y = at.y
      scratch.from.z = at.z
      info.ribbonFrom = scratch.from
      res.attraction.ball.copy(at).sub(scratch.field.setFromMatrixPosition(g.matrixWorld))
    },
    [ball, info, res, scratch],
  )

  useFrame((state, delta) => {
    const g = group.current
    if (!g) return
    const dt = Math.min(delta, 0.1)
    const target = read()
    const l = live.current

    // The ribbons need a ball in play; a reset or a jump leaves nothing to draw them to.
    const b = ball?.() ?? null
    let cut = !b || !b.free || !b.object.visible
    if (b) {
      const p = b.object.position
      const moved = Math.hypot(p.x - l.lastX, p.y - l.lastY, p.z - l.lastZ)
      if (l.hasLast && ballJumped(moved, dt)) cut = true
      l.lastX = p.x
      l.lastY = p.y
      l.lastZ = p.z
      l.hasLast = true
    } else l.hasLast = false
    stepZone(l, target, dt, cut)
    logState(info, target.state, performance.now() / 1000)
    info.presence = l.presence
    info.pull = l.pull
    info.ribbon = l.ribbon

    const visible = l.presence > VISIBLE_PRESENCE
    g.visible = visible
    info.visible = visible
    if (!visible) {
      info.draws = 0
      info.particles = 0
      info.ribbons = 0
      info.streamMotes = 0
      return
    }
    // Reduced motion: a still field and still ribbons (nothing turns, pulses or travels).
    if (!paused && !reducedMotion) l.time += dt
    const cam = state.camera as PerspectiveCamera
    const fov = ((cam.fov ?? 50) * Math.PI) / 180
    const scale = (state.size.height * state.viewport.dpr) / (2 * Math.tan(fov / 2))
    res.set(l.time, l.presence, l.pull, scale)
    const motes = config.particles > 0
    if (points.current) points.current.visible = motes

    const attracting = l.ribbon > RIBBON_VISIBLE && !cut
    const flowing = attracting && config.streamMotes > 0
    if (ribbonMesh.current) ribbonMesh.current.visible = attracting
    if (stream.current) stream.current.visible = flowing
    if (attracting) res.attraction.set(l.time, l.ribbon * l.presence, l.pull, l.dirX, l.dirZ, scale)
    else info.ribbonFrom = null

    info.draws = (motes ? 2 : 1) + (attracting ? 1 : 0) + (flowing ? 1 : 0)
    info.particles = motes ? config.particles : 0
    info.ribbons = attracting ? config.ribbons : 0
    info.streamMotes = flowing ? config.streamMotes : 0
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
      {/* D2 attraction: spans ball to field, so never culled by the field's own bounds. */}
      <mesh
        ref={ribbonMesh}
        name="zone-ribbons"
        geometry={res.attraction.ribbonGeometry}
        material={res.attraction.ribbons}
        renderOrder={3}
        frustumCulled={false}
        visible={false}
        onBeforeRender={placeRibbons}
      />
      <points
        ref={stream}
        geometry={res.attraction.streamGeometry}
        material={res.attraction.stream}
        renderOrder={4}
        frustumCulled={false}
        visible={false}
      />
    </group>
  )
}
