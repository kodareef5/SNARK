Round 3 gives the crowns three foliage values: warm sun leaves in cells 0 and 2, cooler shade leaves in cells 1 and 3, and a darker interior mass. Start with [the four clusters](checks/clusters_review.png), [the four layers](checks/layers.jpg), and [the 30 m test under both lights beside the concept](checks/purpose_30m_concept_comparison.png). The game feedback and repository concept were inspected before editing.

**Only foliage RGB and mass occlusion changed.** The complete height and normal PNGs are byte-identical to round 2. Every alpha pixel, leaf/material identity, roughness value, metalness value, card AO value, twig colour, and both root strips in all four maps also remains exact, including root padding. The [baseline captured before editing](source/round2_preservation_reference.json) and [independent metrics](checks/metrics.json) verify those claims. A separate canonical hash verifies every authored leaf dimension, position, contour source, tilt, shoot, root path, and height-integration setting. The layout file is unchanged.

| Region | Delivered mean RGB, alpha cut 0.5 | Target |
| --- | --- | --- |
| Cell 0 — sun | 110.01/122.09/62.01 | 110/122/62 |
| Cell 1 — shade | 72.25/88.25/58.00 | 72/88/58 |
| Cell 2 — sun | 110.21/121.83/61.95 | 110/122/62 |
| Cell 3 — shade | 72.36/88.36/58.00 | 72/88/58 |
| Mass — interior | 55.83/70.08/43.92 | 56/70/44 |

These are 8-bit sRGB base-colour values, measured before lighting. The builder retains the accepted source-tissue assembly and applies an explicit habitat-pigment pass. Sun-tip warmth follows each leaf’s own botanical base-to-tip coordinates; there is no atlas-wide lighting gradient. Shade cards retain the same blades and turned undersides. The mass uses its existing depth pools to cool whole leaf identities, with additive pigment calibration that preserves the tissue’s contrast. No light vector or normal direction enters that pass.

Cell 2’s fresh growth is still the brightest yellow-green foliage: its mean is **146.82/154.48/70.35**, and its 90th-percentile colour is **155.00/162.00/76.00**, near the requested 150/158/72 tips. Mature sun tips reach 149/156/73 in cell 0. The fresh and yellowed areas remain **1.58%** and **1.27%**; both original yellowed blades remain visible. Turned undersides retain their original areas and remain below 115/125/90. There are no pale neutral flecks on the cards and no blue-dominant pixels in the mass.

The mass’s exposed upper mature tissue averages **71.65/88.31/57.84**, matching the shade cards within 2.5 RGB levels. Its deepest one-percent green-value band averages **27.36/37.00/29.01**, close to 28/38/30. The mass’s occlusion reaches **0.349**, the 8-bit representation of 0.35. Area below AO 0.60 grows from **21.47% to 35.73%**. Broad pooled area, measured with an 11-pixel wrapped Gaussian and AO below 0.70, grows from **32.46% to 43.41%**. These are expanded depth pools, with no dark outlines added around rosettes.

| Delivered file | Construction and validation |
| --- | --- |
| [fig_leaves_base.png](fig_leaves_base.png) | **2048 × 2048, 8-bit straight RGBA, tagged sRGB.** Original generated tissue and 2×-sampled geometry, followed by the habitat pigment pass. Original alpha retained exactly. All forbidden margins have zero alpha; full-cell nearest-leaf RGB padding has zero error. The mass remains fully opaque. |
| [fig_leaves_height.png](fig_leaves_height.png) | **2048 × 2048, 16-bit linear grayscale; black 0 mm, white 200 mm.** Accepted independent blade planes, curvature, veins, and continuous height integration reproduced exactly. Foliage still occupies approximately 5–195 mm. |
| [fig_leaves_normal.png](fig_leaves_normal.png) | **2048 × 2048, 8-bit linear RGB, OpenGL tangent convention.** Derived from the saved quantized height as normalized `(-dH/dx, +dH/drow, 1)`. Pixel pitches remain 2.34375 mm for cards, 1.953125 mm for roots, and 3.125 mm for mass. Maximum independent normal-height error is **0.386°**. Entire PNG unchanged. |
| [fig_leaves_orm.png](fig_leaves_orm.png) | **2048 × 2048, 8-bit linear RGB: occlusion, roughness, metalness.** Only mass occlusion changes. Card AO stays approximately 0.749–0.984, foliage roughness stays 0.937–0.965, roots stay 0.90 roughness, and metalness stays zero. |

The card construction remains the accepted dense set: 512 × 512 pixels covering 1.2 × 1.2 m; leaf-body margins of 20–22 pixels at left, top, and right; six rosettes in cells 0–2 and five along the diagonal spray. All **290 / 294 / 274 / 246** authored blades retain their 140–200 mm projected lengths, against the mass’s 129–211 mm variation. The diagonal spray retains its 2.84 principal-axis ratio. No silhouette, alpha softness, margin, root strand, or leaf scale was altered.

All coverage measurements use ordinary area filtering, alpha cut 0.5, and the fixed native convex outline including its twig attachment. No mip-specific alpha correction is used.

| Resolution / shrink | Cell 0 | Cell 1 | Cell 2 | Cell 3 |
| --- | --- | --- | --- | --- |
| 512 / 1:1 | 81.56% | 79.53% | 83.86% | 77.04% |
| 256 / 1:2 | 81.55% | 79.52% | 83.84% | 77.00% |
| 128 / 1:4 | 81.55% | 79.45% | 83.88% | 77.06% |
| 64 / 1:8 | 81.67% | 79.39% | 83.90% | 77.15% |
| 32 / 1:16 | 81.03% | 80.41% | 83.45% | 77.40% |

Every result remains within 75–85%. The largest connected component retains at least 99.6% of surviving alpha at every shrink. [Grey mips](checks/mips_grey.jpg) and [sky mips](checks/mips_sky.jpg) show the warm/cool distinction surviving down to 32 pixels while retaining the original silhouettes.

The independent checker passes **196 assertions**. It reruns formats/tags, margin alpha, padding, alpha softness, all shrink levels, coverage, connectivity, occupied area, gaps, fresh/old/turned leaves, revised colours, AO/roughness, metalness, metric leaf size, authored and delivered slopes, normal agreement, root scale and 15 m survival, mass opacity, tiling, repetition, and preservation checks. New assertions measure sun/shade separation at 30 m under both lights, fresh-tip brightness, deep cool pigment, expanded pooled area, and absence of amplified blue flecks.

Every review was regenerated. The [base over layout](checks/base_over_layout.png), [alpha](checks/alpha.png), [marked margins](checks/alpha_margins.png), [opposing lights](checks/relighting.jpg), [leaf detail](checks/leaf_detail.jpg), [root detail](checks/root_detail.jpg), [mass relief](checks/mass_relief.jpg), [2 × 2 mass tile](checks/mass_tiled_2x2.png), and [half-period offset](checks/mass_offset.png) accompany the exact-size mip and root images. Tiling checks still pass for all maps; the leaf pattern and periodic construction remain unchanged.

The purpose test retains the same fourteen card placements, 1.2 m card size, 3.6 × 2.1 m closed billow, shared rounded shell normals, rotated delivered detail normals, and lighting response. Its 4.8 × 3.2 m frame projects to **154 × 102 pixels at 1920 px / 90° horizontal FOV / 30 m**, with a frontal card 38.4 pixels across. Both the sun behind the viewer and sun high behind the billow are shown beside the same unmodified concept crop. See [actual size](checks/purpose_30m_actual.png), [enlarged comparison](checks/purpose_30m_concept_comparison.png), [sparse four-card case](checks/purpose_30m_sparse_both_lights.png), and [5 / 30 / 60 m views](checks/purpose_distance.jpg).

In the frontlit test the yellow-green tops now sit above cooler rims and darker visible interior gaps. Mean rendered sun-card green exceeds shade-card green by **40.1 levels**; the separation remains **19.4 levels** under backlighting. Those measurements include placement and normal response. The visible backlit core receives **zero direct sun**. There is no exposure lift, artificial rim, bounce, cast-shadow pass, or coverage boost.

The concept still has brighter warm highlights, stronger branch-scale terracing, and deeper inter-billow channels than this single-billow diagnostic. Backlit cards still read as broad clumps. The material now supplies the requested pigment range, but these images are **not a new game capture** and do not establish whole-crown, wind, texture-compression, or two-sided-lighting acceptance. [Concept registration](source/concept_registration.json) remains an approximate art-scale comparison, not calibrated camera data.

The reused full-size [leaf specimen source](source/fig_specimens_set2_generated.png), [leaf prompt](source/set2_leaves_prompt.txt), [root source](source/generated_aerial_roots.png), and [root prompt](source/roots_prompt.txt) are retained untouched. No new image generation, external reference, or existing-game art was used. [source/README.md](source/README.md) describes every retained input and regenerated assembly record.

The previous palette, mass AO, composed master, dependent reviews/metrics, and report were superseded in place. No rejected candidate or obsolete atlas is retained in the project. Briefs, guide, feedback, current fit data, runner records, reused sources, and compact preservation references remain. [cleanup_manifest.json](source/cleanup_manifest.json) records the replacements and prior cleanup history.

[build_material.py](build_material.py) rebuilds the four maps offline; [check_material.py](check_material.py) regenerates all measurements and reviews; [verify_rebuild.py](verify_rebuild.py) checks byte-for-byte rebuild reproducibility and reruns the full checker. Dependencies remain pinned in [requirements.txt](requirements.txt). The final verification **reproduced all four delivered PNGs byte for byte and passed all 196 assertions again**. [rebuild_verification.json](checks/rebuild_verification.json) records the matching hashes and input fingerprints; [rebuild_run.log](checks/rebuild_run.log) records the full run.

```sh
python3 -B build_material.py
python3 -B check_material.py
python3 -B verify_rebuild.py
```

Import only base colour as sRGB, keep the other maps linear, use OpenGL normals, alpha cut 0.5, and a full height range of **200 mm**. Repeat the mass inside its lower-half rectangle. Cells 0/2 belong on billow tops; cells 1/3 belong around the rims and underneath.
