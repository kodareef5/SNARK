Round 5 gives the unchanged crowns three pigment levels: warm sun leaves in **cells 0 and 2**, cooler shade leaves in **cells 1 and 3**, and a darker interior mass. Start with [the four cells](checks/clusters.png), [the layers](checks/layers.jpg), and [the 30 m comparison beside the concept](checks/purpose_30m_concept_metric.png). The [larger comparison](checks/purpose_30m_concept_comparison.png) makes the leaf construction easier to inspect.

The supplied [round-4 game view](feedback/round4_game_30m.jpg) showed a nearly uniform mid-olive crown beside the [oak concept](../../ref/concept/broadleaf/oak_lineup.png). The revised diagnostic now separates yellow-green tops from cooler rims and deep interiors under both lights. Colour follows the leaf population and the existing interior strata; it has no sun direction, painted highlight, perimeter shadow or new silhouette.

| Region | Target mean RGB | Delivered mean RGB |
| --- | --- | --- |
| Cell 0 / sun | 128, 132, 70 | 128.00, 132.00, 70.00 |
| Cell 1 / shade | 86, 98, 62 | 86.00, 98.00, 62.00 |
| Cell 2 / sun, fresh growth | 128, 132, 70 | 128.00, 132.00, 70.00 |
| Cell 3 / shade | 86, 98, 62 | 86.00, 98.00, 62.00 |
| Interior mass | 66, 78, 48 | 66.00, 78.00, 48.00 |

Cell 2's fresh growth averages **162/157/83**; its 95th-percentile tips are **164/159/85**, close to the requested 165/160/85. Mature sun pigment is bounded at 161/156/83 so the fresh tips remain the brightest oak yellow-green. Fresh and brown leaf areas remain **2.12% and 1.18%**. The existing brown leaves and visible twig colours are unchanged.

The mass's upper leaves average **87.20/98.48/62.03**, matching the shade cards' mean. Existing deep leaves receive cooler pigments before rasterization, interpolated through four depth anchors. The lowest pigment is **34/44/34**, and the darkest one percent averages **34.16/44.00/34.04**. These are complete leaves at their existing depths; the original fine tissue remains. Mean calibration and a pigment floor retain the requested range.

Pooled occlusion uses the same periodic, broadly filtered height field, with its response expanded over the existing recesses. **39.58%** of the mass is now below 0.60 AO, compared with **1.00%** before; **5.96%** reaches the 0.35 floor (89/255 = 0.3490). Deep cool pigment with green below 65 occupies **27.49%** of the mass. No hollow was moved or added, and no height was altered to obtain this increase.

| Delivered file | Construction and preservation |
| --- | --- |
| [oak_leaves_base.png](oak_leaves_base.png) | 2048 × 2048, straight 8-bit RGBA, tagged sRGB. The existing generated leaf tissue and deterministic composition receive the new pigments. Alpha is unchanged everywhere; cell-edge RGB padding is regenerated from the recoloured leaves. Both accessory strips are unchanged. |
| [oak_leaves_height.png](oak_leaves_height.png) | 2048 × 2048, linear 16-bit grayscale, **black 0 mm, white 160 mm**. Entire PNG is byte-identical to round 4. |
| [oak_leaves_normal.png](oak_leaves_normal.png) | 2048 × 2048, linear RGB, OpenGL tangent convention: `(-dH/dx, +dH/drow, 1)`, normalized at each region's physical pixel pitch. Entire PNG is byte-identical to round 4. The builder still derives it from the saved height. |
| [oak_leaves_orm.png](oak_leaves_orm.png) | 2048 × 2048, linear RGB: occlusion, roughness, zero metalness. Only the mass's occlusion changes. Card AO remains 0.75–0.97. All roughness pixels are unchanged: oak about 0.95, twigs 0.85, moss 0.95, fern 0.92. |

The [baseline captured before editing](source/round4_preservation_reference.json) and [independent measurements](checks/metrics.json) prove preservation with **18 hash comparisons**: alpha; complete height and normals; roughness and metalness; card ORM; both strips in all four maps; twig and brown colours; guide files; leaf/material IDs; fern composition; and every oak placement, size, tilt, support and hollow in the composition, excluding only pigment values. Height and normal file hashes also match. The moss and fern retain their earlier round-2/round-3 preservation checks.

Each card remains **512 × 512 pixels / 0.9 × 0.9 m**. Round 4's clumps, margins and 258/258/258/172 authored blades remain intact. Blades remain 80–120 × 40–60 mm, tilted 20–50°, with the same cups, midribs and overlaps. Every forbidden 12-pixel gutter has zero alpha. The mass remains opaque and periodic in its **4.8 × 2.4 m** rectangle.

All **226 assertions pass**. Checks cover formats, colour tags, padding, margins, cell reach, internal gaps, coverage and connectivity at every shrink, botanical construction, prescribed colours and hue separation, fresh tips, expanded pools, AO, roughness, metalness, normal/height agreement, tiling, accessory scale, preservation and the purpose render. Normal disagreement remains at most **0.384°**; fitted leaf slope errors at the 95th percentile remain **1.14–1.42°**. All four maps' seam-energy ratios remain below 1.55; the recoloured base is **1.329 horizontally / 0.959 vertically**.

Coverage is exactly unchanged at every reduction. Ordinary area filtering and alpha cut **0.5** are used, without coverage correction. The following percentages use the fixed native convex outline, including the attachment; the checker also retains the scalloped-envelope measurements and round-2 comparison.

| Resolution / shrink | Cell 0 | Cell 1 | Cell 2 | Cell 3 |
| --- | --- | --- | --- | --- |
| 512 / 1× | 79.77% | 77.64% | 80.89% | 76.88% |
| 256 / 2× | 79.87% | 77.70% | 80.91% | 76.85% |
| 128 / 4× | 79.98% | 77.74% | 81.02% | 76.89% |
| 64 / 8× | 80.13% | 77.29% | 81.36% | 76.77% |
| 32 / 16× | 80.73% | 77.37% | 80.58% | 76.84% |

All review outputs were regenerated: [layout overlay](checks/base_over_layout.png), [alpha](checks/alpha.png), [margins](checks/alpha_margins.png), [grey mips](checks/mips_grey.jpg), [sky mips](checks/mips_sky.jpg), [opposing-light relighting](checks/relighting.jpg), [leaf detail](checks/leaf_detail.jpg), [accessories](checks/accessory_detail.jpg), [2 × 2 mass tile](checks/mass_tiled_2x2.png) and [half-period offset](checks/mass_offset.png). The offset and tiled views retain continuous shingled foliage with deeper irregular pools, without a new edge seam.

The [purpose test](checks/purpose_distance.jpg) keeps a closed **2.4 × 1.5 m** billow, fourteen separately filtered **0.9 m** cards, shared rounded shell normals and rotated delivered detail normals. Its placements now respect this brief: cells **0/2 on top**, **1/3 around and below the rim**. The [sparse four-card test](checks/purpose_30m_sparse_both_lights.png) uses one of each cell, with two on top and two at the lower rim. Both front sun and high rear sun are rerun at 5, 30 and 60 m, plus a 1600-pixel viewport matching the feedback width.

At **1920 pixels / 90° horizontal FOV / 30 m**, the frame is **96 × 67 pixels** and a frontal card is **28.8 pixels** wide. The following ratios measure the visible populations' mean display luminance after filtering and lighting:

| 30 m light | Sun tops / shade rims | Sun tops / exposed interior |
| --- | --- | --- |
| Front sun | 1.59× | 2.38× |
| High rear sun | 1.35× | 1.88× |

The backlit visible core receives **zero direct sun**. The test adds no exposure lift, bounced light, cast-shadow pass, artificial rim or alpha boost. The concept is shown unchanged in both comparison rows. Its larger comparison uses the previous declared art registration of a 100 mm leaf at 12 pixels (120 pixels/metre); the concept has no camera metadata, so that registration is approximate.

The top/interior separation survives the true 30 m reduction and the sparse arrangement. The larger comparison shows the same leaves continuing from shade cards into the mass. Remaining limitations: the concept still has stronger golden highlights, bluer illumination and more three-dimensional terracing. The backlit test remains subdued, and at 96 pixels individual leaves merge into broad patches. Deliberately brighter sun cards can make conspicuous patches if placed over the wrong parts of the shell. **These are material diagnostics, not new game captures**; engine filtering, compression and actual crown placement are not reproduced.

[build_material.py](build_material.py) rebuilds the set offline from the retained full-size leaf, moss and fern sources. No new image generation or downloaded reference was used. [composition.json](source/composition.json) records the unchanged geometry and the new pigment parameters; original prompts remain beside the source images. [check_material.py](check_material.py) regenerates the measurements and review images. [verify_rebuild.py](verify_rebuild.py) repeats both and compares all four delivered PNG hashes. Dependencies remain pinned in [requirements.txt](requirements.txt).

```sh
python3 -B build_material.py
python3 -B check_material.py
python3 -B verify_rebuild.py
```

The superseded base, mass occlusion, composed master, colour metadata, report and review outputs are replaced in place. Reused sources, historical preservation references, briefs, feedback, guides and runner records are retained. No working variants remain. [cleanup_manifest.json](source/cleanup_manifest.json) records the replacement hashes and prior cleanup history.

The independent rebuild reproduced **all four delivered PNGs byte for byte**, with **226 checks passing again**. The result is recorded in [rebuild_verification.json](checks/rebuild_verification.json), with its complete [run log](checks/rebuild_run.log). Import only base colour as sRGB; keep alpha cut **0.5**, height range **160 mm**, and mass repetition within its existing lower-half rectangle.
