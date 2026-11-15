# Kiln

One **2.0 × 2.0 metre** periodic trim, delivered as eight aligned PNGs. The stone band occupies master rows **0–1535**; fired clay occupies **1536–2047**. At 1024 these become **0–767** and **768–1023**. All courses and smoothing marks run along image x. Native sampling is **0.9765625 mm/pixel** at 2048 and **1.953125 mm/pixel** at 1024.

Start with [the contact sheet](checks/contact_sheet.png), [the furnace under two lights](checks/furnace_two_lights.png), and [the clay crucible](checks/pot_two_lights.png).

| Files | Encoding and construction |
| --- | --- |
| `kiln_base.png`, `kiln_base_1024.png` | RGB8, sRGB, explicit sRGB PNG chunk. Independently coloured dark stones, cracked warm daub, soot, small ash deposits, and smoothed fired clay. No normal/light calculation, AO multiplication, cast shadow or specular term enters this map. |
| `kiln_height.png`, `kiln_height_1024.png` | Single-channel grayscale16, linear, white high. **The full integer range 0–65535 means 0–40 mm.** Delivered extrema are **7.394–29.596 mm**. Preserve the full 40 mm encoding; do not normalize the occupied range. Stone faces average **10.94 mm above the daub**. |
| `kiln_normal.png`, `kiln_normal_1024.png` | RGB8, linear, OpenGL: +X right, +Y up the image, +Z outward. Each is differentiated from its own reopened, saved height at the physical tile scale, including the complete stone bevel and crown. No separate strength multiplier or omitted macro shape. |
| `kiln_orm.png`, `kiln_orm_1024.png` | RGB8, linear. R is nondirectional cavity AO; G is roughness; B is identically zero. Low-soot stone lies within 0.80–0.95, soot within approximately 0.90–1.00, and fired clay within approximately 0.75–0.90, allowing half an 8-bit step. Daub is very rough. Only the base files carry colour-space chunks. |

The stone band contains **94 individually shaped stones in ten unequal, wandering courses**, including five thermally split stones. Final raster footprints measure **130–288 mm across and 95–171 mm tall**. Angular split stones alternate with rounded river cobbles; widths, tilts, corner cuts, crowns, mineral hue and soot coverage vary independently. A final proximity pass keeps tipped corners separated without straightening their outlines. The smallest measured gap is **16.1 mm**. Broader clay pockets remain at three-way junctions and rounded corners.

The measured sRGB means are **(78.16, 73.01, 67.10)** on stone interiors, **(147.02, 122.01, 98.01)** on daub, and **(98.35, 87.26, 75.98)** across the entire stone band. Fired clay averages **(168.00, 132.00, 100.00)**. This keeps the body dark against the supplied limestone and boards palettes, while the lip, crucible and cap are warm. The base stays flat; depth appears when the saved normal is lit.

The fired clay has shallow horizontal smoothing marks, fine interrupted crazing, soft scorch clouds at roughly 20–80 cm scales, and a few pale ash smears. Its relief is much smoother than the stones. Periodic clay fields continue through the bottom/top wrap. Small clay smears cover the first and last stone courses, with the transitions confined to the stone band; no stone support extends into row 1536 or below.

The original mineral artwork was made with the **built-in image-generation tool**, without web textures or borrowed images. Its unchanged **1254 × 1254** output is [source/riverstone_grain.png](source/riverstone_grain.png); the exact prompt and tool provenance are in [source/prompts.json](source/prompts.json). The script detrends the artwork and assigns independently rotated, scaled crops to stones. Filtered grain contributes restrained pigment and shallow relief. Native 2048 fields supply the footprints, crowns, cleft relief, grit, drying cracks, thermal fissures, soot, ash and clay marks. The master is not a resized finished image.

[source/construction_fields.npz](source/construction_fields.npz) retains full-size construction arrays, including masks, IDs, relief components, soot, scorch and crack fields. `source/stone_ids.png`, `source/stone_mask.png` and `source/crack_soot_fields.png` provide native-size inspection images. [source/construction.json](source/construction.json) records the seed, physical scale, individual stone geometry and source crop transforms. These procedural sources are regenerated from seed **15112673**; rebuilding consumes the retained original grain image and needs no network or image-generation call.

Normal derivation uses periodic central differences, with image rows increasing downward:

```text
h_mm = saved_uint16 × 40 / 65535
pixel_mm = 2000 / image_width
normal = normalize(-dh/dx, +dh/drow, 1)
```

Both normal files have **zero mismatched channels** against the independent checker. RGB8 quantization gives mean angular error **0.171°**, maximum **0.384°**. Reconstruction from retained height components differs from the saved height by at most **0.000308 mm**, consistent with grayscale16 rounding.

The 1024 base, height and ORM are exact rounded **2 × 2 area averages** of the masters. The 1024 normal is regenerated from the smaller height. Its agreement with the area-filtered master is **36.62 dB**, and with a Lanczos-filtered master **36.46 dB**. Every delivered map exceeds the required 30 dB; the other Lanczos comparisons exceed 50 dB.

| Inspection | What I checked and saw |
| --- | --- |
| [Half-tile offsets](checks/offset.png), `offset_*_native.png` | All four layers shifted 1024 pixels in both axes. No new vertical stitch or top/bottom discontinuity. Intended horizontal trim divisions remain visible. |
| [3 × 3 repeat](checks/tiled3x3.png), `tiled3x3_native.png` | Small overview and full **6144 × 6144** base repeat. No isolated bright stone or singular scorch mark dominates the repeat. The ten-course arrangement can still be found by deliberately tracking matching shapes. |
| [Native seam strips](checks/native_seam_strips.png) | Unscaled left/right joins, bottom/top joins, and row-1536 transitions for base and normal. Continuous grain and smooth clay transitions; no abrupt relief cliff. |
| [Aligned layers](checks/layers.png), [native detail](checks/native_detail.png) | Pale joints, thermal fissures and drying cracks register with their height, normals and cavities. The base contains pigment variation rather than a bevel highlight. |
| [Two-light planar render](checks/relit.png), `relit_A_native.png`, `relit_B_native.png` | Raised stone edges respond to the changed light; dark thermal cracks remain in the same places. Fine stone grain remains visible at native resolution. |
| [Furnace](checks/furnace_two_lights.png), [crucible](checks/pot_two_lights.png) | An eight-sided body, narrow chimney, clay mouth lip and cap, and an open crucible, under two sun directions with plain sky illumination. Tangent-space normals are transformed through the actual UV tangent frame. Clay stays dry and the pot has no conspicuous material stripe. Orange mouth geometry receives the same lighting and emits no light. |
| [Chimney strips](checks/chimney_strips.png) | Three different **0.28 m** cuts retain portions of countable stones, daub and surface detail. |
| [Inventory sizes](checks/inventory_sizes.png) | At 64 pixels the dark furnace, paler joints, warm lip and orange mouth remain distinguishable. Fine cracks are primarily close-view detail. Separate 64, 128 and 256 pixel PNGs are retained. |
| [UV stress render](checks/furnace_uv_stress.png) | Also tests **0.6 tile width per octagon face**, as described in the brief. This reuses the material cleanly but compresses stones horizontally compared with the physical-scale render. |

Mean wrap jumps are below the 95th percentile of interior line differences for every map. Base wrap differences are **1.20 levels horizontally / 0.44 vertically**; height **0.161 / 0.018 mm**; normal **5.14 / 0.88 levels**. [checks/metrics.json](checks/metrics.json) contains all measurements, PNG header checks, roughness limits, physical footprint and gap measurements, and downsample comparisons. [checks/validation.txt](checks/validation.txt) lists the individual assertions; [checks/manifest.json](checks/manifest.json) records the final delivery hashes. The first visual review is retained in `checks/iteration_01/`.

Rebuild using Python with NumPy, SciPy and Pillow:

```sh
python3 build_material.py
python3 check_material.py
# Optional byte-for-byte rebuild verification:
python3 build_material.py --verify-rebuild
```

On this workstation, system Python lacks SciPy despite the brief's environment note. [run_material.sh](run_material.sh) uses the ordinary interpreter when its dependencies are present, otherwise the existing read-only Python 3.13 and cached packages. No installation was necessary. The commands actually used here are `bash run_material.sh build_material.py` and `bash run_material.sh check_material.py`. Validated package versions: NumPy **2.5.4**, SciPy **1.18.1**, Pillow **13.0.0**.

The revisions replaced overly rectangular first-pass outlines, corrected small transition spillovers, opened thin joints at tipped corners, reduced fired-clay microrelief, and enforced the soot roughness floor.

Remaining limits: this is authored procedural relief with generated mineral artwork, not a measured scan. Normal maps cannot change silhouettes or produce real undercuts. The constrained horizontal courses remain recognizable over a long repeat. The software previews are diagnostic rather than game captures, and do not simulate the game's texture compression, shadowing or exposure. The diagnostic body is **1.24 m in diameter**, with approximately **0.475 m wide faces**; mapping **1.2 m of this texture** onto each face necessarily compresses the stones horizontally. Both UV interpretations are previewed explicitly. Actual in-game proportions depend on the supplied mesh's dimensions and UVs.

All delivery files, scripts, generated construction sources and review artifacts are in this folder. The image tool's automatic original was copied intact into `source/`. The supplied brief and start marker were preserved. No git commands were run.

**Final verification: 55/55 checks passed.** The clean rebuild reproduced all **eight delivery PNGs and five source artifacts byte for byte**; [checks/rebuild_verification.json](checks/rebuild_verification.json) records all 13 comparisons. The final build took **71.891 seconds**, and the complete check/render pass **62.036 seconds**. Work ran from **15 November 2026, 20:02:07 to approximately 20:28 UTC** (15:02–15:28 EST), about **26 minutes**, including source generation, visual revisions, checking, rebuilding and reporting.
