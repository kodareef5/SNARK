The four delivered maps are **2048 × 2048**, cover **3 × 3 metres**, and tile on both axes. The grain still runs left to right, without board edges, joints, nails or end grain.

Revision after the stone-house review: the previous material was too even and its relief too restrained, so it looked like brown plastic from a few metres away. I changed three things:

- **Drying checks:** added long, tapered openings with wider pockets, narrow connecting tips and occasional forks. Their maximum openings are 2–6 mm, their parent lengths are within 0.2–1 m, and their dark brown interiors are the darkest colour and deepest height features. This makes the splits survive the beam view instead of disappearing into fine grain.
- **Weathering:** bleached exposed fibres and adze ridges toward warm silver-grey, left brown in pores and hollows, and added long tonal streaks changing over roughly 0.2–1 m. Luminance standard deviation increased from **10.74 to 21.49 levels (2.001×)**. The delivered mean remains **exactly sRGB (118, 92, 66)**.
- **Adze work:** increased the local cuts to 676, with irregular 8–15 cm advances, varied depths up to **2.80 mm**, and sharper curved blade stops. The side-light check now exposes the short cross-grain facets. No light direction is baked into their colour.

The same source grain, quieted knots, periodic overlap construction, 3 m scale and twelve beam crop coordinates are retained. There was no new image-generation call. The previous maps, scripts, report and principal previews are preserved in `checks/pre_feedback_01/`. [checks/before_after.jpg](checks/before_after.jpg) compares the two unlit colour maps at the same mean.

| File | How it was made | Final checks |
| --- | --- | --- |
| [timber_base.png](timber_base.png) | Generated oak source, periodic quilting, shared grain/facet weathering, long streaks, dark open-check coverage, and new 2K fibres and pores. RGB 8-bit with sRGB ICC profile. Balanced integer rounding fixes the exact whole-image mean. | **(118, 92, 66)** mean; **21.49** luminance standard deviation. The strips show grey exposed fibres against brown recesses, with visibly dark splits. |
| [timber_height.png](timber_height.png) | Shared source grain and pores plus local adze cuts and analytically drawn drying checks. The thin crack cross-sections are filtered across pixel footprints. Unsigned 16-bit grayscale, white high, full black-to-white range **10 mm**. | Actual range **0.220–8.522 mm**. Open-check core depth below the local surface is **6.05 mm median**, with **8.10 mm maximum**. Checks are deeper than the surrounding uncracked surface. |
| [timber_normal.png](timber_normal.png) | Reopened the delivered height PNG, computed wrapped central differences at **1.46484375 mm/pixel**, normalized **(-dH/dx, +dH/dy_image, 1)**, encoded RGB 8-bit. OpenGL: +X right, +Y image-up, +Z out. | Independent float64 recomputation: **0.172° mean, 0.298° p99, 0.381° maximum** angular error, consistent with 8-bit encoding. No normal-strength multiplier. |
| [timber_orm.png](timber_orm.png) | Shared cavity geometry supplies AO; exposed fibre, worn cuts and cavities supply roughness. RGB 8-bit linear data; R=AO, G=roughness, B=metalness. | AO mean **0.975**, minimum **0.125** in deep checks, quiet surface mean **0.989**. Roughness **0.714–0.902**, mean **0.796**. Metalness is **zero everywhere**. |

There are 192 added parent checks and 48 narrower forks. Parent lengths in this seeded build are **0.204–0.933 m**; maximum opening widths are sampled within **2–6 mm**, with narrower tips and constrictions. They occupy about **2.03%** of the tile by filtered coverage. Geometry, colour coverage and AO use the same paths and pixel origin. Adze advances were checked at **8.0–15.0 cm**. Every stroke is local and varies in lean, depth, curvature and edge wear.

I rebuilt and opened the required [3×3 repeat](checks/tiled3x3.jpg), [beam sheet](checks/beams.jpg), [half-offset layers](checks/offset.jpg), [layer sheet](checks/layers.jpg) and [four-direction relight](checks/relit.jpg). I see no boundary grid or centre seam. Every one of the same twelve strips carries visible drying checks; the counted range is **3–13** per face. The stronger weathering remains horizontal and changes locally, rather than introducing a tile-wide lighting gradient. The side-lit facets read more clearly than in the earlier version.

[checks/beams_side_lit.jpg](checks/beams_side_lit.jpg) adds a 22° side light and a ray test against the actual height field, with AO applied to ambient illumination only. It shows cavity self-shadowing at the specified scale. This is a diagnostic, not a claim that a normal-only engine shader will produce height shadows. [checks/relief.jpg](checks/relief.jpg) isolates the surface on neutral grey. [checks/detail.jpg](checks/detail.jpg) shows the same enlarged crop from every layer. The beam-sheet backgrounds and outer shadows are presentation only and are absent from the maps.

All checks pass in [checks/metrics.json](checks/metrics.json): PNG dimensions and channel types, 16-bit height, sRGB only on base colour, exact mean, normal/height agreement, metalness, roughness, near-white overall AO, cavity registration, crack dimensions, tool advance spacing, and the strip test. An exhaustive scan of the smallest beam footprint at every tile pixel still finds no blank area: its minimum luminance standard deviation is **14.82 levels**. Height reconstructed from the half-precision audit fields differs by at most **0.0040 mm**; the 16-bit delivered PNG remains authoritative.

Each wrap difference remains below its ordinary interior 95th-percentile line difference. Entries are **wrap mean / interior p95**, in 0–255 display units; height is rescaled only for this comparison.

| Map | Horizontal wrap | Vertical wrap |
| --- | --- | --- |
| `timber_base.png` | 2.614 / 3.469 | 6.508 / 11.638 |
| `timber_height.png` | 1.630 / 1.835 | 3.472 / 15.364 |
| `timber_normal.png` | 1.914 / 2.165 | 3.925 / 13.225 |
| `timber_orm.png` | 0.435 / 0.488 | 1.205 / 6.170 |

The original built-in imagegen output is retained unchanged at [source/oak_generated_01.png](source/oak_generated_01.png), **1254 × 1254**, with its exact prompt in [prompts.md](prompts.md). The build enlarges it to 2304 and folds 256-pixel overlaps into a 2048 periodic master. It then adds grain-following fibres and 24,500 elongated pore impulses directly at final resolution, as well as the new physically sized checks. Fibre relief RMS is **27.92 micrometres**. These are authored additions, not a claim of native 2K photographic detail. The isolated fine fields are shown in [checks/native_detail.jpg](checks/native_detail.jpg).

Reproduce with Python 3, Pillow, NumPy and SciPy:

```sh
python3 build_material.py
python3 check_material.py
```

The scripts use fixed seeds and local paths. Keep the retained source and `checks/pre_feedback_01/timber_base.png`, which is the contrast-comparison reference. `derivation.npz` stores the shared audit fields, while `checks/build.json` records the source hash, scale, crack dimensions and adze placements. Latest build: **18.0 seconds**; checks and preview generation: **6.6 seconds**. This feedback revision took approximately **12.1 minutes**, from **19:20:44 UTC** to **19:32:51 UTC** on 14 November 2026. The initial generation and authoring took approximately 14 minutes.

Engine settings remain the same: sRGB only for base colour, linear height/normal/ORM, repeat U and V, 3 m tile coverage, 10 mm full-range displacement, OpenGL normal convention. Preserve the 16-bit height. `material.json` records these settings. The revision changes the material files in place, so existing paths still resolve.

Remaining limitations: the surface is authored, not measured photogrammetry; AO and roughness are estimates. A 2 mm opening is only about 1.37 pixels wide at this scale, so its narrowest parts will fade under mipmapping. The remaining knots and streaks can still reveal a fixed repeat on a large uninterrupted panel. I inspected these local previews, not a new render of the user's stone house or its texture-compression pipeline.
