Round 3 repairs the binding at the top/bottom boundary. **All four delivered layers now have `seam_x < 2` and `seam_y < 2` using the engine's exact measure. All 47 validation assertions pass.** The accepted golden reeds, cut butts, interior bindings, course relief and panel joints retain their Round 2 layout.

The nominal row-0 binding is centred on the boundary between texel centres 2047 and 0: its unwrapped centre is **-0.5**, with one half of its thickness at the bottom and the other at the top. Its colour, height, twist, stitch turns, compression and cavity masks use the same wrapped coordinates. Only this boundary cord follows a straight joint-centred path; the other eleven binding paths are unchanged. Its compressed cross-section has a broader crown and rounded shoulders, with the twist continuing across both halves. This keeps the height slopes, and therefore the derived normals, continuous enough to meet the same criterion as the other maps.

Round 2 already wrapped row indices, but its wandering edge cord and steep cross-section produced large differences between the adjacent boundary samples. Its former acceptance test compared the wrap with high-percentile internal lines, so it incorrectly accepted the engine failures. That acceptance rule is replaced by the exact whole-image ratio, with no special allowance for binding rows. Internal-line percentiles remain diagnostic only.

`check_material.py` measures the reopened PNG samples, summed over **all rows/columns and all channels**, with signed 64-bit subtraction and accumulation:

```
edge_x = sum |p[y][w-1] - p[y][0]|        over all rows and channels
inner_x = sum |p[y][x] - p[y][x+1]|        over all rows, channels and x < w-1
seam_x = edge_x * (w - 1) / inner_x

edge_y = sum |p[h-1][x] - p[0][x]|        over all columns and channels
inner_y = sum |p[y][x] - p[y+1][x]|        over all columns, channels and y < h-1
seam_y = edge_y * (h - 1) / inner_y
```

The checker records the raw sums and ratios in `checks/metrics.json`, flags engine failures above 4 and remarks above 2, and requires **strictly below 2** for this delivery. No channel averaging, percentile denominator, epsilon or excluded binding band changes these ratios. A constant layer with zero edge and interior differences returns zero.

| Layer | Round 2 seam_x | Round 2 seam_y | Round 3 seam_x | Round 3 seam_y |
| --- | ---: | ---: | ---: | ---: |
| `roof_base.png` | 0.752080 | 4.323172 | **0.751892** | **0.879702** |
| `roof_normal.png` | 0.971623 | 6.655425 | **0.971784** | **1.752540** |
| `roof_height.png` | 0.755434 | 8.731534 | **0.755449** | **0.498636** |
| `roof_orm.png` | 1.116453 | 7.374389 | **1.116270** | **0.193243** |

The metric was also checked against independent scalar sums on a small RGB array, 16-bit values spanning 0–65535, and a constant layer. Applying it to the retained Round 2 maps reproduces all four reported vertical failures.

All maps remain **2048 × 2048**, registered over **3 × 3 metres**, repeating both axes at **1.46484375 mm/pixel**.

| Delivered file | Construction and import |
| --- | --- |
| `roof_base.png` | **8-bit RGB, sRGB.** The same generated sources C and D, course quilting, individual reeds, handful variation, cut-end pigment and cord twist as Round 2. The boundary cord is rebuilt across both ends of the image. Round 2's channel translation is retained exactly so the local repair cannot recolour the rest of the panel. |
| `roof_height.png` | **16-bit grayscale, linear, white high; 0–65535 = 0–25 mm.** The edge cord and its stitches/dimples use the joint-centred profile. Round 2's fixed height datum is retained. Actual extrema remain **0.199893–24.898528 mm**, a **24.698634 mm** span, without clipping. The mesh's 10 mm course steps remain separate. |
| `roof_normal.png` | **8-bit RGB, linear, OpenGL.** Regenerated from the reopened delivered 16-bit height using periodic central differences, `(-dh/dx, +dh/dy, 1)` for image Y increasing downward. No independent normal-edge painting. |
| `roof_orm.png` | **8-bit RGB, linear.** R is derived from height cavities and shared feature masks; G is dry-reed/cord roughness; B is exactly zero. AO and roughness therefore follow the same wrapped cord. Roughness remains **0.7059–0.9490**, mean **0.8645**; AO **0.4314–1.0**. |

Course rows remain **171, 512, 853, 1195, 1536, 1877**. Binding rows remain **0, 171, 345, 512, 679, 853, 1027, 1195, 1363, 1536, 1709, 1877**. There are still **1,591 cut-end faces**, **240 handfuls** and **300 stitches**, with cyclic stitch spacing **105.6–134.1 mm**. The panel joint remains on all four boundaries with its original 15–30 px shoulder.

Regression checks compare against the preserved Round 2 delivery:

- Every pixel in **rows 80–1967 inclusive** is identical in all four layers. The conservative 80 px boundary band includes the repaired cord and the support of the derived normal/AO filters.
- All eleven interior cord paths and their stitch coordinates are unchanged.
- The complete course, cut-butt, bundle-height and panel-joint fields are identical.
- The assembled reed master has identical pixels. PNG byte equality is not required because the generated sRGB profile includes its creation date.
- The edge cord covers both the first and last row, and all earlier format, colour-space, coverage, relief, stitch-spacing, source-preservation and normal-agreement requirements pass.

Mean encoded base colour is **(180.002, 145.005, 90.005)**. Local luminance contrast is **38.5673**, effectively unchanged from Round 2's 38.568 and still **2.52×** Round 1. Normal/height error is **0.1712° mean**, **0.3138° p99**, **0.3835° maximum**.

The production workflow remains:

```sh
python3 build_material.py
python3 check_material.py > checks/check_log.txt
```

Both commands completed successfully. Python, NumPy, SciPy and Pillow are required. Pixel authoring retains seed **621405**. `material.json` records the scale, anchors, source hashes, quilting, handfuls, binding paths and the boundary-cord parameters. `source/derivation.npz` retains the aligned feature fields. The final material rebuild took **63.875 seconds**.

The original generated pictures A–D remain untouched at full resolution. No new image generation or external references were needed. Round 2's maps, scripts, report, metadata, metrics, assembled master and derivation fields are preserved in `source/round2/`; the existing `source/round1/` archive and generation prompts remain available.

Visual checks were regenerated. Start with [the native boundary comparison](checks/edge_binding_comparison.png): each strip places the bottom 40 rows immediately above the top 40 rows, with Round 2 on the left and Round 3 on the right, for all four maps. The centre of each strip is the wrap. I also inspected [both low-sun directions](checks/relighting.jpg) and [the 3 × 3 repeat](checks/tiling_3x3_overview.jpg). The edge now reads as one cord, while the accepted reed field and intended panel grid remain intact.

The full layer sheet, native detail, half-offset, offset layers, 3 × 3 tiling, two relit maps and crops, roof preview, concept comparisons, wood comparison and course-registration view are also regenerated in `checks/`. The measurements and **47/47** results are in [metrics.json](checks/metrics.json), with the run output in [check_log.txt](checks/check_log.txt).

The existing limitations are unchanged: height, AO and roughness are authored estimates; source photographs retain some fine shading; the previews are diagnostic renders rather than the game engine. The seam results above apply to the delivered PNGs. No engine import or compressed-mip test was run. Enable sRGB only for the base, use OpenGL normals, repeat both axes and retain the **25 mm** local height scale.

Round 3 validation and visual review completed on **14 November 2026 at 20:50 UTC**. Repository changes are confined to this roof folder.
