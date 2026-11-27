# Secret athlete, Phase C1: VRM compatibility prototype

Status: **accepted as a technical prototype (C1).** A real anime-style VRM 1.0 humanoid
plays through the athletes' existing controller, left-handed, in singles, doubles,
training and from a spectator's seat. The sample is a technical stand-in, **not** the
secret character.

## The sample

> The sample has since been deleted from `public/`: the real model, `x1.vrm`
> ([tools/characters/x1](../tools/characters/x1/README.md)), replaced it, and the VRM tests
> now use `x1.vrm` when it exists.

- **File:** `VRM1_Constraint_Twist_Sample.vrm` (10.8 MB, SHA-256 `12c2b97e…f2631a2`), from
  the VRM Consortium's official samples:
  `github.com/vrm-c/vrm-specification/samples/VRM1_Constraint_Twist_Sample`.
- **Licence:** © 2022 pixiv Inc., VRM Public License 1.0. Not CC0: no CC0 anime VRM could
  be fetched (OpenGameArt refuses automated requests), and this one was chosen with
  approval.
- **Permissions read from the file:** anyone may use it as an avatar; commercial use
  allowed; modification and redistribution allowed; credit not required.
- **Where it is:** `apps/client/public/models/private/prototype/`, which is gitignored. It
  is still served by the game's web server to anyone who opens the game (everything
  under `public/` is), so delete the folder when the prototype is done.

## Dependency

- `@pixiv/three-vrm` **3.5.5**, exact (MIT, by pixiv), in the client workspace only. Its
  peer requirement is `three >= 0.137`; the project uses three 0.187 and React Three
  Fiber 9.
- 3.5.5 rather than 3.6.0: 3.6.0 was three days old when installed, and 3.5.5 had been out
  for four months with the same peer range.
- The lockfile gained only pixiv's own `@pixiv/*` packages.
- It is loaded on demand: only a page that finds a private VRM downloads it. Normal games
  never do.

## How it works (`apps/client/src/players/athlete/vrm.ts`)

The controller is unchanged and animates a hidden **proxy skeleton** with our 22 bone
names plus 30 finger bones. Each frame:

1. `Controller.update` writes the pose to the proxy (left-handers through the existing
   mirror).
2. `afterPose` copies each proxy bone's world rotation, times its rest turn, onto the VRM's
   **normalized** humanoid bones (three-vrm: identity rest rotations, our convention), and
   the proxy pelvis position onto `hips`.
3. One `vrm.update(delta)` copies normalized to raw bones and runs constraints,
   expressions and spring bones.
4. The frame is drawn.

The controller never touches VRM bones, and raw bones are only set by three-vrm, so
nothing is applied twice. With spring bones off at low quality, the same update runs
without them.

**Rest pose.** VRMs are in a T-pose; our motions are relative to our A-pose. The proxy's
arms are turned at the shoulder and the elbow into `m1`'s measured rest directions: upper
arm (0.661, −0.750, −0.007), forearm (0.506, −0.482, 0.715), mirrored for the right. Each
arm bone remembers that turn. The mesh is never re-posed or re-skinned.

**Paddle.** It hangs from a mount inside the VRM's drawn left hand, which carries the
proxy hand's frame, with the grip measured from that VRM's own finger bones.

**Fallback.** The page asks for `/models/private/x1.vrm` only if the build found the file
(`__HAS_SECRET_MODEL__`, set in `vite.config.ts`; tests force it with
`?e2e&secretModel`). In these cases the secret athlete is drawn with `m1` instead:

- the file is missing;
- it is not a glTF file;
- it is not a VRM 1.0 humanoid (VRM 0.x is refused);
- it fails to parse.

Left-handed play, held curves and TEZUKA ZONE are unchanged in every case, and so is the
match for everyone else. A file found unusable is not tried again on that page.

## Bone mapping

The sample has all 54 humanoid bones, so nothing is estimated:

| Ours                                                | VRM                                                            |
| --------------------------------------------------- | -------------------------------------------------------------- |
| pelvis, spine_01, spine_02, spine_03, neck_01, head | hips, spine, chest, upperChest, neck, head                     |
| clavicle, upperarm, lowerarm, hand (l / r)          | Shoulder, UpperArm, LowerArm, Hand (left / right)              |
| thigh, calf, foot, ball (l / r)                     | UpperLeg, LowerLeg, Foot, Toes                                 |
| index / middle / ring / pinky 01–03                 | Index / Middle / Ring / Little: Proximal, Intermediate, Distal |
| thumb 01–03                                         | ThumbMetacarpal, ThumbProximal, ThumbDistal                    |

28 of its raw bones have non-identity rest rotations; the normalized bones absorb them.

**Missing optional bones** (upperChest, shoulders, toes, fingers) are placed by estimate,
listed in `missing`, and not driven. They were tested by leaving all of them out.

**Measured differences from `m1`:**

- head joint at 1.39 m against 1.65 m;
- shoulder at (0.109, 1.274, −0.025);
- the skeleton is mirror-symmetric to 0.1 mm.

## Verified

### Unit tests (`apps/client/test/vrm.test.ts`, 29)

These run on a VRM 1.0 humanoid made in code from `m1`'s skeleton, in a T-pose with
VRoid-like raw rest rotations, an MToon material with outlines and a spring chain.

- **Rest and joints:** the rest pose matches `m1` within 2 mm. Every **drawn, skinned**
  joint follows `m1`'s own bones within 5 mm on every frame, standing, running, strafing
  and in left-handed forehands and jump smashes.
- **Paddle:** it hangs from the drawn left hand, and meets the ball within 14 cm at contact
  for all 13 strokes, left-handed.
- **Missing bones:** a body missing all optional bones still plays and meets the ball.
- **Refusals:** a plain glTF, a VRM 0.x, a web page, a cut-off file and a 404 are all
  refused.
- **Quality and springs:** outlines and spring bones switch with quality, and the hair
  moves when the body does.
- **Clean-up:** every geometry, material and texture is freed.
- **Repeated controllers:** a second controller on the same body measures the same grip.
- **Private model:** only the secret look asks for it, and only when the build has it.

### Browsers (`e2e/vrm.spec.ts`, 8)

- **No model:** `m1` is drawn left-handed, nothing is requested and there are no errors.
- **Broken model:** a broken file, a web page or a 404 falls back to `m1` while the ball
  machine keeps playing.
- **With the sample, in training:** the paddle is in the left hand. At every
  server-confirmed hit, and on every frame, the drawn paddle face is where the controller
  put it (within 1 cm). Confirmed hits are met by the drawn paddle (14 cm), at least
  three-quarters of them (see "Contact").
- **Other views:** the opponent, a spectator, and doubles with three other players all see
  it left-handed.
- **Viewer:** it loads the sample, and every reachable stroke meets the ball.
- **No viewer by accident:** `?viewer` without `?e2e` shows the normal game.

### Contact

On the real sample, measured in the viewer with the drawn paddle at contact (cm):

| Stroke                                                       | Left-handed | At spots scaled to its height |
| ------------------------------------------------------------ | ----------: | ----------------------------: |
| forehand, backhand, low, low backhand, wide ×2, volley, dink |           0 |                             0 |
| in front                                                     |         3.7 |                          10.0 |
| serve                                                        |         6.8 |                           0.5 |
| shoulder high (1.5 m)                                        |        12.3 |                             0 |
| smash (2.1 m)                                                |        16.2 |                             0 |
| jump smash (2.6 m)                                           |        11.7 |                             0 |

The misses are reach, not the rig: the sample stands about 1.5 m tall. Scaled to its
height, the high balls are met exactly. Only a ball very close in front gets worse,
because it is inside the paddle's length. The rig itself is proven by the synthetic body
(5 mm). A 1.82 m final model reaches further than `m1`.

**In play: how the browser test checks contact.**

- **First version:** every confirmed hit within 14 cm of the drawn paddle face. It failed
  on misses that GLB bodies have too.
- **Second version:** at least 75% within 14 cm, and any miss on a hit accepted 0.3 s or
  more after the swing. The cut-off came from a single observation and failed at 0.25 s
  under load.
- **Final version:**
  1. at every confirmed hit, and on every frame, the drawn VRM paddle face must be within
     1 cm of the face the controller itself computed (on the proxy), with no share of
     hits excused;
  2. at least 75% of confirmed hits are met within 14 cm (the original tolerance).

Check 1 is what isolates the adapter, and it is stricter than any earlier version: with
the arm rest turns removed on purpose, it failed at once (0.47 m). Check 2 is about the
existing animation, which isn't always on the ball for any body.

**Classified hits:** one session each, Tezuka in training, swinging at what the machine
sends.

|                                   | VRM sample           | GLB stand-in (`m1`) |
| --------------------------------- | -------------------- | ------------------- |
| Confirmed hits                    | 13                   | 9                   |
| Met within 14 cm                  | 13                   | 9                   |
| Drawn vs controller, worst        | 0.0 cm (every frame) | — (same bones)      |
| Small gaps (controller gap equal) | 7.8 cm, 8.4 cm       | 0.7 cm              |

The log is in the C1 evidence folder (`hit-classification.log`).

**Which failures come from what:**

- **Specific to the VRM adapter:** none found. The drawn paddle has always matched the
  controller's within 1 cm (0.0 cm measured), and the generated body follows `m1` within
  5 mm.
- **From the sample's shorter proportions:** high balls out of reach (shoulder high, smash,
  jump smash in the table above) and a close-in ball inside the paddle's length. The
  controller's own paddle falls short there by the same amount.
- **Existing animation limitation:** see "Late hits" under Open issues. It appeared before
  the VRM work on GLB bodies too (an ordinary right-handed player: 64 cm, once in 8 hits;
  Tezuka on `m1`: 96.7 cm, once in 4).

### Checked in screenshots

Front, side, back and three-quarter views, the face, all strokes held at contact, and the
forehand and jump smash phases. Nothing showed twisted joints, inverted elbows or knees,
floating feet or a detached paddle. The shoulders deform normally, and the rotation is
right.

## Performance

Measured on macOS 12, Chrome 150 with the GPU, at 60 Hz (so frame time stays at the
16.7 ms vsync limit and can't show a difference).

|                                        |        `m1` GLB | VRM sample, all on | no outlines | no springs | neither |
| -------------------------------------- | --------------: | -----------------: | ----------: | ---------: | ------: |
| Triangles / vertices                   | 31,942 / 18,872 |    36,470 / 24,951 |             |            |         |
| Materials (+ outline)                  |               6 |            13 (+7) |             |            |         |
| Textures                               |               6 |  18 (two 2048², …) |             |            |         |
| Estimated texture memory               |         25.7 MB |            92.3 MB |             |            |         |
| File                                   |         ~1.6 MB |            10.8 MB |             |            |         |
| Viewer draw calls (whole scene)        |              17 |                 45 |          31 |         45 |      31 |
| Viewer triangles drawn (incl. shadows) |             67k |               143k |         76k |       143k |     76k |
| CPU draw time per frame                |         0.58 ms |            1.14 ms |     0.89 ms |    0.99 ms | 0.89 ms |
| Controller per frame                   |         0.15 ms |            0.15 ms |             |            |         |
| VRM update per frame                   |               — |            0.46 ms |    0.58 ms¹ |    0.33 ms | 0.32 ms |
| Load (viewer, cached file)             |          ~90 ms |         640–740 ms |             |            |         |

¹ Measurement noise; outlines don't touch the update.

- **Training, whole game:** 160 draw calls and 320k triangles with the VRM, against 133
  and 243k with `m1`. Frames were p50 16.7 ms and p99 18.0 ms against 18.4 ms: the same.
  Time to first frame with both bodies was 4.65 s against 2.3 s, including the three-vrm
  download and the 10.8 MB file.
- **Spring bones** cost about 0.13 ms per frame. **Outlines** cost 14 draw calls and about
  67k triangles; they and spring bones switch off with the quality setting (with shadows).
- **Memory:** after six load and unload cycles in the viewer, renderer memory is flat
  (17 geometries and 30 textures each time). Five training visits in the game are flat
  too (117 / 50). Two leaks were found and fixed on the way: MToon's textures and the
  skeletons' bone textures were not freed.

**Against the budget,** the raw sample is over on materials (13 against 7) and on texture
memory (92 MB against 32 MB). Triangles are within (36k against 40k), and the file at
10.8 MB is over 6 MB. VRoid's export reduction (section 6 of
[tezuka-character.md](tezuka-character.md)) is meant to close that.

## Developer character viewer

Open `/?viewer` in `yarn dev`, or `/?viewer&e2e=1` in a test build. It never joins a game.

- **Views:** front, side, back, three-quarter, wide and face; orbit with the mouse, zoom
  with the wheel.
- **Animations:** idle, ready, walk, run, both strafes, backpedal, direction changes,
  serve, forehand, backhand, dink, volley, smash and jump smash, played on a loop with the
  ball shown at contact. Pause and 1, 0.5, 0.25 and 0.1× speed.
- **Inspection:** grip axes, and outlines, spring bones and shadows switches.
- **Stats:** load time, triangles, vertices, meshes, materials, textures and memory,
  draw calls, frame and CPU draw time, controller and VRM time, and estimated bones.
- **`?model=`:** any GLB look (`m1`) or `.vrm` under `public/`; `?hand=right` for a
  right-hander.

## Known limitations

- **Model size:** the sample is small, so high balls are out of its reach (above).
- **Spring hair:** this sample's light spring hair flares on quick crouches and landings.
  Spring settings belong to the model (VRoid).
- **Placeholder:** while loading, the placeholder figure now holds the paddle in the
  correct hand. That was checked in code review, not by an automated test, because the
  placeholder shows for only about a second.
- **Late hits:** see Open issues. It predates this work and affects every body.
- **VRM 0.x** is refused (VRoid Studio exports 1.0).
- **Viewer memory:** reloading a GLB look repeatedly in the viewer grows renderer textures
  by six each time. The game itself measured flat; this is the viewer only.
- **Restart after adding a model:** adding or removing `x1.vrm` needs a restart of
  `yarn dev` or a rebuild for `yarn host`.
- **Smoothness:** not judged by eye on a fast display; the measurements are capped at
  60 Hz.

## Open issues for later

### Late hits: the drawn paddle can miss a confirmed hit (pre-existing)

**Seen on:** GLB and VRM bodies alike, before and after this work.

**What happens:** the server confirms a hit, but when it is shown, the drawn paddle is far
from the ball (64–97 cm in the worst cases seen, roughly once in 4 to 8 hits in some
sessions, never in others). At that moment the controller's own paddle is just as far
off, so the body is not the cause.

**Likely mechanism, not yet proven:** a swing is animated as soon as the button is
pressed, toward a predicted contact (`Controller.hit`). The server's word on the real
contact arrives later. `Controller.correct` only moves the swing if it arrives in time
(the swing's contact no more than 0.12 s past) and shifts it by at most 0.25 s. A hit
confirmed later than that is shown with the swing already past.

**To investigate:** log, per confirmed hit, whether `correct` was refused and why; then
decide whether to let the swing wait for the server, or replay a short swing when a late
confirmation arrives. Gameplay is unaffected: the server decides every hit.

### The first full browser run of C1: secret-athlete grants stopped (cause found in D1)

**What happened:**

- In the first full run of the C1 work, the 20 tests up to "Tezuka with the key, in a room
  allowing it" passed.
- From test 21 on, every test that needed the secret athlete failed. Test 21's first room
  creation never completed (20 s).
- After that, training rooms were still created (Coach Erwin appeared), but Tezuka with
  the right key was an ordinary player: look `''` instead of `x1`, right-handed.
- The two tests that don't use the game server passed.

**Established:**

- The game server kept running: rooms were created, and its error output was empty.
- The authorization has no lockout or rate limit.
- The grant is decided per room, from the name, the host check, the key and the room;
  nothing is shared between rooms.

**Not established:** why the grant failed. The page's per-test artefacts were cleared by
the next run (Playwright empties `test-results/` each time), and the test server's
standard output isn't kept.

**Not reproduced:** the next two full runs on the same code did not show it. One failed
only on a VRM test assertion, later replaced; then 32 of 32 passed. The run-1 log is kept
in the C1 evidence folder.

**Cause, found in Phase D1:** the browser tests built and served `apps/client/dist`, the
same folder `yarn host` builds and serves to real players.

- **When it happened:** in D1 the same symptom came back in 2 of 4 repeats of one test,
  and the developer's `yarn host` had restarted (17:12:24) during that run.
- **What the host's build did to the tests:**
  - its `yarn build` replaced the tests' bundle mid-run, so one page load failed with
    an HTTP error while the folder was half written;
  - the pages after that loaded the host's bundle, built for the real game server
    (port 2567, not the tests' 2667). That server doesn't accept the test key: training
    rooms worked, but no grant, so look `''`.
- **What the tests' build did to the host:** each test run left the host serving a bundle
  that pointed at the stopped test server.
- **The probe:** a 12-run probe recording only whether the join request carried a key
  (never the key) granted every time while nothing else was building.
- **Fixed:** the browser tests now build into `apps/client/dist-e2e` (`playwright.config.ts`,
  gitignored). The authorization code is unchanged.
- **Checked after the fix:**
  - the developer's host restarted at 18:23:51 while a test run built `dist-e2e`
    (18:23:56). Each folder kept its own server: `dist` the default 2567, `dist-e2e` 2667;
  - in a controlled run, `yarn build` (what `yarn host` runs on start) rebuilt `dist`
    three times during `tezuka.spec.ts` and `zoneFx.spec.ts`. `dist-e2e` was untouched,
    and all 9 grant-dependent tests passed.

## Stabilization record (before the prototype commit)

- **Zone test:** the Phase B test "presets get stronger in order" runs 1,728 full flights
  with zone planning: 432 ordinary trials of seed 11, for normal, strong (twice) and anime.
  It measured 4.9–6.1 s on its own on this machine, six runs, median about 5.6 s, right at
  vitest's 5 s default, so it failed intermittently. It now has its own 30 s limit, with
  the same assertions and trials. No global timeout changed, and nothing in the zone or
  its presets changed.
- **Final results on the commit's code:**
  - `yarn check`: passed (client 239, server 185, shared 15, build).
  - `yarn test:e2e`: 32 of 32 passed (5.6 min).
  - No retries were added.
- **Six GLB athletes:** the right-handed snapshots (recorded before C2) and the original
  athlete tests all pass unchanged.
