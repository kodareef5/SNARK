**Plate — muted green-grey painted sheet steel, with worn steel trim and domed rivets.**

All eight delivery PNGs are complete. Start with the [contact sheet](checks/contact_sheet.png), [cabinet under two suns](checks/boxes_two_lights.png), and [native rivet relighting](checks/rivet_relight.png). **All 76 numerical checks pass**, and a rebuild reproduced all eight maps and all seven retained source files byte for byte.

One tile covers **1.5 × 1.5 metres**, repeating on both axes. Master resolution is **2048 × 2048**, or **0.732421875 mm per texel**. The corresponding **1024 × 1024** set has a **1.46484375 mm** texel pitch. Panel width, paint brush marks and steel scratches follow image x.

| File | Encoding and construction |
| --- | --- |
| [plate_base.png](plate_base.png) | 2048² RGB, 8-bit sRGB, explicit sRGB PNG chunk. Flat material colour from shared paint, exposed steel, rust and deposited grime fields. No lighting, reflection or AO is multiplied into this map. |
| [plate_base_1024.png](plate_base_1024.png) | 1024² RGB, 8-bit sRGB. Rounded 2 × 2 area average of the master in encoded sRGB values. |
| [plate_height.png](plate_height.png) | 2048² single-channel, 16-bit grayscale, linear. Physical plate overlap, spherical rivet caps, paint thickness, chips, brush ridges, scratches and pits. White is high. |
| [plate_height_1024.png](plate_height_1024.png) | 1024² single-channel, 16-bit grayscale. Rounded area reduction with exactly the same physical encoding. |
| [plate_normal.png](plate_normal.png) | 2048² RGB, 8-bit linear, OpenGL tangent space. Computed from the reopened, saved 16-bit master height at its physical texel pitch. |
| [plate_normal_1024.png](plate_normal_1024.png) | 1024² RGB, 8-bit linear. Recomputed from its saved smaller height at the smaller map's texel pitch. |
| [plate_orm.png](plate_orm.png) | 2048² RGB, 8-bit linear. Red: shallow cavity AO. Green: roughness. Blue: partial metalness, zero on paint. |
| [plate_orm_1024.png](plate_orm_1024.png) | 1024² RGB, 8-bit linear. Rounded area reduction of the master ORM. |

**Height encoding: 0–65535 means 0–8.000 mm**, not ±8 mm and not the observed extrema. Actual master heights span **1.390280–6.250828 mm**. The reference steel plane is **1.500 mm**; intact paint adds **0.200 mm**, and the lap adds **0.650 mm**. Rivet caps are nominally **3.90–4.10 mm** above their underlying steel. Chipping removes the same 0.200 mm paint layer that controls the colour and metalness.

For displacement relative to the reference steel plane, subtract **0.1875** from normalized height before multiplying by 8 mm. Keep normal strength at **1.0**. Normals use **+X right, +Y up the image, +Z outward**, calculated as `normalize(-dh/dx, +dh/drow, 1)` with periodic central differences. Only base colour should be imported as sRGB; height, normal and ORM have no colour-transfer metadata and must be read as linear data. Use repeat wrapping in both directions.

The logical bands remain exactly **0–1/12 seam**, **1/12–1/6 bare steel**, and **1/6–1 painted face**. Boundaries are evaluated in millimetres rather than rounded to integer rows: **0, 125, 250, 1500 mm**. Bare-band transitions span **6 mm**, with their midpoint at the specified boundary. The bottom/top join meets the same painted surface; its procedural fields and feature stamps wrap continuously.

The lap edge sits at about **65 mm** from the tile's top, with small periodic hand-cut irregularity. Its single row contains **25 rivets**, spaced exactly **60 mm** including across the x wrap. Diameters vary **13.6–14.4 mm** and centres sit around **48.5 mm** from the top. The worn crown, painted skirt, dirt around the head, cavity AO and dome all share coordinates.

| Region or property | Measured result |
| --- | --- |
| Painted-face mean, including wear and soil, excluding boundary blends | **sRGB (98.0003, 110.0000, 99.9999)** |
| Bare-band mean, excluding boundary blends | **sRGB (149.502, 149.502, 147.503)** |
| Seam-strip mean | **sRGB (96.360, 108.106, 98.390)** |
| Clean paint roughness | **0.600–0.741** |
| Bare-band roughness | **0.451–0.588**, mean **0.520** |
| Grime and rust roughness targets | Grime **0.8**, rust **0.85**, blended by coverage |
| Metalness | Paint **0**; clean bare band and full chips **89/255**; fully worn rivet crowns **115/255**; reduced by rust |
| Cavity AO | Minimum **219/255**, mean **0.999726** |
| Face area with more than 50% exposed steel | **0.572%** |
| Mean chip coverage near face edges / in the middle | **2.500% / 0.302%**, about **8.3×** denser near edges |
| Face area with more than 10% rust coverage | **0.0302%** |

The material is authored procedurally at native 2048 resolution with seed **2711049**. No external pictures, downloaded textures or reference-material pixels were used. The supplied steel and iron materials were inspected read-only. The installed Python lacks SciPy, so the builder uses NumPy FFT Gaussian filters and Pillow; it requires no downloads or image service.

Soft periodic pigment fields give the paint its restrained 10–40 cm mottling. Strongly elongated, irregular fields provide faint horizontal brushing and finer steel scratches. There are **270 main face chips**, **88 lap-edge chips**, and **421 tiny companion flakes**, with irregular contours and antialiased edges. Main face chips have nominal sizes **3–30 mm**; smaller flakes supply edge breakup. **410 tapered scratch strokes** and **170 small pits** provide native detail. Just **ten short rust runs**, nominally **9–43 mm** long, begin at selected chips and trail downward. Soil concentrates around the lap, rivet shoulders and panel ends without an authored band-wide colour ramp.

[source/construction_fields.npz](source/construction_fields.npz) retains every full-resolution authoring field used by the maps. [source/construction.json](source/construction.json) retains the seed, physical parameters and individual feature records. Full-size 16-bit `chips.png`, `rust.png`, `grime.png` and `rivet_wear.png`, plus `band_masks.png`, provide readily inspectable masks in `source/`. The master is not an enlarged smaller image.

I inspected the [half-tile offsets](checks/offset.png), [small 3 × 3 repeat](checks/tiled3x3.png), [native four-corner meeting](checks/native_wrap_intersection.png), and [wrap strips](checks/seam_strips.png). No abrupt stitch or cross appeared at the wrapping edges. Whole-sheet repeats retain the intentional horizontal trim bands. Full **6144 × 6144** base and normal repeats, plus native offsets for all four layers, remain in `checks/` for larger inspection.

The numerical seam test divides the mean absolute opposite-edge step by the mean absolute adjacent-pixel step in the image, using floating-point subtraction. **All sixteen map/size/axis ratios are below 1.641**, against the checker's strict limit of 3. Exact edge and interior values are retained in [checks/metrics.json](checks/metrics.json).

Independent normal reconstruction from each saved height has **zero mismatched RGB bytes at both sizes**. Mean angular error against the unquantized physical directions is **0.172° at 2048** and **0.174° at 1024**. Height quantization stays within half of one 16-bit step. The shared-source checks also verify base colour, ORM channels, exposed-material support and native brush direction.

| Map | Area-average comparison | Lanczos comparison |
| --- | ---: | ---: |
| Base | **58.71 dB** | **53.38 dB** |
| Height | **106.60 dB** | **67.97 dB** |
| Normal | **50.96 dB** | **50.91 dB** |
| ORM | **62.70 dB** | **54.96 dB** |

Base, height and ORM are exact rounded area reductions. The smaller normal is regenerated to agree with its height, while remaining well above the requested **30 dB** reduction threshold. The [reduction sheet](checks/downsample.png) shows corresponding crops; the [layer sheet](checks/layers.png) and [native detail](checks/native_detail.png) show alignment. Height displays in checks are stretched from **1.35–6.35 mm** for visibility; delivery height maps are unchanged.

The two cabinet views use actual chamfer geometry and the delivered material maps: painted face UVs, bare steel chamfers and correctly rotated tangent frames on vertical riveted trims. The box is **1.7 m wide**, with illustrative dark iron feet and a pull. Rendering uses linear-light GGX, one directional sun, a plain analytic diffuse sky and **no environment map or environment reflections**. Changing the sun moves the rivet highlights and changes the side-panel response. The paint stays subdued, bare trim stays pale, and the iron remains distinctly darker. The [64-pixel inventory study](checks/inventory_palette.png) retains that separation after fine chips and brushing fade. Iron in this diagnostic is a newly drawn flat material using the supplied mean colour, not the existing iron texture.

Review corrections included double-precision face-colour calibration, double-precision height encoding to remove a tiny rounding excess, and clipping the lowest rivet roughness to the requested bare-steel range. A Pillow nearest-neighbour enlargement error in the inventory checker was replaced with exact NumPy pixel repetition. The contact sheet includes the final layers, two lights, offsets, tiling, inventory study and reduction comparisons.

Rebuild and check from this folder:

```sh
python3 build_material.py
python3 check_material.py
```

To rebuild, compare hashes and run the complete validation/render pass:

```sh
python3 check_material.py --verify-rebuild
```

That command passed. [checks/rebuild_verification.json](checks/rebuild_verification.json) records **15/15 files reproduced byte for byte**. [build_manifest.json](build_manifest.json) lists the eight delivery hashes. The final builder took **18.474 seconds**; rebuilding, hash verification, all checks and previews took **58.909 seconds**. Final contact-sheet layout was also executed and inspected separately.

Remaining limits: this is an authored surface, not a measured scan. The normal map cannot change rivet silhouettes. The cabinet is a diagnostic, not the game's fabricator mesh; actual UV placement, engine exposure, compression and mip generation remain untested. The fine brush texture is deliberately quiet, and sparse rust mostly disappears at inventory scale. Small chip constellations can still be recognized if one studies repeated tiles closely; there is no large rust landmark. There are no unresolved numerical check failures.

Work took **16 minutes 24 seconds**, on **15 November 2026**, from **20:02:08 to 20:18:32 UTC** (starting **15:02:08 EST**), including reference inspection, construction, corrections, visual review, reproducibility checks and reporting. All writes stayed in this folder. No git commands were run.
