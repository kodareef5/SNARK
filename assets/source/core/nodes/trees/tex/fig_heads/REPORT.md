Round two is complete: all five fig/banyan head populations are warmer and greener at the means in [BRIEF_ROUND2.md](BRIEF_ROUND2.md), compensating for the game's blue skylight. The six leafy tops, twig-bearing underside and periodic interior retain round one's leaves, scale, folds and layout. **Height, normal and ORM PNGs are byte-for-byte identical to round one**, including occlusion and roughness. Start with the updated [atlas](checks/atlas_preview.png), [60 / 25 / 12px core tests](checks/purpose_distance.png), and [cores with twelve existing fig sprays](checks/assembly_distance.png).

Only the base-colour mapping changed. The original tonal mapping remains fixed, including its underside contrast adjustment; a pointwise monotonic channel translation then meets the new means. A smooth highlight shoulder starts four code values below the **168 / 172 / 70** young-growth ceiling. There is no resampling, blur, new artwork or lighting adjustment. Against the delivered round-one base, luminance-pattern correlation is at least **0.99989**, and luminance standard deviation retains **99.35–100.00%** of its previous value. The requested means entail mean sRGB-code luminance changes of **+9.14 sun, +6.84 middle, +3.28 shade, +1.13 underside and −2.43 interior**; absolute brightness is therefore not pixel-identical. The [colour-change measurements](checks/round2_colour_change.json) record these comparisons and both base-image hashes. These texture measurements do not predict the exact in-game saturation under skylight.

| File | Format and interpretation |
| --- | --- |
| [fig_heads_base.png](fig_heads_base.png) | 2048 × 1024, opaque 8-bit RGB, tagged sRGB. |
| [fig_heads_normal.png](fig_heads_normal.png) | 2048 × 1024, linear 8-bit RGB; normalized tangent convention `(-dH/dx, +dH/drow, 1)`. |
| [fig_heads_height.png](fig_heads_height.png) | 2048 × 1024, linear 16-bit grayscale. **Black = 0 mm; white = 240 mm.** Actual delivered relief: **23.98–162.68 mm**. |
| [fig_heads_orm.png](fig_heads_orm.png) | 1024 × 512, linear RGB: occlusion, roughness, zero metalness. Aligned 2 × 2 area reduction. |

These are only the requested upper-half maps. No lower-half asset was created or changed. Import only base colour as sRGB; renormalize normal vectors after mip filtering. Height describes local foliage relief; the mesh supplies the large head curvature.

Cells are 512px, numbered left to right and then down: **0/1 sun, 2/3 middle, 4/5 shade, 6 underside, 7 interior**. Disc centres are `(255.5,255.5)` within each cell, radius **240.64px**. The interior occupies `(1536,512)–(2048,1024)`; repeat within that rectangle, not across neighbouring cells. [layout.json](source/layout.json) records these regions and their physical pitches.

| Population | Target RGB | Delivered mean RGB¹ | Median roughness² |
| --- | --- | --- | --- |
| Sun | 108, 122, 50 | 108.01, 122.01, 50.02 | 0.329 |
| Middle | 82, 100, 44 | 81.99, 100.01, 43.99 | 0.400 |
| Shade | 60, 78, 40 | 59.99, 77.99, 39.97 | 0.488 |
| Underside | 80, 92, 54 | 79.99, 92.00, 54.02 | 0.769 |
| Interior | 34, 48, 28 | 33.98, 48.00, 27.98 | 0.722 |

¹ Arithmetic sRGB means inside the discs, excluding exterior padding; interior uses the whole tile. Every cell is within **0.03 code value** of its target. ² Average of the population's chart medians. Upper leaves are glossy; shaded backs are rougher. Maximum delivered pigment is **167/171/69**, below the new young-growth ceiling. All populations use the warmer palette; shade and interior retain their darker values and existing leaf structure.

The disc's 2.2m surface radius gives **109.38px/m**, or **9.1423mm/texel**. The specified 100–140mm blades therefore target **10.94–15.31px**, with widths around 5.47–7.66px. The 2.4m interior tile uses **4.6875mm/texel**, so the same physical blades are about 21.3–29.9px there. The initial generated leaves were too large; all three sources received a scale revision before selection.

There is an existing input mismatch: the current `fig_leaves/REPORT.md` describes 140–200mm card blades, larger than this brief's 100–140mm. This work follows the head brief. The [same-physical-scale sheet](checks/leaf_scale_and_cards.png) shows all four unchanged 1.2m cards beside 1.2m head patches, with rulers; it does not resize the cards to hide the mismatch. The [6× leaf grid](checks/leaf_detail_grid.png) exposes native detail and overlap. Generated artwork is not a set of individually dimensioned leaf meshes: some painted blades overlap or foreshorten, and occasional blades vary outside the target. The automated bright-face-core proxy measures medians of **8.3–9.4px above**, **9.9px beneath**, and **13.6px inside**. Those are bright portions, not complete blade dimensions; merged faces also occur. It is not a certification of every leaf's length.

[build_material.py](build_material.py) builds all layers offline from the three selected generated originals. It retains the original removal of the first-order image-axis log-luminance gradient, radial self-occlusion and local leaf structure. The round-two colour transfer follows that fixed mapping and meets the requested means without hard clipping broad faces. The rim darkens in colour without spatially blurring the leaves; [centre / rim / corner patches](checks/edge_detail.png) show the sharp foliage continuing outside every disc. The largest remaining first-order axis coefficient is below **0.008**, with no prescribed sun direction.

One inferred relief combines **70mm fold**, **22mm spray**, and **7mm blade** contributions through bounded functions. These are artistic amplitudes, not measured botanical displacement. The builder quantizes height to the delivered uint16 values **before** differentiating it at each region's physical pitch. The independent checker reconstructs normals from that saved height; maximum disagreement is **0.385°**, including 8-bit normal quantization. There is no separate painted normal image.

The [full-resolution](checks/purpose_distance.png) and [half-size phone](checks/purpose_phone.png) purpose sheets show actual 60, 25 and 12px cores beside the fig and banyan concepts, under overhead and side light. Tests use closed 2.8 × 2.8 × 1.86m ellipsoids, polar charts meeting at 1.75 radians, a 35° upper view and −70° underside view, linear-light colour mips, trilinear sampling, normalized detail normals, and 4 × 4 pixel integration. Exposure and background stay fixed. [All-head rotations](checks/all_heads.png) expose the seven disc charts under the same side light.

At 60px the material resolves as dense leaf sprays with small contrasting faces; at 25px several clumps remain distinct. At 12px individual leaves merge, leaving light upper tissue and dark folds. The nonradial texture contrast at 12px is **11.6–19.7 luminance code values** for top charts and **9.9** beneath. This measurement removes radial brightness terms so a plain shaded disc cannot pass as clumps. The underside shows separate pale backs and carrying twigs at close texture scale; under overhead light its rendered lower surface remains naturally dark.

The opaque core alone has a smooth geometric silhouette. The separate [assembly test](checks/assembly_distance.png) and [phone assembly](checks/assembly_phone.png) add twelve fixed radial planes using the existing fig cards' colour, alpha, normal and ORM, with 1.2m card scale, alpha cut 0.5 and no coverage boost. Their nominal 3m span contains a 2.1m core. They show the cutouts breaking the edge at small sizes and expose the remaining card/head scale difference. These are local material diagnostics, **not new game captures**. They do not reproduce the game's exact head mesh, card placement, inter-head shadows, wind, compression or spray-reduction policy. At long range the core-only test remains the more relevant surface test.

The interior is joined with minimum-error cuts through an 80px overlap, with a three-pixel seam feather. All subsequent interior filtering and differentiation wrap periodically. See the [2 × 2 repeat](checks/interior_tiled_2x2.png) and [half-period offset](checks/interior_offset.png). Boundary-to-internal neighbour-difference ratios, horizontal / vertical, are **1.468 / 1.092 base**, **1.227 / 1.010 normal**, **1.330 / 1.071 height**, and **1.201 / 1.110 ORM**. No mirrored strip or broad edge blur was used.

[check_material.py](check_material.py) passes **117 checks**: the original 109 checks with the new colour means and ceiling, plus eight preservation checks against the [frozen round-one fingerprints and layout](source/round1_structure.json). Those verify exact height, normal and ORM files, all three generated originals, periodic seam paths, and the layout with physical pitches and relief ranges. The [metrics](checks/metrics.json) retain the measured values, including scale-proxy limitations. The two variants in each upper population are distinct; maximum absolute within-pair luminance correlation is **0.064**.

The [rebuild verification](checks/rebuild_verification.json) and [log](checks/rebuild.log) record a byte-for-byte reconstruction of all four current maps and a rerun of the checks. The selected [top](source/top_heads_generated.png), [underside](source/underside_generated.png), and [interior](source/interior_generated.png) originals, exact [prompt history](source/generation_history.json), and source hashes remain in `source/`. Round one generated these with the built-in imagegen tool, solely from words and this project's own imagery; round two uses those exact originals. No photographs, web images or other game's pictures were used.

Rebuild with the pinned [requirements](requirements.txt):

```sh
python3 -B build_material.py
python3 -B check_material.py
python3 -B verify_rebuild.py
```

All authored project files are in this folder; no git commands were run. The base PNG, layout colour measurements, all diagnostic images, metrics and rebuild evidence replace their round-one versions in place. Temporary comparison copies and the superseded round-one completion note were removed. The supplied round-one game feedback, briefs and original generation provenance remain as references.
