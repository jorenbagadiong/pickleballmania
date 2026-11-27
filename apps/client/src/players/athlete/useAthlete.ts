import { useThree } from '@react-three/fiber'
import { useEffect, useState } from 'react'
import type {
  Camera,
  Material,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Scene,
  Texture,
  WebGLRenderer,
} from 'three'
import { type Athlete, loadBody, loadMotions } from './assets'
import { Controller } from './controller'
import type { VrmAthlete } from './vrm'
import { useUi } from '../../state/store'
import { handFor } from './handedness'

export interface LoadedAthlete {
  athlete: Athlete
  controller: Controller
}

/**
 * Gets a body ready to draw before it is shown: its pictures sent to the graphics
 * card and its shaders built off the main thread. Otherwise the first frame that
 * draws a new player freezes the game for a few hundred milliseconds.
 */
const nextFrame = () => new Promise<void>((done) => requestAnimationFrame(() => done()))

async function prepare(gl: WebGLRenderer, root: Object3D, camera: Camera, scene: Scene) {
  const textures = new Set<Texture>()
  root.traverse((o) => {
    const m = (o as Mesh).material as Material | undefined
    if (!m) return
    for (const value of Object.values(m))
      if ((value as Texture | null)?.isTexture) textures.add(value as Texture)
  })
  const compiled = gl.compileAsync(root, camera, scene)
  // One picture per frame: sending them all at once is a stutter of its own.
  for (const t of textures) {
    gl.initTexture(t)
    await nextFrame()
  }
  await compiled
}

/** A player's body, once it has loaded (null until then, or if it can't be). */
export function useAthlete(name: string, color: string, shadow: boolean): LoadedAthlete | null {
  const [loaded, setLoaded] = useState<LoadedAthlete | null>(null)
  const gl = useThree((s) => s.gl)
  const camera = useThree((s) => s.camera)
  const scene = useThree((s) => s.scene)

  useEffect(() => {
    let gone = false
    Promise.all([loadBody(name), loadMotions()])
      .then(async ([athlete, motions]) => {
        if (gone) return
        athlete.root.traverse((o) => {
          const m = o as Mesh
          if (!m.isMesh) return
          m.castShadow = shadow
          m.receiveShadow = shadow
        })
        // If this fails the body is still shown; drawing it just costs a stutter.
        await prepare(gl, athlete.root, camera, scene).catch(() => {})
        if (gone) return
        setLoaded({ athlete, controller: new Controller(athlete, motions, handFor(name)) })
      })
      .catch((e: unknown) => console.warn('[pickleball] player model', name, e))
    return () => {
      gone = true
      setLoaded(null)
    }
  }, [name, shadow, gl, camera, scene])

  useEffect(() => {
    const shirt = loaded?.athlete.materials.shirt as MeshStandardMaterial | undefined
    if (!shirt) return
    shirt.color.set(color)
    shirt.emissive.set('#ff5a00')
    shirt.emissiveIntensity = 0
  }, [loaded, color])

  // Optional looks (a VRM body's spring bones and outlines) follow the quality setting.
  useEffect(() => {
    const vrm = loaded?.athlete as Partial<VrmAthlete> | undefined
    if (!vrm?.setQuality) return
    const apply = (shadows: boolean) => vrm.setQuality!({ springs: shadows, outlines: shadows })
    apply(useUi.getState().shadows)
    return useUi.subscribe((s, prev) => {
      if (s.shadows !== prev.shadows) apply(s.shadows)
    })
  }, [loaded])

  // Their own copies of the materials; shapes and pictures are shared. A VRM body is
  // all its own, and frees all of it.
  useEffect(
    () => () => {
      if (!loaded) return
      for (const m of Object.values(loaded.athlete.materials)) m.dispose()
      loaded.athlete.dispose?.()
    },
    [loaded],
  )
  return loaded
}
