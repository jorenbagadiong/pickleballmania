import {
  DRIVE_SHOT_POWER,
  type MoveIntent,
  NORMAL_SHOT_POWER,
  type Phase,
  type Side,
} from '@pickleball/shared'
import { type Pointer, type Swipe, swipe } from './swipe'

/**
 * A curve being held (Q, E or the right mouse button): the aim stays where it was,
 * and sliding the mouse sideways from `start` sets which way and how much it bends.
 */
export interface Bend {
  start: Pointer
}

/** Live input state, mutated by DOM listeners and read by the fixed-step loop. */
export const controls = {
  keys: new Set<string>(),
  /** Aim point on the ground (world space), updated from the mouse each frame. */
  aim: { x: 0, z: -4 },
  /** Where the mouse is in the view: -1 to 1 from left to right and bottom to top. */
  pointer: { x: 0, y: 0 } as Pointer,
  /** The right mouse button is down. */
  rightButton: false,
  bend: null as Bend | null,
  /** Held curves (Q, E, the right button) are on: the server says so, for one player. */
  cheats: false,
}

/** Slides smaller than this (half-screens) leave a held curve as it was. */
export const BEND_DEAD_ZONE = 0.03
/** Sliding this far to one side (half-screens, ~15% of the screen) bends fully. */
export const BEND_FULL = 0.3

const UP = ['KeyW', 'ArrowUp']
const DOWN = ['KeyS', 'ArrowDown']
const LEFT = ['KeyA', 'ArrowLeft']
const RIGHT = ['KeyD', 'ArrowRight']
/** Held while swinging or serving: the easy way to curve (cheaters only). */
const CURVE_LEFT = 'KeyQ'
const CURVE_RIGHT = 'KeyE'
const GAME_KEYS = new Set([
  ...UP,
  ...DOWN,
  ...LEFT,
  ...RIGHT,
  'Space',
  'KeyC',
  CURVE_LEFT,
  CURVE_RIGHT,
])

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

/** Q held curves left (-1), E right (1); both or neither: 0. */
export function keySpin(keys: ReadonlySet<string> = controls.keys): number {
  return (keys.has(CURVE_RIGHT) ? 1 : 0) - (keys.has(CURVE_LEFT) ? 1 : 0)
}

/**
 * The bend of a held curve: by how far the mouse slid sideways since the hold began.
 * Until it slides, Q bends fully left and E fully right (the right button: straight).
 */
export function bendSpin(bend: Bend, pointer: Pointer, keys: ReadonlySet<string>): number {
  const slid = pointer.x - bend.start.x
  const size = Math.abs(slid)
  if (size < BEND_DEAD_ZONE) return keySpin(keys)
  return Math.sign(slid) * Math.min(1, (size - BEND_DEAD_ZONE) / (BEND_FULL - BEND_DEAD_ZONE))
}

/**
 * Starts a held curve when Q, E or the right button goes down, ends it when all are up.
 * Everyone else curves by swiping the mouse only.
 */
export function updateBend(): void {
  const holding =
    controls.cheats &&
    (controls.rightButton || controls.keys.has(CURVE_LEFT) || controls.keys.has(CURVE_RIGHT))
  if (!holding) controls.bend = null
  else if (!controls.bend) controls.bend = { start: { ...controls.pointer } }
}

/**
 * How a swing right now would curve, as the player sees it (-1 left, 1 right): from a
 * held curve (the aim stays put meanwhile), otherwise from swiping the mouse. A swipe
 * also says where it was aimed.
 */
export function plannedSpin(now: number): { spin: number; pointer: Swipe['pointer'] | null } {
  const bend = controls.bend
  if (bend) return { spin: bendSpin(bend, controls.pointer, controls.keys), pointer: null }
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
    updateBend()
  }
  const keyup = (e: KeyboardEvent): void => {
    controls.keys.delete(e.code)
    updateBend()
  }
  const rightButton = (down: boolean): void => {
    controls.rightButton = down
    updateBend()
  }
  // Swing on press (not release) so the paddle moves the instant you click.
  const pointerdown = (e: PointerEvent): void => {
    if (e.button === 2) rightButton(true)
    if (e.button !== 0) return
    handlers.onSwing(shotPower(e))
  }
  const pointermove = (e: PointerEvent): void => {
    const r = surface.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) return
    const x = ((e.clientX - r.left) / r.width) * 2 - 1
    const y = 1 - ((e.clientY - r.top) / r.height) * 2
    controls.pointer = { x, y }
    swipe.move(e.timeStamp / 1000, x, y)
    // With one button already down, the browser reports the other as a move.
    if (e.button === 0 && (e.buttons & 1) !== 0) handlers.onSwing(shotPower(e))
    if (e.button === 2) rightButton((e.buttons & 2) !== 0)
  }
  const pointerup = (e: PointerEvent): void => {
    if (e.button === 2 || (e.buttons & 2) === 0) rightButton(false)
  }
  const reset = (): void => {
    controls.keys.clear()
    controls.rightButton = false
    controls.bend = null
    swipe.reset()
  }
  const contextmenu = (e: Event): void => e.preventDefault()

  window.addEventListener('keydown', keydown)
  window.addEventListener('keyup', keyup)
  window.addEventListener('blur', reset)
  surface.addEventListener('pointerdown', pointerdown)
  surface.addEventListener('pointermove', pointermove)
  window.addEventListener('pointerup', pointerup)
  surface.addEventListener('contextmenu', contextmenu)
  return () => {
    window.removeEventListener('keydown', keydown)
    window.removeEventListener('keyup', keyup)
    window.removeEventListener('blur', reset)
    surface.removeEventListener('pointerdown', pointerdown)
    surface.removeEventListener('pointermove', pointermove)
    window.removeEventListener('pointerup', pointerup)
    surface.removeEventListener('contextmenu', contextmenu)
    reset()
  }
}
