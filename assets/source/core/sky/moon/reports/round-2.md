## Round two: repainted face (current delivery)

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
