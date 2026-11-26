import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import { useUi } from '../state/store'
import { FrameRateMeter, TARGET_FPS, lowerQuality, saveQuality } from './quality'

/** Slow seconds in a row before shadows and the like go, so one busy moment doesn't cost them. */
const SLOW_SAMPLES = 2

function storage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

/**
 * Keeps the game smooth on slower computers by giving up looks, step by step. It only
 * ever steps down, so the picture doesn't flicker back and forth, and it remembers
 * where it ended up for next time. The sharpness lives in the store (the canvas reads
 * it from there), so redrawing the page never puts it back up.
 */
export function AdaptiveQuality() {
  const meter = useRef(new FrameRateMeter())
  const slow = useRef(0)

  useFrame((_state, delta) => {
    const m = meter.current
    if (document.hidden) {
      m.restart()
      return
    }
    const fps = m.add(delta)
    if (fps === null) return
    const { dpr, shadows, crowd } = useUi.getState()
    useUi.setState({ fps: Math.round(fps) })
    if (fps >= TARGET_FPS) {
      slow.current = 0
      return
    }
    slow.current += 1
    if (dpr <= 1 && slow.current < SLOW_SAMPLES) return
    const next = lowerQuality({ dpr, shadows, crowd }, fps)
    if (!next) return
    slow.current = 0
    useUi.setState({ dpr: next.dpr, shadows: next.shadows, crowd: next.crowd })
    saveQuality(next, storage())
    m.restart()
  })

  return null
}
