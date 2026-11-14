Pass 7 changes only the wrap origin of the **2048 × 2048 px, 3 × 3 m** boards material. The final map operation in [build_material.py](build_material.py) rolls all four already encoded maps **512 pixels right and 85 pixels down**, with wrap-around: `np.roll(pixels, (85, 512), axis=(0, 1))`. Every pixel value, channel and format is preserved. Reversing the roll recovers pass 6 exactly in base, height, normal and packed ORM; all four comparisons have **zero mismatches**. The base ICC profile is unchanged. No colour, relief, filtering, resampling or normal-vector changes were introduced.

[construction.json](checks/construction.json), its masks and [check_material.py](check_material.py) now use the shifted layout. Board boundaries are **y = k × 2048 / 12 + 85**, modulo 2048; the JSON retains thirteen unwrapped boundaries, ending at 2133, to describe all twelve complete courses. Board 11 crosses the top/bottom wrap. Nail columns are **x = 512 and 1536**; butt joints remain on boards **2, 5 and 9**, now at x = 1536, with their paired heads retaining the ±16 px offsets. All **54** nail centres move by the same periodic translation. No head crosses the horizontal wrap, so `wrap_x` is now false. Source-space synthesis parameters remain identified as such; delivered knot centres are recorded separately. The [layout overlay](checks/layout_overlay.png) shows the new positions.

The requested wrap measure is the **mean absolute jump across the entire wrap edge divided by the 95th percentile of the mean jumps across the 2047 interior row/column pairs**, including all channels and all nail/cavity pixels. Across compares the last and first columns; down compares the last and first rows. Jumps below use 0–255 code units (16-bit height divided by 257); that normalization cancels in the ratio. All eight ratios pass the limit of **4**.

| Map | Across jump | Across interior p95 | Across ratio | Down jump | Down interior p95 | Down ratio |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Base | 3.097005 | 3.612402 | **0.857326** | 9.673014 | 11.082389 | **0.872828** |
| Height | 0.724087 | 0.867944 | **0.834255** | 5.663814 | 6.899790 | **0.820867** |
| Normal | 1.517415 | 1.702458 | **0.891309** | 6.359701 | 8.603906 | **0.739164** |
| Packed (ORM) | 0.106283 | 0.142920 | **0.743651** | 1.615723 | 2.851562 | **0.566610** |

The brief's original failure values—height down **13.3**, packed down **22.9**, packed across **5.4**—are reproduced by dividing by the **mean** interior jump. With that denominator, the rolled maps also pass:

| Map | Across / interior mean | Down / interior mean |
| --- | ---: | ---: |
| Base | 0.945504 | 1.174048 |
| Height | 0.917407 | 1.181534 |
| Normal | 0.939819 | 0.982148 |
| Packed (ORM) | 0.698859 | 0.847842 |

Both denominator values and ratios are recorded under `seams` in [metrics.json](checks/metrics.json). The checker enforces both ratios ≤ 4, replacing the previous nail exclusion and special comparison of vertical wrap laps against other laps.

The [half-offset views](checks/offsets.jpg) and [enlarged seam detail](checks/half_offset_seam_detail.png) were regenerated and visually reviewed. In the half-offset coordinates, the current wrap crosses **(1024, 1024)** in board faces, between nail columns. The former y = 0 lap is at **y = 1109** and the former x = 0 nail column is at **x = 1536**. The detail sheet shows the current wrap in its upper panels and the preserved former-edge lap and nails in its lower panels. The full-resolution base, height, normal and ORM half-offset PNGs are also in `checks/`.

The complete checker passed: PNG dimensions/bit depth/profile, shifted lap and butt-joint detection, all nail centres and silhouettes, binary metalness, cavity-only AO, arris and surface relief, and the existing palette/contrast checks. Every construction-mask array equals its pass 6 counterpart under the roll, including wrapped board IDs. Independently rebuilding normals from the delivered quantized height yields **zero byte mismatches**. The base mean remains **(172.00014, 127.99965, 81.99985)**. Both relighting previews and the neutral relief preview exactly match their pass 6 pixels under the roll. Feature crops follow their original subjects; [comparison](checks/pass_comparison.jpg) and [contact](checks/contact_sheet.jpg) sheets include the original tile and aligned detail comparisons.

[verification.txt](checks/verification.txt) records the successful checks; [pass7_build.txt](checks/pass7_build.txt) records the rebuild. Pass 6's maps, scripts, report, construction data and previews were archived before editing in [checks/pass6/](checks/pass6/), with all **44** files verified against its SHA-256 manifest. The [pass 6 report](checks/pass6/REPORT.md) preserves the palette and prior construction history. The build still checks the unrolled physical PNGs against passes 2, 4 and 5 before applying the final roll; their hashes in construction metadata explicitly refer to those pre-roll PNGs.

Rebuild and verify from this folder with Python 3, Pillow, NumPy and SciPy:

```sh
python3 build_material.py
python3 check_material.py
```

Use repeat wrapping, 3 metres per tile, sRGB sampling only for base, and linear sampling for height, OpenGL normal and ORM (R AO, G roughness, B metalness). Height remains 16-bit, 0–12 mm, white high; the other maps remain RGB 8-bit. All writes stayed inside `boards`. No git commands were run. Pass 7 completed 14 November 2026.
