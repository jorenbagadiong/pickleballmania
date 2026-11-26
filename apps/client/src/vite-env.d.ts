/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Full game server URL override, e.g. https://game.example.com (optional). */
  readonly GAME_SERVER_URL?: string
  /** Game server port when the URL is derived from the page hostname (default 2567). */
  readonly GAME_SERVER_PORT?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
