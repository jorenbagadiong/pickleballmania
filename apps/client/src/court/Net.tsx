import { COURT, netHeightAt } from '@pickleball/shared'
import { useEffect, useMemo } from 'react'
import { CanvasTexture, DoubleSide, PlaneGeometry, RepeatWrapping } from 'three'

const POST_HEIGHT = COURT.netHeightPost + 0.03

function makeMeshTexture(): CanvasTexture {
  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const g = canvas.getContext('2d')
  if (g) {
    g.clearRect(0, 0, size, size)
    g.strokeStyle = 'rgba(20, 20, 24, 0.95)'
    g.lineWidth = 6
    g.strokeRect(0, 0, size, size)
  }
  const tex = new CanvasTexture(canvas)
  tex.wrapS = RepeatWrapping
  tex.wrapT = RepeatWrapping
  // ~4 cm mesh squares.
  tex.repeat.set((COURT.netHalfWidth * 2) / 0.045, COURT.netHeightPost / 0.045)
  tex.anisotropy = 4
  return tex
}

/** Net: posts, a mesh whose top sags from 36 in at the posts to 34 in at center, white tape, center strap. */
export function Net() {
  const { geometry, texture } = useMemo(() => {
    const width = COURT.netHalfWidth * 2
    const geo = new PlaneGeometry(width, 1, 48, 1)
    const pos = geo.attributes.position
    if (pos) {
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i)
        // Plane spans y in [-0.5, 0.5]; map to [0, netHeight(x)].
        pos.setY(i, pos.getY(i) > 0 ? netHeightAt(x) : 0)
      }
      pos.needsUpdate = true
    }
    geo.computeVertexNormals()
    return { geometry: geo, texture: makeMeshTexture() }
  }, [])

  useEffect(
    () => () => {
      geometry.dispose()
      texture.dispose()
    },
    [geometry, texture],
  )

  const tapeSegments = useMemo(() => {
    // Two straight tape segments from each post down to the center.
    const h0 = COURT.netHeightPost
    const h1 = COURT.netHeightCenter
    const len = Math.hypot(COURT.netHalfWidth, h0 - h1)
    const angle = Math.atan2(h0 - h1, COURT.netHalfWidth)
    return [1, -1].map((s) => ({
      key: s,
      position: [(s * COURT.netHalfWidth) / 2, (h0 + h1) / 2, 0] as const,
      rotationZ: s * angle,
      len,
    }))
  }, [])

  return (
    <group>
      <mesh geometry={geometry} castShadow>
        <meshStandardMaterial
          map={texture}
          transparent
          alphaTest={0.3}
          side={DoubleSide}
          color="#111827"
        />
      </mesh>
      {tapeSegments.map((t) => (
        <mesh key={t.key} position={[...t.position]} rotation-z={t.rotationZ} castShadow>
          <boxGeometry args={[t.len, 0.05, 0.02]} />
          <meshStandardMaterial color="#f8fafc" />
        </mesh>
      ))}
      {/* Center strap */}
      <mesh position={[0, COURT.netHeightCenter / 2, 0]}>
        <boxGeometry args={[0.05, COURT.netHeightCenter, 0.015]} />
        <meshStandardMaterial color="#f8fafc" />
      </mesh>
      {[1, -1].map((s) => (
        <mesh key={s} position={[s * (COURT.netHalfWidth + 0.03), POST_HEIGHT / 2, 0]} castShadow>
          <cylinderGeometry args={[0.04, 0.045, POST_HEIGHT, 12]} />
          <meshStandardMaterial color="#1f2937" metalness={0.5} roughness={0.4} />
        </mesh>
      ))}
    </group>
  )
}
