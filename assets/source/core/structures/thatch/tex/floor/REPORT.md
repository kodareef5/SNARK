Round 2 rebuilds the floor with **515 distinct rounded reeds**, brighter twined cord, small nodes, grouped straw colours, and darker trodden and pale patches. All four maps pass the engine's exact seam measure in both directions. The accepted earth is unchanged.

Start with [round 1 beside round 2](checks/round1_vs_round2.jpg), the [concept comparison](checks/concept_comparison.jpg), and the requested [house_inside.png floor crop beside the new floor](checks/house_inside_comparison.jpg). The concepts retain their painted lighting; their colours are not sampled as unlit material values.

All four delivered maps are **2048 × 2048**, pixel-aligned over **3 × 3 metres**, at **1.46484375 mm/pixel**. Reeds run left to right and continue through the horizontal wrap. The three mats retain bounds 0–683–1365–2048, with joints on nominal rows **0 (top/bottom wrap), 683 and 1365**. They contain **172, 172 and 171 reeds**. Nominal stem widths are 3.363–4.568 pixels; including every curve's local variation, widths remain **3.061–4.783 pixels / 4.484–7.007 mm**.

Each mat has eleven perpendicular cord rows. Cyclic spacing is **260.742–285.645 mm**, averaging 272.727 mm. Positions vary slightly between mats, and the bindings end just inside their joints. Two strands alternate front/back order, with fine winding fibres and an overall nominal diameter of **6.59 mm**. The reed bed rises approximately **2.20 mm between cords** and compresses under them. There are 1,758 small authored node collars and 3,030 short cut-face marks distributed along the three ragged butt joints. Sparse loose fibres stay close to the surface.

| Delivered file | Construction and import |
| --- | --- |
| [floor_base.png](floor_base.png) | **8-bit RGB, embedded sRGB.** The two retained generated sources supply reed skin, scuffs and splits. The script traces 82 usable source strips and assembles periodic skins at native horizontal scale, fitting each to a narrow stem. More source contrast survives than in round 1; individual pigment, brighter crown/darker sheath, node rings, handful variation, wear and pale patches add detail. Cord and cut-face colour share the height features. No preview light or AO is multiplied into the base. |
| [floor_height.png](floor_height.png) | **16-bit grayscale, linear, white high. 0–65535 encodes 0–12 mm.** Circular reed cross-sections, nodes, shallow mattress bellies, compressed joints and two raised twine strands define the surface. A fixed physical relief gain of 1.22 is used; the image is never normalized to its extrema. Saved values span **0.318975–11.722408 mm**, or **11.403433 mm** of actual relief, with **zero clipped samples**. No foundation thickness is encoded. |
| [floor_normal.png](floor_normal.png) | **8-bit RGB, linear, OpenGL.** Computed solely from the reopened delivered 16-bit height with wrapped central differences at the physical pixel pitch. Components are proportional to `(-dh/dx, +dh/drow, 1)`, because texture +Y points toward the top of the image. No independent normal painting or border repair. |
| [floor_orm.png](floor_orm.png) | **8-bit RGB, linear.** R is cavity occlusion derived from saved height at two wrapped filter scales; G is dry reed and cord roughness, reduced in trodden areas; B is **zero everywhere**. AO is 0.651–1.000. Roughness is 0.682–0.945, mean 0.833. |

Mean encoded base colour is **(174.999, 135.000, 80.000)**, matching the requested (175, 135, 80). Fine-detail luminance RMS is **2.428× round 1**, using the same wrapped 0.8-pixel high-pass measurement. The broader handful and wear variation remains visible when the tile is reduced, while the native crops resolve individual reeds and cord twists.

The joint at row 0 is centred between texels 2047 and 0, at unwrapped coordinate **−0.5**. Internal joints use the same construction at **682.5 and 1364.5**. Unequal fibre shoulders and short paired cut faces border a shallow, solid compressed core. This continuous core occupies both halves of each joint; the first and last base/height samples therefore agree. Border rows are not copied after synthesis. The normals still reflect the distinct neighboring shoulders and are tested independently.

The checker now accepts only the exact engine formula, summed over all pixels and channels using signed 64-bit subtraction and accumulation:

```text
seam_y = sum(abs(last_row - first_row)) * (height - 1)
         / sum(abs(row[y] - row[y+1]))
seam_x = sum(abs(last_column - first_column)) * (width - 1)
         / sum(abs(column[x] - column[x+1]))
```

There is no percentile denominator or exemption for mat joints. A constant layer returns zero. Independent scalar cases cover RGB channel accumulation, full-range uint16 values and constant data. The archived base reproduces the reported round 1 failure, **seam_y = 2.150650**.

| Layer | Round 1 seam_x | Round 1 seam_y | Round 2 seam_x | Round 2 seam_y |
| --- | ---: | ---: | ---: | ---: |
| base | 0.972709 | 2.150650 | **0.883950** | **0.000000** |
| height | 0.634562 | 1.120470 | **0.541527** | **0.000000** |
| normal | 0.636338 | 1.663178 | **0.514156** | **0.483473** |
| orm | 0.808161 | 1.707693 | **0.664577** | **0.017889** |

All checks passed: dimensions, PNG depth/channel type, colour profiles, 3 m scale, mat anchors, actual reed widths, cyclic cord spacing, target colour, unclipped relief, zero metalness and outward OpenGL normals. Independently reconstructed normal errors are **0.1713° mean, 0.3180° p99 and 0.3840° maximum**; green-direction agreement is **100%**. The final independent rebuild reproduced **all four PNG files byte for byte**. Exact sums, measurements and hashes are in [metrics.json](checks/metrics.json), [reproducibility.json](checks/reproducibility.json) and [check_log.txt](checks/check_log.txt).

I inspected the [native layers](checks/native_crop_layers.png), [half-offsets](checks/offsets.jpg), [3 × 3 repeat](checks/tiling.jpg), [all-layer repeats](checks/tilings_all_layers.jpg), [boundary comparison](checks/boundary_comparison.png), and both directions of [grazing-light relief at 1:1](checks/relighting_native.jpg). Reeds now have distinct light and dark sides; twists alternate along the pale cord. The joint lips are slightly ragged and remain backed by solid compressed material. The wrap shows the intended mat joint without an extra boundary break. The repeating organization is the three mats and their bindings, with gentle mottling from wear. Full-resolution offsets, the 6144 × 6144 base repeat, the layer sheet, two full-size relit maps and the overview [relighting sheet](checks/relighting.jpg) are also retained.

Round 1 is preserved in [source/round1/](source/round1/): its four maps, scripts, report, checks, complete sources, composed master, feature fields, manifest and frozen sRGB profile. **All 30 archived files** and **all 31 recorded earth files** were hash-verified unchanged. The original generated PNGs also remain untouched at **1254 × 1254** in the active `source/` folder, with their original [prompts](source/generation_prompts.md). Round 2's [manifest](source/build_manifest.json), [composed master](source/composed_master.png) and [feature fields](source/feature_masks.npz) record the new deterministic build. Only this floor folder was edited.

I used the repository's `piece_foundation.png`, `house_inside.png`, design notes and roof material/detail as references. No new source images were generated, and no outside images or existing game imagery were searched for, downloaded, used or imitated.

Rebuild and check with Python, NumPy, SciPy and Pillow:

```sh
python3 build_material.py
python3 check_material.py
# Also rebuild once more and verify the four PNG files byte for byte:
python3 check_material.py --rebuild
```

The build uses only this folder's frozen sources. The checker also reads the two repository concepts for its comparison sheets and the accepted earth for preservation checks. Import the base as sRGB, the other maps as linear, use repeat wrapping on both axes, and retain the **12 mm** height encoding. The frozen ICC profile keeps PNG byte output stable.

Remaining limitations: the relief, roughness and pigment separation are authored estimates rather than measured scans. Fine source skin contrast is retained. The previews use a diagnostic dielectric renderer, not the game's shader; engine texture compression and mip filtering have not been tested here.

Round 2 editing and verification ran from **14 November 2026, 21:07:00 UTC** to **21:17:04 UTC**, approximately **10.1 minutes**, following the initial reference review. The final verification rebuild took **44.85 seconds**.
