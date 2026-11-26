import { networkInterfaces } from 'node:os'
import { createGameServer } from './app'
import { loadConfig } from './config'

const config = loadConfig()
const server = createGameServer(config)

function reachableAddresses(host: string): string[] {
  if (host !== '0.0.0.0' && host !== '::') return [host]
  const out: string[] = ['localhost']
  for (const list of Object.values(networkInterfaces())) {
    for (const ni of list ?? []) if (ni.family === 'IPv4' && !ni.internal) out.push(ni.address)
  }
  return out
}

await server.listen(config.port, config.host)

console.log(`\n🏓 Pickleball 3D game server listening on ${config.host}:${config.port}`)
for (const addr of reachableAddresses(config.host)) {
  const label = addr.startsWith('100.') ? ' (likely Tailscale)' : ''
  console.log(`   http://${addr}:${config.port}/health${label}`)
}
if (config.host === '127.0.0.1' || config.host === 'localhost') {
  console.log('   Only this computer can connect. Use `yarn dev:lan` or `yarn host` to share.')
}
if (config.allowedOrigins.length > 0) {
  console.log(`   Allowed page origins: ${config.allowedOrigins.join(', ')}`)
}

let stopping = false
async function shutdown(signal: string): Promise<void> {
  if (stopping) return
  stopping = true
  console.log(`\n${signal} received — closing rooms and stopping the game server…`)
  await server.gracefullyShutdown(false).catch((err: unknown) => console.error(err))
  process.exit(0)
}
process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))
