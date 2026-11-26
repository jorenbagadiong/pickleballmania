import { useThree } from '@react-three/fiber'
import { useEffect } from 'react'
import { PMREMGenerator } from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'

/** How much of the light comes from the hall all around (and shows in reflections). */
const INTENSITY = 0.42

/** Soft light from every side of an indoor hall: skin, cloth and the floor need it to look real. */
export function Environment() {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  useEffect(() => {
    const generator = new PMREMGenerator(gl)
    const room = new RoomEnvironment()
    const target = generator.fromScene(room, 0.04)
    scene.environment = target.texture
    scene.environmentIntensity = INTENSITY
    room.dispose()
    generator.dispose()
    return () => {
      scene.environment = null
      target.dispose()
    }
  }, [gl, scene])
  return null
}
