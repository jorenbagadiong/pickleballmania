import { Canvas } from '@react-three/fiber'
import { NeutralToneMapping } from 'three'
import { Ball } from '../ball/Ball'
import { Effects } from '../ball/Effects'
import { CameraRig } from '../camera/CameraRig'
import { Court } from '../court/Court'
import { Environment } from '../court/Environment'
import { Net } from '../court/Net'
import { OtherCourts } from '../court/OtherCourts'
import { ServiceBoxHint } from '../court/ServiceBoxHint'
import { Arena, Lights } from '../court/Arena'
import { Players } from '../players/Players'
import { AdaptiveQuality } from './AdaptiveQuality'
import { AimReticle } from './AimReticle'
import { Atmosphere } from './Atmosphere'
import { GameLoop } from './GameLoop'
import { useUi } from '../state/store'

/** Dim hall color behind everything. */
const HALL = '#1d2733'

/** The 3D view. Pure rendering: reads interpolated/predicted state, never decides outcomes. */
export function GameScene() {
  // A fixed number, owned by AdaptiveQuality: the canvas re-applies it on every render.
  const dpr = useUi((s) => s.dpr)
  return (
    <Canvas
      shadows="percentage"
      dpr={dpr}
      camera={{ fov: 50, near: 0.1, far: 250, position: [0, 6.2, 14.7] }}
      gl={{
        antialias: true,
        powerPreference: 'high-performance',
        toneMapping: NeutralToneMapping,
        toneMappingExposure: 1,
      }}
    >
      <color attach="background" args={[HALL]} />
      <fog attach="fog" args={[HALL, 50, 130]} />
      <AdaptiveQuality />
      <GameLoop />
      <CameraRig />
      <Environment />
      <Lights />
      <Arena />
      <Court />
      <ServiceBoxHint />
      <Net />
      <OtherCourts />
      <Players />
      <Ball />
      <Effects />
      <Atmosphere />
      <AimReticle />
    </Canvas>
  )
}
