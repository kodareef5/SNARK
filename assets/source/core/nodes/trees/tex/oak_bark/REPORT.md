This is the replacement live-oak bark set: four aligned **2048 × 2048** PNGs, repeating over **1.6 m around the stem × 2.0 m along it**. Image-up points toward the crown. Start with [the layers](checks/layers.jpg), [native detail](checks/detail.jpg), and [the cylinder distance views](checks/cylinder_distances.jpg).

The reference review covered `oak_trunk.png`, `oak_lineup.png`, `hammock_near.png`, the oak section and colour table in `../../ref/concept/broadleaf/DESIGN.md`, both supplied near-tree renders, and the wood material's `checks/layers.jpg` and report. Four new original source paintings were generated using the **built-in image_gen tool**. No external image search, downloaded reference or existing-game image was used.

The bark now has broad broken plate faces, offset transverse fractures, chipped fine layers and dark connected recesses. The plates change shading under opposing low sun directions. There is no large scar, knot or lichen island to mark the repeat. The native sources each occur once in the tile; crops are not reused inside it.

| Runtime file | How it was made | Verification and observations |
| --- | --- | --- |
| [oak_bark_base.png](oak_bark_base.png) | Generated anatomy, then script-authored pigment. Broad source exposure drift is removed; material swatches, the shared plate field and local pigment detail rebuild warm brown faces, dark brown fissures, greyer wear and sparse grey-green lichen. No directional lighting pass is baked into this map. RGB8, embedded sRGB profile. | Inspected native detail, 3×3 repeat, offset view, flat and cylindrical relighting. Mean RGB **78.81, 67.59, 53.73** (`#4F4436` rounded), slightly lighter than `#493F34`. Upper plate mean RGB **95.38, 80.70, 62.97**; its 95th-percentile channels are **127, 111, 87**. Fissure mean RGB **38.15, 36.08, 32.10**. Upper plate/fissure mean linear-luminance ratio **5.10×**. Larger plates remain readable at 10 m. |
| [oak_bark_height.png](oak_bark_height.png) | True unsigned greyscale16 PNG. Connected major fissures define recessed channels and nearly planar plate shoulders. Unequal underlying beds, broad face facets, smaller source-aligned flakes and sub-millimetre fibres add separate scales of relief. Small isolated dark pores are excluded from the deep-cut mask. | Actual range **0–48 mm**, using the entire 16-bit range. Local fissure depth is **23.58 / 26.93 / 30.86 mm** at the 5th/50th/95th percentiles, measured against the highest surface within an approximately 63 mm neighbourhood. Most apparent depth belongs to fissures. Inspected height/base registration and constant-pigment relighting. |
| [oak_bark_normal.png](oak_bark_normal.png) | RGB8 linear, tangent-space **OpenGL**. Computed after height quantization using wrapped central differences at the physical texel pitches. No additional normal-strength multiplier. | Independently reconstructed from the delivered height: angular error **0.1702° mean, 0.3150° p99, 0.3862° maximum**, consistent with RGB8 encoding. Both low-light directions and the cylinder's tangent-frame transformation were inspected. |
| [oak_bark_orm.png](oak_bark_orm.png) | RGB8 linear: **R occlusion, G roughness, B metalness zero**. AO integrates height horizons in 16 azimuths at seven radii, then applies a narrow-cavity attenuation for unresolved recesses. Roughness follows substrate, wear and lichen. | Fissure AO median **0.290**, 5th–95th percentile **0.267–0.318**. Plate-face AO median **0.973**. Roughness **0.863–0.949**, with weathered material and lichen rougher. Metalness is zero in every pixel. Separate AO/roughness views and all relighting previews inspected. |

Height conversion is `height_u16 / 65535 × 0.048` metres; white is high. Physical texel pitches are **0.78125 mm across** and **0.9765625 mm along**. The normal is `normalize(-dh/dx, +dh/d(image_down), 1)`: red points image-right, green image-up, blue outward. Enable sRGB decoding only on the base. Use repeat addressing on both axes. The edges are adjacent samples of a continuous period; they are not duplicated texels.

| Source/build file | Purpose and construction |
| --- | --- |
| `source/plate_source_a.png`, `plate_source_b.png`, `plate_source_c.png`, `plate_source_d.png` | Four unchanged native **1254 × 1254** generated PNGs. The prompts requested 2048; this is the actual returned size. All are preserved at full native resolution. |
| [source/prompts.json](source/prompts.json) | Exact prompts for all four originals, tool provenance, source filenames and actual/requested sizes. Generation is not needed to rebuild. |
| [source/periodic_master.png](source/periodic_master.png) | Rebuilt 2048px construction image. Four native patches at 1024px spacing, 230px overlaps and minimum-error cuts, followed by both periodic closures. The last cut has cyclic endpoints. No source upscaling. |
| [source/composition.json](source/composition.json) | Rebuilt source hashes, native sizes, placements, horizontal flips and wrap offset. |
| `source/fissure_mask.png`, `plate_shoulders.png`, `weathering_mask.png`, `lichen_mask.png` | Rebuilt semantic construction fields, all aligned with the final maps. Deep-fissure mask covers **11.67%**; lichen weight exceeds 0.1 on **2.13%** of pixels. These are not runtime textures. |
| [source/srgb.icc](source/srgb.icc) | Reused fixed standard sRGB profile; embedded only in the base and construction master. |
| [build_material.py](build_material.py) | Complete deterministic offline build of composition, semantic fields and all four runtime maps. Reads only files in this folder. Random seed is fixed in the manifest. |
| [check_material.py](check_material.py) | Independent PNG/normal/seam/material checks and physical-scale software renders. Optional isolated rebuild and full PNG SHA-256 comparison. |
| [material.json](material.json) | Updated version 2 manifest: coverage, height range, orientation, colour spaces, swatches, sources and preview setup. |
| [requirements.txt](requirements.txt) | NumPy 2.0.2, SciPy 1.13.1, Pillow 11.3.0. |

Rebuild and check from this folder:

```sh
python3 build_material.py
python3 check_material.py --rebuild
```

The isolated rebuild copies only the build script, manifest, four native paintings and fixed profile into a temporary directory beneath `checks/`. It compares the complete runtime PNG hashes and removes the temporary directory. **All four delivered PNGs rebuilt byte for byte.** The result is recorded in [checks/rebuild.json](checks/rebuild.json).

The edge checks compare the mean absolute jump across each wrap with ordinary adjacent interior pixels along that axis. Height is expressed on an 8-bit-equivalent scale for comparison. Full distributions and normal/colour measurements are in [checks/metrics.json](checks/metrics.json).

| Layer | Join | Edge jump | Interior jump | Ratio |
| --- | --- | ---: | ---: | ---: |
| Base | left/right | 10.445 | 9.891 | 1.056 |
| Base | top/bottom | 7.655 | 8.002 | 0.957 |
| Height | left/right | 3.074 | 2.864 | 1.073 |
| Height | top/bottom | 1.421 | 1.697 | 0.837 |
| Normal | left/right | 8.896 | 9.985 | 0.891 |
| Normal | top/bottom | 6.929 | 7.436 | 0.932 |
| ORM | left/right | 2.372 | 2.263 | 1.048 |
| ORM | top/bottom | 1.385 | 1.554 | 0.891 |

All required edge jumps are comparable to the texture's interior. Visual inspection of the offset and repeated sheets found no straight border, abrupt colour step or conspicuous single feature marking the repeat.

| Check artifact | Contents and observations |
| --- | --- |
| [checks/layers.jpg](checks/layers.jpg) | Four labelled delivered layers. Plate anatomy aligns across the maps. |
| [checks/base_tile3x3.jpg](checks/base_tile3x3.jpg), [native PNG](checks/base_tile3x3_native.png) | 3×3 repeat; native PNG is 6144 × 6144 for one-to-one examination. No obvious seam or isolated repeat landmark. |
| [checks/offsets.jpg](checks/offsets.jpg) | All maps shifted by half a period in both directions, bringing the wraps into the centre. |
| [checks/detail.jpg](checks/detail.jpg) | Matching 768px native crops of base, height and both relights. Fine flakes survive; major plates supply the depth. |
| [checks/ao_roughness.jpg](checks/ao_roughness.jpg) | Individual ORM red/green channels. Dark occlusion follows the recesses; broad faces remain open. |
| [checks/relighting_flat.jpg](checks/relighting_flat.jpg) | Entire tile under the two low suns. Highlights switch sides while fissure pigment remains dark. |
| [checks/geometry_only.jpg](checks/geometry_only.jpg) | Constant grey pigment with the delivered normal and ORM. Confirms plate relief without help from albedo contrast. |
| [checks/flat_distances.jpg](checks/flat_distances.jpg) | Flat 2 m wide × 4 m high surface at 3 m and 10 m, under each sun. Individual full-resolution views are `flat_3m_left.jpg`, `flat_3m_right.jpg`, `flat_10m_left.jpg`, `flat_10m_right.jpg`. |
| [checks/cylinder_distances.jpg](checks/cylinder_distances.jpg) | **2 m diameter**, 4 m high cylinder at 3 m and 10 m, under each sun. Individual views use the corresponding `cylinder_3m_*` and `cylinder_10m_*` filenames. The 1.6 m texture wraps approximately 3.927 times around its circumference. |
| [checks/cylinder_native_crops.jpg](checks/cylinder_native_crops.jpg) | Native screen-pixel crops from the four cylinder renders; the far view is not enlarged. Near faces feel layered; at 10 m the fine grain filters away and the main plate pattern remains. |
| [checks/construction.json](checks/construction.json) | Build provenance, coverage-related construction values and measured range. |
| [checks/metrics.json](checks/metrics.json), [checks/rebuild.json](checks/rebuild.json) | Format/hash inspection, seam distributions, independent normal agreement, material statistics, assertions and isolated rebuild comparison. |

Every distance render uses a **1920 × 1080 viewport, 60° horizontal field of view, 1.6 m camera height**, and distance measured to the front surface. The sun is **18° above the horizon**, at camera-relative azimuth −65° or +65°. Lighting is one sun plus spatially uniform sky, with **no cast shadows and no bounced light**. AO affects the sky only. Rough dielectric shading consumes the ORM roughness. Exposure is fixed; there is no tone mapping. Rendering uses 2× supersampling, periodic trilinear mipmaps, linear-light base filtering and decoded/renormalized normal filtering. These are material diagnostics under the requested lighting model, not screenshots from the game engine.

The visual iterations removed the first attempt's excessive depth in tiny pores, reduced uniformly deep channels to roughly 27 mm typical local cuts, sharpened the plate shoulders, and restored fine fractured pigment so the broad geometry did not become soft dark outlines. The old `oak_a.png`, `oak_b.png`, old crack mask and old source prompts were removed. The old report, build/check scripts, manifest and runtime maps were replaced; semantic masks were regenerated. The reusable sRGB profile and pinned requirements remain.

I would ship this material set. The remaining reservations are that the height is an authored reconstruction, not a measured scan, and a tangent normal cannot create real flake undercuts or alter the trunk silhouette. I have not checked the final maps on the actual game's UVs or through its texture compression. A finite tile can still be identified by deliberate side-by-side pattern matching; the repeat review found no prominent scar or lichen patch drawing attention to it. No known format, alignment or wrap defect remains.
