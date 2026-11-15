# The moon's face

## Round five: three local retouches from round three (current delivery)

Restarted from **`originals/round-08.png`**, which reproduces the exact round-three sprite in `iterations/round-4-baseline/moon.png`. Round four is rejected. Its incoming files and scripts are preserved in `iterations/round-5-baseline/`; its comparison remains untouched.

### What went wrong in round four

The six successive whole-image edits carried unintended changes forward: extra directional texture in the seas, relief-like shading and a bright outline around Serenitatis, dotted mountain highlights, and narrow radial ray cores. The previous report accepted those changes too readily. Passing format and contrast checks did not establish that the painting had improved. This pass uses round three as a fixed base, with a direct full-resolution comparison after each local change.

### What changed and why

1. **Eastern shorelines.** Smoothed the repeated scallops around Serenitatis, Tranquillitatis, Fecunditatis, Nectaris and Crisium. Selected new paint only within a feathered band extending at most 13 pixels from the original boundaries. Serenitatis and Crisium retain simple basin curves; the other three retain asymmetric inlets and softer sections. Serenitatis's pale centre is exactly the original paint. No bright rim was added.
2. **Imbrium's southeast edge.** Replaced its projecting lobe with a gentle curved transition into the brighter central terrain. The pale band merges into the neighbouring highlands and loses its ends. It contains no separate white dots. The deep upper-left floor and western connection remain round three.
3. **Two Tycho extensions.** Continued one faint, uneven trail northwest into the western plain and another northeast into lower Tranquillitatis. Only their distant portions receive new paint. The crater and everything within a 51-pixel radius remain exactly round three, keeping the existing irregular ray origins. The extensions have soft edges and no narrow white cores.

All three image calls used **the built-in image tool**, each independently editing `originals/round-08.png`. Their untouched outputs are `originals/round-15.png` through `round-17.png`; hashes are recorded in the manifest. Exact prompts and inputs are in `prompts.md` and the three iteration folders.

`scripts/retouch_round5.py` selects the relevant generated paint over the reproduced base. The Imbrium selection protects the corrected shores. At a shoreline crossing, the ray pass adds only the generated difference from round three, preserving the earlier shore correction. Selection masks do not synthesize surface details. No round-four image pixels enter the build.

### Inspection and preservation

Inspected the cumulative result against round three at **native 512, 32, 48 and 64 pixels after each stage**, and again after protecting overlapping selections. Each stage retains its comparison, masks, sprite, check sheet and review in `iterations/round-17-local-shores/`, `round-18-local-imbrium/` and `round-19-local-rays/`. The final comparison is **`iterations/round-5-comparison.png`**, with both full 512-pixel discs and native small sizes.

At 512, the shore repetitions are removed, Imbrium has a clearer curve, and the two distant streaks remain subordinate to the crater. The 32/48-pixel face retains its clear dark seas and pale southern ground. No small-size regression was observed. The extensions are deliberately subtle; they mostly merge into the ground at player sizes.

**Every pixel outside the three selection areas is identical to round three.** Of visible pixels, 78.66% are completely unchanged; only 8.70% change by more than three 8-bit channel levels. The sampled Imbrium, Serenitatis and Tranquillitatis interiors and both highland patches are unchanged. The western sample crossed by a ray rises from 155.57 to 160.91 sRGB luma. The sea/highland linear-luminance ratio is 0.469 at 512 (round three: 0.463), 0.462 at 32 (0.454), and 0.467 at 48 (0.460). These support the visual check; they do not measure painting quality.

### Format and rebuild

**512 × 512 RGBA, embedded sRGB profile.** The alpha channel is identical to round three: opaque interior, symmetric antialiased circle tangent to all four edges, transparent exterior. Its original 97.5% source crop, tonal finish and colour balance are retained; no global adjustment follows the local edits. The outer band averages **224.17 sRGB luma**, versus 224.18 in round three.

Alpha-weighted mean encoded sRGB: **R 195.37, G 193.91, B 193.96**, approximately **#C3C2C2**. Mean linear RGB: **0.57684, 0.56561, 0.56415**.

```sh
python3 scripts/build_moon.py
python3 scripts/check_player_sizes.py
python3 scripts/validate_moon.py
```

All **18 checks pass**, including deterministic reproduction, correspondence with the reviewed sprite/check sheet, source hashes, preserved pixels outside selections, unchanged Serenitatis centre and Tycho surroundings, and all format checks. Rebuilds use local files only.

### Rounds, time and remaining limitation

**Three successful image calls and three reviewed stages** in round five; **17 successful calls and 19 reviewed stages** across the five deliveries. Tracked work took **13 minutes 03 seconds**, from the first clock reading at **2026-11-15 00:21:33 UTC** to **2026-11-15 00:34:35 UTC**. Initial file discovery preceded that first reading; see `session-round-5.json`.

The result remains a stylized lunar painting. The remaining practical limitation is inspection on the specified night blue rather than inside the game's tint, phase and atmospheric shader. Further broad repainting would exceed this pass's scope, so this delivery stops with the three local corrections.

---

## Round four: basin curves, Imbrium and long rays (rejected delivery)

The final `moon.png` and `check.png` are rebuilt from **`originals/round-14.png`**. This section supersedes the round-three assessment. The exact incoming delivery, report and scripts are preserved in `iterations/round-4-baseline/`.

### What changed and why

1. **Removed the eastern scallops.** Serenitatis now has a continuous, nearly round basin boundary around its retained pale heart; Crisium has a clean oval boundary. Tranquillitatis, Fecunditatis and Nectaris use longer, asymmetric shoreline curves and shallow inlets instead of rows of rounded protrusions. A separate paint pass partially lost their western and southern margins into the highlands, so these seas combine firm basin-held edges with soft, uneven transitions where the lava thins. The broad sea locations and distinct interior tones remain.
2. **Recovered Imbrium's southeastern curve.** Added a pale, irregular mountain belt descending beside Serenitatis and sweeping southwest above Copernicus. This makes the upper-left basin's curved edge visible against the centre. The arc stays open toward the west, where Imbrium still joins Procellarum's mottled, streaked plain and its fading western margin. It is a painted belt of bright terrain, without a dark shadow or a complete enclosing ring.
3. **Lengthened Tycho's rays.** Three unequal streaks now run far across the south: north-northwest through Nubium into the western plain, northeast through the highlands into Tranquillitatis, and more faintly east-northeast toward Fecunditatis. Their visible reach is roughly one-third to one-half of the disc diameter. Tycho remains a small bright spot. The first extension had overly thin bright centres; the next edit faded too much of the rays and was rejected. The selected final edit keeps the long reach with softer, less intense centres and faint surrounding wisps. Copernicus's diffuse splash remains.

### Inspection and small-size read

**Checked native 32, 48, 64 and 512 pixels after every paint edit**, before proceeding to the next. Each of the six reviewed versions retains its `check.png`, metrics, contrast samples, prompt and review under `iterations/round-11-shores/` through `iterations/round-16-balanced-rays/`. The selected version was also compared with the exact round-three delivery at 32/40/48/64 in `iterations/round-4-comparison.png`.

At 32 and 48 pixels the dark western field, eastern basins and separate Crisium still carry the face immediately. The curved mountain belt clarifies the upper-left sea; the southern rays remain subordinate at these sizes. At 512 the smoother shorelines, varying edge softness and long rays are visible. Procellarum's mottling and western fade, Serenitatis's pale middle and the bright southern ground survive.

The same five sea patches average **163.52 sRGB luma**, versus **160.62** before; the two highland patches average **225.37**, versus **228.07**. Their linear-luminance ratio is **0.495**, versus **0.463**. At **32 pixels** it is **0.485**, versus **0.454**; at **48 pixels**, **0.493**, versus **0.460**. These samples show a modest contrast change through repainting, while the visual comparison retains a clear dark-sea face. They measure fixed painted patches, not lunar reflectance. Coordinates and full measurements are in `iterations/round-16-balanced-rays/validation.json`.

### Format, mean and reproducibility

**512 × 512 RGBA with embedded sRGB profile.** The symmetric, antialiased circular alpha is unchanged, opaque inside and tangent to all four edges, with no exterior halo. The outer 95–99.5% radius band averages **224.79 sRGB luma**, versus **224.18** before; the edge remains bright.

Alpha-weighted encoded sRGB mean: **R 194.52, G 193.82, B 193.88**, approximately **#C3C2C2**. Mean linear RGB: **0.57147, 0.56644, 0.56718**.

The finish retains mean target **194**, contrast **0.95**, and chroma multiplier **0.45**. The fitted source radius retained is now **97%**, versus 97.5%: the initial long-ray source's irregular translucent fringe reached the old crop, so a half-percentage-point inward adjustment was needed. The selected source's minimum sampled alpha is **0.9843**. Premultiplied source sampling, 2× working resolution and the 8×8 rim coverage mask remain unchanged. The build adds no procedural shorelines, mountains, rays, texture or spatial lighting.

```sh
python3 scripts/build_moon.py
python3 scripts/check_player_sizes.py
python3 scripts/validate_moon.py
```

All **13 delivery checks pass**: exact pixel reproduction, correspondence with the selected review and check sheet, dimensions/mode, decoded sRGB profile, circular symmetric coverage, opaque interior, no alpha outside the disc, all four edge contacts, near-grey mean, bright rim and original-source hashes. All **six new raw image outputs** are preserved unchanged as `originals/round-09.png` through `round-14.png`. Their hashes are in `originals/manifest.json`; every prompt and input is in `prompts.md`. All edits used the **built-in image tool**, with only our own paintings as image inputs.

### Rounds, time and remaining reservations

**Six successful image edits and six reviewed versions in this delivery**, including the rejected over-softened ray version. Across all four deliveries: **14 successful image calls and 16 reviewed versions**. Tracked round-four work took **12 minutes 41 seconds**, from **2026-11-15 00:07:31 UTC** to **2026-11-15 00:20:13 UTC**; see `session-round-4.json`.

The requested shoreline, Imbrium and ray corrections are addressed in the selected painting. Geography remains a painted simplification, and the finest rays merge into the highlands at 32 pixels. The remaining practical limitation is that this has been checked on the required night blue, not inside the game's tint, phase and atmospheric shader.

---

## Round three: sea paint and restored ejecta (previous delivery)

`moon.png` and `check.png` now come from **`originals/round-08.png`**. Three successful built-in image edits improved the close view while retaining the dark face at player sizes. A fourth, shoreline-only refinement was **blocked by image-service authentication**; some rounded shoreline sections remain. The exact previous delivery is preserved in `iterations/round-3-baseline/`.

### What changed and why

1. **Distinct seas rather than one grey fill.** Serenitatis has a paler interior within an irregular darker margin. Tranquillitatis is deeper and cooler. Imbrium has a dark floor with lighter painted streaks; Procellarum has broad, quieter mottling and a western boundary that blends into the highlands. Crisium and the southeastern seas have their own subdued variations. A second pass softened excessive matching diagonal bands in the eastern seas. The source retains visible brushwork rather than photographic surface detail.
2. **Mixed shore edges.** The western plain now loses its boundary into the pale ground, while basin-held curves remain firmer. The cut-out impression is reduced by this transition and by interior paint. Some central and eastern boundaries still retain rounded lobes. A final edit specifically targeting those remaining scallops returned **HTTP 401 `token_revoked`**, with no image. I kept the last successful painting rather than claiming that edit had happened. A CLI fallback exists but requires `OPENAI_API_KEY` and explicit authorization; it was not used.
3. **Tycho's rays restored.** Long, uneven light streaks now cross Nubium and reach into the western plain, with softer wisps over the southern highlands. The first ray pass made too many bright threads; the third successful repaint removed most of that web and softened the surviving rays below the crater's brightness. The southern ground is calm again. Copernicus now has a wider diffuse splash around its small bright core. No crater rings were reintroduced.
4. **Player-size face retained.** I inspected **32, 48, 64 and 512 pixels after every successful repaint**, then compared against round two at native 32/40/48/64 sizes. The western dark field, upper-right basins and isolated Crisium still carry the face; the fine paint and ejecta become visible as the disc gets larger. `iterations/round-3-comparison.png` records that comparison.

The same five fixed sea patches now average **160.62 sRGB luma**, versus **151.45** in round two; two highland patches average **228.07**, versus **231.81**. The main deliberate lift is Serenitatis's middle (**188.78**, versus **149.25**); the other four sea samples remain about **151–156**. Combined sea/highland linear-luminance ratio is **0.463**, versus **0.387**. At 32 and 48 pixels the corresponding sample ratios are **0.454** and **0.460**, still below half. These are checks of painted patches, not measured lunar reflectance or a substitute for looking at the small discs. Full coordinates, variation and before/after measurements are in `iterations/round-10-refinement/validation.json`.

### Format, mean and rebuild

**512 × 512 RGBA, embedded sRGB profile**, with the same symmetric, antialiased circular alpha, fully opaque interior and contact with all four image edges. Bright to the rim, no external halo. The fitted crop still retains 97.5% of the original radius; premultiplied source sampling, 2× working resolution and 8×8 rim coverage are unchanged.

The global finish keeps mean luma **194** and chroma multiplier **0.45**, reducing contrast from **1.05 to 0.95** because the richer source paint otherwise pushed pale highland detail too close to white. No spatial lighting, generated noise, procedural shorelines or procedural rays were added in the build.

Alpha-weighted encoded sRGB mean: **R 195.13, G 193.68, B 193.78**, approximately **#C3C2C2**. Mean linear RGB: **0.57559, 0.56430, 0.56300**. The outer 95–99.5% radius band averages **224.18 sRGB luma**, essentially unchanged from round two's 224.26.

```sh
python3 scripts/build_moon.py
python3 scripts/check_player_sizes.py
python3 scripts/validate_moon.py
```

Rebuilds are local and deterministic. All **13 delivery checks pass**, including exact reproduction of the reviewed pixels, check-sheet correspondence, decoded sRGB profile, circle coverage, opaque interior, no alpha outside the rim, edge contact, near-grey mean and preservation of every original's hash. The validation script is retained with the build scripts.

All three new raw generated images are preserved unchanged in `originals/round-06.png` through `round-08.png`, with hashes in `originals/manifest.json`. All prompts, image inputs and the failed attempt are recorded in `prompts.md`. Only our own paintings were supplied to the built-in image tool; no photograph or map pixels were used.

### Rounds, time and remaining reservations

**Three successful repaint/review rounds** this delivery: sea paint (`round-08-seas`), initial rays (`round-09-rays`, rejected for excessive streaks), and restrained rays (`round-10-refinement`, selected). This makes **ten reviewed versions and eight successful image calls across the three deliveries**. One additional image call failed before producing an output.

Tracked round-three work took **8 minutes 26 seconds**, from **2026-11-14 23:57:36 UTC** to **2026-11-15 00:06:02 UTC**; see `session-round-3.json`.

The unresolved issue is the remaining rounded simplification of some central/eastern shorelines, which the failed final edit was intended to address. Imbrium's brushwork still has a noticeable inclined direction. Tycho's fine rays mostly merge into the southern ground at 32 pixels, while the dark face remains the primary cue. The painting has been inspected on blue but not inside the game's tint, phase and atmospheric shader.

---

## Round two: repainted face (previous delivery)

`moon.png` and `check.png` now use **`originals/round-05.png`**. This section supersedes the first-delivery assessment. The user's inspection was right: the earlier painting had weak sea/highland separation, cut-paper shorelines, spoke-like ejecta and relief-style crater rings. Its previous report overstated the small-size read and the quality of the rays.

### What changed and why

1. **The face comes first.** Repainted the seas in darker, quieter cool grey against clean pale ivory highlands. Lowered the global mean from roughly 206 to 194 instead of lifting the seas back toward the ground. Five fixed patches inside Imbrium, Procellarum, Serenitatis, Tranquillitatis and Crisium now average **151.45 sRGB luma**, versus **184.88** before. Two southern highland patches average **231.81**, versus **224.18** before. Their sea/highland ratio is **0.39 in linear luminance**, versus **0.65** before. These are samples of this painting, not measurements of lunar reflectance; coordinates and individual values are in `iterations/round-07-finish/validation.json`.
2. **Broad lava plains.** Replaced fragmented shores with smoother, softly irregular pools, filled small bright holes, and let the western seas flow together. Imbrium retains its broad northern curve; Serenitatis and Crisium remain rounded. Sea interiors are much quieter. The few substantial highland interruptions remain for the face's geography.
3. **Ejecta painted as light.** Erased ring centres and straight spokes. Copernicus is a small bright splash with a short diffuse spray; Tycho is a tiny pale fleck within a grey collar, with faint, uneven, partly lost wisps. A second image edit reduced the first repaint's overly organized ray fan and broad diagonal streaks.
4. **Full-sun surface.** Removed repeated circular crater rims and shadow-like holes. Fine pale mottling and sparse luminous flecks describe the highlands. No synthetic crater geometry, procedural rays, photographic pixels or added noise were used.

Both paint passes used the built-in image generator, starting from our own previous painting. All five original outputs remain unchanged in `originals/`; the manifest verifies their hashes. The exact two new prompts and image inputs are appended to `prompts.md`. No photograph was supplied to the generator.

### Rebuild and preserved format

The build retains the fitted circular crop, premultiplied source sampling, 2× working resolution and 8×8 coverage mask. The crop keeps **97.5%** of the fitted radius, versus 98% before: the additional half-percent excludes the new source's stray transparent fringe. The delivered disc fills the square and touches all four edges. Generated near-opaque interior pixels are made fully opaque; only the antialiased boundary is partially transparent. RGB extends invisibly beneath zero alpha to prevent a dark filtering seam.

The final global finish uses **mean luma 194, contrast 1.05 and chroma multiplier 0.45**. The initial 1.20 contrast review pushed the brightest highland paint too close to white; the final finish retains more pale texture while keeping the dark face. There is no spatial or radial lighting adjustment. Slight ivory/cool-grey differences survive, with an almost neutral mean.

**Final asset:** 512 × 512 RGBA, embedded sRGB profile. Alpha-weighted encoded sRGB mean **R 195.07, G 193.79, B 192.82**, approximately **#C3C2C1**. Mean linear RGB **0.57597, 0.56559, 0.55683**. The outer 95–99.5% radius band averages **224.26 sRGB luma**; the rim remains bright. Full statistics are in `metrics.json`.

```sh
python3 scripts/build_moon.py
python3 scripts/check_player_sizes.py
```

The first command rebuilds the sprite, `check.png` and metrics from `originals/round-05.png`, without network access. The second rebuilds the 32/40/48/64 strip and before/after comparison. The previous final sprite, check, report, metrics and build script are preserved under `iterations/round-2-baseline/`.

### Inspection, checks and rounds

**Three additional review rounds: two generated repaints and one local tonal finish. Seven review rounds and five image-generator calls across both deliveries.**

- `iterations/round-05-repaint/`: removed rings and lace, strengthened the face; still had too much diagonal highland paint and an organized ejecta fan.
- `iterations/round-06-surface/`: calmed the ground and softened the ejecta; reduced the finishing contrast afterward to retain highlight detail.
- `iterations/round-07-finish/`: archived the final reviewed pixels, metrics and validation results.

Inspected final `check.png` at native size: **32, 48, 64 and 512 pixels** on **#09172E**, plus the supplementary **40-pixel** disc. The connected western dark field, upper-right basin and separate Crisium now carry the miniature face. The south stays pale; the craters are small light accents. At 512, there are no repeating crater rings or straight drawn spokes. Ejecta remains subordinate to the seas.

`iterations/round-2-comparison.png` shows the previous and new assets at native 32/40/48/64 sizes, with 256-pixel detail views. `check.png` remains the required full 512-pixel review sheet.

Verification passed for dimensions and mode, decoded sRGB ICC profile, exact pixel reproduction from the selected original, exact correspondence between sprite and check sheet, symmetric circular alpha, fully opaque interior, zero alpha beyond edge coverage, and contact with all four image edges. Original source hashes are unchanged. There is no painted halo or limb darkening.

### Time and remaining reservations

Round two took **8 minutes 32 seconds**, from **2026-11-14 23:47:44 UTC** to **2026-11-14 23:56:15 UTC**, including two repaint calls, rebuilds, inspection, finishing and documentation. Timing and call counts are recorded in `session-round-2.json`.

The geography remains a painted simplification, especially the northern band and smaller southeastern seas. Highland grain is still more uniform than an entirely hand-painted surface. Tycho's faint wisps mostly merge into the highlands at 32 pixels; Copernicus's splash and the sea shapes are stronger small-size cues. The asset has been checked on blue, not inside the game's tint, phase and atmospheric shader.

---

## First-delivery record: superseded by round two

Delivered `moon.png`: **512 × 512, 8-bit RGBA, embedded sRGB profile**, straight alpha. A north-up painted near-side Moon, tangent to all four image edges, with a fully opaque interior and a clean antialiased circular boundary. No added halo, phase, directional lighting, or limb darkening.

### How it was made

Three built-in image-generator calls: one original painting, followed by two edits. Every raw output is preserved unchanged in `originals/`; `originals/manifest.json` records their SHA-256 hashes. Every generation/edit prompt and its image inputs are in `prompts.md`. No lunar photograph or map was supplied to the image generator or used as texture pixels.

The broad geography and two ray-crater choices were informed by NASA's [Moon viewing guide](https://science.nasa.gov/moon/viewing-tips/) and [Moon maps](https://science.nasa.gov/moon/observe-the-moon-night/moon-map/), using text guidance. Imbrium/Procellarum occupy the upper-left and west, Serenitatis/Tranquillitatis the upper-right, Crisium remains separate, and the southern highlands carry Tycho's rays. Copernicus supplies the western accent.

`build_moon.py` fits a circle to the main generated disc, crops about 2% of its irregular outer fringe, samples its colour at twice the delivery resolution, and downsamples to 512. It replaces the slightly translucent generated interior with opaque alpha and uses 8 × 8 coverage sampling for the rim. RGB extends invisibly beneath transparent pixels to avoid a black filtering fringe. The finish applies one global tonal adjustment, keeping 90% of the source's luminance contrast and 22% of its colour deviation from grey. No synthetic craters, random texture, regional lighting, or photographic detail were added.

### Inspection and rounds

**Four review rounds: three generated paintings plus one final tonal/alpha finish.**

1. First painting: readable small; rejected for scalloped, separate-looking sea patches and overly regular rays.
2. First edit: finer rays and calmer paint; Nubium still too round and enclosed.
3. Second edit: irregular Nubium, better connections, removed the extra southern spot. Selected as the source.
4. Final finish: lighter, gently compressed values and neutral colour. Accepted after inspecting 32, 40, 48, 64 and 512 pixels.

`check.png` places actual 32, 48, 64 and 512-pixel discs side by side on deep night blue **#09172E**. View at 100%; a scaled viewer changes the apparent sizes. `iterations/player-size.png` also includes 40 pixels. All four rounds retain their check images, metrics and review notes in `iterations/`.

At player sizes, the broad maria read before the smaller brushwork; the bright southern field and two fine ray accents survive without black blotches. At 512, scumbled paint and sparse crater arcs remain visible. The edge stays bright without an outline or external glow. Dimensions, RGBA mode, profile, alpha symmetry and matching pixels between the reviewed image and final build were checked.

### Mean colour

Alpha-weighted mean of the visible disc, in encoded sRGB 0–255: **R 206.50, G 205.88, B 205.70**, approximately **#CFCECE**. This is nearly neutral with a very slight warm bias. Mean linear RGB is **0.62865, 0.62432, 0.62301**. Full metrics are in `metrics.json`.

The central half-radius has mean sRGB luma 202.69; the outer 95–99.5% radius band is 221.08. The highland-dominated rim is bright, with no darkening toward the edge. These statistics describe the painted geography, not a lighting curve.

### Rebuild

From this folder, using Python 3 with Pillow, NumPy and SciPy:

```sh
python3 scripts/build_moon.py
python3 scripts/check_player_sizes.py
```

The first command recreates `moon.png`, `check.png` and `metrics.json` solely from `originals/round-03.png`. It needs no network or generation service. The second recreates the supplementary player-size strip. Processing takes roughly a second on this machine.

### Time and remaining reservations

**11 minutes 21 seconds elapsed**, including generation, scripting, inspection, revision and documentation. Started 2026-11-14 23:34:37 UTC; completed 2026-11-14 23:45:58 UTC.

The major features are recognisable, but shorelines and the small craters remain artistic approximations. A few eastern mare edges are more angular than I would paint by hand. At 32 pixels, the finest Tycho rays merge into the southern light area; they separate more clearly at 48–64. The asset has been checked as a sprite on blue, not inside the game's actual shader with its tint, phase and atmospheric fade.
