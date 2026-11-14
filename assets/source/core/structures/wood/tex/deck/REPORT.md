Pass 5 is complete. [deck_base.png](deck_base.png) now follows the unlit **D (167, 138, 101)** target in [DESIGN.md — Material palette](../../ref/concept/DESIGN.md#material-palette). Its measured whole-tile mean is **sRGB (167.000, 138.000, 101.000)**, replacing pass 4's (156.000, 106.000, 64.000). The written 8-bit sRGB palette supersedes the warm-lit painting samples used previously.

The change lives in [build_material.py](build_material.py). It halves the original authored board-colour offsets, retains the local weathered grain, and applies restrained pigment shifts toward **B (172, 128, 82)** in the existing walking-polish mask and **E (186, 149, 107)** immediately beside existing exposed ends. Their strengths are 18% and 20% of the respective D-to-B/E colour differences, attenuated by the local masks and wood coverage. A final coverage-weighted translation centres the whole tile on D. Full dirt-gap pixels and every metal-head pixel keep their exact pass-4 colours. No resampling, new layout, random samples or lighting are introduced.

Measured board-mean standard deviations fall from **(5.81, 6.01, 5.71)** to **(3.25, 3.25, 2.97)** sRGB code values: 52–56% of pass 4's variation. The individual boards remain recognisable, with quieter differences within one species. Raised, worn fibres still average lighter than low grain: **(186.10, 157.26, 119.57)** versus **(164.33, 134.27, 96.18)**. Water marks, scuffs and grain retain their locations and local detail. Mean-swatch HSV saturation drops from approximately **0.590 to 0.395**. The lighter blue target needs no low-end toe curve; saved channel minima/maxima are **(45, 39, 31) / (231, 205, 167)**, without clipping.

| Delivered file | Format and pass-5 status |
| --- | --- |
| [deck_base.png](deck_base.png) | RGB, 8-bit sRGB, original embedded ICC profile; revised unlit palette. |
| [deck_height.png](deck_height.png) | Byte-for-byte identical to pass 4; 16-bit grayscale, 0…65535 = 0…12 mm. |
| [deck_normal.png](deck_normal.png) | Byte-for-byte identical to pass 4; 8-bit RGB, linear, tangent-space OpenGL. |
| [deck_orm.png](deck_orm.png) | Byte-for-byte identical to pass 4; 8-bit linear RGB: AO, roughness, metalness. |

All maps remain **2048 × 2048 over 3 × 3 metres**. Layout metadata, all 17 construction masks, the compressed mask archive, source atlases and ICC bytes are unchanged. The same 12 board bands, eight butt joints and 112 dark forged nail heads remain. Distant contrast at former joint sites is **1.266** code values versus pass 4's **1.237**, retaining the quiet end-joint pattern.

[checks/contact_sheet.jpg](checks/contact_sheet.jpg) starts with pass 4 and pass 5 side by side and includes both 4 × 4 repeats at exactly 512 × 512 pixels. [checks/base_colour_comparison.jpg](checks/base_colour_comparison.jpg) compares the full tile and identical native detail; [checks/distance_comparison.jpg](checks/distance_comparison.jpg) compares the repeats unlit and under identical lighting. Visual review covered these sheets, the full base and the offset/repeated views: the orange cast is reduced, foot-worn fibres remain visible, and no new alternating light/dark board pattern or conspicuous end stripe appears. These are texture previews, not an engine review.

The complete [checker](check_material.py) passed: [verification.txt](checks/verification.txt) and [metrics.json](checks/metrics.json). Checks cover the new target, quieter board variation, retained local pigment, unchanged maps/masks/layout, formats, spacing, quiet joints, nails, physical relief, ridge polish and exact normal recomputation from saved height. Two consecutive builds produced byte-identical base, height, normal, ORM and mask files, with identical construction metadata apart from build timing; [rebuild_verification.json](checks/rebuild_verification.json) records the hashes. Those hashes also match the maps used for the checker and review sheets.

The untouched pre-edit maps, scripts, report, construction data and selected review outputs are archived in [checks/pass4/](checks/pass4/), with SHA-256 values in [archive.json](checks/pass4/archive.json). Earlier pass archives remain available there alongside pass 4.

Rebuild and verify from this folder:

```sh
python3 build_material.py
python3 check_material.py > checks/verification.txt 2>&1
```

For engine import, enable sRGB only on base colour; keep height/normal/ORM linear and repeat wrapping on both axes. Decode height as `value / 65535 * 12` millimetres; invert normal green only for a DirectX-normal pipeline.

All writes stayed inside this deck folder. No Git commands were run.
