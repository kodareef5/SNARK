**Steel — oiled, browned and blued village-smithy metal, with rubbed steel and aged brass trims.**

**Latest revision:** the [wrap correction below](#wrap-correction--15-november-2026) rebuilds both sizes and passes all 132 checks, including whole-image wrap ratios below 3 on both axes for every map. The original delivery notes follow for context.

Eight aligned delivery PNGs are complete at **2048 × 2048** and **1024 × 1024**. Start with the [contact sheet](checks/contact_sheet.png), [two-light cylinders](checks/cylinders.png), and [100–300 pixel first-person study](checks/first_person.png).

One tile covers **0.20 × 0.20 metres**. Both axes repeat. Length and all file/draw marks run along **image x, left to right**. Texel pitch is **0.09765625 mm at 2048**, and **0.1953125 mm at 1024**. No external images, web textures or reference-material pixels were used. The supplied stone/flint and wood examples were inspected read-only.

| File | Encoding and construction |
| --- | --- |
| `steel_base.png` | 2048² RGB, 8-bit sRGB, explicit sRGB PNG chunk. Unlit metal reflectance, with faint cool/brown oxidation variation, horizontal file pigment, brass tarnish and minute rust cores. |
| `steel_base_1024.png` | 1024² RGB, 8-bit sRGB. Rounded 2 × 2 area average of the saved master, in encoded sRGB values. |
| `steel_height.png` | 2048² single-channel, 16-bit grayscale, linear. Native procedural file relief, shallow hammer hollows, scratches and pits. White is high. |
| `steel_height_1024.png` | 1024² single-channel, 16-bit grayscale. Rounded 2 × 2 area average; identical physical encoding. |
| `steel_normal.png` | 2048² RGB, 8-bit linear, OpenGL tangent space. Computed from the reopened saved 16-bit height at the physical texel pitch. |
| `steel_normal_1024.png` | 1024² RGB, 8-bit linear. Recomputed from the smaller saved height at its own texel pitch. |
| `steel_orm.png` | 2048² RGB, 8-bit linear. Red: shallow cavity AO. Green: roughness. Blue: metalness, 255 except inside rust. |
| `steel_orm_1024.png` | 1024² RGB, 8-bit linear. Rounded 2 × 2 area average of the master ORM. |

The height encoding is **0–65535 = 0–0.500 mm**, not ±0.500 mm. The saved master actually occupies **0.145129–0.294987 mm**. Do not stretch these extrema. The nominal uncut surface is **0.275 mm**, or **0.55** of the encoded range; subtract that baseline if using displacement. Normal strength already includes the physical height scale. Normals use **+X right, +Y up the image, +Z outward**, with wrapped central differences: `normalize(-dh/dx, +dh/drow, 1)`.

Import only the base maps as sRGB. Height, normal and ORM contain no sRGB, gamma or ICC chunks and should be read as linear data. The previews' stretched height displays are inspection images, not replacement height maps.

| Region | 2048 rows, end exclusive | 1024 rows, end exclusive | Interior mean sRGB | Mean roughness | Roughness, central 98% |
| --- | --- | --- | --- | --- | --- |
| Brass | 0–256 | 0–128 | (168.001, 136.000, 74.000) | 0.424 | 0.388–0.471 |
| Rubbed bright steel | 256–512 | 128–256 | (150.001, 150.001, 150.001) | 0.302 | 0.275–0.329 |
| Browned/blued face | 512–2048 | 256–1024 | (64.000, 64.000, 68.000) | 0.495 | 0.424–0.565 |

The boundaries blend over **3.6 mm**, approximately **37 master texels**, with a very small periodic sideways variation in their row position. Sampled full transition widths are 3.52–3.61 mm. The face-to-brass transition is centred on the top/bottom repeat boundary and has the same construction as the internal transitions. The bands have no geometric steps. Means above exclude the blended boundary texels.

`build_material.py` constructs the surface deterministically at native 2048 resolution using seed **741936**, NumPy and Pillow. SciPy was unavailable in the running Python, so periodic Gaussian filtering uses NumPy Fourier convolution. It needs no downloads or generated-image service. The 2048 maps are not enlarged 1024 images.

Three scales of strongly elongated stochastic grain form the continuous draw/file texture. Correlation lengths vary, so it does not become a regular comb. A second set of **520 individually tapered, slightly wandering scratches**, **4–57 mm long**, supplies discontinuous handling and file marks. Their transverse Gaussian widths are **0.070–0.190 mm**, and nominal depths are about **0.003–0.029 mm**. All follow x. Grain relief is stronger across the file direction than along it by a measured factor of **4.57**.

There are **105 soft hammer impressions**, with nominal radii **1.2–4.5 mm** and depths **0.020–0.055 mm** before regional smoothing. Their broad beds and irregular shoulders subtly bend the sheen. **340 small irregular pits** have nominal radii **0.14–0.60 mm** and depths **0.018–0.082 mm**. Only a minority of the face pits receive rust, and rust is restricted to their deepest cores. These are distributed over the entire 200 × 200 mm tile, so a small part shows only a few. Brass retains 83% of the shared relief; the rubbed steel retains 37%. This makes the edge visibly smoother while preserving related surface structure.

Broad oxidation fields create faint patches roughly 20–60 mm long. Face colour standard deviation is about **1.85–2.07 bytes/channel**. There is no light vector, normal-based highlight, AO multiplication or shadow in base colour. Incidental fitted end-to-end face colour changes remain below **1.96 sRGB bytes** vertically and **0.64 bytes** horizontally; there is no authored band-wide lighting ramp. Brass has slightly stronger, warm tarnish variation. Scratches affect relief and polishing roughness together; rusty pits agree across height, colour, roughness, metalness and AO.

AO is white outside actual pits and the deeper scratches. Its minimum is **212/255**, and mean is **0.999605**. Hammer hollows do not get baked AO. Metalness is **255 everywhere outside rust**; about **0.0171%** of master texels have reduced metalness, with a minimum of **45/255**. Rust colour support occupies **0.0179%** of the tile. The tiny difference comes from 8-bit quantization. The reduced ORM naturally contains filtered coverage around those pit cores.

The first pass looked too evenly brushed on the cylinders. I increased real file relief and shallow peen relief, and strengthened the brass tarnish slightly. Face normal tilt at the 95th percentile increased from **2.98° to 3.85°**; the final median is **1.34°**. The initial full-size source fields and build script remain in [source/pass1](source/pass1/), with its previews and metrics in [checks/pass1](checks/pass1/). The final surface keeps the colour quiet and lets the physical normals and roughness carry the changing light.

**All 85 numerical checks pass.** [checks/metrics.json](checks/metrics.json) records dimensions, PNG channel types and bit depths, colour metadata, band placement and transition widths, palettes, roughness, source-height agreement, normals, reductions, seams, cavity support, metalness and directionality.

Independent normal reconstruction from the saved height gives **zero mismatched channels and zero maximum byte error at both resolutions**. Mean angular quantization error is **0.174° at 2048** and **0.188° at 1024**, with maxima below **0.335°**.

| Map | Area-reduction PSNR | Lanczos-reference PSNR |
| --- | ---: | ---: |
| Base | 58.08 dB | 54.41 dB |
| Height | 106.61 dB | 60.44 dB |
| Normal | 47.91 dB | 47.87 dB |
| ORM | 62.06 dB | 57.70 dB |

Base, height and ORM are byte-exact matches to rounded area reduction. The normal is intentionally regenerated so it agrees with its smaller height, and remains comfortably above the requested 30 dB comparison threshold. The [reduction sheet](checks/downsample.png) shows corresponding crops.

I inspected the [half-tile offsets](checks/offset.png), [small 3 × 3 repeats](checks/tiled3x3.png), [native repeat intersection](checks/tiled_native_intersection.png), and [native wrap strips](checks/seam_strips.png). No vertical stitch or abrupt wrap step stood out. The largest wrap-difference ratio to nearby ordinary differences is **1.16**. The horizontal trim bands remain visible by design when the entire sheet is tiled. Complete **6144 × 6144** base and normal repeats and native offsets are retained in `checks/`.

The [aligned layers](checks/layers.png) and [native detail](checks/native_detail.png) show common feature coordinates. The [two-light flat views](checks/relit.png), [neutral relief views](checks/neutral_relief.png) and [cylinders](checks/cylinders.png) use the delivered maps. The renderer is linear-light metallic GGX with one directional sun and a uniform analytic sky contribution. There is no environment image and no extra normal-strength multiplier. Changing the sun reverses the pit and scratch response; brass stays warm, the rubbed strip gives a narrower bright sheen, and the dark face gives a softer, uneven sheen.

The [first-person sheet](checks/first_person.png) renders an 18 mm diameter steel cylinder at actual **100, 200 and 300 pixel diameters**, with length along x and correctly transformed tangent normals. Prefiltered map sampling avoids coarse alias patterns. File structure reads at those sizes, with the smallest marks fading at 100 pixels. The [64-pixel swatches and palette check](checks/inventory_palette.png) retain dark steel and warm brass identity against the brief's honey wood, straw lashing and brown hide colours. Companion colours there are newly drawn flat swatches, not borrowed reference pixels or final assembled weapons.

Rebuild and check from this folder:

```sh
python3 build_material.py
python3 check_material.py
```

For an actual rebuild followed by SHA-256 comparisons and the full validation/render pass:

```sh
python3 check_material.py --verify-rebuild
```

That command was run successfully. **All eight delivery PNGs and all four current source files reproduced byte for byte**, recorded in [checks/rebuild_verification.json](checks/rebuild_verification.json). The final build took **9.19 seconds**; the combined rebuild, verification and preview pass took **34.54 seconds**. [build_manifest.json](build_manifest.json) contains delivery hashes and build timing.

[source/construction_fields.npz](source/construction_fields.npz) retains **21 full-resolution fields**, including band masks, oxidation, file grain, hammer relief, pits, scratches, polish, rust, physical height, roughness and AO. [source/construction.json](source/construction.json) retains the physical parameters and every individual feature's position and dimensions. `source/band_masks.png` and the 16-bit `source/rust_mask.png` provide inspectable full-size masks. No source asset is required outside this folder.

Remaining limits: this is an authored procedural surface, not a measured metal scan. The filing is deliberately fairly orderly; the surviving hammer impressions are shallow and best seen in the neutral relief or moving light. The oil finish is represented through roughness, without a separate clearcoat layer or anisotropic shader. Normal mapping cannot alter the silhouette. The actual meshes, engine exposure, compression and mip generation have not been tested, and very fine marks will soften at inventory scale. The preview cylinders are ideal geometry, so actual arris placement remains the mesh's responsibility.

All writes stayed in the current folder. No git commands were run. Work ran **15 November 2026, 16:37:19–16:48:46 UTC / 11:37:19–11:48:46 EST**, approximately **11.5 minutes**, including reference inspection, native construction, the visual revision, checks, retained sources, rebuild verification and reporting.

## Wrap correction — 15 November 2026

Rebuilt all eight delivery PNGs, current source fields, manifest, numerical checks and previews. The reported game failure reproduces on the original **1024 base**: x **0.956914**, y **5.072104**. The original 2048 base measured x **0.952302**, y **3.573922**. The previous checker compared the seam against the 95th percentile of nearby differences, which included the strong band blend itself. Its earlier 1.16 maximum was a different measurement and did not establish acceptance by the game's check; the measurements in this section supersede that wrap assessment.

Only the face-to-brass blend profile changed. Its existing **3.6 mm** support, boundary location and sideways irregularity remain fixed. The new profile mixes 40% of the original smoothstep with 30% of each half-width smoothstep. This reduces its central slope while keeping a continuous transition and zero slopes at its outer ends. The top brass darkens toward the join, and the last face rows warm and lighten into it. No extra lighting or band-wide colour ramp was added. The measured full transition spans **36–37 texels per column**, **3.515625–3.613281 mm** at 2048.

The same corrected masks control reflectance, relief strength and roughness. Both normals were regenerated from their saved heights. Original colour-calibration masks were retained to prevent any palette drift elsewhere. At 2048, changed samples in every map are confined to rows **0–18 and 2029–2047**, inclusive. At 1024, every change lies within rows **0–9 and 1014–1023**. All other samples are byte-identical to the retained originals. Internal boundaries at rows 256 and 512, the full bright band, and all band positions and widths are unchanged.

The checker now measures each saved PNG in floating-point arithmetic, using its encoded channel values, with no unsigned subtraction or colour-space conversion:

```text
x = mean(abs(A[:, -1] - A[:, 0])) / mean(abs(A[:, 1:] - A[:, :-1]))
y = mean(abs(A[-1, :] - A[0, :])) / mean(abs(A[1:, :] - A[:-1, :]))
```

Each mean includes all pixels and channels in the relevant differences. **Every ratio must be strictly below 3.** The old local comparison remains only as an additional check. Exact numerators, denominators, ratios and before/after preservation evidence are in [checks/metrics.json](checks/metrics.json).

| Map | Size | x ratio after | y ratio before | y ratio after |
| --- | ---: | ---: | ---: | ---: |
| Base | 2048 | 0.950459 | 3.573922 | 1.807929 |
| Base | 1024 | 0.961291 | 5.072104 | 2.587494 |
| Height | 2048 | 1.011410 | 1.065846 | 1.065684 |
| Height | 1024 | 1.069605 | 1.125598 | 1.125963 |
| Normal | 2048 | 0.997104 | 1.288643 | 1.283939 |
| Normal | 1024 | 0.999896 | 1.519032 | 1.517922 |
| ORM | 2048 | 0.941323 | 0.878454 | 0.819415 |
| ORM | 1024 | 0.927014 | 0.912050 | 0.842945 |

For the base, the vertical edge/interior mean differences are **1.314941 / 0.727319** bytes at 2048 and **2.564779 / 0.991221** at 1024. The edge steps are also below the peak steps in **each** internal band transition: **1.550781 and 3.567220** at 2048; **2.992839 and 7.004557** at 1024.

All **132 numerical checks pass**. Source hashes confirm that file grain, individual scratches, hammer marks, pits, oxidation and the other unaffected fields are identical. All original construction parameters and feature records match. AO and metalness channels are byte-identical throughout both sets. Height remains **0–65535 = 0–0.500 mm**, with the same master extrema **0.145129–0.294987 mm** and the same extrema at 1024. Independent normal reconstruction has **zero mismatched channels** at both sizes. Base, height and ORM remain exact rounded 2 × 2 reductions; the height-derived normal remains **47.91 dB** against area reduction. Every reduction comparison exceeds 30 dB.

Inspected the refreshed [before/after seam strips](checks/wrap_fix/comparison.png), [half-tile offsets](checks/offset.png), [3 × 3 repeats](checks/tiled3x3.png) and [contact sheet](checks/contact_sheet.png). The join is a softer colour transition, with the original surface detail still aligned and no new geometric ridge visible. The original trim bands remain visible in full-sheet repeats. The pre-fix maps, scripts, report, metrics, parameters and source-field hashes are retained in [checks/wrap_fix/before](checks/wrap_fix/before/).

Ran `python3 build_material.py`, followed by `python3 check_material.py --verify-rebuild`. The second build reproduced **all eight delivery PNGs and all four current source files byte for byte**, recorded in [checks/rebuild_verification.json](checks/rebuild_verification.json). That build took **21.328 seconds**; the combined rebuild, verification and complete preview pass took **67.033 seconds**. This round took **about 5 minutes**, starting **16:52:11 UTC / 11:52:11 EST**, including reading, repair, comparison, visual inspection and reporting. All writes stayed in this folder; no git commands were run. The game's asset runner itself was not invoked; its supplied measurement is now enforced locally at the stricter threshold of 3.
