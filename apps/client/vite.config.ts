import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))

export default defineConfig(({ mode }) => {
  // Read the repo-root .env too; real environment variables win.
  const fileEnv = loadEnv(mode, repoRoot, '')
  const env = (key: string): string => (process.env[key] ?? fileEnv[key] ?? '').trim()

  // 127.0.0.1 by default: only this computer can open the page. `yarn dev:lan` /
  // `yarn host` set GAME_HOST=0.0.0.0, or set it to one interface's IP (e.g. your
  // Tailscale 100.x address) to expose the page on that network only.
  const host = env('GAME_HOST') || '127.0.0.1'

  // Vite rejects requests whose Host header isn't allowed (DNS-rebinding
  // protection). IP addresses and localhost are always allowed; Tailscale
  // MagicDNS names end in .ts.net. Add more with GAME_ALLOWED_HOSTS=a.example,b.local
  const allowedHosts = [
    '.ts.net',
    ...env('GAME_ALLOWED_HOSTS')
      .split(',')
      .map((h) => h.trim())
      .filter(Boolean),
  ]

  return {
    envDir: repoRoot,
    // Only these variables are exposed to browser code.
    envPrefix: ['VITE_', 'GAME_SERVER_'],
    plugins: [react(), tailwindcss()],
    server: {
      host,
      port: Number(env('CLIENT_DEV_PORT')) || 5173,
      strictPort: true,
      allowedHosts,
    },
    preview: {
      host,
      port: Number(env('CLIENT_PREVIEW_PORT')) || 4173,
      strictPort: true,
      allowedHosts,
    },
    build: {
      chunkSizeWarningLimit: 1600,
    },
  }
})
