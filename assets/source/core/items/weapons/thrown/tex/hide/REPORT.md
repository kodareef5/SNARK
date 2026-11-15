# Hide — worked, smoked leather

Eight aligned delivery PNGs are complete: a native **2048 × 2048** material and its **1024 × 1024** reduction. Start with the [contact sheet](checks/contact_sheet.jpg), [native detail](checks/native_detail.jpg), [cylinder close-ups](checks/cylinder_close.png), and [actual screen sizes](checks/screen_sizes.png).

The result is warm brown grain-side leather with fine rounded pebbles, follicle pores, soft multidirectional folds, eleven faint healed scratches and two small scars. It has no stitches, seams, cut edges, tooling, or directional layout. Darker pigmentation and a broad satin response distinguish it from the supplied honey-tan wood and straw cord.

## Scale and import

One complete tile covers **0.20 × 0.20 metres**. Use repeat addressing in both directions. The master has **10,240 texels/metre**, or **0.09765625 mm/texel**; the 1024 version has **0.1953125 mm/texel**.

The height encoding's entire **0–65535 range represents 0–1.000 mm**, white high. The saved master actually occupies **0.344289–0.619760 mm**, a **0.275471 mm** span. The **0.500 mm** construction baseline is an encoding offset, not an instruction to add half a millimetre to a weapon's radius. For centered displacement, subtract that baseline. The normal maps already use the stated physical scale.

Import **only base colour as sRGB**. Height, normal and ORM are linear data. Normals use **OpenGL: +X right, +Y up the image, +Z outward**.

## Delivery files

| 2048 master | 1024 counterpart | Contents and construction |
| --- | --- | --- |
| `hide_base.png` | `hide_base_1024.png` | RGB8 sRGB. Mean **(121.9999, 86.0000, 56.0001)**. Independent smoke/tanning pigment, subtle cell variation, follicle pigmentation, slight oil stain and healed-scar colour. No illumination, AO, slope shading, highlights or cast shadows are baked into it. |
| `hide_height.png` | `hide_height_1024.png` | Single-channel **16-bit grayscale**. Native grain relief, recessed pores, soft creases and healed marks, composed in millimetres; full encoding **0–1.000 mm**. |
| `hide_normal.png` | `hide_normal_1024.png` | RGB8 linear. Wrapped central differences from each **reopened saved height**, at that resolution's physical texel pitch. No separate normal-strength multiplier. |
| `hide_orm.png` | `hide_orm_1024.png` | RGB8 linear. **R:** shallow cavity AO from eight height-horizon directions and five distances, restricted to pores, creases and fine grain furrows. **G:** roughness with smoother rubbed areas and slightly rougher cavities. **B:** zero everywhere. |

Base files have sRGB and gAMA chunks. Data files have no sRGB, gAMA or ICC profile chunks. The 2048 roughness median is **0.651**, with 1st–99th percentiles **0.584–0.714**; the quantized extrema are **0.549–0.749**, corresponding to the authored 0.55–0.75 interval. AO ranges from **0.839 to 1.000**; its first percentile is **0.973**, and its median is **1.000**. Cavities remain shallow rather than black.

## Construction and provenance

Everything was made locally with deterministic Python/NumPy/Pillow procedures, seed **161115**. No photographs, web textures, generated-image inputs, third-party pixels or reference-image pixels enter the material. The supplied wood and lashing bases, normals and reports were inspected read-only for context. The comparison swatches use the neighbouring mean colours stated in the brief, not their image pixels.

The entire master is evaluated directly at 2048. A periodic lattice of **34,596 jittered grain sites** is distorted by independent periodic coordinate fields. Rounded shallow furrows define the pebbles. Small collagen undulations and native fine relief break up their regularity. **38,000 elliptical follicle pores** are rasterized analytically at native resolution. They are not an enlarged low-resolution image.

**862 tapered creases** include 312 larger folds distributed among 196 local families and 550 tiny wrinkles. Their orientations span the circle, and their nominal lengths are **1.51–22.23 mm**. The broader folds have curved paths and soft shoulders. Eleven closed scratches are **4.55–9.76 mm** long. The two healed scars are **7.5 and 10.8 mm** long. The individual authored marks remain below the approximately 30 mm feature limit; none is a tile-wide identifying feature.

Smoke variation has its broad component removed. Pigmentation is authored separately from the surface's lighting response. A shared burnish field lowers roughness, compresses grain and closes some shallow pores. Shared scar and follicle fields link their pigment, relief and roughness. AO comes from the saved geometry and is masked to the cavity fields.

All filtering uses periodic boundaries, all feature drawing wraps around the tile, and both normal stencils wrap. Opposite edge pixels are adjacent samples of a periodic surface; they are not duplicated endpoints.

The initial visual pass looked too dry, and several groups resembled parallel scratches. The final revision reduced fine height noise and broad undulation, made the rounded pebbles clearer, and softened and curved the larger folds while reducing their sibling count. Smoke contrast was reduced. A float32 colour-mean accumulation error was also corrected using float64 averaging. The final base meets its target mean. Initial sources and selected previews remain in `source/pass1/` and `checks/pass1/`.

## Retained sources and scripts

| Path | Purpose |
| --- | --- |
| [build_material.py](build_material.py) | Recreates all eight maps, full-size procedural sources and manifest. Uses only Python, NumPy and Pillow. |
| [check_material.py](check_material.py) | Independently validates saved PNGs, renders review sheets, and optionally performs an actual rebuild/hash comparison. |
| `source/construction_fields.npz` | **15 full-size 2048² arrays**: grain, grain furrows, smoke, burnish, cell pigment, fine pigment, crease relief/mask, scar relief/mask/pigment, pore relief/mask, cavity support and roughness. Height fields are in mm. |
| `source/follicles.npz` | Every pore's center, elliptical radius/aspect, angle and depth. |
| `source/construction.json` | Seed, tile and height scales, every crease/scratch/scar, and diagnostic image display ranges. |
| `source/grain_relief.png`, `crease_relief.png`, `pores.png`, `burnish.png`, `smoke.png`, `scar_mask.png` | Full-size **2048² 16-bit** source diagnostics. Their display mappings are recorded in the manifest; they are not delivery maps. |
| `source/delivery_sha256.json`, `build_stats.json`, `work_log.json` | Delivery hashes, build statistics and production timing. |
| `source/pass1/` | Preserved initial full-size source fields and diagnostics. The script snapshot includes the colour-average fix made just before archiving. Final rebuilds use the root script. |

SciPy was not available in the active Python interpreter. Gaussian filtering therefore uses periodic NumPy FFTs; no package installation or fallback download was needed.

## Checks and observations

The final numeric results are in [metrics.json](checks/metrics.json). Validation reads the **delivered PNG files**, not just the generator's in-memory arrays.

- **Formats and alignment:** all eight dimensions, bit depths, channel counts and colour-space chunks pass. Reconstructing the master height from retained source fields produces **zero mismatched pixels**. The [feature sheet](checks/feature_alignment.png) shows both scars at identical coordinates in base, height, normal and relit colour.
- **Height/normal agreement:** independent central-difference reconstruction gives **zero byte error and zero mismatched channels at both sizes**. RGB8 quantization contributes about **0.172° mean angular error**, with maxima below **0.363°**. The master median normal tilt is **5.33°**, and the 95th percentile is **12.99°**.
- **No preferred direction:** x/y slope-energy ratio is **1.0043**. Folds point in different directions, and the fine grain remains nondirectional.
- **Seams:** inspected the [half-tile offsets](checks/offsets.jpg), [native seam intersection](checks/native_seams.png), and [3×3 repetitions](checks/tiling.jpg). Grain and folds cross both borders without a straight discontinuity. Across both resolutions and all maps, wrap-edge mean differences are **0.765–0.993 times** the 95th-percentile interior line differences. The `base_3x3_native.jpg` and `lit_3x3_native.jpg` files retain **6144²** repeats; the corresponding `*_large.jpg` files are **2048²** overviews. No grid or single dominant repeated scar stood out in the small view.
- **Even tone:** 25 mm block means range from **(121.11, 85.56, 55.71)** to **(123.23, 86.64, 56.39)**. Fitted end-to-end colour drift is below **0.153 code values** in either direction. Smoke varies locally without a light or dark side. Albedo correlations with normal x/y are below **0.00014** in magnitude; the construction also contains no light-dependent albedo term.
- **ORM:** metalness is exactly zero. There are **zero dark AO texels outside the tested cavity support**. The [individual channel sheet](checks/orm_channels.png) makes the shallow AO and satin roughness easier to inspect than the packed orange image.
- **Relighting:** [opposed lights](checks/relighting.jpg) reverse the creases' light response; neutral-pigment views isolate the physical relief. Fine rounded grain and pores become visible without darkening their lighting into the base. Full-size `lit_a.png` and `lit_b.png` are retained.
- **Physical wrap:** the [cylinder sheet](checks/cylinder_close.png) maps a **25 mm axial band around a 30 mm cylinder**, with real millimetre UV spacing, two different material regions and opposite lights. The brown support is a plain diagnostic colour authored here. The band reads as soft brown leather with a broad satin highlight.
- **First person and inventory:** [actual-size renders](checks/screen_sizes.png) use **1500, 2200 and 3000 px/m**. The 30 mm cylinder occupies **45, 66 and 90 pixels**; separate 50 mm surface patches occupy **75, 110 and 150 pixels**. At the lowest scale, individual pores largely merge while the folds and material colour survive. At 64 pixels the leather remains substantially darker than wood and cord, with a warmer/redder balance relative to the cord. The neighbouring swatches are flat reference means, not full material renders.
- **Native detail:** the 2048 base differs from bicubic enlargement of its 1024 reduction by **0.953 code-value RMS**. This is intentionally restrained pigment detail. Native cell edges, pore depressions and their normal changes provide the more prominent fine surface detail. See [native versus enlarged](checks/native_vs_upscaled.png).

The 1024 base, height and ORM are rounded **2×2 area reductions** of their saved masters. The 1024 normal is recomputed from its reduced saved height at the correct physical pitch. Against an unrounded area reduction of the 2048 files:

| Map | PSNR | RMS in stored code values |
| --- | ---: | ---: |
| Base | **58.41 dB** | 0.306 / 255 |
| Height | **106.61 dB** | 0.306 / 65535 |
| Normal | **36.69 dB** | 3.731 / 255 |
| ORM | **61.56 dB** | 0.213 / 255 |

All exceed **30 dB**. The normal reduction is deliberately not a byte-identical image resize: it agrees exactly with the reduced physical height. See [downsampling comparisons](checks/downsampling.jpg).

## Rebuild

From this folder:

```sh
python3 build_material.py
python3 check_material.py
```

For an actual second build with before/after SHA-256 verification of all eight maps, followed by validation and previews:

```sh
python3 check_material.py --verify-rebuild
```

The actual verification rebuild reproduced **all eight delivery PNGs byte for byte**. The before/after hashes are recorded in [rebuild_verification.json](checks/rebuild_verification.json).

## Remaining limitations

This is an authored material, not a measured hide scan. At an extreme close-up the pebbles still reveal some procedural consistency. Roughness and AO are plausible approximations, and the scars are deliberately understated. Individual follicle pores soften into the collective grain at ordinary first-person distances.

The preview renderer uses diffuse plus dielectric GGX lighting and an approximate ambient dome. It does not model subsurface scattering, ray-traced self-shadowing or silhouette displacement. The cylinder uses saved tangent normals on a smooth surface and shows the front of the band. A physically sized circumference is approximately **94.25 mm**, not the full 200 mm tile, so arbitrary strip endpoints on an actual mesh can still require a hidden/back-facing UV join. Full-tile repeat continuity does not guarantee that every arbitrary crop has matching endpoints.

Final weapon meshes, engine tangent interpolation, texture compression and mip filtering were unavailable for review. Those remain the main unverified integration details.

All work and generated outputs are inside this folder. The references were read-only. **No git commands were run.**

## Time

Production started approximately **2026-11-15 16:36:30 UTC** and finished **2026-11-15 16:49:24 UTC**, about **12 minutes 54 seconds** later. This includes reference review, construction, one visual revision, saved-file validation, rendering, an actual verification rebuild and reporting. The final build took **38.43 seconds**; the full rebuild-and-check command took **61.47 seconds**. Timing is retained in `source/work_log.json`.
