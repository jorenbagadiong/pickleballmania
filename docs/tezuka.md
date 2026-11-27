# The secret developer athlete

A hidden character for the developer's own casual games and training. It is
deliberately overpowered and never available in tournaments.

## What it gets

| Status  | What                                                                             |
| ------- | -------------------------------------------------------------------------------- |
| Done    | The secret look `x1` (`SECRET_LOOK`), given by the server and chosen by nobody   |
| Done    | Held curves (Q, E, right mouse button), exactly as the `cheater` name gets them  |
| Done    | The TEZUKA ZONE passive: incoming opponent shots bend toward this player (below) |
| Done    | Left-handed play on the existing motions, strokes and IK (Phase C2, below)       |
| Not yet | A model of its own and zone effects (Phases C1, C3 and D)                        |

**Model fallback:** `x1` has no model yet, so it is drawn with the public athlete `m1`
(`SECRET_LOOK_FALLBACK` in `apps/client/src/players/athlete/assets.ts`). While it is on
court, nobody else is cast as `m1` if there is another athlete to go round.

## Who gets it

All four, checked on the server (`apps/server/src/rooms/devAuth.ts`):

1. The nickname is `Tezuka`, trimmed and in any capitals (`isTezukaName`).
2. The player is on the computer running the server (`isHostMachine`, the same check
   the `cheater` name uses).
3. The player sent the developer key, and it matches `PICKLEBALL_DEV_KEY`. The two are
   compared as SHA-256 digests with `timingSafeEqual`. If the variable is missing or
   shorter than 12 characters, nobody gets the athlete.
4. The room allows it:
   - training rooms always do;
   - a casual room does only if it was created with `devPerks: true`. On the start
     screen that is the **Allow developer abilities in the room I create** box: unticked
     each time, and asked for each room. Typing a key alone never enables it, and **New
     room** from the lobby never carries it over;
   - a tournament never does, whatever it was created with.

If any one is missing, the player is an ordinary player under that name. There is no
error message, so a wrong key reveals nothing.

The grant belongs to the session:

- It survives a reconnect, because Colyseus keeps the session ID.
- It ends when the player leaves for good.
- Someone else who joins later as `Tezuka` gets nothing without the key.

The original `cheater` name works exactly as before.

## Running it

Set the key where the server runs. Never commit it (`.env` and `.env.local` are
gitignored):

```bash
PICKLEBALL_DEV_KEY='a-long-random-secret' yarn dev
```

On the start screen, enter `Tezuka` as the nickname. A **Developer key** field appears
(a password field); type the key there. Then either tick **Allow developer abilities in
the room I create** and create a room, or start training.

## Where the key goes

- **Browser:** it stays in memory only, in a module variable in
  `apps/client/src/net/session.ts`. It is not in the Zustand store, storage, the URL or
  the bundle. A page refresh forgets it. Reconnecting after a refresh doesn't need it,
  because the server remembers the session.
- **Network:** it is sent in the join options of `create` / `joinById`, which travel in
  the matchmaking request body.
- **Server:** `onAuth` turns it into a yes/no and removes it from the options. It is
  never logged, put in synchronized state, or included in an error message.

## Picker protection

- `ATHLETES` and `parseLook` (used by the picker, `ClientMsg.look` and the join option
  `look`) do not include `x1`.
- The client accepts `x1` only from server state (`resolveLook`, `castFor`).
- The server ignores `ClientMsg.look` from the secret athlete, so they can't change the
  look either.

## Checked so far

- **Server logs:** a server run with a key, joined as Tezuka with the right key and
  with a wrong one. Its output had no trace of the key, even with `DEBUG=colyseus:*`.
- **Browser (`e2e/tezuka.spec.ts`):**
  - the console, every request and WebSocket URL, `localStorage`, `sessionStorage`,
    cookies, the page HTML, the `?e2e` debug hook (store and state) and `GET /rooms`
    contain no key;
  - the key field is `type="password"`.
- **e2e key:** the test server uses a throwaway key (`E2E_DEV_KEY` in
  `playwright.config.ts`, overridable with `PW_DEV_KEY`). Traces and screenshots are
  off in the config.
- **Bundle:** the client bundle has no mention of `PICKLEBALL_DEV_KEY`.

## TEZUKA ZONE (Phase B)

An always-on passive for the secret athlete in rooms that allow them: every eligible
incoming opponent shot bends toward a point where they can hit it. There is no button,
no cooldown and no cost. The player still has to swing: nothing is hit or scored for
them.

### Where it lives

- `apps/server/src/simulation/zone.ts`: eligibility, prediction, planning and steering.
- `GameSimulation.stepRally` calls it before each `stepBall`. The room hands every court
  its `tezukas` set (only when the room allows the athlete) and the preset.
- `BallBody.steerX` / `steerZ` (shared `flight.ts`): a ground-plane acceleration kept
  apart from `curve`. The zone never touches `curve`, so spin, the bounce kick and spin
  decay work as before. A ball with no steering takes exactly the old code path.
- Wire: `BallState.steerX` / `steerZ` (int16, cm/s², `WIRE.steer`, up to ±327 m/s²).
  Clients decode them and extrapolate with the same `stepBall`. They never compute any
  steering themselves.

### Who it works for

`zoneEligible`, checked every tick, decides who may receive the shot. Whether that
player may hit it yet is a separate question:

- the athlete is seated on this court and connected;
- an opponent hit the ball last;
- a serve is only for its designated receiver (in doubles, a serve to the partner is
  left alone);
- every later shot is for the whole receiving team, so in doubles it comes to the
  athlete even when aimed at the partner;
- a ball that touched the net is no longer pulled.

The zone acts before a required bounce. The two-bounce rule, the kitchen and the hit
checks in `tryHit` still decide every contact, unchanged.

### The algorithm

1. **Predict.** The shared `stepBall` rolls the ball forward on a copy (gravity, spin,
   bounces, net), up to the horizon. It stops at the second bounce on the receiving side,
   counting a bounce that has already happened.
2. **Candidate contacts.** These are moments when the ball would be on the player's side,
   at least 0.3 m past the net and below the reach height, and after its bounce when the
   two-bounce rule (or standing in the kitchen) requires one.
3. **Aim.** For each candidate, the target is the nearest point on a comfortable contact
   disk: radius `contactRadius`, centred `contactSide` toward the paddle hand (the athlete
   is left-handed) and `contactAhead` toward the net, around where the player will be. A
   moving player's position is predicted up to `leadTime` ahead. The disk sits well
   inside the reach radius, so this is a reachable interception point rather than the
   body.
4. **Choose.** Pick the candidate needing the least pull. Pulling along the court costs
   more than across it, braking most of all. Contacts outside 0.45–1.5 m height cost
   extra, and plans that would slow the ball below 1.2 m/s along the court are rejected.
   The result is that the ball bends sideways and meets the player about where it reaches
   their depth on its own.
5. **Refine.** Three corrections are checked against the real predicted flight (bounces
   slow the ball, so a constant pull is only a first guess).
6. **Keep it legal.** If the pulled flight would hit the net, or make a ball that was in
   land out (a serve must stay in its box), the pull is scaled down by bisection. A ball
   that was going out may be pulled in.
7. **Steer.** The pull eases toward the plan: it changes by at most `maxAccel × k` per tick
   (k = 1 − e^(−smoothing·dt)), never exceeds `maxAccel`, and acts along the court only
   once the ball is past the net, so net clearance is never changed. It re-plans every
   `retargetTicks` ticks and keeps the plan unchanged inside `lockTime` of contact.
8. **Stop.** The pull fades out, at the same rate it builds, when any of these happens:
   - the ball passes the player;
   - the contact time has passed;
   - the ball heads back toward the net;
   - the speed budget (`maxExtraSpeed`) is used.

   It drops to zero at once on any new shot (including the athlete's own, whose shots
   are never pulled), when the rally ends, on a fault or a net ball, on a disconnect,
   and on a new game.

If no reachable contact exists, the zone lets go and looks again at the next plan.

### Presets (server-controlled)

The default is `PICKLEBALL_ZONE_PRESET=anime`; `normal` and `strong` are the others.

| Preset | maxAccel (m/s²) | maxExtraSpeed (m/s) | smoothing (1/s) | retarget (ticks) | lockTime (s) | activationRange (m) | horizon (s) | leadTime (s) |
| ------ | --------------: | ------------------: | --------------: | ---------------: | -----------: | ------------------: | ----------: | -----------: |
| normal |               4 |                   3 |               6 |                6 |         0.25 |                   9 |         2.5 |          0.4 |
| strong |              18 |                  12 |              14 |                3 |         0.12 |                  20 |         2.5 |          0.5 |
| anime  |              60 |                  40 |              22 |                3 |         0.10 |                  40 |         3.0 |          0.6 |

All three use the same contact disk: `contactSide` 0.35 m, `contactAhead` 0.15 m,
`contactRadius` 0.6 m. The anime values were tuned by measurement: 40 m/s² with a
20 m/s budget brought 99.2% of ordinary shots but only 84% of smashes and 42% of jump
smashes.

### Measured interception (`yarn workspace @pickleball/server zone:report`)

**Success** means that at some tick the ball was legally hittable by the player, who
never swings: inside the reach radius (1.4 m), on their side, under the reach height,
after the bounce if one was required, and only by the designated serve receiver.

**Trials:** 1,584 per preset, deterministic. That is 11 shot kinds × both court sides ×
4 standing positions (baseline middle, left and right, and mid court) × still / moving
left / moving right × return of serve (must bounce) / later shot × seeds 11, 22, 33.
Every shot is aimed away from the player. Nothing was excluded.

| Shot         |  none | normal | strong |             **anime** |
| ------------ | ----: | -----: | -----: | --------------------: |
| straight     |    8% |    28% |    94% |              **100%** |
| cross left   |   17% |    33% |    88% |              **100%** |
| cross right  |   24% |    48% |    94% |              **100%** |
| curve left   |   25% |    33% |    90% |              **100%** |
| curve right  |   28% |    42% |    90% |              **100%** |
| dink         |    6% |    15% |    92% |             **93.1%** |
| drop         |   22% |    33% |   100% |              **100%** |
| deep         |    8% |    15% |    82% |              **100%** |
| lob          |   15% |    40% |    99% |             **99.3%** |
| **ordinary** | 17.0% |  31.9% |  92.1% | **99.2%** (1285/1296) |
| smash        |    0% |     0% |    29% |              **100%** |
| jump smash   |    0% |     0% |     0% |             **91.7%** |
| **fast**     |    0% |     0% |  14.6% |   **95.8%** (276/288) |

Across every trial of every preset, these held on every tick:

- the pull never exceeded `maxAccel`;
- its per-tick change never exceeded the limit (anime: 18.42 m/s²);
- the ball never moved farther in a tick than its speed plus the strongest allowed
  acceleration explain;
- it never reversed toward the hitter while pulled;
- no pull remained after a rally ended;
- all values stayed finite.

### Where it fails

- **Dinks (10 of 144 anime trials).** All ten are the player at a baseline corner running
  toward their own sideline while a short dink goes to the far side of their kitchen. A
  dink has to bounce in the court and dies quickly, so it can't be carried off the court
  after a runner.
- **Jump smashes (12 of 144).** These need more than 60 m/s², or more than the 40 m/s
  budget, within about half a second.
- **One lob (1 of 144):** no reachable contact existed in time.
- **Hard drives over the head of a player standing in the kitchen.** Volleying there is
  a fault, so the ball would have to bounce in front of them, which means braking it
  almost to a stop. The zone refuses that and lets the ball go.

### Multiplayer

- **Extrapolation drift.** A client extrapolating between updates keeps the last pull it
  was sent, while the server changes it a little every tick. Measured worst drift: 0.13 cm
  one tick ahead, 0.93 cm after three ticks (50 ms), 3.6 cm after six (0.1 s). Without the
  zone it is 0.14 cm (wire rounding). Clients normally draw between two real updates;
  the existing blend absorbs late-update corrections.
- **Two browsers agree exactly.** In `e2e/tezukaZone.spec.ts`, both browsers decoded
  identical ball positions and pulls at every server tick both received (783 and 832
  ticks, of which 182 and 227 were steered).
- **Lag compensation is unchanged.** The ball history records steered positions, so a
  lagged swing is checked against the ball the player actually saw (tested with
  `viewTick` three ticks back).

### Diagnostics (off by default)

With `PICKLEBALL_ZONE_DEBUG=1`, the server sends `ServerMsg.zoneDebug` (`ZoneDebug`) every
4 ticks, to the secret athlete only. It contains the active state, the reason, the target
point and height, the time to contact, the current pull, the pull the plan wanted, and
the speed spent. With `?e2e` (or in dev), the client exposes it as `__PB__.zone()`.

### Cost

A server tick with the zone steering a shot: median 0.001 ms, p99 0.044 ms, worst seen
0.84 ms (JIT warm-up). Without the zone: median 0.0004 ms. The tick budget is 16.7 ms.

## Left-handed animation (Phase C2)

The secret athlete holds the paddle in the left hand; the six public athletes stay
right-handed. `handFor(look)` in `apps/client/src/players/athlete/handedness.ts`
decides it: `left` for `x1`, `right` for everything else. It works on the `m1` stand-in
today and needs nothing from the future model.

### How: the mirror

Every bone of the athletes rests with the identity rotation, its axes those of the model
(+x the body's left). So a body mirrored across its middle is the same skeleton with left
and right swapped, and a left-hander can be animated as a right-hander in that mirror:

1. **In:** the controller is built with the mirrored rest skeleton (`mirrorRest`) and the
   mirrored left-hand grip (`mirrorGrip(gripFor(athlete, 'l'))`). Each frame, what the game
   says is mirrored across the line the player faces along (`WorldMirror`: velocity, where
   to look, the ball held to serve), and so is every contact point (`hit`, `correct`).
2. **Animate:** the unchanged right-handed code runs: captured motions, gait mixing, every
   stroke, arm and leg IK, wrist limits, the free arm, jumps and lunges.
3. **Out:** the finished pose is mirrored back (`mirrorPose`): left and right bones swap,
   each rotation (x, y, z, w) becomes (x, -y, -z, w), and the hips' sideways offset changes
   sign.

The mesh is never scaled by -1 (skinning, normals and shadows stay as they are). The
paddle is attached to `hand_l` with a grip measured from the left hand's own finger bones
(`gripFor(athlete, 'l')`), and the left fingers curl round the handle while the right ones
relax (`poseFingers(athlete, 'l')`). Forehand and backhand follow: for a left-hander, a ball
on their left is a forehand.

Nothing on the server changes: the hit radius, reach, physics and the zone are the same.
The zone already aims at the left side (`contactSide` in `zone.ts`), and a test checks that
the left-handed ready paddle sits inside its contact disk.

### Checked

- **Right-handed regression** (`apps/client/test/rightHanded.test.ts`): snapshots recorded
  before handedness existed. 18 scenarios on `m1` (idle, ready, walking, running, both
  strafes, backpedal, diagonal, looking, serve, forehand, backhand, dink, volley, smash,
  jump smash, a wide shot at a run, celebrating) and forehand, backhand and jump smash on
  all six athletes. Every bone, finger and the grip must match to 1e-5; they do.
- **Mirror twin** (`apps/client/test/leftHanded.test.ts`): a left-hander on a mirror copy of
  `m1`, given the mirrored game, produces the mirror of the right-hander's pose on every
  frame (component difference under 1e-5), through all of the above plus sprinting and
  every stroke through its recovery. This checks gait, strokes, IK, grip and fingers at once.
- **On the stand-in body:** the paddle meets the ball within 14 cm at contact for all 13
  stroke spots (as for right-handers), a jump smash leaves the ground with the left arm
  over the top and lands, every swing returns to ready without snapping, feet stay
  planted while running, strafing and backpedaling (the right-handed limits), finger curl,
  stroke choice, and nonsense input.
- **Zone alignment:** the ready paddle is on the left inside the zone's disk; balls brought
  to the disk's middle at 0.6, 0.95 and 1.3 m are forehands, met within 14 cm.
- **Browsers** (`e2e/leftHanded.spec.ts`): in singles (Tezuka's view, the opponent's and a
  spectator's), doubles and training, Tezuka's paddle hangs from `hand_l` and every other
  player's from `hand_r`. `Tezuka` without the key is right-handed.
- **Cost:** the mirroring adds about 0.002 ms per player per frame (controller median
  0.0335 ms right-handed, 0.0351 ms left-handed). No extra draw calls, materials or memory.

### Limits

- While the model downloads, a player is drawn as the simple placeholder figure, which is
  always right-handed (a second or so).
- The mirror is exact for a symmetric body. `m1` is nearly symmetric; a future model with
  asymmetric clothing or hair still animates correctly (the skeleton is what's mirrored),
  but its own asymmetry is not mirrored.
- The captured motions are mirrored too, so the left-hander's walk and run are the mirror
  of everyone else's. That is intended (a natural left-footed gait), but it means two players
  never share an identical stride.
- Smoothness and foot sliding were measured in tests and seen in screenshots, not judged
  by eye on a fast GPU. See "Checking it on Windows" below.

### Test record

- **Client unit tests: 128 before C2, 210 after.** The 82 new tests are 58 in
  `leftHanded.test.ts` and 24 in `rightHanded.test.ts`. All 128 earlier tests are still
  there under the same names, and none of their assertions changed: `athlete.test.ts`
  only had its model-reading helpers moved, word for word, into `test/fixtures/athletes.ts`.
  (The first C2 report said "up from 119"; that was wrong. 119 was the count at `244771a`,
  before Phases A and B.)
- **Browser tests: 21 before C2, 24 after** (the three in `e2e/leftHanded.spec.ts`). All 24
  pass on the computer C2 was made on, and so do all 21 at the pre-C2 commit `92ec28e`
  there. The six failures reported during Phase B were seen on another computer and do not
  reproduce on this one even without C2, so C2 did not fix them. Their cause is not known
  from here.
- **The two environments:** C2 was tested on macOS 12.7.6 with installed Google Chrome 150
  (rendering on the GPU, about 50–55 fps in the game) and Playwright 1.65.1. Phases A and B
  were committed from a different computer, and the brief mentions a software-rendered
  browser at about 5 fps there; a browser that slow can miss timing-sensitive steps in
  the multiplayer tests.

### Not yet checked by eye

These need a person watching on a fast GPU (steps below): smooth blending between motions
at full frame rate, foot sliding as seen rather than measured, how natural the mirrored
strokes look in motion (forehand, backhand, dink, volley, smash, jump smash, recovery), and
the paddle staying in the hand through fast swings at the Close camera.

### Checking it on Windows

1. On a computer with these changes, in PowerShell:
   `$env:PICKLEBALL_DEV_KEY='a-long-random-secret'; yarn dev`.
2. Open `http://localhost:5173` (the address `yarn dev` prints), enter `Tezuka`, type the
   key, and start **Training**.
3. With the ball machine on, watch from the default camera and the **Close** camera:
   the paddle stays in the left hand; forehands are on the left; backhands cross the body;
   serves are underhand with the left arm; Shift + swing on a high ball smashes left-handed;
   W + Shift + swing jumps.
4. Run in every direction and stop suddenly: feet should not skate, and nothing should snap.
5. Open a second browser as `Bob` in a casual room created with
   **Allow developer abilities**: from Bob's side, Tezuka faces you with the paddle on the
   screen's right.
