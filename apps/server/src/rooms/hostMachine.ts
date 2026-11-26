import { type NetworkInterfaceInfo, networkInterfaces } from 'node:os'

type Interfaces = NodeJS.Dict<NetworkInterfaceInfo[]>

/**
 * Whether a player connects from the computer running the server: from 127.0.0.1
 * (the page opened as localhost) or from one of this computer's own addresses (the
 * page opened by its Wi-Fi address). Friends on their own laptops never are.
 */
export function isHostMachine(
  ip: string | undefined,
  interfaces: Interfaces = networkInterfaces(),
): boolean {
  if (!ip) return false
  const address = ip
    .trim()
    .toLowerCase()
    .replace(/^::ffff:/, '')
  if (address === '::1' || address.startsWith('127.')) return true
  return Object.values(interfaces).some((list) =>
    list?.some((i) => i.address.toLowerCase() === address),
  )
}
