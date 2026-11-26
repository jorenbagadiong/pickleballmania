import { Server, matchMaker } from '@colyseus/core'
import { WebSocketTransport } from '@colyseus/ws-transport'
import { ROOM_NAME } from '@pickleball/shared'
import type { ServerConfig } from './config'
import { listRooms } from './rooms/roomDirectory'
import { PickleballRoom } from './rooms/PickleballRoom'

/** Builds (but does not start) the game server. Shared by main.ts and tests. */
export function createGameServer(config: Pick<ServerConfig, 'allowedOrigins'>): Server {
  const allowed = config.allowedOrigins
  if (allowed.length > 0) {
    // Restrict the matchmaking HTTP endpoints (CORS) to the allowed origins.
    matchMaker.controller.getCorsHeaders = (headers: Headers) => {
      const origin = headers.get('origin') ?? ''
      return {
        'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : (allowed[0] ?? ''),
      }
    }
  }

  const server = new Server({
    transport: new WebSocketTransport({ pingInterval: 3000, pingMaxRetries: 3 }),
    greet: false,
    gracefullyShutdown: false,
    express: (app) => {
      app.get('/health', (_req, res) => {
        res.json({ ok: true, service: 'pickleball-3d', time: new Date().toISOString() })
      })
      // Room list for the start screen. The page is on another port, hence CORS;
      // the same allow-list that guards joining guards this.
      app.get('/rooms', (req, res) => {
        const origin = (req.headers.origin ?? '').replace(/\/$/, '')
        if (allowed.length > 0 && !allowed.includes(origin)) {
          res.status(403).json({ error: 'This page is not allowed to see rooms on this server' })
          return
        }
        res.setHeader('Access-Control-Allow-Origin', allowed.length > 0 ? origin : '*')
        res.setHeader('Vary', 'Origin')
        res.setHeader('Cache-Control', 'no-store')
        res.json({ rooms: listRooms() })
      })
    },
  })
  server.define(ROOM_NAME, PickleballRoom, { allowedOrigins: allowed })
  return server
}
