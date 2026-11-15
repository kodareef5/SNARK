# Wing paint

Painted every texel of `pteranodon_wing`: `membrane_upper`, `membrane_under`, `arm`, and `finger`. The six delivered maps and `layers.json` are in `layers/`. Run `python3 tex/paint/wing/paint.py` from the animal directory to regenerate them. The build is deterministic for a given set of study layers and bakes; a second run reproduced all seven files byte for byte.

## Construction and placement

The membrane uses the accepted membrane study's extracted skin, thickness, stretch, gathered-detail and pleat fields. The fine crease drawing remains in the neutral base as well as its shallow relief. Source fields are filtered to the wing's roughly 600 texels/metre before physical sampling, with a continuous, nonuniform coordinate warp. Gathered skin blends into the taut surface within approximately 75 mm of the arm/finger and 95 mm of the flank. The extracted pleats are placed at those attachments. The trailing edge is the same skin, slightly darker and smoother over about 5.5 mm; there is no drawn hem.

The vascular layout is authored for this wing, using the study's traced curves as bend templates. Sixteen primary supplies enter from the arm/finger, four enter from the flank, and seven small trees supply the front membrane. The trunk directions sample the baked flow. Daughters fork, narrow, and fade; branch growth stops before unrelated vessels. There are 573 path segments in total. This is a new anatomical arrangement of source-derived curves, not the study's vascular tile repeated across the wing. The main vessel roots are 3.8–5.2 mm wide, or about 2.24–3.07 membrane texels, with narrower daughters and terminal taper. Vessel rise is 0.080 mm. Measured vessel-core pigment is approximately 21% darker than surrounding upper skin and 30% darker underneath after physical filtering.

Both faces sample one drawing in animal X/Z coordinates. The actual position bake stores the painted wing at negative X, so span is read as absolute X; the Y difference between the two sides is the model's skin thickness. Independent UV sampling accounts for the slight raster differences between faces. Upper and under values converge toward 0.50 at their insertion into the spar, with a shallow crease rather than a separate dark stroke.

The warm wash is a region-1 mask, full at the flank and fading over 0.4 m. Its edge wanders gently with the vascular drawing. Region 4 fills the remaining main and front membrane. Region 0 starts at 80% of the measured half span, with a 36 mm transition and a small continuous variation in its edge. The same physical boundary crosses the finger. The arm is entirely region 5; the finger is region 5 until its region-0 tip. Six mask weights sum to exactly 255 on every owned texel, including blends. Regions 2 and 3 are unused.

The arm reads the current `fuzz` layers and metadata every run, at the study's 0.5 m tile span and 6–12 mm filament scale. Its strip's measured physical coordinates carry the pile out along the limb. Median agreement with the baked direction is 0.984. Coverage thins over the last 0.32 m toward the knuckle. The finger starts with sparse `fuzz_face` at its 3–6 mm scale, disappearing by X = 1.86 m. Its bare skin uses the accepted skin study reduced from a 0.20 m to a 0.14 m tile span, with quieter value and relief. Both strip cuts converge to quiet skin at the membrane insertion. The tip is bare.

No new image generations were needed. Existing originals remain in their study folders. `source/recipe.json` records the physical dimensions, seed and anatomical roots. `checks/inputs.json` records hashes of the source layers and bakes actually read. If required study outputs are missing, their unchanged build scripts run in private copies under this group's `checks/study_cache/`, leaving the other painters' directories untouched.

## Delivered pictures

All pictures are 2048 square and zero outside the four owned pieces.

| File | Contents and method |
|---|---|
| `pteranodon_wing_base.png` | Computed from the accepted generated studies and the anatomical drawing; RGBA sRGB, identical RGB channels, alpha 255 on all 1,622,755 owned texels |
| `pteranodon_wing_height.png` | Computed, aligned 16-bit relief; black to white represents **0.8 mm**, with the skin's working middle around 0.4 mm |
| `pteranodon_wing_rough.png` | Computed matte skin and dry fuzz roughness; slightly smoother vessels and trailing edge |
| `pteranodon_wing_occlusion.png` | Computed material-scale occlusion only; no baked form shadow |
| `pteranodon_wing_mask.png` | Computed RGB weights for regions 0, 1, 2 |
| `pteranodon_wing_mask2.png` | Computed RGB weights for regions 3, 4, 5 |

No normal or categorical region map is delivered. The compositor derives the normal from the physical height.

| Piece | Texels | Linear base mean | Encoded height extent, mm | Roughness |
|---|---:|---:|---:|---:|
| Arm | 205,061 | 0.500069 | 0.3755–0.4218 | 0.761–0.863 |
| Finger | 124,588 | 0.500949 | 0.3762–0.4076 | 0.753–0.780 |
| Membrane under | 646,505 | 0.599932 | 0.2640–0.4814 | 0.718–0.773 |
| Membrane upper | 646,601 | 0.399924 | 0.2677–0.4815 | 0.718–0.773 |

Weighted linear means over both faces and limbs are **0.499967 / 0.500006 / 0.500004 / 0.500093** for regions **0 / 1 / 4 / 5**. The compositor reports x1.000 for all four, with no grey correction warning. Fine occlusion remains 0.965–1 on the membrane and 0.984–1 on the limbs.

## Checks and visual review

Ran:

```sh
python3 tex/paint/wing/paint.py
python3 tex/paint/wing/check.py --rebuild
python3 tex/paint/wing/review.py
zsh tex/paint/look.sh tex/paint/wing/checks/look --maps
```

`check.py` passes format, exact ownership, full alpha, neutral RGB, permitted regions, exact mask sums, physical vessel-root widths, piece means, region means and deterministic rebuild checks. It compares all 646,505 underside texels to the upper face in animal space. Their nearest texel centres are a median 0.713 mm apart; resampling the upper drawing to the actual underside positions gives **0.9785 vein correlation**. The 99th-percentile nearest-texel mask difference is one 8-bit level. These are raster comparisons, not claims that different texel grids have identical bytes. Full figures and delivery hashes are in [checks/measurements.json](checks/measurements.json).

Reviewed the game's above/below, inner-wing, under-wing and rider views, and its 20/60/150/400 m size sheets, in design, loud and dark dyes. The final arm has fine laid pile without the stretched bands seen in the first trial. The wash is soft in loud yellow as well as ash; tip boundaries line up across the membrane and spar. No UV-band seam, broad pigment blotch or repeated vascular tile was apparent. The close wing shows connected trunks, smaller branches and skin creases; most fine drawing settles into the tone at distance. The design's dark tips and pale centre remain distinct on the small silhouette.

Useful review pictures:

- [Game inner wing](checks/look/inner_wing_design.png), [under wing](checks/look/under_wing_design.png), [rider](checks/look/rider_design.png).
- [Game sizes](checks/look/sizes_design.png), [loud dye](checks/look/below_loud.png), [dark dye](checks/look/below_dark.png).
- [Source, accepted study, painted base and three relief lights at 600 px/m](checks/source_base_relief.png). These three relief views are labelled Python diagnostics, not game renders.
- [Fuzz source and placement at the arm's physical density](checks/fuzz_at_scale.png), plus `checks/unlit_{design,loud,dark}.png`.

## Remaining limitations

The game's opaque underside is substantially darker and less luminous than the concept's painted slate. This is also present in the accepted membrane study; the requested 0.40/0.60 face means are preserved. Near-black dye and the renderer's half-resolution rgba maps suppress the finest skin and finger wrinkles. The source comparison shows that the broad generated gathered folds become much shallower, local attachment creases on the actual taut wing. The vascular layout is more explicitly organised into leading-edge supplies than the study's denser, interconnecting network.

The shared preview combines the other painters' current layers; this report's measurements cover the wing alone. The current model also shows a narrow raised front-membrane silhouette in some rider/under-wing angles. These bakes did not prevent painting or registering the wing, but paint cannot change that geometry. There is no form-occlusion bake yet; the compositor says so, and this delivery supplies only the requested fine material occlusion.

Approximately 15 minutes of work, including reading, two material-placement revisions, renderer reviews, source comparisons and the byte-for-byte rebuild. No Blender was run.
