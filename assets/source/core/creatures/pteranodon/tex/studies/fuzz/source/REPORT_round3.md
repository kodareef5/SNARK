Round 3 revision, responding to `FEEDBACK_2.md`: the pile is now finer, flatter and more nearly parallel, with narrow soft partings and subdued lock shading. The mantle uses a gently wandering band of interleaved fine ends instead of centimetre triangular teeth. The names, 2048-square layers, tile spans, direction, region IDs, mean grey and encoded height scales are preserved. `fuzz_face` continues to use the same drawing as `fuzz` at half its physical size; it has no separate pattern treatment.

The selected source is [fuzz_silky_round3.png](source/fuzz_silky_round3.png), generated with the **built-in imagegen tool** from our previous flat trial and our own neck concept. The [final prompt](source/prompt_fuzz_silky_round3.txt), [first trial prompt](source/prompt_fuzz_sleek_round3.txt), untouched 1254-square originals, reference crop and hashes are retained in [source/manifest.json](source/manifest.json). The first trial was too straight; the selected refinement restores gentle individual curvature and soft overlapping ends. No external references or Blender were used. The previous report is preserved as [REPORT_round2.md](source/REPORT_round2.md).

The build removes broad illumination, reduces the source to 78%, and corrects its 12.07-degree lean before synthesis. Unequal patches retain small angle and size variation. **Horizontal mirroring is removed**: opposing patch directions could make chevrons even with an irregular patch grid. Wider feathering across minimum-error joins avoids abrupt direction changes. The tile has no repeated small motif or visible rows in the inspected native crop, half-offset and 3×3 proofs. [synthesis.json](synthesis.json) records every placement. `build.py --scale NUMBER --direction-deg NUMBER` retains the painter's controls.

Fine strand value and broad lock value now have separate gains. Fine detail remains in the base; the broad envelope is much quieter, and the soft bed contributes much less height. Against the reviewed round 2 maps, base variation in the measured 2 mm and 5 mm Gaussian bands fell **88.7% and 94.3%**. On the identical 1.5 m game view, an interior band-pass comparison fell **49.2%**. That last measurement retains some form shading and is supporting evidence, not a perceptual match score. The before/after views and measurement definitions are in [round2_vs_round3.png](checks/round2_vs_round3.png), [round3_comparison.json](checks/round3_comparison.json), and `check.py`.

| Set | Physical span / study density | Encoded height / actual relief | Mean grey, linear |
|---|---|---|---|
| `fuzz` | 0.5 m / 4096 px/m | 0.80 / 0.0936 mm | region 5: 0.500000 |
| `fuzz_face` | 0.25 m / 8192 px/m | 0.40 / 0.0468 mm | region 5: 0.500000 |
| `mantle_edge` | 0.5 m / 4096 px/m | 0.80 / 0.0936 mm | region 0: 0.500001; region 5: 0.499998 |

Body strand calibration remains approximately 6–12 mm, with slender, weakly defined overlapping groupings around 12–30 mm; face lengths are half these. These are visual calibration ranges, not a segmentation of every generated strand. The unchanged encoded height range has ample headroom: actual body relief fell from 0.543 mm to 0.0936 mm. Lying fibre length is not surface relief.

| Pictures, for all three sets | How made |
|---|---|
| `*_base.png` | Generated source edited by script: neutral extraction, illumination removal, irregular synthesis, separate strand/envelope gains, per-region normalization. RGB, 8-bit sRGB. |
| `*_height.png` | Computed shallow fine-strand and soft-bed relief from the aligned source field; true 16-bit greyscale. |
| `*_normal.png` | Computed from delivered quantized height at the stated physical scale, with wrapped central derivatives and OpenGL +Y up. |
| `*_packed.png` | Computed restrained height-based concavity occlusion, soft dry roughness and zero metalness. AO 0.992–1.000; roughness 0.859–0.863. |
| `*_regions.png` | Computed categorical yellow for body/face; red and yellow for mantle. No blended or antialiased region pixels. |

The mantle's broad boundary wanders **31.5 mm peak to peak**. Its local 5–95% interleaving band is **12.0 mm**, measured after subtracting the wandering. Smooth source-correlated strand coverage and fine rounded stochastic ends put both colours within that band. It no longer offsets the entire boundary by the strong lock envelope. Fine categorical ends filter into a softer transition at game density. A quieter band closes the second wrap. There is no dye in the base or pigment-driven height step.

The six aligned painting patches are refreshed: four body patches and two mantle patches, each with all five layers, each spanning 62.5 mm. All **30 layer crops match their delivered parent pixels exactly**. Boxes, scales and height ranges are in [elements/elements.json](elements/elements.json); validation is in [elements/validation.json](elements/validation.json). They remain rectangular source patches, not independent seamless cutouts.

I inspected the actual game renderer's [fuzz](checks/look/fuzz.png), [face](checks/look/fuzz_face.png) and [mantle](checks/look/mantle_edge.png) sheets: both 0.5 m light directions, 1.5 m and 5 m, in design, loud, dark and pale dyes. I also inspected hot-pink and near-black renders, including 20 m, from `check_game.ts`. At 0.5 m the ivory pile shows fine gently curved strands and shallow overlap. At 1.5 m the coarse bright/dark fleece patches are gone; the form carries the shading over faint grain. At 5 m the surface is calm. The final mantle band is finer and softer than the intermediate thick fringe. [round3_game_design.png](checks/round3_game_design.png) collects the two design rows.

The required [concept comparison](checks/concept_at_scale.png) places ivory base and **actual game-shader relighting** beside both concept neck crops at **1,000 and 2,000 pixels/metre**. `compare_game.ts` uses the game's pack reader, palette, rgba mips, shader and noon lights on a calibrated plane. The head reference's 2× enlargement is labelled; the saddle reference uses nominal 2,000 px/m. [original_base_relit.png](checks/original_base_relit.png) checks that the source's fine overlaps survive the delivered layers at matching scale. The source comparison now includes the same lie correction as the build. [face_at_scale.png](checks/face_at_scale.png) checks the shared drawing at its shorter scale.

All numerical checks pass in [measurements.json](measurements.json) and [engine_measurements.json](engine_measurements.json):

| Check | Final result |
|---|---|
| Dimensions / height encoding | Fifteen 2048-square maps; 16-bit height |
| Neutrality / invalid region pixels / metalness | Exact R=G=B / zero / zero |
| Maximum quarter-mean spread | 0.102% (limit 2%) |
| Maximum base/light correlation, 32 directions | 0.0104 |
| Game height/normal correlation | X 0.99735; Y 0.97671 |
| Normal maximum length error | 0.00431 |
| Game continuous-layer seam ratios | 0.951–1.036 (limit 1.3) |
| Maximum internal shifted-image correlation outside the local neighbourhood | 0.0165 |

Rebuild and verify from the pteranodon folder:

```sh
python3 tex/studies/fuzz/build.py
bun tex/studies/fuzz/compare_game.ts
bun tex/studies/look.ts tex/studies/fuzz
python3 tex/studies/fuzz/check.py
bun tex/studies/fuzz/check_game.ts
```

Remaining limits: the concept's painted individual shafts are somewhat broader and more separately articulated than this dense photographic pile, especially in the enlarged head crop. The reference also retains its warm form lighting, while the game comparison deliberately uses the actual noon shader without colour matching. I regard the flat, silky character as substantially closer, but have not established blind indistinguishability. Near-black hides much of the finest drawing. The egg's UV poles still pinch the pattern and expose the second mantle wrap; the final animal needs its direction field and silhouette treatment. These are surface maps, not geometric hairs.

Elapsed work: approximately **13.5 minutes**, including two generated trials, synthesis and mantle iterations, game renders, concept comparisons, measurements and patch validation. Final build: **10.6 seconds**. All authored files stay in this study's folder.
