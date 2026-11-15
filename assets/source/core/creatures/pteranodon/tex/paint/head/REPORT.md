# Head — revision after round-one feedback

Revised the three returned items: the eye streak, the horn's long grain, and the amber eye. The complete head group still covers **1,141,951 texels**, with no painted texels outside its five pieces. All authored changes are in `tex/paint/head/`. The prior report is retained in [source/REPORT_round1.md](source/REPORT_round1.md).

The eye streak is now a broad cheek band, **30 mm nominal depth at the eye**, widening toward **50 mm including the fringe** at the rear. Independent measurements of the central 90% of delivered charcoal texels give **29.69 mm at the eye** and **43.58 mm on the rear cheek**. Its centre runs nearly straight behind the eye, then falls from y=1.375 at z=0.50 to y=1.354 at z=0.39, turning into a filled rear-head patch below the ivory crown. This replaces the thin strip encircling the rear skull. The edges interlock with the existing face fibres over roughly **2–4 mm**; no new relief ridge outlines the marking.

The rear patch tapers into the body painter's current **70 mm nape**. `paint.py` reads `body/source/joins.json` each run and the live body layers over the final 4 mm of the actual geometric cut. The final **1,608 nearest surface pairs within 1.5 mm** have **100% region agreement**, mean linear base difference **0.003813**, mean height difference **0.000317 mm**, and mean roughness difference **0.001571**. These are nearby surface samples, not coincident points. The rider render uses the current body revision; the neck itself remains that painter's work.

The horn still samples the accepted **400 mm horn tile** through the original beak/jaw and crest charts. A directional decomposition now removes **94% of the extracted long-streak component** from base, height and packed material response: the difference between a 1 × 12 mm smoothing field and a 7 × 12 mm field. This suppresses longitudinal light/dark grain while retaining the source's small dark pits, aligned shallow depressions and soft mottling at their original physical scale. It is not a 94% reduction of all texture. The study's nominal **0.5–1 mm pits** and restrained satin response carry the close surface; growth lines are faint. The existing smoother tip, cutting-edge wear, keel, nasal groove and gape treatments are retained. No study file or generated original was changed.

The **18 mm iris** retains the skin study's drawing, registration and black pupil. Only warm, undyed iris pigment is lifted toward amber, using linear RGB gains of **2.4 / 4.3 / 2.2**. The measured annulus averages approximately **sRGB (160, 106, 21)**; the central pupil remains **(0, 0, 0)**. A **0.65 mm pale inner lid ring**, sRGB (190, 177, 149), follows the source's actual wet boundary. The surrounding bare lid remains in the streak, and the existing eye relief, brow and wet roughness remain in place. At the standard front/head view the iris is now visibly amber inside the dark surround.

The accepted horn/cap region boundary and crest-band region are **pixel-identical to round one**. The band remains **86 mm deep**, between **99 and 185 mm from the crest tip**. The nostril remains a **60 mm tapered slit**, with its measured deep floor spanning **55.73 mm**; its rim and the straight gape are unchanged. The mouth's base, height, roughness, occlusion and region texels are byte-identical. The face uses the same physical chart and flow, with median alignment error **4.36°**, 90th percentile **7.95°**. It reads the latest live face-fuzz study as required; the shared study and body paint were revised during this round, so their latest drawing is present in the composed review.

The delivered contract remains five 2048-square PNGs plus `layers.json`: RGBA sRGB base, genuine 16-bit height, 8-bit roughness and fine occlusion, and pure categorical regions. The full height encoding is **1.8 mm**, with an actual used range of **0.03998–1.08499 mm**. All dyed RGB channels are exactly equal, all owned alpha values are 255, and every non-owned texel is zero. No normal map is delivered; the composer derives it from the joined physical height.

| Dyed region | Final mean in linear light |
|---|---:|
| 0, charcoal markings | 0.500001 |
| 2, horn | 0.499935 |
| 3, crest band | 0.502059 |
| 5, ivory fuzz | 0.499998 |

The composer reports no grey warnings. The final two rebuilds used stable inputs and reproduced all six delivered files **byte for byte**. [checks/validation.json](checks/validation.json), [checks/measurements.json](checks/measurements.json), [checks/join_measurements.json](checks/join_measurements.json), and [checks/round2_preserved.json](checks/round2_preserved.json) hold the measurements. [checks/render_inputs.json](checks/render_inputs.json) records the head/body inputs used for the final render; their hashes still matched the delivered files after review.

Rebuild and review from the pteranodon's folder:

```sh
python3 tex/paint/head/paint.py
python3 tex/paint/head/check.py
zsh tex/paint/look.sh tex/paint/head/checks/look --maps
bun tex/paint/head/render_details.ts
python3 tex/paint/head/review.py
```

Reviewed the game's **head**, **head_front** and **rider** views beside the concept, plus the matched **1000 px/m side/front views**, enlarged face/crest, open mouth, and loud/dark/pale detail views. The broader cheek marking turns into a continuous nape marking in the rider view. The amber iris and pale ring separate from the charcoal in the standard front view. The horn looks more even at whole-head size; its pits remain visible close up, with subdued growth streaks. Also compared the painted horn base and relit height with the generated original and accepted study at the same stated physical scale.

Review files:

- [Head: concept / sent back / revised](checks/head_round2_comparison.png), [front comparison](checks/head_front_round2_comparison.png), and [rider comparison](checks/rider_round2_detail.png).
- Actual game renders: [head](checks/look/head_design.png), [head_front](checks/look/head_front_design.png), [rider](checks/look/rider_design.png).
- Matched-density [side](checks/side_concept_comparison.png) and [front](checks/front_concept_comparison.png); [horn source / base / relief](checks/horn_source_base_relief.png); [close face](checks/details/face_close_design.png).

The comparison sheets retain renderer pixels without colour or contrast corrections. Standard camera views have perspective and differ in angle from the concepts; the additional side/front sheets match 1000 px/m at the camera's centre plane. The rider detail labels its 2× enlargement explicitly. The before/after whole-animal pictures also include the other painters' concurrent updates.

Remaining limits: the mesh still exposes a polygonal eye/socket surround, a projecting crest-root lip and a small gap near the rear gape. These silhouette/geometry issues were not changed. The smallest pits and fibres merge at the renderer's 1024-square rgba resolution; the concept has richer silhouette fuzz and a larger-looking eye than this mesh. No form-occlusion bake is available, so these maps supply fine material occlusion only. No layout or bake issue prevented the three requested paint corrections. No Blender, external references, new generated originals, or edits to another painter's files were used. This revision took about **12 minutes**, including render iterations and refreshes against the live body paint.
