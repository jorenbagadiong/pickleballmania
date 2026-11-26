# Pickleball 3D

A 1v1 or 2v2 multiplayer 3D pickleball game for the browser, built to play with
friends. Players pick a room from the list (or use a code or invite link), control their
own characters on a 28 ft wide court (official is 20 ft), and rally one shared,
server-simulated ball.

> **Status: PB-001 (local multiplayer playable prototype).** Runs on your own
> computer. Nothing is deployed. See [LOCAL_MULTIPLAYER.md](LOCAL_MULTIPLAYER.md)
> to play with friends on your Wi-Fi or over Tailscale.

## Quick start

```bash
corepack enable          # once, provides the pinned Yarn 4
yarn install
yarn dev                 # client http://127.0.0.1:5173 + game server :2567 (this computer only)
```

Open two separate browser windows at `http://127.0.0.1:5173` (four for 2v2). Pick
1v1 or 2v2 and create a room in one, join with the code in the others, and have
everyone press **I'm ready**. In 2v2 you can switch teams in the lobby while a
seat is open; partners take turns serving.

**Controls:** WASD move (W = toward the net) · mouse aim · left click swing ·
Space swing (or serve, on your serve) · hold Shift while swinging to smash, and W too (moving
forward) for a jump smash, which reaches higher and hits harder ·
swipe the mouse left or right and swing (or serve) during the swipe to curve the ball that
way, more the faster you swipe; it still goes to where you aimed before the swipe.

**Training:** _Training — practice alone_ on the start screen (or _Train meanwhile_ while
watching a game) opens a private court with a coach: ball machine, serves or rally, in three
levels. It shows your timing, curve and landing after every shot, and _Back to room_ returns
to the game you were watching.

**Tournament:** tick _Tournament_ when creating a room. Up to 12 players (1v1) or 8 teams of
two drawn at random (2v2) play in groups and then a knockout, best of 3, on up to four courts
side by side in one arena; the final is played alone. Whoever leaves and comes back under the
same nickname keeps their place.

**Watching:** drag to look around (360°), scroll to zoom, **C** for the fixed cameras; in a
tournament, pick the court to watch.

**Returning the ball:** the big circle around your player is your hit zone, the same in
front and behind. When the ball is in it, it lights up yellow: swing (red means let it
bounce). You get two swings at each ball, so
mashing doesn't work. Click exactly as the ball passes
you for a faster, more accurate **PERFECT** hit. Long rallies speed up.

**Chat:** spectators can write messages. Players see them as small captions in the corner
that fade away, ignore the mouse and keyboard, and can be turned off (**Hide chat**).

## Scripts (run from the repo root)

| Command          | What it does                                                                     |
| ---------------- | -------------------------------------------------------------------------------- |
| `yarn dev`       | Client dev server + game server, listening on `127.0.0.1` only                   |
| `yarn dev:lan`   | Same, listening on all network interfaces (trusted networks only)                |
| `yarn host`      | Production build served on port 4173 + game server, all interfaces — for friends |
| `yarn build`     | Type-check and build the client to `apps/client/dist`                            |
| `yarn typecheck` | TypeScript (strict) across all workspaces                                        |
| `yarn lint`      | ESLint                                                                           |
| `yarn format`    | Prettier (`semi: false`)                                                         |
| `yarn test`      | Vitest unit + integration tests (includes a real WebSocket multiplayer test)     |
| `yarn test:e2e`  | Playwright: two real browsers play a match (uses installed Google Chrome)        |
| `yarn check`     | typecheck + lint + format check + tests + build                                  |

`GAME_HOST=<ip> yarn host` restricts both servers to one interface (e.g. your
Tailscale IP). All settings: [LOCAL_MULTIPLAYER.md §7](LOCAL_MULTIPLAYER.md#7-configuring-the-game-server-url--ports)
and [.env.example](.env.example).

## Project layout

```text
apps/
  client/            React + Vite + React Three Fiber + Tailwind
    src/court/       procedural court, net, surroundings, service-box hint
    src/players/     stylized characters, walk/swing animation, name tags
    src/ball/        ball (+ ground shadow, trail), hit/bounce effects
    src/camera/      third-person camera rig
    src/game/        canvas scene, per-frame loop (inputs, prediction), aim reticle
    src/net/         Colyseus session, snapshot interpolation, local prediction, server URL
    src/ui/          start screen, lobby, HUD
    src/input/       keyboard/mouse controls
  server/            Node + Colyseus (server-authoritative)
    src/rooms/       PickleballRoom (network adapter), synchronized schema, room codes
    src/simulation/  GameSimulation, ball physics, shot solver
    src/rules/       rally rules (faults, scoring)
packages/
  shared/            court geometry, movement step, protocol types (used by both sides)
e2e/                 Playwright two-browser test
docs/                architecture notes
```

## How it works (short)

- **Server-authoritative.** The Colyseus server runs the whole game at a fixed
  60 Hz: player movement, ball physics, net/ground collisions, hit validation,
  serve/rally/score state. Clients only send inputs (movement intent + aim,
  swing, serve, ready). State is synchronized to clients ~30 times per second.
- **One physics simulation.** The ball is simulated only on the server. The
  client predicts **only its own player's movement**, using the exact same
  shared `stepPlayer()` function, and reconciles with the server's acknowledged
  input sequence numbers.
- **Smooth remote motion.** Remote players and the ball are drawn 60–150 ms (depending on the connection) in the
  past, interpolated between server snapshots. Hit/bounce effects are scheduled
  on the same timeline so they line up with the ball you see.
- **Latency-tolerant hits (casual level).** With each swing the client sends
  the server tick it was displaying. The server checks the hit against where
  the ball was at that moment (capped at 0.5 s back), so a click made while you
  _saw_ the ball in reach connects even over Wi-Fi/Tailscale latency. Not
  competitive-grade lag compensation (no player-position rewind).

More detail: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Gameplay rules

- **Scoring:** only the serving side scores (side-out scoring). First to 11, win
  by 2, then a rematch screen; the losing side serves first in the rematch.
- **Serving:** from behind the baseline, diagonally into the service box past the
  kitchen line (the line is a fault). Singles: right court on an even score, left
  on odd. Doubles: both partners serve before a side out, except that the team
  starting the game gets one server (the score is called "0–0–2"); the server
  swaps courts after each point. Only the diagonal receiver may return the serve.
- **Two-bounce rule:** the serve and the return must each bounce before being hit.
  An early swing just waits for the bounce; it is not a fault.
- **Kitchen:** hitting the ball out of the air while in the non-volley zone, or
  stepping into it within 0.3 s of a volley, is a fault. An early click in the
  kitchen on a ball about to bounce waits for the bounce.
- **On fire:** win three rallies in a row with your own shot and you burn until your
  side loses a rally. It is only an effect; it changes nothing about the game.
- **Ending a rally:** out, into the net, two bounces, or a fault. A banner tells
  everyone what happened, who did it, and whether it was a point, a second serve
  or a side out.
- Not included: switching ends mid-game, spin, time-outs, line-call challenges.

## Tech

React 19 · Vite 8 · TypeScript 6 (strict) · three.js 0.187 · React Three Fiber 9 ·
Tailwind CSS 4 · Zustand 5 · Colyseus 0.18 (`@colyseus/core`, `@colyseus/sdk`,
`@colyseus/schema` 5) · Vitest 5 · Playwright 1.65 · ESLint 10 · Prettier 3 · Yarn 4 workspaces.
