import { DRIVE_SHOT_POWER, NORMAL_SHOT_POWER } from '@pickleball/shared'
import { describe, expect, it } from 'vitest'
import { spaceAction } from '../src/input/controls'
import { gamePointFor } from '../src/game/gamePoint'
import { blendArm, runPose } from '../src/players/runPose'
import { wantsJump } from '../src/input/jump'
import { JUMP_ANIM_SECONDS, SMASH_ANIM_SECONDS, isSmash, swingPose } from '../src/players/swingPose'

describe('spaceAction', () => {
  it('serves only when it is your serve', () => {
    expect(spaceAction('serving', true)).toBe('serve')
  })

  it('swings the rest of the time', () => {
    expect(spaceAction('rally', true)).toBe('swing')
    expect(spaceAction('rally', false)).toBe('swing')
    expect(spaceAction('serving', false)).toBe('swing')
  })
})

describe('swingPose', () => {
  it('only the hard shot is a smash', () => {
    expect(isSmash(DRIVE_SHOT_POWER)).toBe(true)
    expect(isSmash(NORMAL_SHOT_POWER)).toBe(false)
    expect(isSmash(0.3)).toBe(false) // serve
  })

  it('a smash raises the paddle overhead, slams it down, and jumps', () => {
    const at = (f: number) => swingPose(SMASH_ANIM_SECONDS * f, DRIVE_SHOT_POWER)
    expect(at(0.2).armPitch).toBeLessThan(-Math.PI) // past vertical: behind the head
    expect(at(0.5).armPitch).toBeGreaterThan(-0.8) // swung down in front
    expect(Math.max(...[0.1, 0.2, 0.3, 0.4].map((f) => at(f).lift))).toBeGreaterThan(0.2)
    expect(at(0.5).lean).toBeGreaterThan(0.1)
  })

  it('a normal swing stays on the ground', () => {
    const p = swingPose(0.1, NORMAL_SHOT_POWER)
    expect(p.lift).toBe(0)
    expect(p.lean).toBe(0)
    expect(p.armPitch).toBeGreaterThan(-Math.PI / 2)
  })

  it('returns to the same idle pose after any swing, without a jump at the end', () => {
    const idle = swingPose(-1, NORMAL_SHOT_POWER)
    expect(swingPose(10, DRIVE_SHOT_POWER)).toEqual(idle)
    const end = swingPose(SMASH_ANIM_SECONDS * 0.999, DRIVE_SHOT_POWER)
    expect(end.armPitch).toBeCloseTo(idle.armPitch, 1)
    expect(end.lift).toBeCloseTo(0, 1)
    expect(end.lean).toBeCloseTo(0, 1)
  })
})

describe('stroke direction', () => {
  it('swings across from the side the ball is on, reaching up or down for it', () => {
    const fore = (t: number) => swingPose(t, NORMAL_SHOT_POWER, false)
    const back = (t: number) => swingPose(t, NORMAL_SHOT_POWER, true)
    expect(fore(0.02).armYaw).toBeLessThan(fore(0.2).armYaw)
    expect(back(0.02).armYaw).toBeGreaterThan(back(0.2).armYaw)
    const low = swingPose(0.1, NORMAL_SHOT_POWER, false, 0.3).armPitch
    const high = swingPose(0.1, NORMAL_SHOT_POWER, false, 2).armPitch
    expect(high).toBeLessThan(low)
  })
})

describe('paddle angle', () => {
  it('leads with the face in a stroke and turns back for a smash', () => {
    expect(swingPose(0.1, NORMAL_SHOT_POWER).roll).toBeCloseTo(Math.PI / 2, 6)
    expect(swingPose(SMASH_ANIM_SECONDS * 0.4, DRIVE_SHOT_POWER).roll).toBeCloseTo(0, 6)
    expect(swingPose(-1, NORMAL_SHOT_POWER).wrist).toBeLessThan(-0.5) // held up when ready
  })
})

describe('gamePointFor', () => {
  it('only the serving side can be on game point, and must lead by one already', () => {
    expect(gamePointFor([10, 5], 0)).toBe(true)
    expect(gamePointFor([10, 5], 1)).toBe(false)
    expect(gamePointFor([10, 10], 0)).toBe(false)
    expect(gamePointFor([12, 11], 0)).toBe(true)
    expect(gamePointFor([9, 0], 0)).toBe(false)
  })
})

describe('runPose', () => {
  it('stands still when not moving', () => {
    const p = runPose({ phase: 1.3, speed: 0, heading: 0 })
    for (const v of [p.thighL, p.thighR, p.hipTurn, p.leanX, p.leanZ]) expect(v).toBeCloseTo(0, 6)
    expect(p.run).toBe(0)
  })

  it('legs alternate and knees only bend backwards', () => {
    for (let phase = 0; phase < Math.PI * 2; phase += 0.3) {
      const p = runPose({ phase, speed: 5, heading: 0 })
      expect(p.thighL).toBeCloseTo(-p.thighR, 6)
      expect(p.kneeL).toBeGreaterThanOrEqual(0)
      expect(p.kneeR).toBeGreaterThanOrEqual(0)
    }
  })

  it('hips turn toward the run while the chest can keep facing the ball', () => {
    const right = runPose({ phase: 1, speed: 5, heading: 1 })
    expect(right.hipTurn).toBeGreaterThan(0.5)
    // Running straight back is a backpedal, not a 180 degree hip turn.
    const back = runPose({ phase: 1, speed: 5, heading: Math.PI })
    expect(Math.abs(back.hipTurn)).toBeLessThan(0.1)
    expect(back.thighL).toBeCloseTo(-runPose({ phase: 1, speed: 5, heading: 0 }).thighL, 6)
  })

  it('running does not change the swing: the paddle arm follows the swing pose', () => {
    const run = runPose({ phase: 1, speed: 5, heading: 0.4 })
    const idle = blendArm(swingPose(-1, NORMAL_SHOT_POWER), run)
    const swing = swingPose(0.1, NORMAL_SHOT_POWER)
    const smash = swingPose(SMASH_ANIM_SECONDS * 0.2, DRIVE_SHOT_POWER)
    expect(blendArm(swing, run).armPitch).toBeCloseTo(swing.armPitch, 6)
    expect(blendArm(smash, run).armPitch).toBeCloseTo(smash.armPitch, 6)
    expect(idle.armPitch).not.toBeCloseTo(swingPose(-1, NORMAL_SHOT_POWER).armPitch, 2) // pumps
  })
})

describe('jump smash', () => {
  const at = (f: number) => swingPose(JUMP_ANIM_SECONDS * f, DRIVE_SHOT_POWER, false, 2, true)

  it('leaps high with the paddle behind the head, slams, and lands back in the ready pose', () => {
    expect(at(0.18).armPitch).toBeLessThan(-Math.PI)
    expect(Math.max(...[0.2, 0.3, 0.4].map((f) => at(f).lift))).toBeGreaterThan(0.6)
    expect(at(0.42).armPitch).toBeGreaterThan(-0.8)
    expect(at(0.85).lift).toBeLessThan(0) // knees give on landing
    const idle = swingPose(-1, DRIVE_SHOT_POWER)
    expect(at(0.9999).lift).toBeCloseTo(0, 2)
    expect(at(0.9999).armPitch).toBeCloseTo(idle.armPitch, 2)
    expect(at(1.2)).toEqual(idle)
  })

  const ball = (y: number, z = -1) => ({
    x: 0,
    y,
    z,
    vx: 0,
    vy: 0,
    vz: 4,
    visible: true,
    held: false,
  })
  const me = { x: 0, z: 0 }

  it('needs a smash and moving forward', () => {
    expect(wantsJump(DRIVE_SHOT_POWER, 1, me, ball(2.4))).toBe(true)
    expect(wantsJump(DRIVE_SHOT_POWER, 0, me, ball(2.4))).toBe(false)
    expect(wantsJump(DRIVE_SHOT_POWER, -1, me, ball(2.4))).toBe(false)
    expect(wantsJump(NORMAL_SHOT_POWER, 1, me, ball(2.4))).toBe(false)
  })

  it('does not leap over a low ball', () => {
    expect(wantsJump(DRIVE_SHOT_POWER, 1, me, ball(0.4))).toBe(false)
  })

  it('leaps when there is no ball about to be met', () => {
    expect(wantsJump(DRIVE_SHOT_POWER, 1, me, null)).toBe(true)
    expect(wantsJump(DRIVE_SHOT_POWER, 1, me, ball(0.4, -9))).toBe(true)
  })
})
