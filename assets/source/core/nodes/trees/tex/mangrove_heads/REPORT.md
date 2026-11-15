The mangrove upper crown atlas contains six distinct leafy tops, one pale underside with carrying twigs, and one dark periodic interior. Start with the [atlas](checks/atlas_preview.png), [35 / 20 / 9 pixel purpose test](checks/purpose_distance.png), and [half-size phone test](checks/purpose_phone.png). All four deliverables are in this folder; nothing was written outside it and no git commands were run.

| File | Format and interpretation |
| --- | --- |
| [mangrove_heads_base.png](mangrove_heads_base.png) | 2048 × 1024, opaque 8-bit RGB, explicit sRGB and gAMA chunks. |
| [mangrove_heads_normal.png](mangrove_heads_normal.png) | 2048 × 1024, linear 8-bit RGB; normalized tangent convention `(-dH/dx, +dH/drow, 1)`, matching the mangrove sprays. |
| [mangrove_heads_height.png](mangrove_heads_height.png) | 2048 × 1024, linear 16-bit grayscale; **black = 0 mm, white = 160 mm**. Actual relief spans **20.46–77.02 mm**. |
| [mangrove_heads_orm.png](mangrove_heads_orm.png) | 1024 × 512, linear RGB: occlusion, roughness, zero metalness. Aligned 2 × 2 area reduction. |

Only base color should be imported as sRGB. Normalize normal vectors after mip filtering. Height describes local leaf, shoot and fold relief; the head mesh supplies the overall curvature. These are standalone upper-half maps, not a replacement for a 2048-square atlas. The lower prop-root half was not accessed for editing.

Cells are numbered left to right, then down: **0/1 sun, 2/3 middle, 4/5 shade, 6 underside, 7 interior**. Each disc is centered at `(255.5,255.5)` within its 512px cell, radius **240.64px**. Crisp leaves continue into the padding, with darker pigment toward the edges. Cell 7 is the periodic 2.4 × 2.4m interior; wrap within its own rectangle `(1536,512)–(2048,1024)`, not into neighboring cells. [layout.json](source/layout.json) records the layout and pitches.

| Population | Target RGB | Delivered mean RGB¹ | Median roughness² |
| --- | --- | --- | --- |
| Sun | 92, 116, 50 | 92.00, 116.00, 50.00 | 0.365 |
| Middle | 68, 92, 44 | 68.00, 92.00, 44.00 | 0.435 |
| Shade | 48, 70, 40 | 48.00, 70.00, 40.00 | 0.516 |
| Underside | 80, 94, 56 | 80.00, 94.00, 56.00 | 0.800 |
| Interior | 28, 44, 30 | 28.01, 44.00, 30.00 | 0.765 |

¹ Arithmetic sRGB means inside the discs, excluding padding; interior uses the whole tile. Each cell is within 0.02 code value of its target. ² Average of cell medians for paired populations. Upper surfaces are glossy; leaf backs and interior tissue are duller. The existing spray maps are much rougher, near 0.92; the head maps follow this brief's glossy-upper requirement and do not alter the sprays.

The palette retains warm yellow-green sun tissue, deeper saturated greens in folds, sage undersides, and sparse brown blades. Sun cells remain below the requested `(170,176,76)` ceiling. The whole atlas's maximum is `(166,172,86)`; the higher blue values occur on pale undersides. Brown is an explicit tissue role on complete blades: **1.80–2.76% of visible disc/tile area**, including fractional edge coverage, with **1.87%** beneath. It is not added as brown pixel noise.

This work uses the **same original leaf library as the mangrove sprays**, copied unchanged into [source/leaves_generated.png](source/leaves_generated.png), with its original [generation prompt](source/generation_prompt.txt). No new image generation was invoked: its managed save location would conflict with the folder-only instruction. All imagery comes from that project artwork and the two project concepts. No photographs, web imagery, or other game's art were used. [Source provenance and hashes](source/originals.json) and the [source guide](source/README.md) explain the retained inputs.

I read the oak's three briefs/report and the fig's briefs/report, and inspected their supplied game feedback. The oak's rejected soft, fine texture informed the use of complete crisp blades and contrasting overlaps. The later color feedback informed the warm saturated palette. The new build reuses the mangrove library's actual contours and vein tissue, arranging three or four opposite pairs on each short shoot. Independent seeds give each cell its own overlapping composition. Hundreds of shoots form several irregular clumps, with deeper leaf-filled folds between them; there is no global sun vector, side highlight, or baked white specular reflection.

The disc's 1.1m surface radius gives **218.76px/m**, or **4.5711mm/texel**. Authored blades are **90–130 × 40–60mm**, hence **19.69–28.44px long**, before overlap and minification. The 2.4m interior uses 4.6875mm/texel. The dimension audit checks every authored blade, including those hidden by overlap; it does not claim that every visible fragment is a full blade. [Per-cell geometry records](source/cell_0_geometry.json) retain each dimension and placement.

There is a real input mismatch: the current mangrove spray report describes **13.0–16.9cm** blades, larger and generally broader than this brief's **9–13cm**. I preserved the requested head dimensions while matching the source contours and tissue. The [same-physical-scale comparison](checks/leaf_scale_and_cards.png) displays 0.8m patches at equal scale, exposing that difference. It also shows the slightly warmer head palette used to account for blue sky fill. The existing cards were not resized in world units or recolored to hide either difference.

Relief is authored alongside each blade: local tilt, a raised midrib, a subtly rolled margin, overlapping shoots, and broad fold depth. One resulting surface is smoothed by 0.55 texel to avoid thin edge walls, then quantized to the delivered 16-bit height. **Only that saved quantized height supplies the normal slopes**, at the physical pitch; there is no independent painted normal layer. Base color receives no corresponding spatial blur. Maximum independently reconstructed normal error is **0.385°**, including 8-bit quantization. [Material layers](checks/layers.png) and [centre/rim/padding detail](checks/edge_detail.png) show the result.

Occlusion follows authored tissue exposure and local relief recesses. It is an artistic contact/depth estimate, not a ray-traced bake. Color calibration uses smooth monotonic curves with per-blade midrib/margin variation, preserving dark gaps without clipping bright faces into flat patches. The first-order image-axis tone bias is removed while radial self-shade remains. Final log-luminance axis coefficients are below **0.058**; the two variants in each population have absolute nonradial luminance correlation below **0.122**.

The purpose sheets show a closed **1.4 × 1.4 × 0.92m** core with two polar texture charts meeting just below its equator. They use linear-light color mips, trilinear sampling, normalized tangent normals, fixed overhead/side lights, blue ambient fill, and 4 × 4 integration per pixel. The upper view is 35° above the horizon; underside views are −60°. Native pixels and labelled nearest-neighbor enlargements sit beside the concept. A small concept clump is also reduced to 35/20/9px; its approximate physical span is inferred from M03's 7.4m crown, not from a calibrated photograph.

At 35px, the core shows dense leaf-face highlights and irregular gaps; individual blade silhouettes resolve more clearly at close range and on the cutout sprays. At 20px the blades merge into several clumps; at 9px the overhead-lit head retains a brighter top and dark underside. The 9px nonradial texture contrast is **13.53–18.26 luminance code values** for the six tops and **11.55** beneath. This metric removes radial brightness, so a plain shaded disc cannot satisfy it. The lit upper-to-lower luminance ratio remains above **1.166** for all six tops at all three sizes, on both full and half-size phone inputs. [Render measurements](checks/render_metrics.json) retain each result.

The [assembly check](checks/assembly_distance.png) and [phone assembly](checks/assembly_phone.png) add twelve fixed radial cards using the unchanged existing mangrove alpha, base, normal and ORM. They use 0.8m cards around the 1.4m core, an approximately 2m span, alpha cutoff 0.5, and no coverage boost. The core-only test is the relevant surface check when sprays are removed at distance. [All chart rotations](checks/all_heads.png) show 90px cores under the same side light.

These are **local material diagnostics, not game captures**. A smooth opaque core necessarily has a smooth geometric outline. The checks do not reproduce the actual game mesh, wind, compression, crown overlap shadows, spray placement or LOD policy. In-game integration and visual acceptance remain to be checked by the owning renderer; no renderer or lower-half asset was changed here.

The interior was authored directly on a periodic domain: leaves and twigs crossing an edge also draw across the opposite edge. Its clump field, relief filtering, and normal derivatives wrap. No mirrored edge strip, seam feather, or broad edge blur is used. The [2 × 2 repeat](checks/interior_tiled_2x2.png) and [half-period offset](checks/interior_offset.png) expose the join. Boundary-to-internal neighbor-difference ratios, horizontal / vertical, are **0.949 / 1.001 base**, **0.867 / 0.907 normal**, **1.034 / 0.987 height**, and **0.878 / 0.913 ORM**.

[check_material.py](check_material.py) passes **195 checks**, covering PNG dimensions/encodings/tags, palettes, physical blade dimensions, opposite pairs, brown coverage, gloss roles, shared height/normal consistency, edge padding, reduced clump contrast, rendered top/underside separation, variant distinction, periodic seams, zero metalness, and source hashes. Full values are in [metrics.json](checks/metrics.json). The [offline rebuild verification](checks/rebuild_verification.json) confirms that **all four PNGs reproduce byte for byte**, all frozen inputs remain unchanged, and the checks pass again; [rebuild.log](checks/rebuild.log) contains the run output.

Rebuild offline using the pinned [requirements](requirements.txt):

```sh
python3 -B build_material.py
python3 -B check_material.py
python3 -B verify_rebuild.py
```

The source images, source extraction, deterministic builder, geometry/ownership records, and diagnostics are all contained in this folder. Superseded local preview files were removed.
