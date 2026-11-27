# TEZUKA ZONE visual effects

Phase D1: the zone field and its visual states. Everything here is drawing only. The
ability itself (`apps/server/src/simulation/zone.ts`, see [tezuka.md](tezuka.md)) is
unchanged, and nothing here sends anything to the server.

| Stage | What                               | Status  |
| ----- | ---------------------------------- | ------- |
| D1    | Zone field and visual-state basis  | Done    |
| D2    | Ball attraction and energy streams | Not yet |
| D3    | Curved ball trails                 | Not yet |
| D4    | Paddle impact and shockwave        | Not yet |
| D5    | Cinematic ability introduction     | Not yet |
| D6    | Performance, accessibility, polish | Not yet |

## Where it lives

All in `apps/client/src/players/zone/`:

| File                  | What                                                                      |
| --------------------- | ------------------------------------------------------------------------- |
| `zoneFx.ts`           | The state machine, easing, quality steps, palette, and the debug registry |
| `zoneResources.ts`    | The shaders, geometry and materials, with `dispose()`                     |
| `ZoneField.tsx`       | The component: one per field, driven per frame without React updates      |
| `PlayerZone.tsx`      | Feeds the game's replicated state to a field                              |
| `useReducedMotion.ts` | Follows the system's reduced-motion setting                               |

`PlayerAvatar` mounts a `PlayerZone` only for a player whose look is `x1` on the court in
focus. It sits next to `Flames`, in the group that follows the player without turning
with them.

## What decides it (authoritative state)

Everything comes from state the server already replicates. No server change was needed.

| Question                         | Answer, from the server                                                                                                                |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Is the player the athlete?       | `PlayerState.look === 'x1'`. The server sets that look only for the session it granted                                                 |
| Is the zone available?           | That player is seated on the court in focus and `PlayerState.connected`                                                                |
| Is it attracting the ball now?   | The ball as drawn has a pull (`BallState.steerX/steerZ`), the phase is `rally`, and the last hit (`lastHitSlot`) was by the other team |
| Has the rally ended?             | `phase` is no longer `rally`; the server also zeroes the pull at once                                                                  |
| Has the athlete dropped or left? | `connected` false (dropped; the seat waits 30 s), or the player is gone from `players`                                                 |

About the grant:

- **Granted only by the server, never by the name.** The server gives the `x1` look only
  together with the grant (`PickleballRoom.onJoin`, `grantsTezuka`), and only in a room
  that allows the athlete: training, or a casual room created with **Allow developer
  abilities**. Never in a tournament.
- **The name plays no part on the client.** `zoneTarget` never looks at the nickname.
- **The pull is what the server sent.** The client never computes a pull of its own; it
  reads the one the server sent, interpolated with the ball it draws. So the field lights
  up exactly while the ball on screen is being pulled.
- **Doubles:** the zone only pulls the other team's shots. The secret athlete's field
  lights up, and the partner never has one.

## Visual states

| State      | Shown when                                     | Looks like                                                                               |
| ---------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------- |
| inactive   | not the athlete, dropped, or another court     | nothing drawn (the group is hidden; no draw calls, no uniforms written)                  |
| available  | the athlete, on court and connected, any phase | slow rotating rings, faint markings, a slow outward pulse, a faint blue glow             |
| attracting | the pulled ball is coming to them in a rally   | brighter, shifting to cyan; thicker main ring; faster, brighter pulse; motes rise faster |

**Transitions** are frame-rate independent (`approach`):

| Change          | Rate  | Time         |
| --------------- | ----- | ------------ |
| Appearing       | 6/s   | about 0.5 s  |
| Disappearing    | 4/s   | about 0.75 s |
| Pull rising     | 9/s   | about 0.3 s  |
| Pull easing off | 3.5/s | about 0.9 s  |

The strength of "attracting" follows the replicated pull: 0.55 to 1, full at 12 m/s².
A unit test checks that the curves match at 30, 60 and 144 frames per second.

**What happens when:**

- **Rally ends:** the attraction eases off, and the field stays available.
- **Disconnect:** the field fades out.
- **Leaving the room, or the player removed:** the field is unmounted and its GPU
  resources are freed.
- **Reconnect:** it fades back in.

There is no key, cooldown, meter or charge. The ability is always on, and so is the
field.

## The design

- **One ground disc**, 1 m in radius at 1.8 cm above the court, drawn by one fragment
  shader:
  - a soft blue glow, strongest round the feet and gone before the rim;
  - the main ring, in six slowly turning arcs;
  - a dashed inner ring turning the other way;
  - an outer hairline in three arcs;
  - 48 segmented markings;
  - a pulse travelling outward.
- **Blending:** additive, without writing depth, with a polygon offset. It never
  z-fights the court, its lines, the player ring (1.2 cm) or the fire glow (1.6 cm).
- **Size:** the disc is smaller than the 1.4 m hit circle on purpose, and doesn't look
  like it. It is decoration, not a range.
- **Motes:** up to 24 floating motes in one fixed buffer. They rise from the ring and
  drift inward, with every position computed on the GPU from fixed seeds, so all clients
  draw the same motes.
- **Palette:** the brief's colours, unchanged, are the shader's inputs:
  - deep `#081C3A` and zone blue `#2456FF` for the glow and main ring;
  - cyan `#00C8FF` for attraction;
  - highlight `#8CEAFF` for the markings, outer ring and pulse;
  - white `#F4FCFF` for the pulse at full attraction.
- **Tuned on court:** the first version's glow read as an opaque plate over the court
  lines. The glow is now about a quarter as strong, gone before the rim, and the
  available state is about half the brightness of attracting.

## Quality

The field follows the game's own quality steps (`game/quality.ts`, which lower
themselves on slow computers). It never changes the ability.

| Step   | When                  | Rings          | Markings and pulse | Motes | Draw calls |
| ------ | --------------------- | -------------- | ------------------ | ----- | ---------- |
| high   | shadows on            | main + 2       | yes                | 24    | 2          |
| medium | shadows off, crowd on | main + 1       | yes                | 10    | 2          |
| low    | crowd off             | main, and glow | no                 | 0     | 1          |

Each step is a shader variant (defines), so the lower steps really run less code. A step
change recompiles the ground shader once. The motes keep one buffer, and only how much
of it is drawn changes.

**Reduced motion** (`prefers-reduced-motion: reduce`): nothing turns, pulses or drifts,
and there are no motes. Attraction then shows only as a steady change of brightness and
colour. There is no flashing at any step: the pulse is a slow travelling ring, at most
1.1 per second.

## Developer viewer

`?viewer` (dev build, or with `?e2e`) has a **Zone** row:

- off, inactive, available, attracting;
- high, medium, low;
- reduced motion;
- a pull slider;
- and the viewer's own pause freezes the field's clock too.

Also scriptable: `__VIEWER__.set({ zone, zoneTier, zoneIntensity, zoneReduced })`. The
viewer never connects to the game server.

## Debug hook

With `?e2e`, `__PB__.zoneFx()` returns, read-only:

- each field's state, strength, step, draw calls, motes, a bounded state log, and its
  world position next to its player's;
- mount and disposal counts.

## Performance

**The machine:** macOS 12.7.6, Chrome via Playwright, rendering on the GPU, 1280×720,
pixel ratio 1. Your `yarn host` was running during the measurements, so the load average
was 5 to 10.

**The field alone, in the developer viewer.** Everything else was fixed: the x1 model
running, shadows on. The field was in its most expensive state (attracting at full
pull), at a camera where it covers more of the screen than in play. There were four
interleaved rounds of 6 s (about 360 frames each). CPU is main-thread time per animation
frame; GPU is `EXT_disjoint_timer_query_webgl2` per frame.

|          | Draw calls | Geometries | CPU mean (median / p99) | GPU mean (median / p99)         |
| -------- | ---------- | ---------- | ----------------------- | ------------------------------- |
| No field | 41         | 16         | 2.34 ms (2.1 / 2.8–6.1) | 2.47 ms (2.37–2.55 / 2.65–2.94) |
| Low      | 42         | 17         | 2.56 ms                 | 2.44 ms                         |
| Medium   | 43         | 18         | 2.41 ms                 | 2.46 ms                         |
| High     | 43         | 18         | 2.32 ms                 | 2.44 ms                         |

**Change against no field** (mean of the four rounds' differences):

| Step   | CPU      | Range by round    | GPU      |
| ------ | -------- | ----------------- | -------- |
| Low    | +0.21 ms | +0.07 to +0.52 ms | −0.03 ms |
| Medium | +0.06 ms | −0.25 to +0.47 ms | −0.01 ms |
| High   | −0.03 ms | −0.83 to +0.56 ms | −0.03 ms |

**Reading it:**

- **GPU:** the cost is below what the timer resolves (about ±0.1 ms).
- **CPU:** the differences are smaller than the round-to-round noise on this busy
  machine. Every step's mean is under the 0.5 ms target, but single rounds reached
  +0.56 ms.
- **Per-frame JavaScript, timed directly:** 0.36 µs per frame (a Node microbenchmark of
  `zoneTarget`, `stepZone`, the state log and the uniform writes, over 10⁶ frames). The
  rest is three.js submitting one or two more draw calls.
- **The coarse clock:** the browser rounds `performance.now()` to 0.1 ms, which is why
  the medians move in steps.

**The whole game** in training as the athlete, with the field drawn at each quality step
(12 s each):

| Step   | Draw calls (field) | CPU mean / median / p99 | GPU mean / median / p99 |
| ------ | ------------------ | ----------------------- | ----------------------- |
| high   | 157 (2)            | 3.98 / 4.7 / 10.6 ms    | 4.05 / 4.04 / 4.25 ms   |
| medium | 111 (2)            | 2.99 / 3.5 / 9.9 ms     | 2.67 / 2.67 / 2.98 ms   |
| low    | 105 (1)            | 2.98 / 3.3 / 14.5 ms    | 2.17 / 2.16 / 2.47 ms   |

The steps differ mostly by shadows and crowd. The field is one or two of the 105–157
draw calls. These runs have no in-game measurement without the field: there is no way to
remove it in a game, so the viewer comparison above is the one that isolates it.

**Memory:**

- the ground plane is 4 vertices, and the motes 24 × 28 bytes;
- under 1 KB of buffers, no textures;
- two shader programs (the ground variant for the step, and the motes).

**Allocation and disposal:**

- **Nothing is allocated per frame.** Uniforms are written in place. The debug hook's
  position check allocates only when the hook is called.
- **Disposal:**
  - in the viewer, turning the field off returns geometries to 16 and textures to 30;
  - in a game, leaving the match brings the disposal count to the mount count
    (`e2e/zoneFx.spec.ts`);
  - a unit test checks that `dispose()` frees both geometries and both materials.

## Tests

- **`apps/client/test/zoneFx.test.ts`** (18 tests):
  - which state shows, for every look, phase, last hitter, ball and connection case;
  - doubles partners;
  - the easing at 30, 60 and 144 fps, and the state log;
  - the quality steps and reduced motion;
  - one fixed particle buffer;
  - shader rebuilds only on a step change;
  - uniforms written in place, and disposal.
- **`e2e/zoneFx.spec.ts`** (5 tests, no private model needed):
  - **own, opponent and spectator views:** exactly one field, the athlete's, on the
    athlete's drawn position;
  - **disconnect:** the field fades out in the other views;
  - **no field:** for the name without the key, or a room without developer abilities;
  - **training:** each pulled shot lights the field, and the rally end settles it.
    Attraction is only ever seen in a rally, and leaving frees the resources;
  - **quality and reduced motion:** the draw calls and motes at each step;
  - **doubles:** the partner's view.

## Browser test record (D1)

| Run | Result              | The failure                                                                                                                                                                                   |
| --- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 36 passed, 1 failed | `multiplayer.spec.ts` "two players create/join…": Bob moved 0.38 m in 400 ms where more than 1 m was expected. No secret athlete in that test, so no field. Passed 3 of 3 alone. Not changed. |
| 2   | 36 passed, 1 failed | The new training test required two pulled shots and saw one. Rewritten to check that every sustained server pull lights the field.                                                            |
| 3   | 37 passed           |                                                                                                                                                                                               |

- **The run-1 failure** is a timing-sensitive movement check on a heavily loaded machine
  (load average 7 to 17, with `yarn host` rebuilding during the run). It is recorded here
  and its artefacts are kept. Its assertions are unchanged.
- **The training test can't pass vacuously:**
  - it needs at least one sustained pull (6 or more samples in a row) in the server's own
    replicated state, in a rally, from the other team's shot;
  - every such pull must show as attracting;
  - with attraction deliberately broken (`MIN_PULL` raised so the field never attracts),
    it failed: "pull at samples 0-17 not shown".

## Limitations

- **No pull from the athlete's own side:** the zone only acts on opponents' shots, so
  the field never shows attraction while the athlete hits.
- **Two secret athletes on one team** (possible only with two host-machine browsers that
  both have the key): both fields light up for a pulled shot, because the zone pulls for
  the receiving team.
- **The field's own CPU cost** can't be resolved in the browser on this machine below
  about ±0.5 ms per round (see Performance). It was measured directly only for the
  JavaScript part.
- **Not checked by eye at full frame rate on a fast GPU:** the field was judged from
  screenshots and measurements.
- **No soft lighting on the athlete:** the blue light is painted on the ground, not cast
  by a real light. A real light would change every lit material's shader and cost more.
  D6 can revisit this.
