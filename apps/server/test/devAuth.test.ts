import { describe, expect, it } from 'vitest'
import {
  MIN_DEV_KEY_LENGTH,
  configuredDevKey,
  devKeyMatches,
  grantsTezuka,
} from '../src/rooms/devAuth'

const KEY = 'correct-horse-battery'
const env = { PICKLEBALL_DEV_KEY: KEY }

describe('the developer key', () => {
  it('is off when PICKLEBALL_DEV_KEY is not set, empty or too short', () => {
    expect(configuredDevKey({})).toBeNull()
    expect(configuredDevKey({ PICKLEBALL_DEV_KEY: '' })).toBeNull()
    const short = 'x'.repeat(MIN_DEV_KEY_LENGTH - 1)
    expect(configuredDevKey({ PICKLEBALL_DEV_KEY: short })).toBeNull()
    expect(devKeyMatches(short, { PICKLEBALL_DEV_KEY: short })).toBe(false)
    expect(devKeyMatches('', {})).toBe(false)
    expect(devKeyMatches(undefined, {})).toBe(false)
  })

  it('matches only the exact key', () => {
    expect(devKeyMatches(KEY, env)).toBe(true)
    for (const wrong of [`${KEY} `, KEY.toUpperCase(), KEY.slice(1), '', 'x'.repeat(300)]) {
      expect(devKeyMatches(wrong, env), JSON.stringify(wrong)).toBe(false)
    }
    for (const notText of [undefined, null, 42, [KEY], { key: KEY }]) {
      expect(devKeyMatches(notText, env)).toBe(false)
    }
  })
})

describe('who plays the secret athlete', () => {
  const ok = { onHost: true, devKey: true }

  it('takes the name (any capitals), the host computer, the key and a room allowing it', () => {
    expect(grantsTezuka('Tezuka', ok, true)).toBe(true)
    expect(grantsTezuka('  tEZUKA ', ok, true)).toBe(true)
  })

  it('any one missing is a normal player', () => {
    expect(grantsTezuka('Tezuka', { onHost: false, devKey: true }, true)).toBe(false)
    expect(grantsTezuka('Tezuka', { onHost: true, devKey: false }, true)).toBe(false)
    expect(grantsTezuka('Tezuka', ok, false)).toBe(false)
    expect(grantsTezuka('Tezuka', undefined, true)).toBe(false)
    expect(grantsTezuka('Tezuka', {}, true)).toBe(false)
    for (const name of ['Cheater', 'Tezukas', 'Tez uka', 'Bob']) {
      expect(grantsTezuka(name, ok, true), name).toBe(false)
    }
  })
})
