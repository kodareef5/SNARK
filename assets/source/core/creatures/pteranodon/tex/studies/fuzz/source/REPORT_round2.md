Round 2 rebuild: `fuzz`, `fuzz_face`, and `mantle_edge` have all been replaced. The names, 2048-square maps, physical tile spans, top-to-bottom lie, region IDs, 0.50 linear means, and encoded height scales are preserved. This report supersedes the earlier visual assessment, which used the inward-facing egg. I reran the corrected shared renderer on both the old delivery and this revision.

The selected new source is [source/fuzz_laid_round2.png](source/fuzz_laid_round2.png), made with the built-in image generation tool using our `head_side.png` and `saddle_detail.png` references. Its exact prompt is [source/prompt_fuzz_laid_round2.txt](source/prompt_fuzz_laid_round2.txt). The untouched result is 1254 square. Two further trials are retained: `fuzz_short_round2.png` became too raised and clumpy on the corrected egg, and `fuzz_flat_round2.png` lost too much lock grouping. All originals, prompts, dimensions, selection notes and hashes are in [source/manifest.json](source/manifest.json). No outside reference images or Blender were used.

The selected drawing has gently curving, lying filaments collected into uneven overlapping locks. The base retains their pale tips and darker roots and partings. The build now removes only much broader illumination; the former filtering discarded useful lock-scale value. Height carries a soft lock bed with restrained fine fibre relief. The body and face share the same drawing, with the face at half its physical size and half its height.

The old fixed patch step has been replaced with unequal patch sizes, staggered row boundaries, independently varied sampling scale and angle, and horizontal flips. Minimum-error cuts join overlaps and close both wraps. Every placement is recorded in [synthesis.json](synthesis.json). The generated source is reduced to 78% before synthesis, without enlarging its native detail. `build.py --scale NUMBER --direction-deg NUMBER` retains the painter's scale and direction controls.

| Set | Span / density | Strand and lock calibration | Encoded height / actual relief | Mean linear grey |
|---|---|---|---|---|
| `fuzz` | 0.5 m / 4096 px/m | strands 6–12 mm; locks 10–30 mm | 0.80 / 0.543 mm | region 5: 0.500001 |
| `fuzz_face` | 0.25 m / 8192 px/m | strands 3–6 mm; locks 5–15 mm | 0.40 / 0.271 mm | region 5: 0.500001 |
| `mantle_edge` | 0.5 m / 4096 px/m | same pile as `fuzz` | 0.80 / 0.543 mm | region 0: 0.500002; region 5: 0.500003 |

These length ranges are visual calibration targets for a generated, overlapping pile, not an exhaustive segmentation of each filament. Connected overlapping locks can read as a longer flow. The height range measures relief above the surface, not the length of a lying hair.

| Delivered layer, all three sets | How made |
|---|---|
| `*_base.png` | Generated source edited by script: neutral value extraction, broad light removal, irregular synthesis, retained tip/root contrast, per-region linear normalization. RGB, 8-bit sRGB. |
| `*_height.png` | Computed shallow fine-fibre and soft lock relief from the aligned source field. Greyscale, 16-bit. |
| `*_normal.png` | Computed from the delivered quantized height, physical span and height range, using wrapped central derivatives. OpenGL +Y up. |
| `*_packed.png` | Computed from height: restrained concavity occlusion, dry roughness, zero metalness. Occlusion 0.949–1; roughness 0.875–0.941. |
| `*_regions.png` | Computed pure categorical colours. Yellow body/face; red upper mantle and yellow lower body. Mantle contours follow the actual generated lock and filament field. |

The mantle no longer adds a separate row of equal-length fringe hairs. Its main boundary wanders **50.6 mm peak to peak**, with a **19.5 mm local 5–95% interleaving band** measured after subtracting that wandering. Both colours enter the same lock field, so the region tips follow the delivered base and relief. The quieter second boundary near the wrap uses the same method at reduced amplitude. The global row-coverage width is 45.7 mm; this includes the wandering and must not be confused with the local overlap width.

The aligned library has been rebuilt: four 256-square body patches and two new mantle patches, each with all five layers. All 30 layer crops were checked pixel-for-pixel against their parent maps. Every patch spans 62.5 mm, and [elements/elements.json](elements/elements.json) records its box, source, scale and height range. They are rectangular painting patches, not independent seamless tiles or isolated hair cutouts.

I inspected the corrected game's [fuzz sheet](checks/look/fuzz.png), [face sheet](checks/look/fuzz_face.png), and [mantle sheet](checks/look/mantle_edge.png), including both 0.5 m views, 1.5 m and 5 m, in design, loud, dark and pale dyes. At 0.5 m the new pile shows fine strands and irregular soft locks without the former even crimp. At 1.5 m the lock grouping remains visible on the ivory egg. At 5 m it settles to a calm tone with slight grain. The mantle now wanders in groups and has varied interleaving tips. The extra hot-pink and near-black sheets, including 20 m, were also rendered and inspected.

The required [concept comparison](checks/concept_at_scale.png) puts ivory base and **actual game-shader relighting** beside neck crops from both concepts at 1,000 and 2,000 px/m. [compare_game.ts](compare_game.ts) renders a calibrated flat plane with the same pack reader, rgba mips, palette, surface shader and noon sky as `look.ts`; these panels are not substitutes made with Python Lambert shading. The head reference is native about 1,000 px/m and explicitly labelled when enlarged. The saddle reference is treated as nominal 2,000 px/m. [face_at_scale.png](checks/face_at_scale.png) compares the face beside both delivered scales; the face remains denser and shorter while retaining the same character. [original_base_relit.png](checks/original_base_relit.png) checks the selected source, base and Python relight at matching physical scale.

All numerical checks pass; full results are in [measurements.json](measurements.json) and [engine_measurements.json](engine_measurements.json).

| Check | Round 2 result |
|---|---|
| Sizes / height encoding | Fifteen 2048-square maps; genuine 16-bit height |
| Neutrality / invalid region pixels / metalness | Exact R=G=B / zero / zero |
| Largest quarter-mean spread | 0.597%, below 2% |
| Largest base/light correlation, 32 directions | 0.0492 |
| Game height/normal correlation | X 0.99968; Y 0.99838 |
| Normal length | Mean 1.00056; maximum error 0.00517 |
| Game seam ratios, continuous layers | 0.921–1.109, below 1.3 |
| Maximum internal shifted-image correlation beyond the local lock neighbourhood | 0.0296; horizontal 0.0239 |

I also inspected native detail, half offsets, 3×3 repeats, animal-density reductions and one-tenth-density reductions. I found no standing columns or short internal repeating motif. The shifted-image correlation excludes the immediate neighbourhood and the full-tile periodicity; it supports that inspection rather than proving that repetition can never be found.

Rebuild and verify from the pteranodon folder:

```sh
python3 tex/studies/fuzz/build.py
bun tex/studies/fuzz/compare_game.ts
python3 tex/studies/fuzz/check.py
bun tex/studies/look.ts tex/studies/fuzz
bun tex/studies/fuzz/check_game.ts
```

Remaining limits: the painted concept has warmer, broader individual strokes than this finer photographic pile. Near-black still suppresses much of the finest detail under the game's lighting. These maps provide surface pile, not silhouette hairs. The egg's UV poles pinch the texture and expose the quieter wrap boundary in the second mantle view; the final animal still needs its own direction field and UV review. The scale comparisons retain the concepts' original form lighting rather than trying to remove it.

Elapsed work for this revision: approximately 20 minutes, including three source generations, corrected-renderer iterations, all three map rebuilds, exact-scale game comparisons, numerical checks and the refreshed library. The final build took about 13 seconds.
