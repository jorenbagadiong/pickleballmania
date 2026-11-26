import { DEFAULT_SERVER_PORT } from '@pickleball/shared'

interface LocationLike {
  protocol: string
  hostname: string
}

interface EnvLike {
  GAME_SERVER_URL?: string
  GAME_SERVER_PORT?: string
}

/**
 * Where the game server lives. By default it is the same host that served this
 * page (so a friend who opened http://192.168.1.50:5173 connects to
 * 192.168.1.50:2567 — never to their own localhost), on the configured port.
 * GAME_SERVER_URL overrides everything (useful later for production).
 */
export function resolveServerUrl(loc: LocationLike, env: EnvLike): string {
  const explicit = env.GAME_SERVER_URL?.trim()
  if (explicit) return explicit.replace(/\/$/, '')
  const port = Number(env.GAME_SERVER_PORT) || DEFAULT_SERVER_PORT
  const scheme = loc.protocol === 'https:' ? 'https' : 'http'
  const host =
    loc.hostname.includes(':') && !loc.hostname.startsWith('[') ? `[${loc.hostname}]` : loc.hostname
  return `${scheme}://${host}:${port}`
}
