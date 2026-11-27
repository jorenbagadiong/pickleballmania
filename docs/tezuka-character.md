# Secret athlete, Phase C1: asset strategy and character design

Status: **proposal, waiting for approval.** Nothing has been downloaded or installed for
it. The left-handed animation it builds on (C2) is done; see [tezuka.md](tezuka.md).

The character is an **original design** in a familiar archetype: a tall, composed,
left-handed captain with glasses. It must not copy an existing character's face, hairstyle,
uniform, emblem or colour scheme. The displayed ability stays TEZUKA ZONE and the trigger
nickname stays Tezuka.

## 1. Asset research

What exists, and whether it can be used. Licences were read from the sources listed at the
end. "Fits" means it meets the art direction without being rebuilt.

| Candidate                                                               | Licence (verified)                                                                                                                                                                      | Fits?                                         | Verdict                                         |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | ----------------------------------------------- |
| **VRoid Studio preset parts** (body, hair, faces, outfits, accessories) | Models you make are yours to use. Preset items may be used for any purpose unless an item says otherwise. Base models are not CC0 (copyright kept by pixiv, licensed for use).          | Yes, after recolouring and adjusting          | **Recommended base**                            |
| VRoid AvatarSample A–Z (official samples)                               | Not CC0. Altering and distributing allowed, but not for a fee and not relicensed as CC0. Conditions differ per model (e.g. AvatarSample_B allows alterations; AvatarSample_C does not). | Fixed designs; would need most parts replaced | Possible, but no less work than presets         |
| OpenGameArt "VRoid Studio CC0 models"                                   | CC0 (VRoid's own alpha-era models)                                                                                                                                                      | Older, simpler quality                        | **Use to prototype the pipeline**, not as final |
| Polygonal Mind 100Avatars                                               | Permissive ("use them on any project"); listed as CC0 by a registry, licence file not confirmed                                                                                         | Low-poly stylised, not anime                  | No: wrong style                                 |
| Broadside2037 cyberpunk VRM pack                                        | CC0 1.0                                                                                                                                                                                 | Masked cyberpunk characters                   | No: wrong style                                 |
| Free glasses on BOOTH (several)                                         | Mostly "personal / VTuber use, no resale"; not clearly allowed in a game asset                                                                                                          | Yes                                           | No: licence unclear. Use VRoid's own glasses    |
| VRoid Hub / Sketchfab models                                            | Per model; many forbid modification                                                                                                                                                     | Varies                                        | Only a model whose page allows modification     |
| Extracted game or anime assets                                          | Proprietary                                                                                                                                                                             | n/a                                           | **Never**                                       |

**Conclusion:** no free, clearly licensed ready-made model meets the brief (adult
proportions, premium anime look, glasses, blue and white kit). The least manual work is
**not** designing from scratch: it is starting from VRoid Studio's built-in male preset
and changing about 25 settings from a checklist (section 5), about 60–90 minutes. Every
part used is a VRoid preset, so the licence stays simple.

## 2. Getting the model into the game: three ways compared

Our animation drives 22 named bones (UE-style: `pelvis`, `upperarm_l`…) plus finger bones,
all with identity rest rotations, in an A-pose (upper arms 48.6° down). A VRoid export is a
VRM: humanoid bones with VRM names, in a T-pose.

|                         | **A. Blender + VRM add-on, scripted**                     | **B. Our own Python converter**          | **C. Load the VRM at runtime with three-vrm**                                                                                                                 |
| ----------------------- | --------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tools                   | Blender (~350 MB) + VRM add-on (both free, maintained)    | numpy, pillow, `tools/characters/glb.py` | `@pixiv/three-vrm` (MIT, maintained by pixiv), loaded only when the secret athlete is on court                                                                |
| Skeleton / bone names   | Script renames bones to ours                              | Our code maps and rebuilds the skeleton  | A table maps VRM humanoid bones to ours; three-vrm's **normalized** bones already have identity rest rotations, our convention                                |
| Rest pose (T → A)       | Re-pose and apply in Blender: proven, may pinch shoulders | Re-skin by hand: the riskiest part       | No re-posing: a fixed rest offset per arm bone at runtime (no mesh change)                                                                                    |
| Skin weights            | Kept by Blender                                           | Must be carried over correctly by us     | Untouched                                                                                                                                                     |
| Finger bones            | Renamed                                                   | Rebuilt                                  | Mapped (proximal / intermediate / distal; thumb metacarpal → `thumb_01`)                                                                                      |
| Facial expressions      | Kept as shape keys if exported                            | Baked or dropped                         | Kept: three-vrm's expression manager sets a calm face                                                                                                         |
| Materials               | MToon lost on plain glTF export: we write a toon shader   | Same                                     | **MToon kept** (anime toon shading, rim light, outline), with outlines switchable by quality                                                                  |
| Hair motion             | Spring bones lost                                         | Lost                                     | **Spring bones kept** (VRMC_springBone): hair moves                                                                                                           |
| Texture compression     | Blender or gltf-transform afterwards                      | Pillow                                   | VRoid's export options first (texture atlas size, material and polygon reduction), then gltf-transform for WebP if still over budget                          |
| Mesh optimisation       | Decimate in Blender                                       | Our own simplifier                       | VRoid's polygon reduction on export                                                                                                                           |
| Animation compatibility | Full (same skeleton as today)                             | Full                                     | Full through the adapter; needs a prototype to prove the rest offsets                                                                                         |
| Maintenance             | A Blender script tied to Blender / add-on versions        | Highest: our own format code             | A ~200-line adapter; three-vrm updates                                                                                                                        |
| Browser cost            | Lowest                                                    | Lowest                                   | three-vrm adds some download (an estimate of 100–200 KB, to be measured), only for games with the secret athlete; MToon outlines add a draw per outlined mesh |
| Manual work for you     | Install Blender on Windows                                | None                                     | None                                                                                                                                                          |

**Recommended: C, proven by a prototype first.** It keeps what VRoid does well (MToon
shading, outlines, spring hair, expressions), needs no converter and no re-skinning, and
VRoid's own export settings cover texture atlasing and polygon reduction. B is not
justified. A is the fallback if the runtime rest offsets turn out not to hold.

**Prototype (first step after approval):** load a CC0 VRoid model from OpenGameArt in a
dev-only page and drive it with the existing `Controller` through the adapter. Pass mark:
the paddle meets the ball within 14 cm in the same stroke tests as today, feet stay
planted, and the left-handed mirror holds. Only then would you build the real model. This
needs one approved download (about 10–20 MB) and one new dependency (`@pixiv/three-vrm`).

### Adapter outline (for C)

- **Bones:** `hips→pelvis`, `spine→spine_01`, `chest→spine_02`, `upperChest→spine_03`
  (or `chest` if missing), `neck→neck_01`, `head→head`, `leftShoulder→clavicle_l`,
  `leftUpperArm→upperarm_l`, `leftLowerArm→lowerarm_l`, `leftHand→hand_l`,
  `leftUpperLeg→thigh_l`, `leftLowerLeg→calf_l`, `leftFoot→foot_l`, `leftToes→ball_l`, and
  the same on the right. Fingers: `leftIndexProximal/Intermediate/Distal → index_01/02/03_l`,
  likewise middle, ring and little (`pinky`); `leftThumbMetacarpal/Proximal/Distal →
thumb_01/02/03_l`.
- **Facing:** VRM 1.0 models face +Z with their left on +X, which is ours. VRM 0.x models are
  turned round by `VRMUtils.rotateVRM0`.
- **Rest pose:** our rest positions are made from the VRM's with each arm turned 48.6° down
  at the shoulder. Each frame, every normalized bone gets `ourWorldRotation × restOffset`,
  where `restOffset` is identity except along the arms. The mesh is not re-posed.
- **Left-handed:** unchanged. The mirror in `handedness.ts` works on any skeleton with
  identity rest rotations, which normalized VRM bones have.

## 3. Privacy and licensing

- The model goes in `apps/client/public/models/private/` (already excluded in
  `.gitignore`), so it never enters the public repository.
- **Being gitignored does not make a file private on the web.** Anything in `public/` is
  served by the game's web server, so any player who opens the game, or knows the address,
  can download it. It is only fetched when the secret athlete is on court, but it is not
  hidden. The licence must allow that kind of distribution: VRoid's terms do, for a model
  made from presets.
- If the file is missing, the secret athlete is drawn with `m1` as today
  (`SECRET_LOOK_FALLBACK`), with no error. The check is a request that fails quietly.
- A `LICENSES.md` next to the model will record what it is made from (VRoid preset parts,
  under pixiv's VRoid Studio terms) and that it is not CC0 and must not be resold.

## 4. Performance budget

The brief's starting budgets, to be measured, not assumed:

- About 40,000 triangles (VRoid's export reduction can usually reach this).
- At most 7 materials (VRoid's material reduction merges them; outlines are drawn as
  separate passes).
- A GLB/VRM of at most 6 MB.
- About 32 MB of texture memory (for example, one 2048 atlas plus a 1024 one).

To measure: frame time against `m1` in the character viewer, singles, doubles, a spectator
view, and the background courts. Outlines and spring bones switch off at lower quality
levels (`game/quality.ts`).

## 5. Character design specification

Original design: **"the composed captain"**. Every value here is a target to check against
the model, in VRoid or in the game viewer.

### Silhouette and proportions

- Height 1.82 m; head-to-body ratio about 1 : 7.5 (adult, never chibi).
- Long legs: hip joint at about 51% of height. Shoulders 0.46 m wide; narrow waist, lean
  athletic build with defined forearms and calves, without bulky muscle.
- Posture: upright and still. Weight evenly on both feet, chin level, shoulders relaxed.

### Face

- Narrow, angular face with a sharp jaw and pointed chin; high cheekbones.
- Eyes: narrow and calm, slightly upturned outer corners, dark hazel iris `#5B3E28`, small
  highlights. Upper lids slightly lowered: composed, not sleepy.
- Brows: straight and level, a little thicker at the inner ends, set close to the eyes.
- Nose: straight, fine bridge; small line shading only.
- Mouth: closed, level, a faint downward set at the corners. No smile at rest.
- Skin: light warm `#F2D5C0` with shade `#D9AB91`. Soft cel shading, not glossy.

### Hair

- Deep brown `#4A3022`, highlight band `#7A5236`, shade `#2C1B12`.
- Short to mid-length, **layered and swept**: crown layered back and to the right
  (from the viewer), a side part on his left, fringe falling in 4–5 tapering locks to the
  top of the glasses, sides covering the top half of the ears, back tapering to the nape.
- Built from VRoid hair-card groups (not one solid lump): crown, fringe, sides and back as
  separate groups, so the silhouette has depth and moves with spring bones.
- Avoid spikes and gravity-defying shapes, and avoid copying any existing character's
  hairstyle.

### Glasses

- Thin rectangular full-rim frame, lens 46 × 28 mm, bridge 18 mm, gunmetal `#3A3F47`, rim
  1.2 mm, temples straight back over the ears.
- Lenses slightly tinted `#CFE3F0` at about 15% opacity, with a thin specular streak. The
  eyes must stay readable behind them.
- Made with VRoid's accessory or hair-preset glasses so they follow the head.

### Sportswear (original kit)

- **Shirt:** short-sleeved athletic shirt, royal blue `#1F4FA8` body with white `#F5F7FA`
  sleeves and a white collar band. A thin navy `#13284F` diagonal panel from the left
  shoulder to the right hip, edged with a 4 mm silver-grey `#A9B4C2` line. A small
  original crest on the chest: a white chevron in a navy shield, with no lettering.
- **Shorts:** white `#F2F4F7`, mid-thigh, with a navy side stripe 25 mm wide.
- **Wristband:** navy on the left (paddle) wrist.
- **Socks:** white crew socks with one blue ring.
- **Court shoes:** white uppers, navy heel counter and toe guard, light gum sole `#C9A27A`.
- Fabric reads as technical: matte with a faint sheen, seams drawn in the texture.

### Colour palette

| Use              | Colour    |
| ---------------- | --------- |
| Kit blue         | `#1F4FA8` |
| Kit navy         | `#13284F` |
| Kit white        | `#F5F7FA` |
| Trim silver-grey | `#A9B4C2` |
| Hair             | `#4A3022` |
| Hair highlight   | `#7A5236` |
| Hair shade       | `#2C1B12` |
| Skin             | `#F2D5C0` |
| Skin shade       | `#D9AB91` |
| Eyes             | `#5B3E28` |
| Glasses frame    | `#3A3F47` |
| Sole             | `#C9A27A` |

### Materials (MToon)

| Material      | Shade colour | Shading toony / shift | Rim               | Outline            |
| ------------- | ------------ | --------------------- | ----------------- | ------------------ |
| Skin          | `#D9AB91`    | 0.85 / -0.05          | warm, weak (0.15) | 0.0015, skin shade |
| Hair          | `#2C1B12`    | 0.95 / 0.0            | cool, 0.25        | 0.0020, dark brown |
| Kit           | 25% darker   | 0.90 / 0.0            | cool, 0.2         | 0.0020, navy       |
| Glasses frame | `#22262C`    | 1.0 / 0.0             | none              | none               |
| Lenses        | n/a          | transparent           | specular streak   | none               |
| Eyes / face   | as VRoid     | as VRoid              | none              | none               |

The result should read as "hybrid": soft two-band cel light and a cool rim from the court
lights, while still taking the court's shadows. Outlines switch off at low quality.

### Views (for checking the model, not concept art)

[tezuka-character-sheet.svg](tezuka-character-sheet.svg) draws the turnaround to the
proportions above: front, side, back and three-quarter, plus a face close-up and the
hair, glasses and kit details, the palette, the ready stance and the left-hand grip. It is
a flat measuring guide for building and checking the model. It is not artwork and not a 3D
asset.

### Ready stance and grip

- **Ready:** feet shoulder width apart, knees softly bent, weight on the balls of the feet.
  Paddle up in front of the body at chest height, face toward the net, in the **left**
  hand. The right hand lightly near the paddle's throat. Eyes level, past the net.
- **Grip:** continental "handshake" grip in the left hand. The handle lies diagonally across
  the palm, index finger slightly spread, thumb wrapped over. The animation already does
  this (`poseFingers`); the model only needs normal finger bones.

## 6. Building it in VRoid Studio (if approved)

About 60–90 minutes, on Windows or macOS. Slider names differ a little between VRoid
versions: what matters is the target in each step, which you can check in VRoid's preview.

1. **New model:** start from the masculine preset body.
2. **Body:** height to 1.82 m (or the closest value VRoid shows); head size down until the
   head fits about 7.5 times into the height; legs longer, shoulders a little wider, waist
   narrower, arms and legs lean.
3. **Face:** pick the narrowest masculine face preset. Sharpen the jaw and chin, narrow the
   eyes, lower the upper lids slightly, set the brows level and close, mouth neutral.
   Eye colour `#5B3E28`, skin `#F2D5C0`.
4. **Hair:** pick a short layered masculine preset, set the colour to `#4A3022` with the
   highlight `#7A5236`, part it on his left, and trim the fringe to the top of the glasses.
   Keep the groups separate (crown, fringe, sides, back).
5. **Glasses:** add VRoid's thin rectangular glasses and set the frame to `#3A3F47`.
6. **Outfit:** a short-sleeved preset top and short shorts. In the texture editor, paint the
   kit from section 5 (blue body, white sleeves and collar, navy diagonal panel with a
   silver edge, chest crest; white shorts with a navy stripe). Shoes: preset trainers,
   recoloured.
7. **Expression:** leave the default face neutral; the game sets the calm look.
8. **Export (VRM 1.0):** polygon reduction to about 40k triangles, material reduction to 7
   or fewer, texture atlas 2048. Title "Captain (private)", licence "do not redistribute
   for a fee", author you.
9. Put the file at `apps/client/public/models/private/x1.vrm` and tell me. Everything after
   that is automated.

## Sources

- [VRoid Studio](https://vroid.com/en/studio) and [VRoid Studio guidelines](https://vroid.com/en/studio/guidelines)
- [Do VRoid Studio's sample models come with conditions of use?](https://vroid.pixiv.help/hc/en-us/articles/4402614652569-Do-VRoid-Studio-s-sample-models-come-with-conditions-of-use),
  [AvatarSample A–Z terms](https://vroid.pixiv.help/hc/en-us/articles/4402394424089-VRoidPreset-A-Z),
  [AvatarSample_B](https://hub.vroid.com/en/characters/7939147878897061040/models/2292219474373673889),
  [AvatarSample_C](https://hub.vroid.com/en/characters/2720223491564308793/models/7533495354811817099)
- [OpenGameArt: VRoid Studio CC0 models](https://opengameart.org/content/vroid-studio-cc0-models)
- [Polygonal Mind 100Avatars](https://github.com/gfodor/100avatars),
  [open-source-avatars registry](https://github.com/toxsam/open-source-avatars)
- [Broadside2037 cyberpunk VRM pack (CC0)](https://broadside2037.itch.io/free-vrchat-avatars-cyberpunk)
- BOOTH glasses: [antique glasses preset](https://onlyvirtualrae.booth.pm/items/3077295),
  [black glasses](https://booth.pm/en/items/2641137)
- [three-vrm (MIT)](https://github.com/pixiv/three-vrm), [VRM features](https://vrm.dev/en/vrm/vrm_features/)
- [glTF Transform](https://gltf-transform.dev/), [VRM Optimizer](https://note.com/lain2772/n/n3145724634b2?hl=en)
