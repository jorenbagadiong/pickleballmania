# Architecture notes (PB-001)

## Responsibilities

| Concern                         | Where                                                          |
| ------------------------------- | -------------------------------------------------------------- |
| Court dimensions, service boxes | `packages/shared/src/court.ts`                                 |
| Player movement step + bounds   | `packages/shared/src/movement.ts` (server **and** client)      |
| Wire protocol, phases           | `packages/shared/src/protocol.ts`                              |
| Ball physics                    | `apps/server/src/simulation/ball.ts` (server only)             |
| Shot trajectory                 | `apps/server/src/simulation/shot.ts` (server only)             |
| Rally rules / faults            | `apps/server/src/rules/rally.ts` (server only)                 |
| Game state machine, hit checks  | `apps/server/src/simulation/GameSimulation.ts` (no networking) |
| Networking adapter              | `apps/server/src/rooms/PickleballRoom.ts`                      |
| Rendering                       | `apps/client/src/{court,players,ball,camera,game}`             |
| Client networking               | `apps/client/src/net`                                          |

`GameSimulation` is plain TypeScript and is unit-tested without a network.
`PickleballRoom` only validates who sent a message, forwards it to the
simulation, steps it on a fixed timestep, and copies the result into the
Colyseus schema.

## Match phases

```
waiting ──(2nd player joins)──▶ lobby ──(both ready)──▶ serving ──(Space)──▶ rally
   ▲                              ▲                        ▲                   │
   │                              │                        └──(2.2 s)── pointOver
   └──(a player leaves)───────────┴──(Return to lobby)
pointOver ──(11, win by 2)──▶ gameOver ──(all want a rematch)──▶ serving
any match phase ──(player drops)──▶ paused ──(reconnects ≤ 30 s)──▶ serving
                                       └──(timeout)──▶ waiting
```

## Networking model

- **Inputs:** each client produces one input frame per 1/60 s
  (`seq`, movement intent, aim point) and sends the frames generated during each
  rendered frame in one message. Swings (normal, or a smash with Shift) and serves are
  separate messages.
- **Validation:** the server sanitizes every field, drops replayed/out-of-order
  sequence numbers, caps queue size, and meters inputs with a token bucket that refills at 1.1
  inputs per tick (clients produce 1). The 10% surplus is deliberate: at exactly
  1.0, inputs queued by any stall or lost tick never drain, and swings get judged
  from where the player used to be. It is also the most speed flooding can gain.
  Movement is clamped to the player's half (serve position while serving).
  Swings have a cooldown and only hit if the ball is within reach, on the
  hitter's side, and it's that player's turn. Only the server may serve.
- **Swing timing:** a swing carries the server tick the player was viewing
  (their interpolated picture, 60–150 ms old plus network time). The server keeps 0.5 s of
  tick-stamped ball positions and accepts the hit if the ball was in reach from
  that tick through the swing's 0.3 s active window. Claims older than 0.5 s are
  clamped, so a client can't hit a ball it never could have seen.
- **Hit box:** `reachDistance()` in `packages/shared` (a circle, the same in every direction) is used
  by both the server's check and the on-screen cue. A swing meets the ball at its
  closest point to the player rather than at the edge of the box, and the shot
  leaves from that point (for a lagged click, where the player saw the ball).
- **Swing limits:** `canSwing()` (shared) blocks swings while your own team hit last,
  and allows two swings per incoming ball, the second one slower. The server enforces it.
- **State:** synchronized via `@colyseus/schema` every 33 ms: phase, scores,
  players (position, yaw, last applied input `seq`, swing counter) and ball.
  One-shot effects (hit, bounce, net) are broadcast as messages stamped with
  the server tick.
- **Prediction / reconciliation:** the local player is moved immediately on
  input with the shared `stepPlayer()`. On every patch the client resets to the
  server position, re-applies inputs newer than the acknowledged `seq`, and
  blends any small error away visually.
- **Interpolation:** snapshots are timestamped with `tick × 1/60 s`; the client
  estimates the server-clock offset and renders others 60–150 ms in the past, more on an
  uneven connection. If updates are later still, the ball's flight is predicted (shared
  `flight.ts`, for drawing only) and any difference blended away.
- **Reconnects:** network drops are retried automatically by the SDK; the server
  holds the seat for 30 s (`allowReconnection`). After a page refresh, the client
  uses the reconnection token kept in `sessionStorage` to reclaim the seat.
- **Room list and spectators:** `GET /rooms` lists every room on the server (guarded
  by the same origin allow-list as joining). Joining gives a seat if one is open,
  otherwise the client becomes a spectator: in the synchronized state but not in
  the simulation, so every game command from them is ignored.
- **Chat:** messages are part of the room state (last 30, so late joiners see them).
  The server accepts them only from spectators, cleans and shortens the text, and allows
  4 per person per 5 s.
- **Rooms:** kept out of Colyseus matchmaking, joined from the list or by a 5-character
  code that is the room id; 2 or 4 seats plus up to 20 spectators; disposed when empty.

## Training

`PracticeSimulation` extends `GameSimulation` with a coach: an ordinary player steered by the
server, so training has the same rules and physics as a game. A training room takes one
person, skips the lobby, is not in the room list and is never won. The client leaves the room
it was watching and remembers its code (`returnTo`) to rejoin.

## Athletes

- Models and motions (`public/models`) are built by `tools/characters` from CC0 bodies and
  free motion capture; see its README for sources and credits. All of them start
  downloading in the background when the page opens (`preloadAthletes`). Before a body is
  shown its textures are uploaded one per frame and its shaders built with `compileAsync`,
  so a player joining or a match starting doesn't freeze the game; until then (or if they
  can't load) the simple `Humanoid` is drawn.
- Nothing about animation is sent: `players/athlete` derives it from positions, swing
  counters and the server's hit events, and never changes game state.
- `locomotion.ts` picks captured motions by speed and direction and plays them at the speed
  actually covered; `strokes.ts` describes 15 shots; `controller.ts` layers them and solves
  the arm (`ik.ts`) so that the paddle is on the ball at the contact the server reported
  (`contact.ts`; predicted until it is known). Feet are kept on the ground.
- `stepPlayer` (shared) accelerates and brakes; speeds are part of the player state, so the
  client's prediction replays them exactly.

## Frame rate

- `AdaptiveQuality` steps down sharpness (straight to about the pixel count that reaches
  ~55 fps), then shadows, then the crowd, and never back up during a session. Where it
  ended up is saved per browser for a week (`savedQuality`), so a slow computer starts
  there instead of stuttering through the steps again.
- The canvas reads its pixel ratio from the store (`dpr`) as a fixed number. React Three
  Fiber re-applies the `dpr` prop every time the canvas re-renders (every phase change),
  so a range like `[1, 2]` would quietly undo every step down.

## What travels over the network

- Positions, speeds and facing are sent as 16-bit whole numbers in small units (`WIRE`
  in `shared/wire.ts`: mm, mm/s, cm/s, 1e-4 rad), converted back where the page reads the
  state (`readCourt`, `readPlayers`, the prediction's reconcile, the debug hook). A
  tournament sends every court to everyone, so this cut what the host uploads by a third.

## Tournaments

- `tournament/Tournament.ts` is the pure logic: groups (round robin), standings and
  tie-breaks, the knockout, results. `TournamentRunner` runs it in a room: sign-up, calling
  matches onto free courts, ready checks, best-of-3 breaks, walkovers, coming back.
- Someone who drops while waiting for a match keeps their place for 10 minutes
  (`TOURNAMENT_WAIT_GRACE_SECONDS`); on court it is 30 s, because the match is paused.
  When the automatic reconnect gives up, the page keeps trying for 10 minutes (and at once
  when the network or the window comes back): first the held place, then by name, which
  gives back the place in the tournament.
- Every court is its own `GameSimulation`. Court 1 is the room's ordinary state; further
  courts are `state.courts`. The tournament itself is a `TournamentView`, sent as JSON
  (`state.tournament`) when it changes. Effects carry a court number.
- The client draws everything around the court in focus (the one played on, or the one
  watched), which stays at the origin, so prediction, aiming and hitting work as in any
  game. The other courts are drawn beside it (`court/layout.ts`, `OtherCourts`).

## Server endpoint resolution (client)

`GAME_SERVER_URL` if set, else `<page protocol>//<page hostname>:<GAME_SERVER_PORT|2567>`.
This keeps local, LAN and Tailscale play working without hardcoded IPs and
leaves a single override for a future production deployment (PB-003).
