# Horn study — round 2

Rebuilt `horn` from a new built-in image-tool source and carried it into `head_side`. Dark irregular stippling now
lives in the base and in aligned shallow dimples. Long soft pigment bands replace the old scratch-like growth
lines. The corrected outward-facing game render shows the stipple in orange at 0.5 m in both lights.

All ten delivered PNG names, their 2048-square dimensions, physical spans, declared height ranges and region means
are retained. The accepted crest band is pixel-identical. The accepted outer silhouette, gape and fuzz-contact
fringe are unchanged; the only alpha change fills the nostril. It is now opaque region 2, with a narrow dark floor,
a shallow height groove and a soft rim. The original concept-space layout paths are unchanged.

## Construction

| Picture | How this round was made |
|---|---|
| `horn_base.png` | New image-tool source, made periodic with cosine overlaps, converted to neutral linear value and stripped of only broad illumination. Its dark pits and soft mottled growth bands are retained; bright source rims are restrained. Mean normalized to 0.50 and encoded sRGB RGB8. |
| `horn_height.png` | Dimples extracted from the same dark source pits, bounded at 0.083 mm deep; very shallow source structure and 22 occasional broken fine ridges. No general-purpose scratches. Linear 16-bit. |
| `horn_normal.png` | Computed from the delivered quantized height at 0.4/2048 m per pixel, with wrapped central differences and OpenGL +Y. |
| `horn_packed.png` | Short-range height-derived AO; satin roughness with slightly rougher pit floors; zero metalness. Linear RGB8. |
| `horn_regions.png` | Pure blue, region 2 throughout. |
| `head_side_base.png` | The same source material sampled horizontally along the beak and turned up the crest. Crest features are 20% coarser. Fine detail fades toward the needle and wears smoother/paler along cutting edges. The opaque nasal floor is darker and smoother. Both dyed means are corrected smoothly without a step at the band. RGBA8, with nearest-solid RGB bleed through transparency. |
| `head_side_height.png` | The aligned sampled dimples, the accepted keel guide and face-contact crease, 19 fine wear strokes on the used beak tip/edge, and a nominal 0.28 mm nasal groove with soft rim. Linear 16-bit. |
| `head_side_normal.png` | Recomputed from its delivered quantized height at 1.5/2048 m per pixel. |
| `head_side_packed.png` | Restrained height-derived AO and the narrow face-contact crease; satin horn with smoother tip/edges; zero metalness. |
| `head_side_regions.png` | The accepted pure blue/cyan map, with only the former nasal hole filled blue. The band remains pigment in continuous horn. |

The built-in tool received our `ref/concept/head_side.png` as a material reference and the exact saved
[`source/horn_prompt.txt`](source/horn_prompt.txt): old stippled satin keratin, dark 0.5–1 mm pits, soft broad
mottling, horizontal fading growth bands, flat even illumination. It returned **1254 × 1254**, despite the requested
2048. That PNG is preserved untouched as [`source/horn_generated.png`](source/horn_generated.png), with its hash
in `study.json`. The former source, prompt and report are archived in `superseded/source/` with round-one names. No outside
reference was used.

The [reusable source fields](#reusable-source-fields) below document the aligned value/height fields, coordinate
controls, head paths, groove mask and detail weighting. `build.py` and `check.py` reproduce the maps and review sheets.

## Physical scale and measured values

| Set | Span / density | Full encoded height range | Used height relative to plane | Region means, linear |
|---|---|---|---|---|
| `horn` | 0.4 m / 5120 px/m | 0.32 mm | −0.0825 to +0.0107 mm | Region 2: **0.5000** |
| `head_side` | 1.5 m / 1365.3 px/m | 1.20 mm | −0.2888 to +0.3239 mm | Regions 2 and 3: **0.5000** each |

Every visible dyed pixel has identical RGB channels. The median dark-pit core diameter is **0.825 mm**; the 10th
and 90th percentiles are 0.382 and 1.145 mm. These are equivalent-circle diameters of connected cores at 0.07 linear
below their local surroundings, not claims that every generated dimple has a fixed diameter. The source has
naturally smaller marks and occasional broader shallow depressions. Crest sampling makes them somewhat coarser.

Mottling and broad growth pigment are limited to approximately ±0.047 linear around the 0.50 mean: up to about
9% either way, with broad measured standard deviation 0.0199. Growth bands are millimetres wide and tens of
millimetres long; the occasional fine ridge is subordinate. Wear scratches are 3–12 mm long, confined to the used
beak tip/cutting edge. The plain material and crest have no added scratches.

Tile roughness averages 0.430 (1st–99th percentile 0.416–0.471); head roughness averages 0.423. AO averages 0.992
and 0.993 respectively. Metalness is zero. Nasal floor pixels are fully opaque, all region 2, averaging 0.187 linear
value and −0.257 mm relative to the plane. The gap between jaws remains transparent.

## Checks and visual review

Ran the corrected renderer on round one before rebuilding, then on the delivered horn. Ran the local checks and
independent shared measurements on the final maps:

```sh
python3 tex/studies/horn/build.py
python3 tex/studies/horn/check.py
python3 tex/studies/measure.py horn
bun tex/studies/look.ts tex/studies/horn
```

Both sets pass. Details are in `checks/check.json` and `checks/measure.json`.

- Normal/height correlations: **0.997 / 0.998** for `horn`, **0.942 / 0.972** for `head_side`. Recomputed physical
  normals match the delivered bytes exactly; maximum normal-length error is below 0.0049.
- All tile seam ratios are **0.98–1.14**. Tile quarter means are 187.1, 187.1, 187.2 and 187.2 sRGB. Half-offset and
  3 × 3 reviews show continuous bands and stipple without an edge line. No authored dot grid is present.
- Strongest measured base/normal-light correlation is 0.035 on the tile and 0.005 on the head.
- Band pixels are identical to round one. Exactly 1558 alpha pixels changed, all inside the old nostril opening.
  Exterior/fuzz-contact edges and the gape are unchanged. RGB bleed error in the 16-pixel gutter is zero.
- Intrinsic source/base correlation is **0.970**. Source value standard deviation is 0.0572; delivered base is
  0.0591, compared with the previous round's 0.0197. Same-scale source/base/relit crops retain the dark drawing.
- At the planned 2400 px/m density, approximately 15.1% of tile pixels remain at least 0.035 linear darker than
  their local surroundings. The unlit orange preview already reads as stippled horn.
- Reviewed full-resolution material, 2400 px/m and one-tenth density, two light directions, orange, lime, near-black
  and pale dyes, and thresholded alpha at native, planned animal and quarter densities.

In `checks/look/horn.png`, the design-orange blade at **0.5 m** now has a visible field of fine dark pits and soft
value variation, including in the second light. Lime and pale horn retain the drawing; dark horn is quieter but
still varied close up. At 1.5 m the fine stipple merges, and at 5 m the horn returns to a clean strong colour. The
before/after crop uses the same fixed renderer and native screen pixels, without contrast changes.

`checks/head_relit_vs_concept.png` sets the final orange/charcoal head material, relit, beside the concept at exactly
**1000 px/m** with identical coordinates. The crest and cap carry the denser stipple and upward bands; the needle
and cutting edges are smoother. `checks/concept_stipple_details.png` compares matching crest, beak and nasal crops
at that scale, enlarged 3× nearest only for inspection. `checks/head_context.png` uses the concept's face as clearly
labelled context; no face pixels are delivered as horn.

Review pictures:

| File | Contents |
|---|---|
| `checks/horn_05m_compare.png` | Corrected round-one and final orange game views at 0.5 m, both lights, native screen pixels. |
| `checks/look/horn.png` | Full game-renderer dye/distance sheet. |
| `checks/head_relit_vs_concept.png` | Requested relit head/concept comparison at 1000 px/m. |
| `checks/concept_stipple_details.png` | Same-scale crest, beak and nostril comparisons. |
| `checks/source_comparison.png` | Registered generated source, delivered base and relit material. |
| `checks/horn_scales.png`, `checks/horn_dyes_full.png` | Density and dye/light checks. |
| `checks/horn_half_offset.png`, `checks/horn_tiled_3x3.png` | Wraps and repetition. |
| `checks/head_dyes.png`, `checks/head_details.png`, `checks/head_alpha.png` | Head dye, feature and fringe checks. |

## Limits and time

The head remains the requested flat placement study. Its shallow physical normal map does not reproduce the
concept's rounded beak/crest form lighting, and its nasal rim is quieter than that painted reference. The head
sheet is only 1365 px/m at the stipulated 1.5 m span; final UV painting should sample the 5120 px/m horn material
through these paths, rather than enlarge the head sheet. The final mesh supplies the large form and the face
artist supplies ivory fibres over the preserved crease. No final head mesh was available to render here.

Approximately **15 minutes** for this revision, including one new image generation, rebuilding, a head refinement,
corrected game renders and review. The final build took **15.6 seconds**. All authored work stays in this study.

Round 2 is accepted as delivered. For the animal's painter: the study's nostril reads as a short dark oval; paint
the final animal with the concept's longer, narrower slit and its rim. No study picture was changed for this note.

## Reusable source fields

`source/horn_elements.npz` is rebuilt by `build.py`. All arrays are aligned 2048 × 2048 float32 fields:

| Key | Units and use |
|---|---|
| `source_periodic` | Original linear luminance after periodic overlap/resampling, before illumination removal. |
| `source_value` | Source value after subtracting only a broad 32 mm-sigma illumination field. |
| `source_pigment` | Fine intrinsic value: dark pits and restrained lighter keratin variation. |
| `mottling_value` | Soft pigment mottling and horizontal growth bands; approximately ±0.047 linear. |
| `pores_value` | Negative intrinsic pit value, derived from the generated source. |
| `pores_height_mm` | Aligned negative physical pit relief, smoothly bounded at 0.083 mm deep. |
| `growth_height_mm` | Occasional fine, broken ridges; secondary to pigment bands. |
| `scratches_height_mm` | Zero for plain horn. Wear is placed only on the head's beak tip/cutting edge. |
| `base_linear` | Complete neutral linear albedo, mean 0.50. |
| `height_mm` | Complete physical surface relief, zero at the smooth plane. |
| `roughness` | Linear satin roughness. |

Pits are extracted from the new image's dark structure, not an unrelated noise field. Their pigment stays in the
base; the aligned depressions go into height. Bright source rims are compressed so the base does not look like
white-speckled metal. Soft growth bands and 5–30 mm mottling remain in pigment. Do not turn them into scratches.
The median measured dark-pit core diameter is about 0.82 mm, with natural size and shape variation.

Resample all material fields through the same surface coordinates and compute the normal from the destination
height at its physical texel pitch. Do not resize a normal and adjust its strength independently.

`build.py --grain-scale 1|0.5|0.3333333333333333|...` scales all source components with an integer number of repeats
for exact tile wrapping. `--grain-angle 0|90|180|270` rotates every aligned field together; `--relief-scale NUMBER`
scales physical microrelief. `SPAN`, `HEAD_SPAN` and the named numeric feature sizes are near the top of `build.py`.
For continuous local scales/directions, use `head_surface`'s coordinate sampler. The crest has a 1.2 scale dilation
anchored at its root; the beak uses the ordinary tile scale. Fine contrast/relief taper toward the needle and wear
smooths and lightens the cutting edges. There are 19 independently seeded fine wear strokes on the used beak edge.

`source/head_layout.json` is unchanged. Its concept-space paths and landmarks register at 1000 px/m. The output window
starts at `(150,-200)` and spans 1500 × 1500 reference pixels, then samples to 2048 square. Beak tip to crest tip is
1.445 m. The matte is refined against the concept's horn/fuzz colour boundary; no concept lighting enters the base.

`source/head_silhouette.png` keeps the accepted outline, gape and fuzz fringe. The old nasal alpha hole is now filled:
nostril pixels are opaque region 2. `source/head_nostril_groove.png` weights the shallow slit, its smooth dark floor and soft
height rim. `source/head_face_crease.png` supplies the narrow contact crease. `source/head_growth_direction.png` records the
cap-to-crest direction blend in red. `source/head_detail_weight.png` records fine-detail attenuation toward tip/edges.

The band remains exactly the accepted pure cyan region, with the same horn passing through it. A smooth broad
value correction makes both regions average 0.50 without putting a step into any material map. The final animal
should reuse these paths and the high-density horn source: the 1.5 m head panel is a 1365 px/m placement study,
while the material tile is 5120 px/m and retains the finer detail needed for the planned 2400 px/m head.

## Files

The accepted build reads the untouched `source/horn_generated.png` (1254 × 1254), accompanied by
`source/horn_prompt.txt`, and `source/head_layout.json`; it also reads the shared `ref/concept/head_side.png`.
Round-one originals, prompt and report, the old timing note and archived source README are in `superseded/`;
the reusable source notes are preserved above. The files retained for the repository total **3,192,667 bytes (3.04 MiB)** across
**12 files** in this study (excluding shared dependencies).

The local `.gitignore` lists all 17 regenerated files individually: ten delivered PNGs, six derived files under
`source/` (five PNG fields and `horn_elements.npz`), and `study.json`. They remain on disk. The shared ignore rules
also exclude `checks/`, `superseded/` and Python caches. After deleting every file listed in the local `.gitignore`,
`python3 tex/studies/horn/build.py` recreated all 17: SHA-256 comparisons confirmed **all ten delivered pictures
matched the accepted files byte for byte**, as did all six derived source files. Only `study.json`'s elapsed build
time changed. No build dependency was moved into `superseded/` or left ignored without being rebuilt. All 28
existing files in `checks/` are unchanged; the build, checker, source original, prompt, layout and shared concept
are also unchanged. The before/after hash records are in `superseded/tidy_verification/`.
