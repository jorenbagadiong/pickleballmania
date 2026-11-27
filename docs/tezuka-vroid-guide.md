# Making the captain in VRoid Studio: a beginner's guide

> **Not needed any more.** The model is now built automatically from a CC0 VRoid sample
> in Blender: see [tools/characters/x1/README.md](../tools/characters/x1/README.md).
> This guide is kept only in case you ever want to build a character by hand.

This walks you from nothing to a finished `x1.vrm` for the secret athlete, assuming you
have never made a 3D character. You only move sliders, pick presets and choose colours. No
modelling, no Blender.

The character is **inspired by** a famous anime tennis captain: a tall, calm, left-handed
leader with brown hair and glasses, in blue and white. It is your own character, for your
private game, built only from VRoid's own presets and your colour choices. Don't copy
the anime's exact face, hairstyle, school uniform, logo or lettering; the guide gives
original details that keep the same feel.

> **No final character exists yet.** The prototype tested the game with a sample model.
> This guide is how you make the real one.

**Before you start:**

- **Time:** about 1½ to 2 hours the first time.
- **Reference:** keep [tezuka-character-sheet.svg](tezuka-character-sheet.svg) open beside
  VRoid; it shows the proportions, colours, glasses and kit.
- **Slider numbers:** VRoid's sliders have no number boxes, and labels differ a little
  between versions. So each step says what to aim for, and the game's character viewer
  measures the result for you at the end. Wherever this guide says "VRoid default", leave
  that setting alone.

---

## How we work: one stage at a time

You do the VRoid steps; after each stage you send me a screenshot, and I review it before
the next one. I do everything outside VRoid: textures, the emblem, checking the exported
model in the viewer and in play, and fitting it into the game.

| Stage | You do (in VRoid)                                   | Send me                        | I do                                     |
| ----- | --------------------------------------------------- | ------------------------------ | ---------------------------------------- |
| 1     | Install, create the masculine base                  | front view of the base model   | check the starting point                 |
| 2     | Body proportions (section 3)                        | front and side views           | check the proportions against the sheet  |
| 3     | Face, eyes, brows (section 4)                       | face close-up                  | check the expression                     |
| 4     | Hair (section 5)                                    | front, side, back of the head  | check the silhouette                     |
| 5     | Glasses (section 6)                                 | face close-up                  | check fit and readability                |
| 6     | Pick the outfit items; export their texture layouts | the exported texture PNGs      | paint the kit textures for those layouts |
| 7     | Import my textures, recolour shoes                  | front and back views           | check the kit                            |
| 8     | Export `x1.vrm` (section 10)                        | the file in the private folder | measure, inspect, test in play, tune     |

Only stage 1 needs doing now; the later sections are there for reference.

## 1. Install VRoid Studio (free)

1. Get it from the official page, [vroid.com/en/studio](https://vroid.com/en/studio), or
   from [Steam](https://store.steampowered.com/app/1486350/VRoid_Studio/). Both are free.
   On Steam, install Steam first, sign in, search "VRoid Studio", press **Play** /
   **Install**.
2. **Requirements** (from the Steam page): Windows 10 or 11, or macOS 11 or later; 8 GB of
   memory at least (16 GB recommended); about **10 GB** of free disk space.
3. Start VRoid Studio once and let it finish setting up.

## 2. Start from the male preset

1. Choose **Create New**, then the **masculine** base model.
2. **Save right away:** File → Save As → `captain.vroid`, in your Documents folder, **not**
   inside the game's folder. This is your editable original; keep it. The game only uses
   the exported `x1.vrm`.
3. Save again after every section below.

---

## 3. Body: tall, lean, adult

Open the **Body** tab (everything below the neck). Aim for the body on the design sheet.

| Slider (as VRoid names it, roughly) | Move it                           | Aim for                                                                            |
| ----------------------------------- | --------------------------------- | ---------------------------------------------------------------------------------- |
| Height (masculine)                  | towards the tall end              | a tall man. The viewer checks it later: head joint 1.64–1.68 m (about 1.82 m tall) |
| Head size                           | a little smaller                  | the head fits about **7.5 times** into the height (sheet)                          |
| Head width                          | a little narrower                 | a narrow, adult face                                                               |
| Neck length / thickness             | slightly longer, slightly thinner | a visible neck, not thick                                                          |
| Shoulder width                      | slightly wider                    | shoulders clearly wider than the hips                                              |
| Torso length                        | VRoid default                     | —                                                                                  |
| Chest                               | flat, a little muscle             | athletic, not bulky                                                                |
| Waist                               | narrower                          | a V shape from the shoulders down                                                  |
| Leg length                          | longer                            | the hip joint about halfway up the body (sheet: 51%)                               |
| Arms / hands                        | VRoid default                     | fingertips reach mid-thigh                                                         |

**Check from the side and back as well.** If it looks like a teenager, make the head
smaller and the legs longer. If it looks bulky, reduce the chest and arm thickness.

## 4. Face: sharp, calm, a little intimidating

Open the **Face** tab.

1. **Face preset:** pick the narrowest masculine face with a clear jaw.
2. **Outline / contour:**
   - sharpen the jaw and chin slightly;
   - make the cheeks less round;
   - make the face a touch longer.
3. **Eyes:**
   - shape: **narrower**, with the outer corners slightly **raised**;
   - upper lid lowered a little, so he looks focused rather than sleepy;
   - iris small to medium, colour **`#5B3E28`** (dark hazel), small highlights;
   - eye white VRoid default.
4. **Eyebrows:**
   - straight and **level**, set **close** to the eyes;
   - a little thicker at the inner ends;
   - colour **`#33231A`**.
5. **Eyelashes:** short, masculine; reduce any feminine lash flicks.
6. **Nose:** small and straight, line shading only.
7. **Mouth:** closed and level. If the preset smiles at rest, pick a neutral one.
8. **Skin:** colour **`#F2D5C0`**; shadow tone **`#D9AB91`** if VRoid offers it.

**Test:** at rest he should look calm and serious, like he's reading his opponent. Compare
with the face on the design sheet.

## 5. Hair: brown, layered, swept

Open the **Hairstyle** tab.

1. **Preset:** a **short masculine** hairstyle made of separate pieces (fringe, sides, back,
   crown). Avoid single-piece "helmet" presets.
2. **Colour:** base **`#52382B`**, highlight **`#835C44`**, shade **`#33231A`**.
3. **Shape** (adjust the preset's groups or strands):
   - side part on **his left**;
   - crown laid back and a little to the side;
   - fringe in **4–5 tapering locks**, ending at the top of where the glasses will sit;
   - sides covering the top half of the ears;
   - back tapering neatly to the nape.
4. **Hair swaying:** keep it on the fringe and back, but **stiff** (raise stiffness, lower
   gravity). The prototype's light, floaty hair flared up on crouches and landings.
5. **Avoid:** spikes, very long hair, and copying any anime character's exact hairstyle.

## 6. Glasses: thin and rectangular

1. Open **Accessories** (or the glasses-type hair presets, depending on your version) and
   add **thin rectangular glasses** from VRoid's own items.
2. **Frame colour:** **`#444B55`** (gunmetal). **Lenses:** very light tint, about
   **`#CFE3F0`** at low opacity. You must still see his eyes clearly.
3. **Size:** they should sit level, just below the fringe; lenses about as wide as each
   eye's socket (sheet: about 46 × 28 mm).
4. Use only VRoid's own items or your own textures. Skip third-party "personal use only"
   assets.

## 7. Sportswear: blue and white, original

Open the **Outfit** tab and pick the items first (stage 6). Then, for the shirt and the
shorts, open the **texture editor** (the brush icon next to the item) and **export** its
texture or guide image, and send it to me. I paint the kit onto exactly that layout and
send it back for you to import as a layer (stage 7). Pieces already made, original and
kept out of Git, are in `private-assets/tezuka/textures/`:

- `emblem-1024.png` / `emblem-256.png`: the team crest, with a transparent background;
- `diagonal-panel-overlay-2048.png`: the navy panel with its silver edge;
- `fabric-knit-tile-512.png`: a subtle athletic knit to tile over the shirt;
- `palette.png`: every colour with its hex code.

The design to aim for:

1. **Shirt:** a short-sleeved, fitted athletic top.
   - body royal blue **`#2456B8`**; sleeves and collar band white **`#F4F6FA`**;
   - a **navy `#142747` diagonal panel** from his left shoulder down to his right hip,
     edged with a thin silver-grey **`#A9B4C2`** line;
   - a small **original crest** on the left chest: a white chevron (⌃) on a navy shield.
     No letters, no school name.
2. **Shorts:** short athletic shorts, white **`#F4F6FA`**, mid-thigh, with a navy stripe
   down each side.
3. **Socks:** white crew socks with one thin blue ring.
4. **Shoes:** a trainer preset recoloured: white upper, **navy** heel and toe, light gum
   sole **`#C9A27A`**.
5. **Wristband:** navy, on the **left** wrist (his paddle hand). If there's no wristband
   item, paint it on the arm texture or leave it out.

**Avoid:** copying a real team's or the anime's uniform, logos or lettering.

## 8. Colour palette

| Use           | Hex       |     | Use            | Hex       |
| ------------- | --------- | --- | -------------- | --------- |
| Kit blue      | `#2456B8` |     | Hair           | `#52382B` |
| Kit navy      | `#142747` |     | Hair highlight | `#835C44` |
| Kit white     | `#F4F6FA` |     | Hair shade     | `#33231A` |
| Trim          | `#A9B4C2` |     | Skin           | `#F2D5C0` |
| Shorts        | `#F4F6FA` |     | Skin shade     | `#D9AB91` |
| Glasses frame | `#444B55` |     | Eyes           | `#5B3E28` |
| Lens tint     | `#CFE3F0` |     | Shoe sole      | `#C9A27A` |

## 9. Materials and shading

VRoid exports the anime toon look (MToon) automatically, and the game draws it as it is,
with the court's lights and shadows. What VRoid lets you change here depends on the
version, so:

- **If your VRoid shows shading, rim-light or outline options** for skin, hair or outfit:
  - **outline** thin (the game turns outlines off at lower quality);
  - **rim light** weak;
  - **shade colours** as in the palette: skin `#D9AB91`, hair `#33231A`, kit about 25%
    darker than its base colour.
- **If it doesn't, leave everything at VRoid default.** Shading strength, rim light and
  outline width can be set in the game when the model is integrated, so this isn't work
  for you.

## 10. Export as `x1.vrm` (VRM 1.0)

1. Click the **export** button (camera icon, top right) → **Export** → **Export as VRM**.
2. **VRM version:** choose **VRM 1.0**. The game refuses 0.x.
3. **Reduction settings:**

| Setting                     | Choose                                                                                                                                 | Why                                        |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Delete transparent meshes   | **on** (usually the default)                                                                                                           | hidden parts cost triangles                |
| Reduce polygons             | on, moderate; hair first (it's the biggest)                                                                                            | target **about 40,000 triangles** or fewer |
| Change hair cross-section   | try it only if still over budget, then check the hair and glasses look right                                                           | saves many triangles, can look flatter     |
| Combine hair meshes         | on, if offered                                                                                                                         | fewer draws, no visible change             |
| Reduce materials            | the smallest number that still looks right; start at **4–8** (the game's target is **7 or fewer**). Very low counts can blur the face. | fewer materials draw faster                |
| Texture atlas resolution    | **2048 × 2048** (the default is 4096)                                                                                                  | about 4× less texture memory               |
| Texture quality / downscale | off at first; on only if the viewer says texture memory is well over 32 MB                                                             | keeps the face sharp                       |
| Reduce bones                | keep the hair-swaying bones for the fringe and back; don't remove the finger bones                                                     | the paddle grip needs the fingers          |

4. **Information about the model** (VRoid asks when exporting):
   - **Title:** `Captain (private)`;
   - **Author:** you;
   - **Who may use it as an avatar:** only the author;
   - **Redistribution / modification by others:** not allowed;
   - **Commercial use:** not allowed.
5. **Save as:** `x1.vrm`.

**Budget to aim for** (the viewer measures all of these):

- about **40,000 triangles**;
- **7 materials** or fewer;
- about **32 MB** of texture memory;
- about **6 MB** file;
- **VRM 1.0**, with all fingers.

Don't flatten the face, hair, glasses or kit just to save triangles. If you're a little
over on triangles but it looks right, keep it and tell me.

---

## 11. Put it in the game and look at it

These steps assume the project is on your computer and you normally start it with
`yarn dev`.

1. **Copy the file** to `apps/client/public/models/private/x1.vrm`. Create the `private`
   folder if it isn't there. On Windows, for example:
   `C:\…\pickleballmania\apps\client\public\models\private\x1.vrm`.
   - This folder is kept out of Git, so the model is never uploaded to GitHub.
   - Every player who opens your game can still download it: their browser needs it to
     draw Tezuka.
2. **Restart the game:** stop `yarn dev` (Ctrl+C in its terminal) and start it again. The
   game only notices the file if it is there when it starts. To test Tezuka, set the key
   first:
   - **Windows (PowerShell):** `$env:PICKLEBALL_DEV_KEY='your-long-key'; yarn dev`
   - **macOS:** `PICKLEBALL_DEV_KEY='your-long-key' yarn dev`
3. **Open the character viewer:**
   [http://localhost:5173/?viewer&model=/models/private/x1.vrm](http://localhost:5173/?viewer&model=/models/private/x1.vrm).
   - It only exists in `yarn dev`, never in the shared game, and it never joins a game.
   - With `yarn host` instead, use `http://localhost:4173/?viewer&e2e=1&model=/models/private/x1.vrm`.
4. **Pick the model:** it opens with your file. You can type another path in the box at
   the top and press Enter, or click **m1 (GLB)** to compare with a standard athlete.
5. **Read the numbers** in the panel:

| Panel line      | Should be                   |
| --------------- | --------------------------- |
| estimated bones | **none**                    |
| height (head)   | **1.64–1.68 m**             |
| triangles       | about **40,000** or fewer   |
| materials       | **7** or fewer (+ outlines) |
| textures, ~MB   | about **32 MB** or less     |
| frame           | about 16.7 ms (60 fps)      |

6. **Look at him** with the view buttons: **front, side, back, three-quarter, face** (and
   **wide** for jumps). Drag to orbit and use the mouse wheel to zoom. Compare with the
   design sheet.
7. **Play every animation** from the drop-down: idle, ready, walk, run, strafe left and
   right, backpedal, direction changes, serve, forehand, backhand, dink, volley, smash,
   jump smash.
   - **Pause** and **0.25× / 0.1×** let you look closely.
   - Watch for twisted joints, broken fingers, backward elbows or knees, floating feet, or
     the paddle leaving his hand.
8. **Check paddle contact:**
   - In the stroke animations the yellow ball sits where the paddle should meet it, so the
     paddle must be in his **left** hand with the ball on its face. **Grip axes** shows the
     grip.
   - For numbers, open the browser's developer console (F12) and type
     `__VIEWER__.contacts()`. Every stroke should be under **0.14** (14 cm).
9. **Play for real:**
   - Start screen → nickname **Tezuka**, type your key → **Training**. Hit forehands,
     backhands, serves, and smashes (Shift + swing), plus jump smashes (W + Shift +
     swing).
   - Then open a second browser window as **Bob**, joining a casual room you created as
     Tezuka with **Allow developer abilities** ticked. From Bob's side, Tezuka faces you
     with the paddle on your right (his left).
10. **Change something and try again:**
    - open `captain.vroid` in VRoid, change it, export again over `x1.vrm` (same name and
      place), then **reload** the viewer or game page (Ctrl+Shift+R);
    - with `yarn dev`, replacing the file doesn't need a restart, but adding or removing
      it does; `yarn host` serves a built copy, so restart it after any change.

When he looks right in the viewer and in play, tell me. Fitting him into the game and the
final tuning (C3) come next, after your approval.

## 12. Cleaning up

- When your model works, delete the prototype sample folder
  `apps/client/public/models/private/prototype/`. Every player who opens the game can
  download it, and it isn't the character.
- The browser tests that need a real model skip themselves without the sample. After
  integration they can be pointed at your `x1.vrm`.
- Keep `captain.vroid` safe (outside the repository). It is your only editable original.

## If something goes wrong

| Problem                                          | Try                                                                                        |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| Tezuka still looks like a standard athlete       | the file must be named exactly `x1.vrm` in `…/models/private/`; restart `yarn dev`; reload |
| The viewer says it "could not be used as a body" | export as **VRM 1.0** (not 0.x); export again                                              |
| "estimated bones" lists fingers                  | don't use bone reduction on fingers; export again                                          |
| Looks childish                                   | smaller head, longer legs, narrower face (sections 3–4)                                    |
| Too many triangles                               | more polygon reduction on hair, or "change hair cross-section"                             |
| Face looks blurry                                | more materials (for example 8), atlas 2048, texture downscale off                          |
| Paddle misses high balls                         | he may be too short: raise Height; check "height (head)" is at least 1.64 m                |
| Hair flies up when he crouches                   | stiffer hair swaying, less gravity (section 5)                                             |

## Sources

- [VRoid Studio](https://vroid.com/en/studio)
- [VRoid Studio on Steam](https://store.steampowered.com/app/1486350/VRoid_Studio/) (free,
  Windows and macOS, about 10 GB)
- [Getting Started with VRoid](https://vroid.pixiv.help/hc/en-us/articles/4405597663385-Getting-Started-with-VRoid)
  (the Body tab covers everything below the neck: height, shoulders)
- [Head size and limb length](https://vroid.pixiv.help/hc/en-us/articles/360014785994-Adjust-the-parameters-to-easily-create-a-SD-character)
- [Steam discussion on the height sliders](https://steamcommunity.com/app/1486350/discussions/0/594021343914179397/)
  (range sliders with no number inputs)
- Export options, from creators' write-ups:
  [delete transparent meshes](https://note.com/melvina/n/ne2e8752f75d8?hl=en),
  [VRM export settings](https://note.com/vsrx/n/n23cd17ccde7e?hl=en),
  [VRM 1.0 export notes](https://note.com/151_151/n/n4cea31260931?hl=en),
  [lightening VRoid files](https://tips.clip-studio.com/en-us/articles/9053)
