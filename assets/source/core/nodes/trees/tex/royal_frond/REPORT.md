**Round 2 (2026-11-14) is now the delivered set.** The original report below is retained as history; see the [round 2 changes and measurements](#round-2--folded-blades-and-filtered-edges) at the end for current results.

The four requested **2048 × 2048**, pixel-aligned material maps are complete. Slot 0 is a mature mid-green frond, slot 1 a fresher, slightly shorter and stiffer individual, and slot 2 a declining frond with green-yellow proximal tissue, ochre and orange through the middle, and brown distal tissue. Start with [the layer sheet](checks/layers.jpg), [opposite-light views](checks/relighting.jpg), and [the mip ladder](checks/mip_ladder.jpg).

The source direction came from the repository’s `palm_parts.png`, `royal_lineup.png`, `grove_near.png`, and `DESIGN.md`; the supplied `guide/LAYOUT.json` controls the atlas. The wood material’s layer sheet and report were reviewed as the material-delivery standard. No reference images were searched for or downloaded, and no existing game imagery was used. All authored files are in this folder.

| Delivered file | Construction | Checks and observations |
| --- | --- | --- |
| [royal_frond_base.png](royal_frond_base.png) | **8-bit RGBA, sRGB.** Two original built-in imagegen source sheets supply individual leaflet outlines and tissue detail. The builder isolates each source blade, removes disconnected source spill, rectifies it, suppresses broad illumination variation, and combines its pigment detail with the design’s authored green/aging colours. Independently seeded curved ribbons are composed at 2× sampling resolution into the 2048 master. Fine longitudinal fibres, a paler vein, a straight striped rachis, split tips and selected breaks are authored in blade coordinates. | Visually reviewed the full atlas, blade crops, guide overlay, and every requested mip scale. The mature median is RGB 76/115/56; the fresher median is 116/151/66. Crease lighting comes from the normal map. Transparent RGB is nearest-leaf colour extended separately to each slot’s edge, including the appropriate yellow/brown tissue in slot 2. The checker finds **zero RGB error** against that padding rule and **zero alpha pixels in the 12-pixel side margins**. |
| [royal_frond_height.png](royal_frond_height.png) | **16-bit grayscale, linear, white high. Full encoded range: 10 mm.** The same blade coordinates define a folded cross-section, rounded margins, a small central ridge and fine longitudinal relief. Leaflet ranks have different offsets; a height buffer resolves which blade crosses above another. The rachis has a rounded raised profile. Height is extended into transparent space before gentle filtering so the cutout does not acquire a false cliff against zero-height black. | Reviewed against colour, alpha and the opposite-light crops. Blade creases, their veins, crossing edges and the central rachis align. Visible samples occupy approximately 0.24–7.99 mm of the 10 mm encoding. Heights outside the alpha are filtering support, not visible additional geometry. |
| [royal_frond_normal.png](royal_frond_normal.png) | **8-bit RGB, linear data, OpenGL.** Computed only after saving and reopening the delivered quantized height. Central differences use **2.34375 mm/pixel across** and **2.05078125 mm/pixel along**. The vector is normalized from `(-dH/dx, +dH/drow, 1)`: +X right, +Y image-up, +Z outward. | Independently recomputed from the PNG by the checker. Angular error on the cutout: mean **0.173°**, 99th percentile **0.300°**, maximum **0.380°**. This is 8-bit normal quantization. Opposite lights reverse the blade-flank response and reveal the rounded rachis. |
| [royal_frond_orm.png](royal_frond_orm.png) | **8-bit RGB, linear.** R is a local cavity/overlap AO estimate, with contact darkening close to the rachis. G is roughness in the same blade coordinates: roughly 0.49–0.60 mature, 0.45–0.55 fresh, 0.65–0.87 declining. B is metalness, zero everywhere. | Channel formats and ranges checked. Open tissue reaches AO 1; crossings and proximal contact are darker. Median roughness is approximately 0.55 / 0.49 / 0.74 by slot. **Zero nonzero metalness pixels.** The lit previews use this AO and roughness without multiplying lighting into the saved base colour. |

The atlas contains **200, 196, and 193 leaflets** respectively. The third slot starts from 100 attachment positions per side, with seven omitted leaves and nine broken blades. There are 12, 15, and 55 small split tips across the three slots. The mature frond’s longest projected blade is about **0.84 m**, the younger one **0.75 m**, and the declining one **0.81 m**. Broad middle blades are approximately 3–4 cm wide; the tiny terminal blades taper below that. Angles, lengths, roots, bends, heights and pigment vary independently between sides. The old frond has stronger downward tip bends.

The midribs measure **341.0, 1023.5 and 1706.5 pixels** at their stalks. Each reaches the top and bottom rows. The bottom **0.42 m** contains only the petiole. The checker confirms one connected cutout per slot at native resolution, one connected nonzero-alpha support per slot, no detached native pixels, and no leaf pixels outside the bare-stalk width below its specified start. Side-margin checks include *all nonzero alpha*, not only alpha above the cut threshold. The guide’s 4.2 × 1.6 m authoring scale is used throughout.

The following is the share of each frond’s **fitted silhouette envelope** occupied by alpha after a 0.5 cut. For each native row the envelope spans the leftmost to rightmost cutout sample, including the rachis. That envelope is area-filtered to each smaller size without thresholding, so the denominator stays comparable. This measures density within the card outline, not occupancy of the entire rectangular slot. Whole-slot occupancy, area retention and connectivity are also recorded in [metrics.json](checks/metrics.json).

| Atlas height | Mature | Fresher | Declining |
| --- | --- | --- | --- |
| 2048 | 70.3% | 70.1% | 68.0% |
| 1024 | 70.2% | 70.0% | 67.8% |
| 512 | 70.1% | 70.2% | 67.7% |
| 256 | 70.8% | 70.7% | 68.2% |
| 128 | 72.8% | 72.8% | 72.0% |

At **256 pixels tall**, surviving cutout area relative to native is **100.76%, 100.85%, 100.26%** in slot order. The largest connected component contains **99.944%, 99.937%, 99.958%** of each surviving cutout. The three shapes retain their feather structure and central attachment; they do not disintegrate into floating groups. At 128 pixels the core feather still reads, while the finest tips and some petiole samples disappear. Slight area increases at the smallest levels come from the binary 0.5 threshold, without any mip-specific alpha boost. The RGB tests use straight, padded colour and the alpha tests use ordinary box/area filtering, equivalent to successive halves before the final cut.

Visual iteration corrected overly curled healthy blades, excessive open bands, weak proximal attachments in the aging source, and a half-pixel coordinate offset. A close alpha inspection also exposed pinholes produced by a thick-polyline rasterization shortcut; the builder now samples through a solid conservative polygon and resolves the actual blade shape analytically. The final alpha and close crops were inspected again after that correction. Earlier diagnostic images are separated in `checks/iterations/`.

The final inspection artifacts are:

- [layers.jpg](checks/layers.jpg): all four layers, masked for clear comparison.
- [base_over_layout.png](checks/base_over_layout.png) and [alpha_margins.png](checks/alpha_margins.png): full-size placement and margin review.
- `mip_02_grey.png` / `mip_02_sky.png`, and the corresponding `04`, `08`, and `16` pairs: exact-size reductions over middle grey and pale blue, all cut at alpha 0.5. [mip_ladder.jpg](checks/mip_ladder.jpg) presents them together.
- [lit_upper_left.png](checks/lit_upper_left.png), [lit_lower_right.png](checks/lit_lower_right.png), [relighting.jpg](checks/relighting.jpg), and [blade_detail.jpg](checks/blade_detail.jpg): both directions, including enlarged crease/crossing detail. These are diagnostic diffuse/specular previews, not in-engine renders.
- [metrics.json](checks/metrics.json): PNG header checks, colour-space metadata, SHA-256 hashes, margin and padding tests, stalk registration, roughness/AO statistics, normal agreement and all mip measurements.
- `slot_0_outline.json`, `slot_1_outline.json`, `slot_2_outline.json`: one `[row, left_x, right_x]` entry per image row, using global pixel coordinates, for fitting the cards.
- [source_overview.jpg](checks/source_overview.jpg): the two untouched generated source sheets on grey.

The generated sources remain at their original full sizes: [living leaflets](source/leaflets_living_generated.png), **1254 × 1254**, and [aging leaflets](source/leaflets_aging_generated.png), **1024 × 1536**. Six blades were requested in each sheet. The **built-in image generator** was used, with no fallback API or CLI. The exact prompt set is in [source/generation_prompts.txt](source/generation_prompts.txt). The final 2048 image is a composed material with newly authored fine detail, rather than a claim that the generator returned native 2048 imagery.

`source/composed_master_2048.png` preserves the finished master. `source/composition.json` records the physical scale, seeds and every blade’s controls, width, age, rank and damage. `source/leaflet_ids.png` and `source/overlap_count.png` retain assembly diagnostics. The standard sRGB profile is frozen in `source/sRGB.icc` to keep its creation timestamp from changing rebuilds.

A fresh end-to-end build reproduced **all four delivered PNGs byte for byte**, including their metadata. The before/after SHA-256 hashes and source/script hashes are recorded in [rebuild_verification.json](checks/rebuild_verification.json).

Rebuild locally with Python and the versions recorded in [requirements.txt](requirements.txt):

```sh
python3 build_material.py
python3 check_material.py
```

No network or generation service is needed to rebuild from these retained sources. Import only the base map as sRGB; height, normal and ORM are linear data. Use the requested 0.5 alpha cut and keep sampling within the chosen slot. The double-sided folded/arching card supplies the large frond shape; this height field supplies only millimetre-scale surface detail.

I would ship this texture set. Remaining limitations: the material is authored from generated tissue images, not measured botanical scans. Height, roughness and AO are authored estimates, and AO is not ray-traced. Twelve source blades recur with independent geometry and pigment variation. The proximal shoulders and rachis are deliberately substantial enough to survive ordinary filtering. The smallest mip cannot retain every terminal strand. The actual folded crown, two-sided foliage shading/transmission, wind animation and target-platform texture compression have **not** been evaluated in the game; the delivered previews test the atlas and its material response.


## Round 2 — folded blades and filtered edges

All four 2048 × 2048 layers have been replaced. Start with [the same-filter before/after comparison](checks/round2_comparison.jpg), [blade detail under opposite lights](checks/blade_detail.jpg), and [the magnified alpha edge comparison](checks/alpha_edge_detail.png).

The layout is locked to the delivered round 1 material. **Every native alpha ≥ 0.5 pixel is identical**, with zero new opaque pixels outside the old shape. All 589 blade records—curves, widths, source silhouettes, ranks, seeds, splits and breaks—are unchanged. `outline.json` is unchanged byte for byte; the per-row outline checks therefore reproduce the same card bounds. The 0.42 m bare stalk, slot margins, three slot characters, and **10 mm height encoding** are preserved.

| Layer | Round 2 change |
| --- | --- |
| `royal_frond_base.png` | Each blade now has distinct lighter/darker intrinsic pigment halves, a narrow pale midvein, and stronger variation in local tissue. The crease shifts slightly from the centre to vary flank widths without moving the blade's outline. Healthy tips receive varied subtle paling or a little brown. The existing individual widths and whole-blade tones remain. The dying slot retains its original generated tissue and yellow-green → ochre → brown progression, with restrained fold detail. **No contact shadows or specular highlights are baked into the base.** |
| `royal_frond_height.png` | Stronger, slightly varied planar crease flanks, rounded margins and a fine raised vein share the same blade coordinates as colour. Healthy cross-sections receive the larger change; dying blades receive a smaller adjustment. Rank offsets still resolve crossings. The final visible range is approximately **0.18–8.00 mm within the unchanged 0–10 mm encoding**. |
| `royal_frond_normal.png` | Regenerated exclusively from the saved 16-bit height at the original physical pixel pitches, in OpenGL convention. The blade halves now turn more distinctly toward opposite lights. |
| `royal_frond_orm.png` | A narrow lower-roughness stripe follows the crease for a faint waxy sheen on healthy blades. Crossing AO is stronger on the lower receiving surface and remains confined to nearby overlapping surfaces and rachis contacts. Open tissue reaches AO 1. Healthy roughness stays approximately 0.45–0.60; the dying frond retains its rougher response. Metalness remains zero. |

Alpha is now filtered from the original supersampled geometry with a compact 0.48-native-pixel Gaussian, integrated to native pixels, then constrained to preserve the old 0.5 cutout exactly. The former five alpha values become **all 256 levels**, with **403,193 fractional texels**. Across 1,559 isolated edges, the measured 10–90% transition has median **1.83 px**, with the central 80% spanning **1.72–1.84 px**. Tiny fringe samples below the first leaflet attachment are excluded to retain the strictly bare stalk; those edges retain fractional coverage on their inner side. Transparent RGB is still nearest-leaf colour extended independently through each slot, with **zero padding error**.

The checker independently samples matching exposed blade halves in the delivered maps, rejecting crossings covered by another blade. This confirms the visible change rather than only checking the renderer's parameters:

| Measurement | Mature | Fresher | Dying |
| --- | ---: | ---: | ---: |
| Exposed paired samples | 431 | 441 | 435 |
| Median normal separation across blade, round 1 → round 2 | 18.5° → 24.9° | 19.4° → 25.3° | 19.2° → 20.8° |
| Median crease rise above sampled flanks | 1.83 mm | 1.80 mm | 1.55 mm |
| Median green-channel difference between flanks | 13.7/255 | 11.4/255 | 9.8/255 |
| 256 px frond-envelope coverage | 70.77% | 70.65% | 68.15% |
| 256 px native cutout area retained | 100.73% | 100.78% | 100.23% |

All existing checks were regenerated: four-layer sheet, guide overlay, alpha/margins, 1/2 through 1/16 reductions over grey and sky, opposite-light renders, blade crops and JSON measurements. Native shapes remain a single connected component per slot, with zero detached pixels and zero nonzero alpha in forbidden margins. The largest component retains over **99.93%** of the surviving cutout at 256 px. Normal/height error is **0.173° mean, 0.302° at the 99th percentile, 0.377° maximum**, consistent with 8-bit quantization. [metrics.json](checks/metrics.json) includes the new silhouette, contour, crease, flank, sheen and edge-width measurements.

The enlarged detail previews now bilinearly sample RGB, alpha, normals and ORM **before** the 0.5 cut, so they show the actual filtering benefit. The previous preview enlarged an already thresholded image with nearest-neighbour sampling, which necessarily displayed a staircase. Native and mip coverage checks still use the literal cutoff with no alpha boost.

A new **1254 × 1254** tissue sheet was made with the built-in image generator, using the retained living sheet as its edit reference. It is saved untouched as [leaflets_fold_detail_generated.png](source/leaflets_fold_detail_generated.png), with the exact request in [generation_prompt_round2.txt](source/generation_prompt_round2.txt). Its internal pigment is rectified and stripped of broad illumination; **its outlines are never used**. The original living/aging sheets still determine the geometry. [round2_rectified_tissue.png](source/round2_rectified_tissue.png) preserves the processed swatch preview. The builder also refreshes the master, owner/overlap maps and composition metadata. The concept and coconut references were reviewed locally; no external reference images were searched for or downloaded.

`source/round1/` freezes the prior maps, scripts, geometry records, report and relevant checks. Its original base alpha is a required immutable build input for the silhouette lock; its other maps support independent before/after checks. The new source, original sources, updated builder/checker and frozen ICC profile are all local. Rebuild with the same two commands above, or run **`python3 verify_rebuild.py`** to rebuild, compare all four PNGs byte for byte, rerun checks and record hashes in [rebuild_verification.json](checks/rebuild_verification.json).

The final `verify_rebuild.py` run reproduced **all four delivered PNGs byte for byte**, then passed the complete checker.

The final review shows clearer blade halves and veins in the unlit map, reversing flank response under opposite lights, contact shading at crossings, and smoother filtered cut edges. The diagnostic checks cannot establish the result under the game's compression, transmission or actual crown mesh; no in-engine test was available here. No unresolved local check failures remain.
