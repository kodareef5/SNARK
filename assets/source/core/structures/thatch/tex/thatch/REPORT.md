The four delivered maps are **2048 × 2048**, cover **1.5 × 1.5 metres**, and share the same pixel origin. Row zero is the top; stems point downward. There are exactly **four 512-pixel courses**, with geometry origins at **0, 512, 1024 and 1536**. Each course contains **11 complete bundles**, giving 44 differently shaped sheaves in the tile. Authored bundle widths are **11.74–14.28 cm**, within the requested 9–15 cm range. Adjacent courses are staggered by approximately half a bundle.

Binding centres were registered into local rows **50.92–61.23**, inside the upper 15% of each course. The preceding course's fringe extends over them. Approximately **61.4%** of the authored binding masks remains visible; coverage varies along each band. The tips have individually varying silhouettes, and their colour is slightly greyer than the protected stems. There are no holes, rot, moss or green growth.

| File | How it was made | Inspection and result |
| --- | --- | --- |
| `thatch_base.png` | **Generated source, edited and computed by script.** Registered the source courses and bindings, quilted the two repeat directions, attenuated seven conspicuous long stray arcs, and transported preceding-course stems over the ties. Removed broad illumination, lifted dark crevices and extended crest reflectance across the reed widths. Added intrinsic pigment and epidermal detail, slight tip greying, and a final global colour correction. RGB, 8 bits/channel, embedded sRGB profile. | Inspected the layer sheet, native crop, half-offset and 3×3 repeat. The tied region is not a painted dark stripe. No AO is multiplied into albedo. Final mean: **(190.0002, 165.9999, 112.0001)** in encoded sRGB. |
| `thatch_height.png` | **Computed by script.** Rounded local bundle cross sections, locally normalized source reed/rope ridges, small raised fringe tips, and the same native epidermal field used in colour. Grayscale, **16 bits**. No course slope or geometric step is added. | Inspected beside albedo and in neutral-clay relighting. Bundle crowns are raised; individual reeds, bindings and tips retain local relief. The stored range is 7.403–20.883 mm within the 32 mm encoding. |
| `thatch_normal.png` | **Computed from the saved, quantized height.** Wrapped central differences at 0.732421875 mm/pixel, followed by normalization and RGB quantization. **OpenGL: +X right, +Y image-up, +Z outward.** RGB, 8 bits/channel, linear data. | Independently reconstructed from the delivered height. Angular error: **0.171° mean, 0.316° at the 99th percentile, 0.385° maximum**. Opposing and raking lights change the reed shading in the expected directions. |
| `thatch_orm.png` | **Computed by script.** Red: cavity and receiving-surface occlusion beneath the actual fringe mask, between bundles and between fine ridges. Green: rough dry stems with smoother grass bindings. Blue: **zero everywhere**. RGB, 8 bits/channel, linear data. | Packed channels inspected beside the height and in relighting. Straw roughness averages **0.875**, visible ties **0.781**; total encoded range is approximately **0.75–0.95**. Metalness has **zero nonzero pixels**. |

The full grayscale range represents **32 millimetres**: `height_mm = sample × 32`. A renderer needing centred displacement can subtract its chosen reference height; this does not change the normals. The map deliberately does not use the full numerical range. Its approximately 13.5 mm occupied relief is the local detail on top of the supplied sloping/stepped mesh. The normal calculation is `normalize(-dh/dx, +dh/drow, 1)`, using millimetres on both axes. Enable sRGB only for the base colour, and repeat wrapping on both axes for all four maps.

Two original pictures were produced with the **built-in imagegen tool**, exclusively from the written description. No reference-image search, download, existing-game image, or fallback API/CLI was used. Both returned **1254 × 1254**, and both remain unchanged at that full size in `source/`: `generated_reed_stock.png` and `generated_thatch_layout.png`. Their exact prompts are `generation_prompt.txt` and `layout_generation_prompt.txt` in the same directory.

The final detail is not merely an enlarged 1254-pixel picture. The layout is reconstructed into a 2048 master. **44 separate epidermis patches** from the close reed stock are sampled at 1.3 source pixels per output pixel horizontally and 1.35 vertically, then blended into the four courses. A further deterministic 2048-resolution longitudinal fibre field adds fine variation. The combined field contributes to both pigment and physical displacement. Its prefilter displacement coefficient is 0.07 mm, with an input amplitude limit of ±0.21 mm. These are fine fibres on the larger generated stalks, not a claim of a native 2K photographic scan.

Other files in `source/` are **computed intermediates**: `cleaned_layout.png` and `repeat_cleanup_mask.png` record repeat-mark suppression; `registered_master.png` preserves the final aligned structure; `pigment_master.png` preserves the final albedo master; `native_fibre_field.png` stores the fine field; and `bundle_ids.png`, `fringe_mask.png`, `tie_mask.png`, and `tie_mask_before_overlap.png` preserve construction fields. `build_manifest.json` records physical scales, control points, bundle dimensions, source hashes and the seed. `sRGB.icc` is frozen so repeated builds also reproduce colour-profile bytes.

`build_material.py` rebuilds every delivered map and computed intermediate from the retained originals. `check_material.py` reads the delivered PNGs independently, validates their formats and numerical relationships, and regenerates the inspection artifacts. `requirements.txt` pins the three library versions used here. Rebuild with:

```sh
python3 -m pip install -r requirements.txt
python3 build_material.py
python3 check_material.py
```

For the deterministic rebuild check, run `python3 check_material.py --rebuild`. This runs the builder twice, compares SHA-256 hashes of all four complete PNG files, and then performs the normal checks. The final two builds were **byte-for-byte identical**; results are in `checks/rebuild.json`. All **15** validation checks passed.

The inspection artifacts in `checks/` are:

- `layers.jpg`: the four maps together.
- `base_3x3.jpg`: full **6144 × 6144** base-colour repeat; `base_3x3_overview.jpg` is the smaller viewing copy.
- `thatch_*_offset.png`: full-resolution, half-tile wrapped offsets of every map; the height offset retains 16-bit precision. `offsets.jpg` collects their previews.
- `relighting.jpg`: upper-left, lower-right and raking-right lighting. Each light also has a full-size `relit_*.jpg`; `relit_clay.jpg` removes the pigment cue.
- `detail_1to1.png`: base colour and normal at exactly **one image pixel per texture pixel**. `detail_data_1to1.png` and `detail_relit_1to1.png` show the same area in the data maps and lit/clay views.
- `alignment.png`: source-feature contours over the corresponding colour and height crop.
- `course_layout.png`: exact geometry-origin rows marked over the base colour.
- `metrics.json`: formats, hashes, colour mean, roughness, normal agreement, course-height trends and seam measurements.

I inspected the final 3×3 repeat, layer and offset sheets, native detail, and the three relighting directions. The first procedural study was too smooth and uniform, so it was replaced with the natural generated layout and stock-derived fine detail. Iteration also removed a height discontinuity, made the ties partly hidden, registered their vertical positions, and fixed a roughness discontinuity at the wrap. In the final offsets I do not see a special join at the centre. The horizontal courses remain readable without a conspicuous knot, stain or repeated colour patch dominating the large repeat.

The seam test compares adjacent pixels across each wrap with adjacent pixels inside the image. Opposite edge pixels should be adjacent samples, not forcibly identical. Values below are normalized channel differences, **0–1**, averaged over the whole seam. The 95th percentile is taken over interior line averages, making it comparable with the wrap average.

| Map | Wrap | Wrap mean | Interior mean | Interior line P95 |
| --- | --- | ---: | ---: | ---: |
| `thatch_base.png` | left/right | 0.02893 | 0.02918 | 0.03394 |
| `thatch_base.png` | top/bottom | 0.00892 | 0.00759 | 0.01488 |
| `thatch_height.png` | left/right | 0.01243 | 0.01285 | 0.01518 |
| `thatch_height.png` | top/bottom | 0.00236 | 0.00218 | 0.00501 |
| `thatch_normal.png` | left/right | 0.08280 | 0.08477 | 0.09705 |
| `thatch_normal.png` | top/bottom | 0.02070 | 0.01778 | 0.03944 |
| `thatch_orm.png` | left/right | 0.02508 | 0.02378 | 0.02906 |
| `thatch_orm.png` | top/bottom | 0.00444 | 0.00430 | 0.00970 |

Every wrap mean is below its corresponding interior-line P95. Across the four geometry-origin rows, the largest absolute mean-height jump is **0.0138 mm**. Fitted body-height trends are only **0.026–0.046 mm per course**, confirming that an additional course-sized ramp or step was not baked into the height.

Remaining limitations: the fine ridge height is inferred from generated surface appearance, and AO/roughness are authored estimates, not measurements or ray tracing. Removing lighting from a generated source is an approximate intrinsic-colour reconstruction; very small pigment/relief ambiguities remain. Some upper fringe contours are more uniform than naturally packed loose straw. A single tile necessarily repeats: the large stray arcs were reduced and there is no dominant stain or knot, but careful inspection can still identify recurring individual sheaves. The 3×3 and lighting checks are offline diagnostics, not an in-engine evaluation of the actual building meshes, mipmaps or texture compression.

Work took approximately **27 minutes** on 14 November 2026, including generation, rejected-study work, construction, visual revisions, checks and reporting. It began at **18:37:11 UTC**; final artifact review and report writing completed at **19:04:31 UTC**. All deliverables and rebuild inputs are in this folder and its `source/` and `checks/` subdirectories.

## Round two — readability across a yard

The four maps in the material folder now contain round two. The earlier sections above document round one; this section supersedes their numerical results for the current maps. Before rebuilding, all four accepted PNGs were copied unchanged into `round1/`. Their complete-file SHA-256 hashes still match the accepted measurements, frozen as `source/round1_metrics.json`; the original layout manifest is retained as `source/round1_build_manifest.json`. Both generated source images remain unchanged. This revision used the existing procedural build and the supplied local house/door renders only; no reference search, download, new image generation or existing-game imagery was used.

The revision changes three things:

- **Bundle pigment and valleys.** Each of the same 44 bundles now has a deterministic cream, gold or older grey straw pigment offset. Soft transitions retain the original reed detail. Valleys receive only a small base-colour reduction (maximum RGB subtraction of 4, 3.5, 3 codes). The stronger separation comes from 1.28× crown relief, an additional valley depth of up to 1.4 mm, and a broad valley term in AO. Per-course crown profiles have equal mean height, preventing batch differences from becoming geometric steps.
- **Reed batches.** Course pigment offsets are +8%, −8%, +3.5% and −3.5%, with small warm/grey chroma changes. These are intrinsic pigment differences, not illumination. The final common colour correction preserves the tile mean. Colour, crown and valley fields follow the preceding course's fringe, so its tips keep their parent bundle's appearance over the next batch.
- **Longer broken fringe.** The four origins remain exactly rows 0, 512, 1024 and 1536. Most hanging clumps reach 70–110 pixels beyond them (5.13–8.06 cm). Short notches between clumps expose the receiving course's ties; a few narrow stems reach about 140 pixels. The source transport is monotonic, without folding or reversing the stems. The shared silhouette controls source transport, pigment, local relief and occlusion. Fine fibres remain present in both colour and height.

All filenames, formats, 2048 × 2048 resolution, 1.5 m coverage, stem direction, 11 whole bundles per course, bundle widths, stagger, and binding registration are preserved. The height encoding remains **32 mm over the full grayscale range**; occupied values are now **5.315–23.300 mm**. OpenGL normals are regenerated from the saved 16-bit height using wrapped physical-scale differences. ORM remains linear AO/roughness/zero metalness, and only the base colour carries an sRGB profile.

The updated checker compares the actual saved maps and the retained round-one maps. Distance previews area-filter base colour in **linear light**, filter normal/ORM data, renormalize the normals, and then apply identical lighting. This checks broad features after texture minification, rather than merely shrinking a finely lit image.

| Measurement | Round one | Round two |
| --- | ---: | ---: |
| Mean within-course standard deviation of bundle-body luma at 200 px/tile, 0–255 encoded scale | 0.43 | 12.70 |
| Course-body luma offsets from their common mean at 200 px/tile | approximately 0% throughout | +8.06%, −7.92%, +3.44%, −3.57% |
| Mean crown-to-valley height difference, sampled with identical masks | 4.68 mm | 7.23 mm |
| Mean crown-to-valley AO difference, 0–1 scale | 0.014 | 0.335 |
| Visible fraction of authored binding masks | 61.4% | 36.9% |

Fringe measurements come from the saved mask: **61.6–63.5%** of each boundary's width has tips in the 70–110 px range; **27.0–27.5%** consists of notches ending before 45 px; roughly **0.9–1.3%** has stray tips beyond 110 px. Remaining columns form the transitions between the notches and long clumps. Median tips reach 80–82 px. The visible ties appear through these gaps, with darkness supplied by AO.

New comparison artifacts in `checks/`:

- `round_comparison_200px.png`: paired round-one/round-two tiles, exactly 200 × 200 px each, showing base colour and two identical light directions.
- `round_comparison_3m_wall_10m.png`: 2 × 2 repeats, exactly 400 × 400 px per 3 m wall, in base colour and matched lighting.
- `round_comparison_fullsize.png`: complete 2048 × 2048 tiles side by side at 1:1, both base colour and matched lighting; no texture resizing.
- `round_comparison_distance_sweep.png`: matched lighting at 400, 200 and 133 pixels per tile, approximating 5, 10 and 15 m at the requested viewing scale.
- `round_comparison_metrics.json`: bundle contrast, batch offsets, crown/valley comparisons, measured tip lengths, preservation checks and their pass/fail results.

All original layer, half-offset, 3 × 3 tiling, native-detail, alignment and relighting checks were regenerated. I inspected the comparisons, native fringe crop, three-light relighting, offsets and tiled overview. Bundles remain individually readable at 200 and 133 pixels per tile. The fringe visibly overlaps the receiving course in irregular clumps, with ties visible between them. No special join appears at the wrapped boundaries. Stronger colour separation makes the four-course batch sequence easier to recognize in a large repeat; that is an unavoidable tradeoff with the requested four-course variation in one fixed tile.

`python3 check_material.py --rebuild` completed successfully: **all 26 checks pass**, and the two rebuilds produced **byte-for-byte identical PNGs** (`checks/rebuild.json`). Final mean sRGB is **(189.9995, 166.0000, 111.9998)**. Normal/height angular error is **0.171° mean, 0.316° P99, 0.385° maximum**. Every wrap difference remains below the corresponding interior-line P95. Maximum absolute mean-height jump at a course origin is **0.0072 mm**, and fitted body trends are **0.037–0.049 mm per course**; no course slope or step was added. Roughness remains approximately **0.75–0.95**, and metalness is zero everywhere. The rebuild commands and pinned dependencies listed above are unchanged.

These are material previews, not a new in-engine house render: they do not reproduce the game's stepped mesh, texture compression or renderer. The painted fringe breaks up surface colour and shading, but opaque material maps cannot change the mesh silhouette or its cast-shadow edge. Round two took approximately **six minutes** on 14 November 2026, including inspection, revision, comparison generation, deterministic rebuilding and reporting.
