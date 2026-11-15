Round 4 delivery, responding to **FEEDBACK_3.md**: visible pale strand tips and darker roots return at 0.5 m, while the egg remains calm at 1.5 m. The new drawing uses straighter, occasionally crossing filaments. Broad lock shading stays subdued. The mantle has unequal dark reaches and fewer pale overlaps, with individual shafts thinning out through the transition. Names, spans, 2048-square layers, top-to-bottom lie, region IDs and encoded height ranges are unchanged. All five `fuzz_face` pictures are pixel-identical to `fuzz`; its half-sized span and height range supply the shorter physical scale.

The main evidence is the [rounds 2 / 3 / 4 game comparison](checks/round2_round3_round4_fuzz.png), shown at native screen pixels, and the [concept comparison](checks/concept_at_scale.png). I inspected both 0.5 m views and the 1.5 m view beside the two reviewed deliveries, then the neck at 1,000 and 2,000 px/m. At 0.5 m the new pile has distinct light shafts over darker gaps, rather than round 3's faint scratches. At 1.5 m it has fine grain over form shading, without round 2's cauliflower-sized clumps. At 5 m it is an even tone. The previous deliveries are retained in `checks/round2_baseline/` and `checks/round3_baseline/`; the previous report is preserved as [REPORT_round3.md](source/REPORT_round3.md).

The new original, [fuzz_strands_round4.png](source/fuzz_strands_round4.png), was generated with the **built-in imagegen tool**, using our concept neck, the straight round 3 trial and round 2's articulated fur as references. Its [exact prompt](source/prompt_fuzz_strands_round4.txt), untouched 1254-square original, reference list and SHA-256 are recorded in [manifest.json](source/manifest.json). No outside references or Blender were used.

`build.py` scales the source to 78%, removes broad illumination and synthesizes the tile from irregular patches. Patch widths now range from 240–510 pixels and heights from 270–520, with independent samples, small rotations, unequal scale and no mirroring. The source already lies down the image, so the previous 12.07-degree correction is removed. No periodic warping is added. The [native comparison](checks/round2_round3_round4_fuzz_native.png), full half-offset and 3×3 proofs show irregular changes in lie, without the old regular 170-pixel columns. A local check over sixteen 512-pixel crops finds maximum correlation at horizontal lags 140–200 pixels of **0.082**, compared with **0.216** in round 3. This supports visual inspection; it is not a perceptual pass score. Details are in [column_check.json](checks/column_check.json), reproduced by `check.py`.

Fine strand value and lock value remain separate: the former has gain 2.3, the latter 0.3, split at a 6-pixel Gaussian sigma. Relief is shallow and comes from the aligned source, with most strand definition in the base. [Original / delivered base / relit](checks/original_base_relit.png) shows the generated shaft drawing retained at matching physical scale.

| Supporting comparison | Round 2 | Round 3 | Round 4 |
|---|---:|---:|---:|
| Base 0.5 mm band standard deviation, linear | 0.04282 | 0.02473 | 0.06167 |
| Base 5 mm band standard deviation, linear | 0.01956 | 0.00111 | 0.00170 |
| Game 0.5 m interior texture band | 0.04461 | 0.01635 | 0.04027 |
| Game 1.5 m interior texture band | 0.02252 | 0.01144 | 0.01212 |

The game measurements use identical camera crops with broad shading removed; definitions are in `check.py` and values in [round4_comparison.json](checks/round4_comparison.json). Close-view texture contrast is about 90% of round 2 and 2.46× round 3. At 1.5 m it is only about 6% above round 3. These support the requested balance without claiming that equal contrast means equal material character.

| Set | Span / study density | Encoded height / actual relief | Mean grey, linear |
|---|---|---|---|
| `fuzz` | 0.5 m / 4096 px/m | 0.80 / 0.1832 mm | region 5: 0.499974 |
| `fuzz_face` | 0.25 m / 8192 px/m | 0.40 / 0.0916 mm | region 5: 0.499974 |
| `mantle_edge` | 0.5 m / 4096 px/m | 0.80 / 0.1832 mm | region 0: 0.499969; region 5: 0.499980 |

Body filaments remain visually calibrated around 6–12 mm, with gently marked groups around 12–30 mm; face dimensions are half these. These are visual ranges, not segmentation measurements of every generated shaft. `build.py --scale NUMBER --direction-deg NUMBER` retains the painter's controls.

| Pictures, for each set | How made |
|---|---|
| `*_base.png` | Generated drawing processed by script: neutral extraction, broad-light removal, irregular synthesis, separate value bands and per-region mean normalization. RGB 8-bit sRGB. |
| `*_height.png` | Computed fine shaft relief and weak soft bed from the same aligned source; 16-bit greyscale. |
| `*_normal.png` | Computed from delivered quantized height at physical scale, with wrapped central derivatives and OpenGL +Y up. |
| `*_packed.png` | Computed restrained height concavity occlusion, dry roughness and zero metalness. AO 0.980–1.000; roughness 0.855–0.867. |
| `*_regions.png` | Computed categorical yellow body/face; red and yellow mantle. No blended region pixels. |

For the mantle, 24 irregularly placed dark lock fields have reaches of 10–30 mm; 11 pale fields reach about 6–20 mm into the dark. These are overlapping placement fields, not a count of visible locks. Width and reach vary independently. Each field controls the proportion of source-aligned shafts carrying its colour, fading toward its ends. Moving the entire contour made solid teeth in an intermediate trial; the delivered construction instead leaves the other colour between the shafts. The main boundary wanders 32.4 mm peak to peak; its local 5–95% mixed band is 30.3 mm wide. A quieter edge closes the wrap. There is no pigment-driven height step. I inspected the final [mantle comparison](checks/round2_round3_round4_mantle_edge.png): varying fine reaches at 0.5 m and a softer, gently irregular band at 1.5 m.

All six reusable painting patches were refreshed, each with five aligned layers. All 30 crops match their parent pixels exactly; boxes and physical spans are in [elements.json](elements/elements.json), verification in [validation.json](elements/validation.json). They are rectangular painting patches, not seamless isolated cutouts.

Checks completed: all three sets through the actual game renderer in design, loud, dark and pale dyes; extra hot-pink and near-black views through 20 m; exact-scale game-shader planes; Python unlit and two-light proofs in five dyes; study, animal and tenth-density proofs; half-offset and 3×3 repeats; original/base/relit and concept comparisons; patch alignment; and both Python and engine numerical checks. The [face comparison](checks/face_at_scale.png) checks the same character at its smaller scale. `compare_game.ts` uses the game's palette, rgba mips, shader and noon sky; the enlarged head reference is labelled, and the saddle neck is native at nominal 2,000 px/m.

| Final numerical check | Result |
|---|---|
| Dimensions / height encoding | Fifteen 2048-square maps; height 16-bit |
| Neutrality / invalid region pixels / metalness | Exact R=G=B / zero / zero |
| Largest quarter-mean spread | 1.902% in mantle; body/face 0.031%; limit 2% |
| Maximum absolute base/light correlation, 32 directions | 0.0597; check limit 0.06 |
| Game height/normal correlation | X 0.99951; Y 0.99316 |
| Normal maximum length error | 0.00480 |
| Game continuous-layer seam ratios | 0.909–1.054; limit 1.3 |
| Whole-tile internal shift correlation outside local neighbourhood | Below 0.022 |

Full results: [measurements.json](measurements.json), [engine_measurements.json](engine_measurements.json). Rebuild from the pteranodon folder:

```sh
python3 tex/studies/fuzz/build.py
bun tex/studies/fuzz/compare_game.ts
bun tex/studies/look.ts tex/studies/fuzz
python3 tex/studies/fuzz/check.py
bun tex/studies/fuzz/check_game.ts
```

Remaining differences: the concept's painted shafts are broader and more loosely grouped, especially in the enlarged head crop; the delivered pile remains denser and more uniform. The full-size neutral base is deliberately stronger than the previous delivery and reads more graphic before filtering. Near-black still hides fine value drawing. The egg's poles pinch the UVs and expose the secondary mantle wrap. Surface maps do not supply silhouette hairs; the animal still needs its direction field. I do not claim that the result is indistinguishable from the painting.

Elapsed: about 10 minutes from baseline capture through generation, build iterations and final checks, plus the initial reread; timestamps are in [round4_timing.json](source/round4_timing.json). Final build: 15.8 seconds. All project writes stayed inside this study folder.
