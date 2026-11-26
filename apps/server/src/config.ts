import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { DEFAULT_SERVER_PORT } from '@pickleball/shared'

// Load the repo-root .env (if present) using Node's built-in loader; real
// environment variables always take precedence over the file.
const rootEnv = fileURLToPath(new URL('../../../.env', import.meta.url))
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv)

function parsePort(value: string | undefined, fallback: number): number {
  const n = Number(value)
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : fallback
}

export interface ServerConfig {
  /** Interface to bind. 127.0.0.1 = this computer only; 0.0.0.0 = all interfaces. */
  host: string
  port: number
  /** If non-empty, only pages served from these origins may join rooms. */
  allowedOrigins: string[]
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  return {
    host: env.GAME_HOST?.trim() || '127.0.0.1',
    port: parsePort(env.GAME_SERVER_PORT, DEFAULT_SERVER_PORT),
    allowedOrigins: (env.GAME_ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((s) => s.trim().replace(/\/$/, ''))
      .filter(Boolean),
  }
}
