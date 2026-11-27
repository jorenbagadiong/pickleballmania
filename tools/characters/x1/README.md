# x1.vrm: the secret athlete's model

`build_x1.py` turns a CC0 VRoid sample into the secret athlete's model, headless in
Blender. It takes about 40 seconds and needs no manual steps.

```bash
~/Applications/Blender-4.2.app/Contents/MacOS/Blender -b --python-exit-code 1 \
  --python tools/characters/x1/build_x1.py -- \
  --base private-assets/tezuka/base/05-sakurada-fumiriya.vrm \
  --out apps/client/public/models/private/x1.vrm
```

Then restart `yarn dev` (or rebuild for `yarn host`) and look at it in the viewer:
`http://localhost:5173/?viewer&model=/models/private/x1.vrm`.

## Tools (free)

| Tool                                          | Version                       | Licence                 | Source                                                                                               |
| --------------------------------------------- | ----------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------- |
| Blender                                       | 4.2.23 LTS, Intel macOS build | GPL                     | `download.blender.org/release/Blender4.2/blender-4.2.23-macos-x64.dmg` (SHA-256 `c85e18c5…7b77b6`)   |
| VRM add-on for Blender (`vrm`, by saturday06) | 4.10.5                        | MIT or GPL-3.0-or-later | Blender's official extensions site, `extensions.blender.org/add-ons/vrm/` (SHA-256 `5f0dd6a2…44bf1`) |

Blender 4.2 because it is the newest that runs on this Intel Mac with macOS 12: Blender 5
dropped Intel Macs, and 4.5 reportedly needs macOS 13. It is installed in
`~/Applications/Blender-4.2.app`, and the add-on with
`blender -b --command extension install-file -r user_default -e add-on-vrm-v4.10.5.zip`.

## The base model

- **Sakurada Fumiriya**: one of VRoid's early (β) sample characters, made by pixiv.
- **Licence: CC0** (public domain), written into the file's own VRM metadata
  (`licenseName: CC0`, use allowed for everyone, commercially), and stated on VRoid's help
  page _Do VRoid Studio's sample models come with conditions of use?_
- **Download:** `05-sakurada-fumiriya.vrm`, 19.3 MB, SHA-256
  `d8fb05f33e377df028cb6b9d58c441ce68326c41fa23f6c735d40c65ae3dc710`, from
  `file-in-abyss.soga-web.studio`, a site that hosts sample files and links each to VRoid's
  article as its licence source. The checksum matches the one that site publishes.
  VRoid's own pages refuse automated downloads. As a CC0 work, any faithful copy carries
  the same rights.
- **Why this one:** of the CC0 VRoid samples, the two male ones were compared. This one is
  tall (head joint 1.68 m, about 1.82 m overall), slim and adult-looking, with a layered
  brown hairstyle and a sharper face. It has all 54 humanoid bones, all 30 finger bones,
  40 expression shapes and spring-bone hair. Its legs are modelled under its trousers,
  which is what makes shorts possible.
- **Where it is kept:** `private-assets/tezuka/base/`, which Git ignores and which is
  outside `public/`, so players can't download it.

## What the script does

1. **VRM 0.x → 1.0:** imports the base and carries its spring bones and expressions over
   to VRM 1.0 (the add-on's own operators). Sets new metadata: "Captain (private)",
   personal non-profit use, no redistribution, no modification by others; the copyright
   note credits the CC0 base.
2. **Geometry:**
   - the tie goes;
   - the trousers are cut cleanly at 0.80 m into mid-thigh shorts (a plane cut; his
     modelled legs show below);
   - the small cowlick strand standing off the crown goes.
3. **Resting face:** a calm, serious look is baked in (brows 0.45, eyes 0.28 and mouth
   0.35 of VRoid's own "angry", "angry" and "close" shapes). It is added to the base shape
   and to every expression shape, so all expressions still work on top of it.
4. **Kit textures:** Cycles bakes where on the body each texel of the shirt, shorts, shoes
   and skin sits. The new colours are then assigned by real body position, and the
   original's folds, seams and knit are multiplied back in:
   - **shirt:** royal blue, a navy diagonal panel with a silver edge, the crest on the left
     chest (`emblem-1024.png`), a white collar and V insert, white sleeves with navy and
     royal cuffs, a navy ribbed hem;
   - **shorts:** white, navy side stripes, waistband and hem;
   - **shoes:** white with navy toe and heel, gum sole;
   - **socks:** white crew socks with a royal ring.
5. **Colours:** hair brown (base, highlight and shade of `#52382B`), with a softer sheen.
   Irises from blue to hazel brown.
6. **Glasses:** thin rectangular full-rim frames, a low bridge, temples over the ears and
   lightly tinted lenses, built from curves to fit his eyes. They are skinned entirely to
   the head bone, in gunmetal MToon with no rim light.
7. **Materials (MToon):** thin dark outlines on the kit and hair, a soft cool rim light,
   and cool grey-blue shading on the fabric instead of the skin's pink.
8. **Hair motion:** the springs are simulated relative to the neck (VRM spring
   `center`), so crouching, jumping and landing don't fling the hair. Stiffness is ×4 of
   the base's and drag 0.7, so a thin strand no longer flips over on a landing. The hair
   still sways when the head turns.
9. **Budget:** oversized textures are halved, three normal maps the toon look doesn't need
   are dropped, and the thumbnail goes. Four atlases merge materials:
   - **Kit:** shirt, shorts and shoes;
   - **FaceLines:** brows, lashes and eyeline;
   - **EyeLight:** the eye highlights;
   - **Eyes:** iris and eye white.
10. **Shade textures:** the kit and the body each get a half-resolution shade texture, so
    white fabric (shorts, collar, sleeves, socks) shades to a light cool tone while
    colours and skin shade as before. With a single shade colour per material, the whites
    went grey.
11. **Output:** exports `x1.vrm` (VRM 1.0), and saves the painted textures to
    `private-assets/tezuka/textures/generated/`.

## Other scripts

- `inspect.py`: lists a VRM's materials, textures and meshes.
- `dump_textures.py`: saves every texture as PNG.
- `probe.py`: checks the add-on is installed.

## Privacy

- **Generated files are ignored by Git:** `x1.vrm` (in `apps/client/public/models/private/`),
  the base and the textures (in `private-assets/`).
- **`x1.vrm` is downloadable by players:** it is served from `public/`, so every player who
  opens the game can download it. Their browsers need it to draw Tezuka.
- **Fallback:** without the file, the game draws the secret athlete with `m1`.

## Verification of the first build (`x1.vrm` SHA-256 `41f3bbd4…aa7a9c1`)

- **In the viewer:** no estimated bones; head joint 1.68 m. Every stroke meets the ball
  within 14 cm, smash and jump smash included (0 cm); "in front" is 8.5 cm, "low" 2.2 cm.
  Screenshots checked: front, side, back and three-quarter; face; every stroke held at
  contact; the jump smash phases; idle, walk, run, strafe, backpedal and direction
  changes. No broken joints, floating feet or detached paddle were seen, and the paddle is
  in his left hand throughout.
- **In play:**
  - in training, 7 of 8 server-confirmed hits were met within 14 cm. The miss (52 cm) was
    missed equally by the controller's own pose: the known late-hit timing, not the model.
  - the drawn paddle matched the controller's on every frame (0 cm);
  - the opponent and a spectator see him left-handed.
- **Cost** (training, whole scene, this Mac at 60 Hz):

  |            | x1.vrm  | `m1`    |
  | ---------- | ------- | ------- |
  | Frames p50 | 16.7 ms | 16.7 ms |
  | Frames p99 | 18.4 ms | 18.6 ms |
  | Draw calls | 147     | 132     |
  | Triangles  | 331k    | 243k    |
  | First load | 7.9 s   | 2.2 s   |

  The first load includes three-vrm and the 7.1 MB file.

- **Budget:**

  |                         | x1.vrm  | Target |
  | ----------------------- | ------- | ------ |
  | Triangles               | 39,604  | ~40k   |
  | Materials (+6 outlines) | 13      | ~7     |
  | Textures (estimated)    | 36.7 MB | ~32 MB |
  | File                    | 7.1 MB  | ~6 MB  |

- **Tests:**
  - `yarn check` passes: client 239, server 185, shared 15 tests, and the build.
  - `yarn test:e2e`, three full runs with `x1.vrm` in the build:
    - **run 1:** 31 passed and 1 failed: a bug in the new viewer test (its network route
      also caught the page address), fixed;
    - **runs 2 and 3:** 31 passed and 1 failed: "swiping the mouse while serving", a
      real-time test whose observing browser collected 1 sample instead of more than 3.
  - **For comparison:** a full run without `x1.vrm` failed a different timing-sensitive
    test (TEZUKA ZONE, side 1) and passed the swipe test.
  - **Alone:** each of those tests passes on its own (swipe 3 of 3, zone 2 of 2).
  - **Load:** the machine's load average was 6–10 throughout. That is consistent with
    intermittent timing failures, but it isn't proven as the cause.

## Known limitations

- **The base:** an early (β) VRoid sample. Its face can't be re-sculpted (only its
  expression shapes mixed), its eyes are large in the classic VRoid way, and its hairstyle
  is the original's: recoloured, cowlick removed, swept quiff kept.
- **Not AAA:** it is a clean, coherent anime athlete, not the bespoke premium character
  of a big studio.
- **Over budget:** materials (13), estimated texture memory (36.7 MB) and file size
  (7.1 MB) are a little over. Going further would mean merging skin and face materials
  through baked shade textures, or lowering texture resolution, at some cost in quality.
- **Shorts:** the white shorts read slightly grey on their shaded side.
- **Hair:** the quiff flicks up on quick crouches and landings (spring hair), even
  stiffened.
- **Blender:** 4.2 LTS no longer receives updates (June 2026). It is the newest that runs
  on this Mac.

## Polish (Phase C3)

Build: `x1.vrm` SHA-256 `3fe63826…0513c4e`, 7.6 MB.

Measured on the real model, driven by the game's controller through a dink, a jump smash
with landing, and a sprint. The worst movement of any hair joint is in the head's own
frame:

|                       | Before  | After   |
| --------------------- | ------- | ------- |
| Dink (deep crouch)    | 9.9 cm  | 1.2 cm  |
| Jump smash, landing   | 12.2 cm | 1.6 cm  |
| Running               | 3.9 cm  | 0.6 cm  |
| Glasses drift vs head | 0.00 mm | 0.00 mm |

What I ruled out first:

- **Colliders:** with none at all, the swing was still 12.2 cm.
- **Stiffness alone:** ×5 only reached 9.9 cm.

The causes were inertia from whole-body movement (fixed by the neck-relative center) and
one thin strand flipping over on landings (fixed by drag 0.7).

**Whites:** the shorts, collar, sleeves and socks keep their colour in shade (shade
textures, step 10).

**Checked in screenshots** (before and after, in the viewer), unchanged:

- the face's calm expression;
- the glasses' fit;
- no clipping in the dink or the jump smash.

**Budget after C3:**

|                         | x1.vrm (C3) | Before                              |
| ----------------------- | ----------- | ----------------------------------- |
| Materials (+6 outlines) | 12          | 13                                  |
| Draw calls (viewer)     | 41          | 43                                  |
| Draw calls, low quality | 29          | —                                   |
| Textures                | 20          |                                     |
| Texture memory (est.)   | 40.0 MB     | 36.7 MB (+3.3 MB of shade textures) |
| File                    | 7.6 MB      | 7.1 MB                              |
| Triangles               | 39,604      | 39,604                              |

### Loading

From clicking Training to Tezuka appearing, on a production build, cold browser:

|                            | Run 1     | Run 2 |
| -------------------------- | --------- | ----- |
| Before C3 (model and code) | 3.0 s     | 2.6 s |
| After C3                   | 3.8 s     | 2.5 s |
| `m1` fallback              | 2.3–2.9 s |       |

The 7.9 s reported earlier came from a different measurement (until both players were
drawn, on a heavily loaded machine) and does not reproduce under this one.

Where the VRM's own time goes (performance measures `pb:vrm:*` and `pb:prepare:*`, kept in
the code):

| Stage                                | Time        | Notes                                               |
| ------------------------------------ | ----------- | --------------------------------------------------- |
| Download (7.6 MB, 4.8 MB compressed) | 0.40–0.55 s | in parallel with the three-vrm import (0.16–0.26 s) |
| Parse, PNG decoding included         | 0.13–0.46 s |                                                     |
| Setup                                | 0.01–0.04 s |                                                     |
| GPU preparation                      | 0.32–0.35 s | shader compile and texture upload                   |

**Caching:** a second visit transfers 300 bytes (the server answers "not modified" thanks to
the ETag), so the model downloads once per browser.

**Preloading would not help:** the download starts within milliseconds of the room state
first listing the secret look, the earliest moment the client knows the room uses it.

**Fixed:** MToon keeps its textures in shader uniforms, which the body preparation didn't
look at, so they were all uploaded during the first frame that drew the model. They are
now uploaded one per frame beforehand, like the GLB athletes'.

**Freezes:**

- The longest frames during loading (270–360 ms) come when the court scene and players
  are created. The `m1` fallback has them too (270–620 ms).
- The VRM adds a hitch of about 150 ms on its first draw, most likely shadow and outline
  shader variants that can't be compiled ahead.

### Clean checkout

**Never in Git, all optional:** `x1.vrm`, its base and the textures. Without `x1.vrm`:

- the build doesn't ask for it, and the secret athlete is drawn with `m1`, left-handed;
- held curves and TEZUKA ZONE are unchanged.

**Tests:**

- **Never need the private model:** all unit tests (VRM tests use a humanoid generated in
  code, `test/fixtures/vrm.ts`) and every browser test except the two below.
- **Need a real VRM:** in `e2e/vrm.spec.ts`, the group "with the real model, x1.vrm" (the
  model in training, opponent, spectator and doubles views, and the viewer's contacts).
  It uses `x1.vrm` if it exists, otherwise skips.
- **Adapts to the build:** "without its own model" expects no request without
  `x1.vrm` and exactly one with it.

### Test results (Phase C3)

Logs are kept outside the repository; the key lines are quoted here.

| Run                                              | `yarn check`               | `yarn test:e2e`                    |
| ------------------------------------------------ | -------------------------- | ---------------------------------- |
| C1B, full suite, runs 2 and 3                    | —                          | 1 failed each: swipe while serving |
| Baseline `338f612` (C1 code), with this `x1.vrm` | —                          | 27 passed, 3 skipped, 2 failed     |
| Clean checkout (C3 changes, no private files)    | 3 lint errors, fixed since | 29 passed, 3 skipped (5.9 min)     |
| Final, this tree with `x1.vrm`                   | passed                     | **32 passed** (5.1 min)            |

**Baseline failures at `338f612`:**

- "tournament courts side by side, and a spectator looking around 360°":
  `TypeError: Cannot read properties of null (reading 'court')`. It passes in every
  C3 run.
- "nothing is asked for": expected there, because the old test assumes there is no model
  at all. It was rewritten in C3 to expect exactly one request when the build has one.

The swipe test passed at the baseline and in both C3 runs.

**The clean checkout** was `338f612` plus every modified and new file Git tracks or would
track, with no `apps/client/public/models/private/` and no `private-assets/`. The three
skipped tests are the group that needs a real VRM.

**Swipe while serving:** C1B's failures were not reproduced in C3, so their cause is still
not proven. It was not proven to be load either. The test now reports the serve as Alice's
input recorded it and how many samples Bob took, so a straight serve can be told apart from
an observer that sampled too little. Its assertions are unchanged.
