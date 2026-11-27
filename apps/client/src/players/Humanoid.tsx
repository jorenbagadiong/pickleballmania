import { useEffect, useMemo } from 'react'
import { type BufferGeometry, type Group, MeshStandardMaterial } from 'three'
import {
  ANKLE,
  FOREARM,
  HIP_HEIGHT,
  type Look,
  SHIN,
  THIGH,
  UPPER_ARM,
  buildBody,
  disposeBody,
} from './bodyShapes'
import type { Hand } from './athlete/handedness'
import { Paddle } from './Paddle'

/** Joints and materials the animation drives; filled in as the model mounts. */
export interface Rig {
  hips: Group | null
  spine: Group | null
  head: Group | null
  thighL: Group | null
  thighR: Group | null
  kneeL: Group | null
  kneeR: Group | null
  ankleL: Group | null
  ankleR: Group | null
  /** The free arm. */
  shoulderL: Group | null
  /** The paddle arm (the left one for a left-hander), likewise `elbowR`. */
  shoulderR: Group | null
  elbowL: Group | null
  elbowR: Group | null
  /** Holds the paddle: bends and turns it in the hand. */
  wrist: Group | null
  shirt: MeshStandardMaterial | null
  paddle: MeshStandardMaterial | null
}

export function emptyRig(): Rig {
  return {
    hips: null,
    spine: null,
    head: null,
    thighL: null,
    thighR: null,
    kneeL: null,
    kneeR: null,
    ankleL: null,
    ankleR: null,
    shoulderL: null,
    shoulderR: null,
    elbowL: null,
    elbowR: null,
    wrist: null,
    shirt: null,
    paddle: null,
  }
}

const SKIN_TONES = ['#eec5a2', '#dfae87', '#c99167', '#a8734a', '#86573a']
const HAIR_TONES = ['#1d1712', '#3b2417', '#6b4423', '#a9743a', '#4a4a4f']
const EYE_TONES = ['#4a2f1b', '#3b6a8f', '#5b7a45', '#2c1c12']

/** Same name, same look on everyone's screen. */
function hash(text: string): number {
  let h = 7
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0
  return h
}

function lookFor(nickname: string, color: string): Look {
  const h = hash(nickname)
  const style = (['cap', 'headband', 'ponytail'] as const)[(h >>> 8) % 3] ?? 'cap'
  return {
    skin: SKIN_TONES[h % SKIN_TONES.length] ?? '#d7a27a',
    hair: HAIR_TONES[(h >>> 4) % HAIR_TONES.length] ?? '#3b2417',
    eyes: EYE_TONES[(h >>> 12) % EYE_TONES.length] ?? '#4a2f1b',
    style,
    stubble: style !== 'ponytail' && (h >>> 16) % 2 === 0,
    color,
  }
}

/** Shared by everyone (so never disposed): the colors are in the shapes. */
const bodyMaterial = new MeshStandardMaterial({ vertexColors: true, roughness: 0.72 })

interface Props {
  rig: Rig
  nickname: string
  color: string
  shadow?: boolean
  /** The paddle hand (see athlete/handedness.ts). */
  hand?: Hand
}

/**
 * A player: sculpted body with jointed knees, ankles and elbows, a face and hair that
 * vary by nickname. Faces local +z; the paddle is in the right hand (local -x), or the
 * left (+x) for a left-hander. `shoulderR`, `elbowR` and `wrist` always mean the paddle
 * arm. One draw call per moving part, so four players stay cheap.
 */
export function Humanoid({ rig, nickname, color, shadow = true, hand = 'right' }: Props) {
  const paddleSide = hand === 'left' ? 1 : -1
  const body = useMemo(() => buildBody(lookFor(nickname, color)), [nickname, color])
  useEffect(() => () => disposeBody(body), [body])

  const part = (geometry: BufferGeometry) => (
    <mesh geometry={geometry} material={bodyMaterial} castShadow={shadow} dispose={null} />
  )

  const leg = (side: 1 | -1) => (
    <group
      ref={(g) => {
        if (side === 1) rig.thighL = g
        else rig.thighR = g
      }}
      position={[side * 0.092, -0.06, 0]}
    >
      {part(body.thigh[side])}
      <group
        ref={(g) => {
          if (side === 1) rig.kneeL = g
          else rig.kneeR = g
        }}
        position={[0, -THIGH, 0]}
      >
        {part(body.shin[side])}
        <group
          ref={(g) => {
            if (side === 1) rig.ankleL = g
            else rig.ankleR = g
          }}
          position={[0, -SHIN + ANKLE, 0]}
        >
          {part(body.foot[side])}
        </group>
      </group>
    </group>
  )

  const arm = (side: 1 | -1) => (
    <group
      ref={(g) => {
        if (side === paddleSide) rig.shoulderR = g
        else rig.shoulderL = g
      }}
      position={[side * 0.19, 0.382, 0]}
    >
      {part(body.upperArm[side])}
      <group
        ref={(g) => {
          if (side === paddleSide) rig.elbowR = g
          else rig.elbowL = g
        }}
        position={[0, -UPPER_ARM, 0]}
      >
        {part(body.forearm[side])}
        {side === paddleSide && (
          <group
            ref={(g) => {
              rig.wrist = g
            }}
            position={[0, -FOREARM - 0.04, 0]}
          >
            {part(body.fist)}
            <Paddle
              faceRef={(m) => {
                rig.paddle = m
              }}
            />
          </group>
        )}
      </group>
    </group>
  )

  return (
    <group position={[0, HIP_HEIGHT, 0]}>
      <group
        ref={(g) => {
          rig.hips = g
        }}
      >
        {part(body.pelvis)}
        {leg(1)}
        {leg(-1)}
      </group>

      <group
        ref={(g) => {
          rig.spine = g
        }}
        position={[0, 0.08, 0]}
      >
        <mesh geometry={body.torso} castShadow={shadow} dispose={null}>
          <meshStandardMaterial
            ref={(m) => {
              rig.shirt = m
            }}
            vertexColors
            emissive="#ff5a00"
            emissiveIntensity={0}
            roughness={0.85}
          />
        </mesh>
        {arm(1)}
        {arm(-1)}
        <group
          ref={(g) => {
            rig.head = g
          }}
          position={[0, 0.56, 0.01]}
        >
          {part(body.head)}
        </group>
      </group>
    </group>
  )
}
