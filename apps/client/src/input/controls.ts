import {
  DRIVE_SHOT_POWER,
  type MoveIntent,
  NORMAL_SHOT_POWER,
  type Phase,
  type Side,
} from '@pickleball/shared'
import { type Swipe, swipe } from './swipe'

/** Live input state, mutated by DOM listeners and read by the fixed-step loop. */
export const controls = {
  keys: new Set<string>(),
  /** Aim point on the ground (world space), updated from the mouse each frame. */
  aim: { x: 0, z: -4 },
}

const UP = ['KeyW', 'ArrowUp']
const DOWN = ['KeyS', 'ArrowDown']
const LEFT = ['KeyA', 'ArrowLeft']
const RIGHT = ['KeyD', 'ArrowRight']
const GAME_KEYS = new Set([...UP, ...DOWN, ...LEFT, ...RIGHT, 'Space', 'KeyC'])

function held(codes: string[]): number {
  return codes.some((c) => controls.keys.has(c)) ? 1 : 0
}

/**
 * Converts WASD into a world-space intent relative to this player's camera,
 * which always sits behind their own baseline: W is always "toward the net".
 * The player on the +z half faces -z (their right is +x); the -z player is mirrored.
 */
export function movementIntent(side: Side): MoveIntent {
  const forward = held(UP) - held(DOWN)
  const right = held(RIGHT) - held(LEFT)
  let mx = right * side
  let mz = -forward * side
  const len = Math.hypot(mx, mz)
  if (len > 1) {
    mx /= len
    mz /= len
  }
  return { mx, mz }
}

/** Holding Shift turns a swing into a smash: a hard, flat shot. */
function shotPower(e: { shiftKey: boolean }): number {
  return e.shiftKey ? DRIVE_SHOT_POWER : NORMAL_SHOT_POWER
}

/**
 * How a swing right now would curve, as the player sees it (-1 left, 1 right), from
 * swiping the mouse. A swipe also says where it was aimed.
 */
export function plannedSpin(now: number): { spin: number; pointer: Swipe['pointer'] | null } {
  return swipe.read(now) ?? { spin: 0, pointer: null }
}

function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  )
}

/** Space serves when it's your serve, and swings the rest of the time. */
export function spaceAction(phase: Phase, isServer: boolean): 'serve' | 'swing' {
  return phase === 'serving' && isServer ? 'serve' : 'swing'
}

export interface ControlHandlers {
  /** Called the moment the mouse button goes down, with the shot power. */
  onSwing(power: number): void
  /** Called the moment Space goes down, with the shot power if it ends up being a swing. */
  onSpace(power: number): void
  /** C: next spectator camera. */
  onCycleView(): void
}

/** Installs keyboard/mouse listeners. `surface` is the 3D canvas container. */
export function installControls(surface: HTMLElement, handlers: ControlHandlers): () => void {
  const keydown = (e: KeyboardEvent): void => {
    // Leave browser shortcuts (such as copying with Ctrl/Cmd+C) alone.
    if (e.metaKey || e.ctrlKey) return
    if (isTyping(e.target) || !GAME_KEYS.has(e.code)) return
    e.preventDefault() // stop Space/arrows from scrolling or pressing focused buttons
    if (e.code === 'KeyC' && !e.repeat) handlers.onCycleView()
    if (e.code === 'Space' && !e.repeat) handlers.onSpace(shotPower(e))
    controls.keys.add(e.code)
  }
  const keyup = (e: KeyboardEvent): void => {
    controls.keys.delete(e.code)
  }
  // Swing on press (not release) so the paddle moves the instant you click.
  const pointerdown = (e: PointerEvent): void => {
    if (e.button !== 0) return
    handlers.onSwing(shotPower(e))
  }
  const pointermove = (e: PointerEvent): void => {
    const r = surface.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) return
    swipe.move(
      e.timeStamp / 1000,
      ((e.clientX - r.left) / r.width) * 2 - 1,
      1 - ((e.clientY - r.top) / r.height) * 2,
    )
  }
  const reset = (): void => {
    controls.keys.clear()
    swipe.reset()
  }
  const contextmenu = (e: Event): void => e.preventDefault()

  window.addEventListener('keydown', keydown)
  window.addEventListener('keyup', keyup)
  window.addEventListener('blur', reset)
  surface.addEventListener('pointerdown', pointerdown)
  surface.addEventListener('pointermove', pointermove)
  surface.addEventListener('contextmenu', contextmenu)
  return () => {
    window.removeEventListener('keydown', keydown)
    window.removeEventListener('keyup', keyup)
    window.removeEventListener('blur', reset)
    surface.removeEventListener('pointerdown', pointerdown)
    surface.removeEventListener('pointermove', pointermove)
    surface.removeEventListener('contextmenu', contextmenu)
    reset()
  }
}
