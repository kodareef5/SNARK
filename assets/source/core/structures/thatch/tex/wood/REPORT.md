**Round 3 is a colour revision: deeper warm bark, honey exposed wood and honey cut ends.** Start with the [cylinders before/after](checks/cylinders_before_after.jpg), [updated cylinder preview](checks/cylinders_close.jpg), [native-size colour comparison](checks/bark_before_after.jpg), and [four layers](checks/layers.jpg). The four maps remain **2048 × 2048** with the accepted layout, scale and encodings.

The new build changes base colour in bands 1, 2, 3 and 5. **Band 4 is pixel-identical in all four maps. Height, normal and ORM are pixel-identical across the entire atlas.** The independent checker also confirms identical bark masks, incisions, disc masks, cord fields, source-window placements, fractures, facets, turn geometry and end registration. Round 2's maps, scripts, report, fields and measurements are frozen under [checks/round2/](checks/round2/), with their hashes in [round3_baseline.json](checks/round3_baseline.json). These are comparison fixtures; the builder reconstructs everything from `source/` without reading the archived maps.

All colour values below are measured **8-bit sRGB code values**, not linear-light averages. Fresh wood excludes bark and weathered regions; cut-face measurements exclude the bark rim and atlas padding.

| Region | Round 3 measured mean RGB | Requested mean RGB |
| --- | --- | --- |
| Band 1, whole strip | **113.9, 80.0, 52.7** | about 115, 80, 52 |
| Band 1, fresh stripped patches | **184.9, 145.0, 95.0** | honey wood |
| Band 2, fresh exposed wood | **185.0, 145.0, 95.0** | about 185, 145, 95 |
| Band 2, bark cores | **104.2, 70.3, 45.5** | same bark as band 1 |
| Band 1, bark cores for comparison | **103.7, 69.9, 45.2** | — |
| Band 3, whole strip | **124.6, 88.3, 56.6** | about 125, 88, 56 |
| Band 4, whole strip, unchanged | **204.2, 178.4, 130.8** | unchanged |
| Band 5, each of six cut faces | **190.0, 150.0, 100.0** | about 190, 150, 100 |
| Band 5, dark bark rims | **98.0, 65.0, 41.0** | dark bark |

Band 2's whole-strip average is **147.4, 111.1, 73.4**, because roughly 46% is bark. Band 5's whole-band average is **145.2, 108.6, 71.2**, including its dark padding and rims. These whole-band numbers should not be compared with the brief's fresh-wood and cut-face targets.

| File | Construction and encoding |
| --- | --- |
| [wood_base.png](wood_base.png) | **Generated sources, composed and recoloured by script.** Accepted native-resolution quilts, source registration, knots and detail remain. Round 3 separates bark and exposed-wood pigment, deepens brown bark with dark fissures and lighter ridges, retains sparse grey lichen, warms bare wood and recolours the six cut faces and rims. The cord construction is unchanged. RGB, 8 bits/channel, embedded **sRGB** profile. No directional lighting or AO pass is multiplied into base colour. |
| [wood_height.png](wood_height.png) | **Computed by script, exactly unchanged from round 2.** Shared bark, checks, facets, grain and cord fields supply local relief. No pole curvature is baked in. **16-bit grayscale**, white high, linear data. |
| [wood_normal.png](wood_normal.png) | **Computed from the saved and reloaded 16-bit height**, exactly unchanged. Physical-scale central differences wrap independently on both axes within bands 1–4; band 5 uses nonperiodic differences. RGB, 8 bits/channel, linear data. **OpenGL: +X right, +Y image-up, +Z outward.** |
| [wood_orm.png](wood_orm.png) | **Computed by script, exactly unchanged.** R: multiscale cavity AO. G: roughness, approximately **0.89 bark, 0.75 peeled wood, 0.88 cord**. B: **zero everywhere**. RGB, 8 bits/channel, linear data without a colour profile. |

The sheet covers **1.5 × 1.5 m**, giving **0.732421875 mm/pixel**. Horizontal texture direction follows a pole's length. **Black-to-white height represents 10 mm**; delivered values span **1.118–9.793 mm**, without clipping. The nominal peeled surface is 4 mm (`height_sample * 10 - 4` millimetres). Normal strength follows the delivered height directly.

The layout uses **half-open intervals**, with pixel y increasing downward. All x intervals are `[0, 2048)`.

| Band | Exact rows, inclusive | Half-open y interval | Height | Top-origin V edge interval | Content |
| --- | --- | --- | ---: | --- | --- |
| 1 | 0–613 | `[0, 614)` | 614 px | `[0, 0.2998046875)` | Deep brown bark-on; 89.11% bark coverage |
| 2 | 614–1125 | `[614, 1126)` | 512 px | `[0.2998046875, 0.5498046875)` | Honey wood and deep brown bark islands; 45.85% bark coverage |
| 3 | 1126–1433 | `[1126, 1434)` | 308 px | `[0.5498046875, 0.7001953125)` | Warm brown thin-stick bark; 99.09% bark coverage |
| 4 | 1434–1781 | `[1434, 1782)` | 348 px | `[0.7001953125, 0.8701171875)` | **164 side-by-side turns of two-ply dry grass cord** |
| 5 | 1782–2047 | `[1782, 2048)` | 266 px | `[0.8701171875, 1)` | Six honey cut ends with dark bark rims |

Each surface band closes on its **own** top/bottom boundary; the atlas is not one vertically repeating surface. At nominal texel density, the four circumferential strips represent **449.707, 375.000, 225.586 and 254.883 mm** respectively. The cylinder checker corrects normal slopes when fitting a whole strip to another circumference.

The end-grain grid has **six 256 × 256 cells**, a **336 px horizontal pitch**, **80 px between cells**, and **56 px left/right margins**. Every cell occupies y `[1787, 2043)`, leaving 5 px above and below within band 5. Each centred disc has a 125 px radius, leaving about 3 px of rim-coloured sampling margin inside its square. Six squares spanning the entire 2048 px width would be taller than the 266 px band; this arrangement preserves square cells and round ends.

| Disc, left to right | Cell x interval, half-open | Inclusive x pixels | Centre in pixel-index coordinates | Top-origin U edge interval |
| --- | --- | --- | --- | --- |
| 1 | `[56, 312)` | 56–311 | `(183.5, 1914.5)` | `[0.02734375, 0.15234375)` |
| 2 | `[392, 648)` | 392–647 | `(519.5, 1914.5)` | `[0.19140625, 0.31640625)` |
| 3 | `[728, 984)` | 728–983 | `(855.5, 1914.5)` | `[0.35546875, 0.48046875)` |
| 4 | `[1064, 1320)` | 1064–1319 | `(1191.5, 1914.5)` | `[0.51953125, 0.64453125)` |
| 5 | `[1400, 1656)` | 1400–1655 | `(1527.5, 1914.5)` | `[0.68359375, 0.80859375)` |
| 6 | `[1736, 1992)` | 1736–1991 | `(1863.5, 1914.5)` | `[0.84765625, 0.97265625)` |

All six cell V edge intervals are `[0.87255859375, 0.99755859375)`. Pixel-index coordinates put pixel centres at integer indices; convert a reported centre to texture UV with `(centre + 0.5) / 2048`. The exact cells and source registration centres are also machine-readable in [construction.json](checks/construction.json).

The colour changes are in `colour_wood()` and `build_ends()` in [build_material.py](build_material.py). The accepted `build_band()` geometry and the complete `build_cord()` remain unchanged. The three wood strips retain four native 640-pixel source windows per strip, spaced 512 pixels apart, with 128-pixel minimum-error overlaps. All 65 tapered checks and 22 shallow facets retain their original fields.

For bark, the script removes the previous class palette from the accepted reflectance reconstruction and retains its within-material pigment. A stronger, softly limited pigment range separates fissures from ridges; incision pigment is darker without baking a light direction or multiplying AO. The same deep-brown palette drives band 1 and band 2's bark islands. Band 3 uses a slightly lighter brown. Measured mean ridge/fissure luminance is **83.1 / 55.0** in band 1, **82.0 / 55.4** in band 2 and **94.6 / 72.8** in band 3.

The lichen selector now requires locally pale, neutral source pigment, rather than protecting ordinary pale bark ridges across a large area. Its stronger flecks cover **1.97%, 1.37% and 1.78%** of bark-core area in bands 1–3 respectively (mask greater than 0.5). They remain warm grey, around **RGB 156, 149, 132**, with feathered edges. They use source features; no new external imagery was introduced.

Exposed wood uses **RGB 185, 145, 95** where fresh. A separate deterministic, periodic colour-weathering field blends up to 40% toward **166, 153, 129**, while preserving fine grain. The weathered sample in band 2 averages **175.7, 145.0, 103.9** and is measurably less saturated. This field has its own random seed and cannot change the accepted geometry. Cut-face pigment is centred around **190, 150, 100** independently for each disc; source rings, pith, facets and cracks remain registered. Rim and sampling-margin colour are **98, 65, 41**.

The accepted cord remains **164 touching vertical turns**, each **11–14 pixels / 8.057–10.254 mm** wide, with two circular strand bundles following opposite sides of a helix. Each turn completes **8–11 full rotations** around the band, giving **16–22 detected ply ridges**. Both band wraps remain intact. The generated grass-fibre image supplies only restrained fine pigment; analytic geometry supplies the round turns and grooves. The same 29 frayed fibres and five short loose ends remain. Body/gap mean heights are **7.133 / 1.179 mm**; body/ply-groove/gap AO is **0.936 / 0.512 / 0.181**.

All seven original `generated_*.png` files and all four older computed source PNGs retain their SHA-256 hashes. Their existing generation prompts remain in [generation_prompts.json](generation_prompts.json) and [generation_prompts_round2.json](generation_prompts_round2.json). Round 3 adds only computed intermediates: [quilted_master_round3.png](source/quilted_master_round3.png), [lichen_mask_round3.png](source/lichen_mask_round3.png), and [weather_mask_round3.png](source/weather_mask_round3.png). The hewn source remains for provenance and is not used by the current build.

The local concepts inspected were [house_hero.png](../../ref/concept/house_hero.png), the upper-right pole detail in [details.png](../../ref/concept/details.png), and [piece_wall.png](../../ref/concept/piece_wall.png). They guided the warm-brown versus golden-thatch relationship; their lighting was not copied into the texture. **No game imagery, reference searches, downloads or new image generations were used in round 3.**

[check_material.py](check_material.py) independently reads the delivered PNGs without importing the builder. **All 99 assertions pass**, including the existing contracts, profiles, zero metalness, physical normal agreement, 32 band/map/axis seam tests, bark coverage and relief, regular end grid, and complete cord checks. Round 3 adds exact preservation checks against round 2, source/baseline hash checks, colour targets, bark contrast, sparse neutral lichen, weathering, matching bark islands, all six honey faces and dark rims, and unclipped base colour. Obsolete round-2 colour restrictions are replaced by this round's acceptance criteria; the previous checker is archived with its report.

Independent normal differentiation gives **0.1800° mean, 0.3178° p99 and 0.3823° maximum error**, unchanged and consistent with 8-bit encoding. `--verify-rebuild` rebuilt from sources offline and reproduced **every decoded pixel of all four maps**, with maximum integer difference **zero** for each; see [rebuild_verification.json](checks/rebuild_verification.json). All measurements are retained in [metrics.json](checks/metrics.json).

Seam entries below are **wrap difference / interior-line p99**, in 8-bit-equivalent values (height is divided by 257 only for this comparison). The accepted tolerance is unchanged: `wrap <= 1.20 * interior_line_p99 + 0.05`. Opposite edges are adjacent samples, not duplicated edge pixels.

| Band / layer | X wrap / interior p99 | Y wrap / interior p99 |
| --- | ---: | ---: |
| Bark-on / base | 6.420 / 8.860 | 12.084 / 12.778 |
| Bark-on / height | 3.086 / 3.545 | 5.706 / 7.090 |
| Bark-on / normal | 9.759 / 11.053 | 14.073 / 18.924 |
| Bark-on / orm | 2.857 / 3.433 | 7.934 / 9.627 |
| Half-peeled / base | 3.965 / 5.121 | 8.504 / 10.787 |
| Half-peeled / height | 1.398 / 2.149 | 3.970 / 5.173 |
| Half-peeled / normal | 4.566 / 6.577 | 9.691 / 12.979 |
| Half-peeled / orm | 1.479 / 2.074 | 5.954 / 8.520 |
| Thin sticks / base | 5.733 / 8.225 | 9.160 / 10.132 |
| Thin sticks / height | 1.596 / 2.211 | 3.994 / 4.049 |
| Thin sticks / normal | 5.346 / 6.981 | 11.797 / 11.217 |
| Thin sticks / orm | 1.563 / 2.221 | 6.290 / 6.319 |
| Grass cord / base | 5.266 / 9.195 | 1.093 / 1.156 |
| Grass cord / height | 65.705 / 65.002 | 11.890 / 12.710 |
| Grass cord / normal | 59.162 / 62.585 | 15.331 / 15.847 |
| Grass cord / orm | 37.796 / 38.928 | 6.236 / 6.656 |

The checker rebuilds the visual evidence in [checks/](checks/):

- `layers.jpg`, `base_overview.jpg`: the four maps and the full colour atlas.
- `tilings.jpg`, `band_*_tile_3across.png`, `band_*_tile_3x3.png`: all four surface bands, with full-resolution copies up to 6144 pixels wide.
- `offsets.jpg`, `wood_*_half_offset.png`, `wrap_detail.png`: separate wraps within each band; the saved height offset retains 16-bit precision.
- `relighting.jpg` and six `relight_*` PNGs: three light directions in colour and neutral clay.
- `cylinders.jpg`, `cylinders_close.jpg`: 3 m and 0.75 m poles, with bark/peeled/stick diameters **12/10/5 cm** and a **6 cm wide cord lashing around a 14 cm pole**.
- `cylinders_before_after.jpg`: round 2 and round 3 at the same exposure, light, camera and UV placement.
- `cord_cylinders.jpg`, `cord_detail.png`: opposing lights and native-size material detail. The accepted analytic sleeve is raised 4 mm; the delivered maps provide strand relief.
- `bark_before_after.jpg`: native-scale comparisons for bands 1, 2, 3 and 5. `detail_1to1.png` and `end_grain_1to1.png` retain close inspection of the surfaces and all six cut ends.
- `source_overview.jpg`, `construction.json`, `feature_fields.npz`, `round3_baseline.json`: source provenance, exact layout and feature evidence.

Visual inspection of the cylinders shows rich brown bark, clearly lighter honey patches and cut faces, sparse grey flecks and pale grass lashing. Fissures remain readable under both light directions. The relit clay response is unchanged. The per-band wrap crops show no isolated bright or dark boundary. In deliberate 3 × 3 inspection, the accepted large peeled islands remain recognisable; the stronger colour contrast makes their repeat easier to recognise. Their layout was retained as requested.

To rebuild offline with the dependencies in [requirements.txt](requirements.txt):

```sh
python3 build_material.py
python3 check_material.py --verify-rebuild
```

Enable sRGB only for base colour. Treat height, normal and ORM as linear. Sample V within the selected band and use band-aware filtering/mips; ordinary whole-atlas vertical repetition crosses materials. The accepted layout has no guard rows. Use the square cells above for end UVs. A 6 cm binding uses approximately 82 texels along X, with the full cord strip around V; do not squeeze all 164 turns into one small binding.

The material remains authored rather than measured photogrammetry, and roughness/AO remain estimates. The accepted 1.5 m repeat and 11–14-pixel cord turns are still visible at sufficiently close inspection. This revision was reviewed in the local analytic cylinder renderer; the full house was not re-rendered, and engine compression/mip behaviour was not tested here.

Recorded round-3 work from baseline capture through final validation took **7.1 minutes** on **14 November 2026**, excluding the initial inspection. The final offline rebuild took **30.01 seconds**; the final `--verify-rebuild` run, including that rebuild and all preview generation, took **61.27 seconds**.
