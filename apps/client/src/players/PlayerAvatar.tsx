import { createPortal, useFrame } from '@react-three/fiber'
import {
  JUMP_MIN_FORWARD,
  JUMP_REACH_HEIGHT,
  REACH_RADIUS,
  type Slot,
  type Spot,
  forwardShare,
  isInKitchen,
  reachDistance,
  sideOf,
} from '@pickleball/shared'
import { type RefObject, useEffect, useMemo, useRef } from 'react'
import {
  CanvasTexture,
  type Group,
  type Mesh,
  type MeshBasicMaterial,
  type MeshStandardMaterial,
  Vector3,
} from 'three'
import { playerColor } from '../game/colors'
import { frame } from '../game/frame'
import { movementIntent } from '../input/controls'
import { useUi } from '../state/store'
import { playIgnite } from '../audio/sfx'
import { Flames } from './Flames'
import { Humanoid, emptyRig } from './Humanoid'
import { NameTag } from './NameTag'
import { knownContact, predictContact } from './athlete/contact'
import { PADDLE_SCALE } from './athlete/grip'
import { handFor } from './athlete/handedness'
import { type LoadedAthlete, useAthlete } from './athlete/useAthlete'
import { PADDLE_GLOW, Paddle } from './Paddle'
import type { WorldSample } from '../net/snapshots'
import { blendArm, runPose, wrapAngle } from './runPose'
import { swingPose } from './swingPose'

/** Characters are drawn a bit smaller than life so the court reads better. */
const BODY_SCALE = 0.8
/** Distance covered by one full stride cycle (two steps), so feet don't skate. */
const STRIDE_LENGTH = 2.1
/** How far the arm and paddle reach, and how far a player lunges beyond that. */
const PADDLE_REACH = 0.7
const MAX_LUNGE = 0.8
const LUNGE_SECONDS = 0.28
/** Balls further round than this (radians) make the player turn to hit them. */
const MAX_SWING_ANGLE = 1.3
/** Faster apparent movement than this is a teleport (serve reset), not running. */
const MAX_VISIBLE_SPEED = 12

interface Props {
  id: string
  slot: Slot
  spot: Spot
  nickname: string
  /** Which person they look like. */
  look: string
  isLocal: boolean
  connected: boolean
  onFire: boolean
  /** On another court than the one in focus: drawn from there, without cues or shadows. */
  court?: number
}

type Anim = {
  vx: number
  vz: number
  swingAt: number
  swingPower: number
  swingJump: boolean
  faceYaw: number
  startedAt: number
}

/** How far players turn from the net toward where they aim. */
const MAX_AIM_TURN = 0.5
/** A swing at nothing: where the paddle goes. */
const AIR = { x: -0.55, y: 1, z: 0.55 }
const NEW_SWING_SECONDS = 0.25
const HELD = new Vector3()
const LOOK = new Vector3()

/** Feeds the game's state to an athlete's animation. */
function animateAthlete(
  { controller }: LoadedAthlete,
  a: Anim,
  o: {
    id: string
    slot: Slot
    x: number
    z: number
    yaw: number
    now: number
    delta: number
    world: WorldSample | null
    court: number | undefined
  },
): void {
  const { id, slot, x, z, now, delta, world } = o
  const ui = useUi.getState()
  const focused = o.court === undefined
  const ball = world?.ball

  // Facing the net, turned a little toward the aim; never spinning with the mouse.
  const net = sideOf(slot) === 1 ? Math.PI : 0
  const off = Math.max(-MAX_AIM_TURN, Math.min(MAX_AIM_TURN, wrapAngle(o.yaw - net)))
  const toward = net + off
  if (Number.isNaN(a.faceYaw)) a.faceYaw = toward
  a.faceYaw += wrapAngle(toward - a.faceYaw) * (1 - Math.exp(-9 * Math.min(delta, 0.1)))

  const c = Math.cos(a.faceYaw)
  const s = Math.sin(a.faceYaw)
  const local = (p: { x: number; y: number; z: number }) => {
    const dx = p.x - x
    const dz = p.z - z
    return { x: dx * c - dz * s, y: p.y, z: dx * s + dz * c }
  }

  const serving =
    focused &&
    ui.serverId === id &&
    (ui.phase === 'serving' || (ui.phase === 'rally' && ui.rallyShots <= 1))
  const known = focused ? knownContact(id, now) : null
  if (a.swingAt !== a.startedAt) {
    a.startedAt = a.swingAt
    if (now - a.swingAt < NEW_SWING_SECONDS) {
      const met = known ?? (serving ? null : predictContact({ x, z }, ball, now))
      const held = serving && ball ? { x: ball.x, y: ball.y, z: ball.z, at: now + 0.1 } : null
      const at = met ?? held
      const depth = Math.abs(z)
      controller.hit(
        now,
        {
          power: a.swingPower,
          serve: serving,
          jump: a.swingJump,
          contact: at ? local(at) : AIR,
          volley: !!ball && !ball.bounced,
          pace: ball ? Math.hypot(ball.vx, ball.vz) : 0,
          depth,
          aimDepth: focused && id === ui.sessionId ? Math.abs(frame.localShot.aim.z) : 5,
        },
        at ? at.at : now + 0.16,
      )
    }
  } else if (known) controller.correct(local(known), known.at, now)

  const playing = !focused || ui.phase === 'serving' || ui.phase === 'rally'
  const bigMoment = ui.phase === 'gameOver' || (ui.phase === 'pointOver' && ui.rallyShots >= 5)
  const winner = ui.phase === 'gameOver' ? ui.gameWinner : (ui.lastRally?.winner ?? null)
  const holding = serving && ui.phase === 'serving' && !!ball?.held
  if (holding && ball) HELD.set(ball.x, ball.y, ball.z)
  if (ball) LOOK.set(ball.x, ball.y, ball.z)
  controller.update({
    now,
    delta,
    vx: a.vx,
    vz: a.vz,
    yaw: a.faceYaw,
    alert: playing ? 1 : 0.25,
    look: ball?.visible ? LOOK : null,
    serveBall: holding ? HELD : null,
    mood: focused && bigMoment && winner !== null ? (winner === slot ? 'won' : 'lost') : 'none',
    x,
    z,
  })
}

/** Soft darkness right under the feet, where the light never gets. */
let smudge: CanvasTexture | null = null
function smudgeTexture(): CanvasTexture {
  if (smudge) return smudge
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 64
  const g = canvas.getContext('2d')
  if (g) {
    const fade = g.createRadialGradient(32, 32, 2, 32, 32, 32)
    fade.addColorStop(0, 'rgba(0,0,0,0.75)')
    fade.addColorStop(0.45, 'rgba(0,0,0,0.3)')
    fade.addColorStop(1, 'rgba(0,0,0,0)')
    g.fillStyle = fade
    g.fillRect(0, 0, 64, 64)
  }
  smudge = new CanvasTexture(canvas)
  return smudge
}

function ContactShadow() {
  const texture = useMemo(smudgeTexture, [])
  return (
    <mesh rotation-x={-Math.PI / 2} position={[0, 0.01, 0]} scale={[0.95, 0.8, 1]}>
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial map={texture} transparent opacity={0.55} depthWrite={false} />
    </mesh>
  )
}

/** The body itself, with the paddle in its hand. */
function AthleteBody({
  id,
  loaded,
  paddle,
}: {
  id: string
  loaded: LoadedAthlete
  paddle: RefObject<MeshStandardMaterial | null>
}) {
  const { athlete, controller } = loaded
  const hand =
    athlete.paddleMount?.(controller.paddleBone) ?? athlete.all.get(controller.paddleBone)
  const grip = controller.paddleGrip
  // For the debug probe: where the controller itself put the paddle face. A VRM body
  // draws a copy of that pose; a GLB body draws the controller's own bones.
  const intendedFace = athlete.paddleMount
    ? () =>
        athlete.root.localToWorld(
          athlete.all.get(controller.paddleBone)!.localToWorld(grip.center.clone()),
        )
    : null
  return (
    <>
      <primitive object={athlete.root} dispose={null} />
      {hand &&
        createPortal(
          <group
            name="paddle"
            userData={{ player: id, intended: intendedFace }}
            position={grip.position}
            quaternion={grip.rotation}
            scale={PADDLE_SCALE}
          >
            <Paddle
              faceRef={(m) => {
                paddle.current = m
              }}
            />
          </group>,
          hand,
        )}
    </>
  )
}

/** A player on court: run and swing animation, name tag, cues and streak fire. */
export function PlayerAvatar({
  id,
  slot,
  spot,
  nickname,
  look,
  isLocal,
  connected,
  onFire,
  court,
}: Props) {
  const color = playerColor(slot, spot)
  const root = useRef<Group>(null)
  /** Turns to face the aim; the name tag and flames stay outside it. */
  const turn = useRef<Group>(null)
  const body = useRef<Group>(null)
  const tag = useRef<Group>(null)
  const rig = useMemo(emptyRig, [])
  const athlete = useAthlete(look, color, court === undefined)
  const paddle = useRef<MeshStandardMaterial | null>(null)
  const reachDisc = useRef<Mesh>(null)
  const reachMat = useRef<MeshBasicMaterial>(null)
  const zoneMat = useRef<MeshBasicMaterial>(null)

  const anim = useRef({
    initialized: false,
    lastX: 0,
    lastZ: 0,
    vx: 0,
    vz: 0,
    phase: 0,
    heat: 0,
    swingAt: -10,
    swingPower: 0,
    swingJump: false,
    lastSwingSeq: -1,
    posedSwingAt: -10,
    backhand: false,
    spin: 0,
    height: 1,
    faceYaw: Number.NaN,
    startedAt: -10,
  })

  useEffect(() => {
    if (onFire && court === undefined) playIgnite()
  }, [onFire, court])

  useFrame((_, delta) => {
    const g = root.current
    if (!g) return
    const a = anim.current
    const now = frame.now
    const world = court === undefined ? frame.world : (frame.courts[court] ?? null)

    // Pose: local player uses prediction; everyone else uses interpolated server state.
    let x: number
    let z: number
    let yaw: number
    if (isLocal && frame.local.valid) {
      x = frame.local.x
      z = frame.local.z
      yaw = frame.local.yaw
      a.swingAt = frame.localSwingAt
      a.swingPower = frame.localSwingPower
      a.swingJump = frame.localSwingJump
    } else {
      const p = world?.players.get(id)
      if (!p) {
        g.visible = false
        return
      }
      x = p.x
      z = p.z
      yaw = p.yaw
      if (a.lastSwingSeq !== -1 && p.swingSeq !== a.lastSwingSeq) {
        a.swingAt = now
        a.swingPower = p.swingPower
        a.swingJump = p.swingJump
      }
      a.lastSwingSeq = p.swingSeq
    }
    g.visible = true
    g.position.set(x, 0, z)
    if (turn.current && !athlete) {
      // Lunge toward the ball on contact, so the paddle really gets there.
      const c = frame.contact[id]
      const since = c ? (now - c.at) / LUNGE_SECONDS : 1
      let ox = 0
      let oz = 0
      if (c && since >= 0 && since < 1) {
        const far = Math.hypot(c.x - x, c.z - z)
        const step =
          Math.min(MAX_LUNGE, Math.max(0, far - PADDLE_REACH)) * Math.cos((since * Math.PI) / 2)
        if (far > 0.01) {
          ox = ((c.x - x) / far) * step
          oz = ((c.z - z) / far) * step
        }
      }
      turn.current.position.set(ox, 0, oz)
    }

    // Legs follow the actual movement; arms and chest follow the swing. The two are
    // independent, so a player can hit at full sprint.
    if (!a.initialized) {
      a.initialized = true
      a.lastX = x
      a.lastZ = z
    }
    const dx = x - a.lastX
    const dz = z - a.lastZ
    a.lastX = x
    a.lastZ = z
    const dist = Math.hypot(dx, dz)
    if (delta > 0 && dist / delta < MAX_VISIBLE_SPEED) {
      const k = Math.min(1, delta * 12)
      a.vx += (dx / delta - a.vx) * k
      a.vz += (dz / delta - a.vz) * k
      a.phase += (dist / STRIDE_LENGTH) * Math.PI * 2
    }
    a.heat += ((onFire ? 1 : 0) - a.heat) * Math.min(1, delta * 4)
    if (athlete) {
      animateAthlete(athlete, a, { id, slot, x, z, yaw, now, delta, world, court })
      if (turn.current) {
        turn.current.position.set(0, 0, 0)
        turn.current.rotation.y = a.faceYaw
      }
      if (tag.current) tag.current.position.y = 0.22 + athlete.controller.lift
      const shirt = athlete.athlete.materials.shirt as MeshStandardMaterial | undefined
      if (shirt) shirt.emissiveIntensity = a.heat * (0.14 + Math.sin(now * 13) * 0.05)
    } else {
      const speed = Math.hypot(a.vx, a.vz)
      const mirror = handFor(look) === 'left' ? -1 : 1
      const heading = speed > 0.1 ? Math.atan2(a.vx, a.vz) - yaw : 0
      const run = runPose({ phase: a.phase, speed, heading })
      if (a.swingAt !== a.posedSwingAt) {
        // New swing: forehand or backhand, and how high, from where the ball is.
        a.posedSwingAt = a.swingAt
        const ball = world?.ball
        const bx = ball ? ball.x - x : 0
        const bz = ball ? ball.z - z : 0
        const near = !!ball && Math.hypot(bx, bz) < 5
        // Ball on the side away from the paddle hand: a backhand.
        a.backhand = near && mirror * (bx * Math.cos(yaw) - bz * Math.sin(yaw)) > 0.2
        a.height = near && ball ? ball.y : 1
        // A ball behind their back: spin toward it instead of swinging at nothing.
        const toBall = near ? wrapAngle(Math.atan2(bx, bz) - yaw) : 0
        const over = Math.abs(toBall) - MAX_SWING_ANGLE
        a.spin = over > 0 ? Math.sign(toBall) * over : 0
      }
      const swing = swingPose(now - a.swingAt, a.swingPower, a.backhand, a.height, a.swingJump)
      if (turn.current) turn.current.rotation.y = yaw + a.spin * swing.active
      const arm = blendArm(swing, run)
      const breathe = Math.sin(now * 2.2 + x) * 0.02 * (1 - run.run)

      if (body.current) {
        body.current.position.y = (run.bob + swing.lift) * BODY_SCALE
        body.current.rotation.set(run.leanX + swing.lean * 0.5, 0, run.leanZ)
      }
      // The name stays above the head in a jump.
      if (tag.current) tag.current.position.y = Math.max(0, swing.lift) * BODY_SCALE
      if (rig.hips) rig.hips.rotation.y = run.hipTurn
      // Ready stance: knees slightly bent, tucked up in a hop, giving way on landing.
      const tuck = a.swingJump ? Math.max(0, -swing.lift) * 5 : swing.lift * 1.6
      const crouch = 0.22 * (1 - run.run) + tuck
      const legs = 1 - swing.air // a leap takes over from the stride
      // In a jump smash the front knee drives up while the other leg kicks back.
      const thighL = (run.thighL - crouch) * legs - swing.air * 1
      const thighR = (run.thighR - crouch) * legs + swing.air * 0.45
      const kneeL = (run.kneeL + crouch * 1.8) * legs + swing.air * 1.3
      const kneeR = (run.kneeR + crouch * 1.8) * legs + swing.air * 1.5
      if (rig.thighL) rig.thighL.rotation.x = thighL
      if (rig.thighR) rig.thighR.rotation.x = thighR
      if (rig.kneeL) rig.kneeL.rotation.x = kneeL
      if (rig.kneeR) rig.kneeR.rotation.x = kneeR
      // Feet stay level on the ground; toes point down when off it.
      const ankle = (thigh: number, knee: number): number => {
        const off = Math.min(1, swing.air + run.run * Math.max(0, knee - 0.5))
        return Math.max(-0.6, Math.min(0.7, -(thigh + knee))) * (1 - off) + 0.55 * off
      }
      if (rig.ankleL) rig.ankleL.rotation.x = ankle(thighL, kneeL)
      if (rig.ankleR) rig.ankleR.rotation.x = ankle(thighR, kneeR)
      // A left-hander's upper body is the mirror image: turns about y and z change sign.
      if (rig.spine) {
        rig.spine.rotation.set(
          0.08 + swing.lean * 0.5 + breathe,
          mirror * (swing.twist - run.armSwing * 0.15 * (1 - swing.active)),
          0,
        )
      }
      if (rig.head) rig.head.rotation.set(-0.05 - run.leanX * 0.6, mirror * -swing.twist * 0.8, 0)
      rig.shoulderR?.rotation.set(arm.armPitch, mirror * arm.armYaw, 0, 'YXZ')
      if (rig.elbowR) rig.elbowR.rotation.x = -arm.elbow
      rig.wrist?.rotation.set(swing.wrist, mirror * swing.roll, 0, 'XYZ')
      // Free arm: pumps while running, held out for balance during a swing.
      rig.shoulderL?.rotation.set(
        -0.35 - run.armSwing * (1 - swing.active * 0.6) - swing.active * 0.35,
        mirror * 0.25,
        mirror * (0.12 + swing.active * 0.45),
        'YXZ',
      )
      if (rig.elbowL) rig.elbowL.rotation.x = -(0.8 + run.run * 0.5 - swing.active * 0.4)

      // Glow of the fire on the shirt.
      if (rig.shirt) rig.shirt.emissiveIntensity = a.heat * (0.18 + Math.sin(now * 13) * 0.06)
    }

    // "Swing now" cue for the local player: the ground disc lights up while the
    // ball (as you see it) is within reach and it's your shot.
    if (isLocal && reachDisc.current && reachMat.current) {
      const ui = useUi.getState()
      const ball = frame.world?.ball
      let inReach = false
      let kitchen = false
      let jumpable = false
      if (ball && ui.phase === 'rally' && ui.lastHitSlot !== slot && !ball.held) {
        // Not your serve to return (doubles), or it still has to bounce: no cue yet.
        const allowed =
          (ui.lastHitSlot !== ui.servingSlot || ui.receiverId === id || !ball.mustBounce) &&
          (ball.bounced || !ball.mustBounce)

        const side = sideOf(slot)
        kitchen = !ball.bounced && isInKitchen(x, z, side)
        inReach = allowed && reachDistance({ x, z }, side, ball) !== null
        // Too high to reach standing, but a jump smash would: only while moving forward.
        if (!inReach && allowed) {
          const forward = forwardShare(movementIntent(side).mz, side) >= JUMP_MIN_FORWARD
          jumpable = forward && reachDistance({ x, z }, side, ball, JUMP_REACH_HEIGHT) !== null
          inReach = jumpable
        }
      }
      reachDisc.current.visible = inReach
      // Red = the ball is in reach, but volleying from the kitchen is a fault.
      reachMat.current.color.set(kitchen ? '#ef4444' : jumpable ? '#fb923c' : '#fef08a')
      reachMat.current.opacity = 0.7 + Math.sin(now * 25) * 0.2

      // Hit zone outline: faint, gray while you can't swing, bright when the ball is in it.
      if (zoneMat.current) {
        const ready = frame.swingReady(now)
        zoneMat.current.color.set(
          inReach ? (kitchen ? '#ef4444' : '#fde047') : ready ? '#ffffff' : '#64748b',
        )
        zoneMat.current.opacity = inReach ? 0.95 : ready ? 0.4 : 0.2
      }
    }

    // Paddle glows right after this player hits the ball.
    const face = athlete ? paddle.current : rig.paddle
    if (face) {
      const since = now - (frame.hitFlashAt[id] ?? -10)
      face.emissive.set(a.heat > 0.5 ? '#ff6a00' : '#facc15')
      face.emissiveIntensity =
        PADDLE_GLOW + a.heat * 0.35 + (since >= 0 && since < 0.25 ? 2.5 * (1 - since / 0.25) : 0)
    }
  })

  return (
    <group ref={root} visible={false}>
      <group ref={turn}>
        {/* Ground ring + facing arrow so direction is readable from any angle. */}
        <mesh rotation-x={-Math.PI / 2} position={[0, 0.012, 0]}>
          <ringGeometry args={[0.38, 0.46, 32]} />
          <meshBasicMaterial color={color} transparent opacity={0.85} />
        </mesh>
        <mesh rotation-x={-Math.PI / 2} position={[0, 0.012, 0.62]}>
          <circleGeometry args={[0.12, 3]} />
          <meshBasicMaterial color={color} />
        </mesh>

        {isLocal && (
          <mesh rotation-x={-Math.PI / 2} position={[0, 0.014, 0]}>
            <ringGeometry args={[REACH_RADIUS - 0.05, REACH_RADIUS, 64]} />
            <meshBasicMaterial ref={zoneMat} transparent depthWrite={false} toneMapped={false} />
          </mesh>
        )}

        {isLocal && (
          <mesh ref={reachDisc} rotation-x={-Math.PI / 2} position={[0, 0.013, 0]} visible={false}>
            <circleGeometry args={[0.55, 32]} />
            <meshBasicMaterial
              ref={reachMat}
              color="#fef08a"
              transparent
              depthWrite={false}
              toneMapped={false}
            />
          </mesh>
        )}

        {athlete && <ContactShadow />}
        {athlete ? (
          <AthleteBody id={id} loaded={athlete} paddle={paddle} />
        ) : (
          <group ref={body} scale={BODY_SCALE}>
            <Humanoid
              rig={rig}
              nickname={nickname}
              color={color}
              shadow={court === undefined}
              hand={handFor(look)}
            />
          </group>
        )}
      </group>

      <Flames active={onFire} />

      <group ref={tag}>
        <NameTag
          text={`${onFire ? '🔥 ' : ''}${nickname}${isLocal ? ' (you)' : ''}${connected ? '' : ' — reconnecting…'}`}
          color={onFire ? '#ea580c' : color}
          dimmed={!connected}
          y={1.85}
        />
      </group>
    </group>
  )
}
