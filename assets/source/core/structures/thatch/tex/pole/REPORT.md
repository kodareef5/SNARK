The four material maps are complete at **2048 × 2048**, with one shared origin and feature layout. The tile represents **1.5 × 1.5 metres**, or **0.732421875 mm per pixel**. Horizontal image direction follows the pole; vertical image direction goes around it. The full black-to-white height range represents **12 mm**. No cylinder curvature is included in the height or normals.

Start with [the layer sheet](checks/layers.jpg), [the 3×3 repeat](checks/tiling_3x3.jpg), [the 1:1 detail sheet](checks/detail_1to1.png), and [the pole context preview](checks/pole_context.jpg). The context preview adds circular geometry and lighting only for inspection.

| File | How it was made | Validation and observations |
| --- | --- | --- |
| [pole_base.png](pole_base.png) | **Generated sources, edited and composed by script.** Four original 1254 × 1254 source images were colour/contrast matched and quilted at native density using 230-pixel overlaps, minimum-error cuts, and narrow four-pixel transition feathers. Oversized source knot eyes were locally compressed. Broad illumination variation, bright/dark bark rims, and crevice shading were reduced; fine fibres, restrained weathering, bark pigment, and shallow trim-facet colour were retained or added. Final colour was centred on the requested mean. 8-bit RGB with an embedded sRGB profile. | Mean sRGB **(132.00008, 111.99990, 88.00006)**. Inspected the whole tile, wrapped half-offset, native-size crops, and 3×3 repeat. Grain runs horizontally, without plank divisions. No light or AO pass is multiplied into this file. |
| [pole_height.png](pole_height.png) | **Computed by script.** Shared bark segmentation raises remnants approximately two millimetres above peeled wood. Locally normalized source detail supplies shallow fibres and bark surface relief. Explicit branch-scar depressions/rims, 110 tapered drying checks, 27 subtle trim facets, and fine periodic fibres supply additional relief. 16-bit grayscale; white is high. | Actual saved range is **1.326–8.476 mm** within the 0–12 mm encoding. Mean clear wood is **4.668 mm**; mean bark interior is **6.640 mm**. Bark rises and checks cut down in the contact sheet and neutral-clay relighting. There is no overall pole bulge. |
| [pole_normal.png](pole_normal.png) | **Computed from the delivered height PNG after saving and reloading its uint16 samples.** Wrapped central differences use the 1.5 m tile size and 12 mm encoding. Components are normalized and encoded to 8-bit RGB. **OpenGL:** +X image-right, +Y image-up, +Z out of the surface. | Independently recomputed from disk: angular error **0.17154° mean**, **0.30187° at p99**, **0.38255° maximum**. The difference is consistent with 8-bit normal quantization. Opposite-light crops show the raised bark rims and recessed checks changing illumination in the expected directions. |
| [pole_orm.png](pole_orm.png) | **Computed by script.** Red contains a multiscale cavity approximation from physical height, incisions, and exterior bark-edge proximity. Green contains weathered wood roughness with grain/weathering variation and a higher bark value. Blue is exactly zero. 8-bit RGB, linear data, no colour-transfer profile. | Mean roughness is **0.7763 on clear wood** and **0.8958 on bark interiors**. Mean AO is **0.265 in deep checks** and **0.964 on clear wood**. All **4,194,304 metalness samples are zero**. Shared feature fields and overlays were inspected for alignment. |

The four untouched generated images are in [source/](source/), named `generated_pole_a.png` through `generated_pole_d.png`. Each is retained at the full **1254 × 1254** returned by the built-in **image_gen** tool. The exact common prompt and the additions for each variation are in [generation_prompts.json](generation_prompts.json). No fallback API generation, external reference-image search, download, or game imagery was used. The repository plank material was viewed only as the requested quality benchmark.

This is a composition of four native sources, not a single smaller picture enlarged to 2048. Most source pixels retain their native sampling density; the knot-size corrections and narrow quilt transitions are localized exceptions. Additional coherent fibre detail, pores, check profiles, and facet relief are evaluated directly on the final 2048 grid. The final base has **5.877 code values RMS** of residual after a one-pixel Gaussian, so the full-resolution texture contains measurable fine variation. [source/quilted_master.png](source/quilted_master.png) preserves the intermediate native-density composite before final albedo treatment.

Bark occupies **14.934%** of the tile using the shared mask at its 0.5 threshold. Every possible row starting position was checked for a wrapped 20 cm and 55 cm band. Bark coverage stays between **12.71–17.18%** in 20 cm bands and **14.14–15.82%** in 55 cm bands. There is no plain-only or bark-only band. The authored checks are approximately 2–40 cm long; their exact lengths, depths, seed, source hashes, and facet positions are in [checks/construction.json](checks/construction.json).

All twelve assertions in [checks/metrics.json](checks/metrics.json) pass. The checker verifies the PNG headers, dimensions, channel counts, bit depths, colour-profile placement, mean colour, zero metalness, normal/height agreement, bark coverage in bands, raised bark, and stronger cavity occlusion in checks. Its normal calculation is independent of the build's normal calculation and reads the final PNGs. A final offline rebuild reproduced **every pixel of all four primary maps exactly**; hashes of decoded pixel data are in [checks/rebuild_verification.json](checks/rebuild_verification.json).

Wrap measurements below use mean absolute differences in 8-bit-equivalent code values; the 16-bit height is divided by 257 only for this table. These compare adjacent samples, so opposite edge pixels are not forced to be duplicates.

| Layer | X wrap / interior mean | Y wrap / interior mean | Y interior line p99 / nearby line maximum |
| --- | ---: | ---: | ---: |
| Base | 3.325 / 3.264 | 8.530 / 9.309 | 11.216 / 9.670 |
| Height | 0.946 / 0.930 | 5.955 / 3.575 | 5.517 / 6.752 |
| Normal | 3.294 / 3.354 | 16.072 / 10.457 | 14.100 / 18.104 |
| ORM | 1.362 / 1.290 | 7.521 / 6.042 | 9.432 / 11.055 |

The larger Y height/normal difference is caused by a **36.3 cm, 2.615 mm-deep drying check** crossing the wrap near the top row. A first, global-p99-only criterion flagged this. The [1:1 wrap strip](checks/wrap_detail.png) shows a continuous cut, and neighboring interior rows contain larger differences. The final checker reports the original p99 figures transparently and tests for an isolated jump against both nearby rows and the full interior range. The feature was retained. All border filtering, added fields, and height derivatives use periodic boundaries.

Visual review covered the four-layer contact sheet, all four half-offsets, the 3×3 colour repeat, bark-mask overlay, neutral-clay and colour relighting from three directions, native-resolution base and normal crops, and four cylindrical context samples. I see no abrupt straight wrap line or obvious patch-grid boundary. The bark now retains texture within each remnant instead of the flat dark islands seen in the first build. Small scars blend into the grain rather than acting as large repeated knot targets. The native crops show individual fibres and narrow cuts. At the full 3×3 scale, a deliberate search can still identify repeated configurations of small features; a single periodic tile cannot eliminate all repetition.

The inspection files are reproducible:

- `checks/layers.jpg`: four-layer contact sheet.
- `checks/tiling_3x3.jpg`: overview; `checks/pole_base_tile3x3.png`: **6144 × 6144**, unreduced repeat.
- `checks/offsets.jpg` and `checks/pole_*_offset.png`: wrapped half-offsets; the height offset retains 16-bit samples.
- `checks/relighting.jpg`, `checks/relight_1.png` through `relight_6.png`, and `checks/relight_detail.png`: three colour and three neutral-clay light tests, plus a native-size colour comparison.
- `checks/detail_1to1.png`, `checks/pole_base_crop_1to1.png`, `checks/pole_normal_crop_1to1.png`: exact pixel crops, without enlargement.
- `checks/alignment.jpg`, `checks/bark_mask.png`, `checks/check_depth_mask.png`, and `checks/derivation.npz`: shared feature diagnostics.
- `checks/wrap_detail.png`: native-size strip spanning the Y boundary; `checks/pole_context.jpg`: circular-geometry context.
- `checks/metrics.json` and `checks/construction.json`: measurements and construction metadata.

To rebuild, use Python with NumPy, SciPy, and Pillow; version ranges are in [requirements.txt](requirements.txt). The supplied sources make the rebuild offline and do not require an image-generation account:

```sh
python3 build_material.py
python3 check_material.py
```

Enable sRGB only for `pole_base.png`. Import the other maps as linear data, use OpenGL normals, and enable repeat wrapping on both axes. For displacement, a useful reference plane is the nominal peeled-wood level at **4.7 mm**: `displacement_mm = height_sample * 12 - 4.7`.

Remaining limitations: this is authored material, not a measured scan. Bark segmentation, inferred micro-height, albedo/shading separation, roughness, and cavity AO are estimates. Small residual lighting cues in generated fibres may remain despite flattening; I cannot certify scan-grade reflectance separation. Bark edges are somewhat smoother than a real torn fragment at extreme magnification. The relighting previews are diffuse diagnostics, not a full renderer using the roughness channel, and this has not been tested under a particular engine's compression or mip settings.

The full **1.5 m tile** closes on both axes. An arbitrary **20–55 cm crop** of any nonconstant periodic image does not automatically have matching first and last rows. To handle that layout, `build_material.py` includes an optional **closed-band export**. It selects a closed minimum-error cut using extra rows beside the chosen band, applies the same cut to colour/height/ORM, and recomputes normals from the saved band height. The primary four 2048-square maps are unchanged. For example:

```sh
python3 build_material.py --band-cm 30 --start-row 570
python3 check_material.py --band-dir checks/band_30cm_row570
```

The worked [30 cm band](checks/band_30cm_row570/) is **2048 × 410** to preserve native texel density, physically **1.5 × 0.300293 m** after rounding to whole texels. It has its own four derived maps, metadata, half-offset, [repeat preview](checks/band_30cm_row570/tiling_2x3.png), and measurements. Its independent checks pass; maximum normal/height error is **0.37651°**. I inspected the repeated strip for a join. Use this mode for selected girths, or perform an equivalent join blend in the material shader; directly cropping the square alone is insufficient. The exporter accepts 20–55 cm and any starting row.

Time: approximately **18 minutes** of wall-clock work on **14 November 2026**, beginning at **18:37:09 UTC**, including four generations, source composition, scripting, visual revisions, validation, the optional band closure, and report writing. All deliverables, copied sources, scripts, and checks were written in the current folder.
