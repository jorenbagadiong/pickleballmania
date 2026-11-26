/**
 * What to give up, in order, when a computer can't draw the game smoothly. A low
 * frame rate delays inputs and makes the ball harder to hit, so looks go first.
 */
export interface Quality {
  /** Pixels drawn per screen pixel. */
  dpr: number
  shadows: boolean
  crowd: boolean
}

/** Below this average frame rate the game looks for something to give up. */
export const TARGET_FPS = 50
/** This slow, small steps would take too long to help. */
const VERY_SLOW_FPS = 30
const DPR_STEP = 0.25
const LOWEST_DPR = 0.5

/** Frame rate a lower sharpness is chosen to reach. */
const AIM_FPS = 55
const HIGHEST_DPR = 2

/** The next step down, or null when there is nothing left to give up. */
export function lowerQuality(q: Quality, fps: number): Quality | null {
  if (q.dpr > 1) {
    if (fps < VERY_SLOW_FPS) return { ...q, dpr: 1 }
    // Drawing time follows the number of pixels, so go straight to about the right size.
    const fit = Math.floor((q.dpr * Math.sqrt(fps / AIM_FPS)) / DPR_STEP) * DPR_STEP
    return { ...q, dpr: Math.max(1, Math.min(q.dpr - DPR_STEP, fit)) }
  }
  if (q.shadows) return { ...q, shadows: false, crowd: q.crowd && fps >= VERY_SLOW_FPS }
  if (q.crowd) return { ...q, crowd: false }
  // A blurry picture only helps when drawing is what's slow, so it is the last resort.
  if (q.dpr > LOWEST_DPR && fps < VERY_SLOW_FPS) return { ...q, dpr: LOWEST_DPR }
  return null
}

/** The best this screen can show. */
export function fullQuality(deviceDpr: number): Quality {
  const dpr = Number.isFinite(deviceDpr) && deviceDpr > 0 ? deviceDpr : 1
  return { dpr: Math.min(HIGHEST_DPR, Math.max(1, dpr)), shadows: true, crowd: true }
}

const QUALITY_KEY = 'pickleball.quality'
/** A computer may be faster another day (other apps closed, plugged in): look again after this. */
const REMEMBER_MS = 7 * 24 * 3600 * 1000

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>

/**
 * What this computer managed last time, so the game does not start slow and step
 * down again (each step costs a moment of stutter). Never more than the screen can show.
 */
export function savedQuality(deviceDpr: number, store: Storage | null, now = Date.now()): Quality {
  const full = fullQuality(deviceDpr)
  try {
    const raw = store?.getItem(QUALITY_KEY)
    if (!raw) return full
    const saved = JSON.parse(raw) as Partial<Quality> & { at?: number }
    if (typeof saved.at !== 'number' || now - saved.at > REMEMBER_MS || now < saved.at) return full
    const dpr =
      typeof saved.dpr === 'number' && Number.isFinite(saved.dpr)
        ? Math.min(full.dpr, Math.max(LOWEST_DPR, saved.dpr))
        : full.dpr
    return { dpr, shadows: saved.shadows !== false, crowd: saved.crowd !== false }
  } catch {
    return full
  }
}

export function saveQuality(q: Quality, store: Storage | null, now = Date.now()): void {
  try {
    store?.setItem(QUALITY_KEY, JSON.stringify({ ...q, at: now }))
  } catch {
    // Private browsing: it just won't be remembered.
  }
}

const SAMPLE_SECONDS = 1
/** Loading and recompiling make the first moments slow whatever the computer. */
const WARM_UP_SECONDS = 1.5
/** One frame this long is a hiccup or a hidden tab; several in a row are a slow computer. */
const HICCUP_SECONDS = 0.25
const HICCUPS_ALLOWED = 2

/** Turns frame times into an average frame rate about once a second. */
export class FrameRateMeter {
  private frames = 0
  private seconds = 0
  private hiccups = 0
  private warmUp = WARM_UP_SECONDS

  /** Start over, ignoring the next moments. */
  restart(): void {
    this.frames = 0
    this.seconds = 0
    this.hiccups = 0
    this.warmUp = WARM_UP_SECONDS
  }

  /** Returns the frame rate when a sample is complete. */
  add(delta: number): number | null {
    if (delta > HICCUP_SECONDS) {
      this.hiccups += 1
      if (this.hiccups <= HICCUPS_ALLOWED) {
        this.frames = 0
        this.seconds = 0
        return null
      }
    } else this.hiccups = 0
    if (this.warmUp > 0) {
      this.warmUp -= delta
      return null
    }
    this.frames += 1
    this.seconds += delta
    if (this.seconds < SAMPLE_SECONDS) return null
    const fps = this.frames / this.seconds
    this.frames = 0
    this.seconds = 0
    return fps
  }
}
