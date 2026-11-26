import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { CanvasTexture, LinearFilter, SRGBColorSpace, type Sprite } from 'three'

/** On-screen label height in CSS pixels, independent of distance and window size. */
const LABEL_PX = 20

interface Props {
  text: string
  color: string
  dimmed?: boolean
  y: number
}

/** Nickname label rendered to a canvas texture on a sprite (always faces the camera). */
export function NameTag({ text, color, dimmed = false, y }: Props) {
  const { texture, aspect } = useMemo(() => {
    const scale = 2
    const font = `600 ${28 * scale}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`
    const canvas = document.createElement('canvas')
    const g = canvas.getContext('2d')
    let width = 200
    if (g) {
      g.font = font
      width = Math.ceil(g.measureText(text).width) + 36 * scale
    }
    const height = 44 * scale
    canvas.width = width
    canvas.height = height
    if (g) {
      g.font = font
      g.fillStyle = color
      g.beginPath()
      g.roundRect(0, 0, width, height, height / 2)
      g.fill()
      g.fillStyle = '#ffffff'
      g.textAlign = 'center'
      g.textBaseline = 'middle'
      g.fillText(text, width / 2, height / 2 + 2)
    }
    const tex = new CanvasTexture(canvas)
    tex.colorSpace = SRGBColorSpace
    tex.minFilter = LinearFilter
    return { texture: tex, aspect: width / height }
  }, [text, color])

  useEffect(() => () => texture.dispose(), [texture])

  // With sizeAttenuation off, a sprite of scale h spans h * P[1][1] / 2 of the
  // viewport height. Solve for h so the label is always LABEL_PX tall.
  const ref = useRef<Sprite>(null)
  useFrame(({ camera, size }) => {
    const sprite = ref.current
    if (!sprite || size.height === 0) return
    const p11 = camera.projectionMatrix.elements[5] ?? 2
    const h = (2 * LABEL_PX) / (size.height * p11)
    sprite.scale.set(h * aspect, h, 1)
  })

  return (
    <sprite ref={ref} position={[0, y, 0]} renderOrder={10}>
      <spriteMaterial
        map={texture}
        sizeAttenuation={false}
        transparent
        opacity={dimmed ? 0.5 : 1}
        depthTest={false}
        toneMapped={false}
      />
    </sprite>
  )
}
