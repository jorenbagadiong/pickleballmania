import type { NetworkInterfaceInfo } from 'node:os'
import { describe, expect, it } from 'vitest'
import { isHostMachine } from '../src/rooms/hostMachine'

const wifi = (address: string, family: 'IPv4' | 'IPv6' = 'IPv4') =>
  ({ address, family, internal: false }) as NetworkInterfaceInfo
const thisComputer = { en0: [wifi('192.168.1.50'), wifi('fe80::1c2b:3a4d', 'IPv6')] }

describe('playing on the computer that runs the server', () => {
  it('the page opened as localhost is', () => {
    expect(isHostMachine('127.0.0.1', thisComputer)).toBe(true)
    expect(isHostMachine('::1', thisComputer)).toBe(true)
    expect(isHostMachine('::ffff:127.0.0.1', thisComputer)).toBe(true)
  })

  it("the page opened by this computer's own Wi-Fi address is", () => {
    expect(isHostMachine('192.168.1.50', thisComputer)).toBe(true)
    expect(isHostMachine('::ffff:192.168.1.50', thisComputer)).toBe(true)
    expect(isHostMachine('FE80::1C2B:3A4D', thisComputer)).toBe(true)
  })

  it("a friend's laptop on the same Wi-Fi is not", () => {
    expect(isHostMachine('192.168.1.51', thisComputer)).toBe(false)
    expect(isHostMachine('::ffff:192.168.1.7', thisComputer)).toBe(false)
  })

  it('an unknown address is not', () => {
    expect(isHostMachine(undefined, thisComputer)).toBe(false)
    expect(isHostMachine('', thisComputer)).toBe(false)
  })
})
