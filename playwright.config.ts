import { defineConfig } from '@playwright/test'

/**
 * Two-browser multiplayer tests. Starts a real game server and a production
 * build of the client (served by `vite preview`) on test-only ports, so they
 * don't collide with a running `yarn dev`.
 *
 * Browser: uses the locally installed Google Chrome (channel "chrome") because
 * Playwright's bundled Chromium doesn't support older macOS versions. Set
 * PW_CHANNEL=chromium to use the bundled browser instead (`npx playwright install chromium`).
 */
const SERVER_PORT = 2667
const CLIENT_PORT = 4273

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  // Up to five game windows share one graphics card here, so a page can take several
  // seconds to draw its first frame. (Real players each have their own computer.)
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${CLIENT_PORT}`,
    channel:
      process.env.PW_CHANNEL === 'chromium' ? undefined : (process.env.PW_CHANNEL ?? 'chrome'),
    headless: process.env.PW_HEADED ? false : true,
    viewport: { width: 960, height: 540 },
    // Several pages share one browser in these tests; stop Chrome from throttling
    // the pages that aren't focused (two real players each have their own window).
    launchOptions: {
      args: [
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        '--disable-backgrounding-occluded-windows',
      ],
    },
  },
  webServer: [
    {
      command: 'yarn workspace @pickleball/server serve',
      url: `http://127.0.0.1:${SERVER_PORT}/health`,
      env: { GAME_HOST: '127.0.0.1', GAME_SERVER_PORT: String(SERVER_PORT) },
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: 'yarn workspace @pickleball/client build && yarn workspace @pickleball/client serve',
      url: `http://127.0.0.1:${CLIENT_PORT}`,
      env: {
        GAME_HOST: '127.0.0.1',
        GAME_SERVER_PORT: String(SERVER_PORT),
        CLIENT_PREVIEW_PORT: String(CLIENT_PORT),
      },
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
})
