# Fittings — third pass

Only the wood base colour changed in this pass. The **2048 × 2048**, **1 × 1 metre** layout, height, OpenGL normal and packed ORM maps remain exactly as delivered in pass two. The iron half of base colour is also pixel-identical. All work and saved artifacts are inside this folder; no git commands were run.

Read the **Material palette** in [DESIGN.md](../../ref/concept/DESIGN.md) and reviewed [details.png](../../ref/concept/details.png), especially the foundation corner/end grain, pillar crown and pegs. The written unlit sRGB values control this adjustment; the painted sunlight was not sampled.

[Contact sheet with pass-two/pass-three comparison](checks/contact_sheet.jpg) · [Large before/after](checks/before_after.jpg) · [Unlit detail comparison](checks/before_after_detail.jpg) · [Numerical checks](checks/metrics.json)

| Region / 8-bit sRGB | Pass two measured mean | Pass three measured mean | Palette target |
| --- | --- | --- | --- |
| Entire end-grain half, including arrises and pegs | (94.79, 65.87, 43.89) | **(185.71, 148.80, 106.82)** | E (186, 149, 107) |
| Three peg interiors | (115.19, 83.17, 55.12) | **(177.19, 142.17, 96.12)** | P (177, 142, 96) |
| Bare iron, excluding any rust coverage | (62.49, 62.19, 62.51) | **(62.49, 62.19, 62.51)** | I (48, 45, 41); kept at pass-two colour as permitted |

The sawn ends now read light and warm against the tier's dark hewn timber T (98, 67, 45). In [build_material.py](build_material.py), E and P are explicit sRGB palette constants. E receives a small carrier offset of (4, 3, 2) to compensate for the darker annual grain and cell margins when averaged over the half. Face interiors excluding the arris and pegs average **(188.57, 150.85, 108.18)**. All eight outer four-pixel margins are **(158, 129, 94)**, visibly darker than the faces; the existing narrow scuffed inner arris is retained.

The wood pigment lift preserves the existing latewood, ray, pore, saw-mark and wear contrast to within one rounding code. Checks retain their exact depth and AO, so their dark recesses remain visible under both preview light directions. Peg positions, shapes and grain remain unchanged in cells **2, 5 and 7**. No grain, check, fastener, cell or band was moved. Iron colour, polished edges and restrained rust around seams, pits and head seats were left untouched; no new I/I+ recolouring was applied.

The source component bases are regenerated with the atlas. Seed **831740**, physical construction and random-number ordering are unchanged. The original embedded sRGB profile is retained in [source/srgb.icc](source/srgb.icc), avoiding a fresh profile timestamp on every build. [source/manifest.json](source/manifest.json) records revision 3 and the palette intent.

[check_material.py](check_material.py) passes all assertions. [checks/check_run.txt](checks/check_run.txt) and [checks/metrics.json](checks/metrics.json) record:

- **41 files verified byte for byte** against pass two: the delivered height, normal and ORM; all 28 component height/ORM maps; and all 10 construction masks.
- Exact preservation of layout, scale, seed, eight cells, six iron bands, three pegs and sixteen fastener placements; zero changed base-colour pixels in the iron half.
- E/P colour acceptance, dark clean arrises, and preservation of wood pigment detail.
- PNG dimensions, bit depth, channels and colour profiles; zero component-to-atlas differences; metalness, rust localization, roughness and AO checks.
- Independent normal reconstruction: **0.1728° mean**, **0.2967° p99**, **0.3766° maximum** angular error, with at most one RGB code difference.
- All six horizontal iron joins pass across all four maps; wrap differences are **0.21–0.81×** the interior-column 95th percentile.

A second complete build reproduced all **57 map/profile files byte for byte**, including all four delivery PNGs. The manifest is identical apart from elapsed build time. Results and hashes are in [checks/rebuild_check.json](checks/rebuild_check.json).

The contact sheet now compares the actual archived pass-two maps with pass three at equal scale, exposure and lighting, in both unlit base and the same GGX preview. Reviewed the assembled sheet and enlarged unlit details: the warmer, lighter ends retain their darker rings and margins; pegs are slightly darker than the sawn faces; iron is unchanged. The existing two-light, cell, fastener, tiling and half-offset diagnostics are regenerated. The previous contact sheet, scripts, report, delivery maps, manifest, metrics and masks are preserved in [source/pass2/](source/pass2/), with verified archive hashes. The earlier pass-one archive is untouched.

Rebuild and check from this folder with Python 3, Pillow, NumPy and SciPy:

```sh
python3 build_material.py
python3 check_material.py > checks/check_run.txt
```

Import only base colour as sRGB. Height, normal and ORM remain linear data. Height encoding remains **0…65535 = 0…12 mm**, with centred displacement `(height_normalized - 0.5) × 12 mm`; ORM is R=AO, G=roughness, B=metalness. Iron bands repeat horizontally; the atlas does not repeat vertically. Preview lighting remains a simple GGX diagnostic; this colour pass has not been reviewed on the modelled pieces.

Third pass completed **14 November 2026**. The full preceding technical and visual report is retained in [source/pass2/REPORT.md](source/pass2/REPORT.md).
