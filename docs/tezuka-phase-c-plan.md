# Secret athlete, Phase C plan: character model and left-handed animation

Status: **C2 (left-handed animation) done**; see [tezuka.md](tezuka.md). The asset
route below is **superseded** by the revised research, conversion comparison and design
specification in [tezuka-character.md](tezuka-character.md), which waits for approval.
Phases A (authorization, `1eb4c28`) and B (TEZUKA ZONE, `c9a815b`) are done.

The character is an **original design** in this archetype: a tall, lean, composed,
left-handed captain with glasses, a navy and white kit and premium anime shading. It is
not a likeness of an existing character. The nickname trigger and the TEZUKA ZONE label
stay as they are.

## Constraints a model must meet

|           | The six athletes today                                                  | What a new model needs                                    |
| --------- | ----------------------------------------------------------------------- | --------------------------------------------------------- |
| Skeleton  | 52 joints, UE-style names (`pelvis`, `upperarm_l`…), 30 of them fingers | Same names: 22 bones driven by motions, plus finger bones |
| Rest pose | Identity rest rotations; A-pose, upper arms 48.6° down; head at 1.65 m  | Re-posed to this before export (VRoid exports a T-pose)   |
| Budget    | About 32k triangles, 6 materials, 1.5–1.7 MB per GLB                    | About 40k triangles, at most 7 materials, at most 6 MB    |
| Animation | `motions.glb` (CMU capture) plus procedural strokes and IK              | Reuse all of it; no new animation engine                  |

## Options

|            | A. Existing free model                                             | B. Custom in Blender                  | C. MakeHuman (current)           | **D. VRoid Studio + our converter**                                                |
| ---------- | ------------------------------------------------------------------ | ------------------------------------- | -------------------------------- | ---------------------------------------------------------------------------------- |
| Source     | OpenGameArt CC0 VRoid models; VRoid Hub; Sketchfab                 | blender.org                           | `tools/characters`               | VRoid Studio (Steam, free)                                                         |
| License    | CC0; otherwise per model (often no modification or redistribution) | GPL tool; you own the output          | CC0                              | Your models and preset parts may be used, even sold, unless an item says otherwise |
| Platform   | any                                                                | Windows best; headless in WSL         | WSL                              | **Windows or macOS only**                                                          |
| Quality    | fixed designs, mostly mid-quality                                  | highest ceiling; weeks of artist work | realistic only; can't look anime | good anime quality: sliders, hair cards, clothing editor                           |
| Complexity | medium; licensing risk                                             | very high                             | low                              | medium                                                                             |

**Recommended: D.** It's the only free route to real anime quality without weeks of
sculpting. VRoid has a visual editor, so the character is built by hand on Windows
(about 2–4 hours) from the sheet below and exported as VRM 1.0. The rest is automated.

## Design sheet

- **Body:** about 1.82 m, long-limbed, lean athletic build, adult proportions (about
  1:7.5 head to body).
- **Face:** sharp jaw, narrow calm eyes, level brows, neutral mouth. The calm expression
  is baked in from VRoid's expression sliders.
- **Hair:** deep brown, short, a crisp layered silhouette of our own, with a painted
  highlight band.
- **Glasses:** thin half-rim frame, real geometry, slightly tinted lenses.
- **Kit:** navy and white, an original chevron panel and team crest, white shorts, white
  and navy court shoes.
- **Shading:** two-band cel light with a soft edge, a cool rim light, a skinned outline
  about 1.5 px wide, simplified face shading. Still receives the court's shadows.

## Pipeline

1. **VRoid (Windows):** build the character from the sheet and export VRM 1.0.
2. **Optional, Blender + VRM add-on (Windows):** glasses refinement, mesh clean-up.
3. **`tools/characters/vrm_to_athlete.py` (new, Python + numpy, runs in WSL):**
   - map the VRM humanoid bones to our 22 body and 30 finger bones, folding extra bones
     into the nearest of ours;
   - re-pose the mesh from T-pose to the 48.6° A-pose and rebind with identity rest
     rotations;
   - bake the calm expression and drop the other face shapes;
   - pack textures into atlases of at most 2048 px and cut down to the triangle budget;
   - write the GLB with the existing `glb.py`.
4. **Output:** `apps/client/public/models/private/x1.glb` plus a manifest, in a
   gitignored folder. The client uses it if present and falls back to `m1` otherwise, so
   the model never enters the repository.
5. **Hair:** static at first, since VRoid's springy hair bones aren't in our skeleton. A
   light client-side spring can come later.

## Left-handed animation (C2; needs no new assets)

- `handFor(look)`: left for `x1`, right for everyone else, so the six athletes keep
  today's behaviour.
- **Controller:** the paddle arm, IK sides, free-arm logic and leg-bend constants depend
  on the hand setting.
- **`grip.ts`:** `gripFor(a, hand)` and `poseFingers(a, hand)`.
- **`strokes.ts`:** keys mirrored at lookup (negate x of the contact point, shaft and
  face; negate the chest turn). `chooseStroke` flips forehand and backhand.
- **`mirrorPose`:** swaps left and right bones, maps quaternions (x,y,z,w)→(x,−y,−z,w)
  and negates the pelvis x offset. Gait lookup mirrors the sideways direction. The mesh
  is never negatively scaled.
- **`PlayerAvatar.tsx`:** the paddle attaches to the paddle-hand bone. `contact.ts` is
  unchanged (the server reports contact).
- **Zone:** the zone already aims at the player's left side, and a test will check that
  the left-handed grip matches. Reach and zone physics are not changed.
- **Tests:** mirroring twice returns the original pose; the grip sits on `hand_l`;
  strokes flip; a snapshot proves the right-handed athletes are unchanged.

## Integration (C3)

- **Files:**
  - `athlete/{assets,controller,grip,strokes,locomotion,skeleton}.ts`
  - `PlayerAvatar.tsx`
  - new `athlete/toon.ts` (hybrid toon material and skinned outline; no new dependency)
  - `game/quality.ts` (outline off at low quality)
  - `.gitignore`
  - `tools/characters/{vrm_to_athlete.py,README.md}`
  - client tests; `docs/tezuka.md`
- **Viewer:** a dev-only character viewer (`?viewer=x1`) that orbits the model and plays
  ready stance, run, forehand, backhand, smash and jump smash.
- **Quality gate:** front, side and back views, a face close-up, the strokes, and an
  in-game view, all rendered. Smoothness and foot sliding need a real GPU: check them on
  Windows with `yarn dev` if the dev machine renders in software.
- **Performance:** about 40k triangles, at most 7 materials plus outline passes, a GLB of
  at most 6 MB, about 32 MB of texture memory. Measure the frame time against `m1`.

## Dependencies (none installed yet)

| What                                          | Where   | Size         | For         |
| --------------------------------------------- | ------- | ------------ | ----------- |
| VRoid Studio                                  | Windows | 10 GB disk   | the model   |
| `numpy`, `pillow` in `tools/characters/.venv` | WSL     | about 20 MB  | converter   |
| Blender 5.2 LTS + VRM add-on (optional)       | Windows | about 350 MB | polish only |

## Risks

- The model can't be built without VRoid on Windows.
- Re-posing a T-pose into the A-pose can pinch shoulders: blend the weights there.
- VRoid exports are heavy, so the converter has to reduce them a lot.
- Static hair looks stiff in motion.
- Genshin-level shading is a stretch goal, not a promise.

## Order

1. **C2:** left-handed animation, on the `m1` fallback.
2. **C1:** design sheet, then the VRoid model, then the converter and `x1.glb`.
3. **C3:** shading, outline, viewer, visual gate, docs.

Sources: [VRoid Studio guidelines](https://vroid.com/en/studio/guidelines),
[VRoid Studio on Steam](https://store.steampowered.com/app/1486350/VRoid_Studio/),
[VRM add-on for Blender](https://extensions.blender.org/add-ons/vrm/),
[Blender download](https://www.blender.org/download/),
[three-vrm (MIT)](https://github.com/pixiv/three-vrm),
[OpenGameArt CC0 VRoid models](https://opengameart.org/content/vroid-studio-cc0-models).
