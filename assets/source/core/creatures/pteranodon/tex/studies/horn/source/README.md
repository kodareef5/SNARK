# Reusable horn sources

`horn_generated.png` is the **untouched 1254 × 1254 output** of the built-in image tool. The exact prompt is in
`horn_prompt.txt`; it requested 2048 × 2048, but the tool returned 1254 × 1254. No external reference images were
searched for or downloaded. The source SHA-256 is recorded in `../study.json` and checked on every review.

`horn_elements.npz` is rebuilt by `../build.py`. All arrays are aligned 2048 × 2048 float32 fields:

| Key | Units and use |
|---|---|
| `source_periodic` | Original linear luminance after periodic overlap/resampling, before illumination removal. |
| `source_value` | Intrinsic linear value after subtracting only the broad 32 mm-sigma illumination field. |
| `authored_pigment` | Added linear value drawing for pores, growth and wear. |
| `pores_height_mm` | Signed physical micro-pits and bumps relative to the smooth horn plane. |
| `growth_height_mm` | Signed relief of irregular, interrupted longitudinal growth lines. |
| `scratches_height_mm` | Signed shallow incision relief. |
| `base_linear` | Complete neutral linear albedo, mean 0.50. |
| `height_mm` | Complete physical surface relief, zero at the smooth plane. |
| `roughness` | Linear satin roughness. |

These are scalar materials, not stamps to place at repeated intervals. Resample every field through the same surface
coordinates, then compute the normal from the resampled physical height at the destination texel pitch. Never scale
an existing normal's strength to compensate for a density change. The delivered PNGs are the five aligned final
layers, and retain the source value drawing.

`build.py --grain-scale NUMBER` changes the sizes of authored growth lines, pits and scratches.
`--grain-angle 0|90|180|270` rotates **all** aligned source and authored fields together while preserving the square
tile's periodic boundary. `--relief-scale NUMBER` scales the tile's physical microrelief. The span and feature sizes
are explicit constants in metres / millimetres near the start of `build.py`. Defaults reproduce the delivered study.
For arbitrary local orientations, reuse `head_surface`'s shared coordinate sampler or supply a modeller's direction
field. Do not rotate each map independently.

`head_layout.json` records the original concept-space paths and landmarks. Reference scale is approximately
1000 px/m. The output is a 1500 × 1500 reference-space window beginning at `(150,-200)`, resampled to 2048 square.
The head from beak tip to crest tip measures 1.445 m in this registration. The matte is refined against our own
`ref/concept/head_side.png`, with disconnected warm-fuzz specks removed. Its colour/light is not used in the albedo.

`head_silhouette.png` is the reusable horn cutout including nasal/gape apertures and the fuzz-overlap fringe.
`head_face_crease.png` is the narrow crease weighting, used only for relief/occlusion.
`head_growth_direction.png` has the cap-to-crest orientation blend in red (0 = beak direction, 1 = crest direction),
with green and blue zero. It is a scalar blend mask, not a tangent-space normal.

The charcoal band is solely a pure cyan region in `head_side_regions.png`. It does not appear as a dark patch or a
step in any neutral material field. Never bake its dye into the base. For the final head, use the high-density tile
and these layout paths; the 1.5 m head sheet itself is intentionally only 1365 px/m.
