Round 2 supplies **18 opaque, periodic PNGs**, all **2048 × 1024**: sun and shade pigments for each skin, their compatibility average, and one shared height/normal/ORM set. Start with the [layer sheet](checks/layers.jpg), [card/skin scale comparison](checks/card_skin_scale.jpg), and the native-size purpose tests for [oak](checks/oak_purpose_actual.png), [fig/banyan](checks/fig_purpose_actual.png), and [mangrove](checks/mangrove_purpose_actual.png).

I reviewed both supplied round-2 GPU captures and the repository concepts. The new material addresses their warm outer foliage and cool underside contrast through entire leaf populations. Each leaf is rasterised once into both pigment maps, with the same specimen contour, position, overlap, tissue, midrib and relief. Sun leaves receive warmer mature pigment and fresh terminal blades; shade leaves mature those same terminal blades into cool ordinary foliage. A small yellow shift follows each sun blade's own base-to-tip axis. No sun direction or painted lighting enters the colour builder. Rare turned undersides and brown leaves occupy the same places in both variants.

| Skin | Sun mean sRGB | Shade mean sRGB | Compatibility mean sRGB | Fresh area, sun / shade | Underside area, either |
| --- | --- | --- | --- | --- | --- |
| Oak | 140.000 / 142.000 / 66.000 | 94.000 / 106.000 / 62.000 | 117.000 / 124.000 / 64.000 | 4.79% / 0% | 0.48% |
| Fig | 125.000 / 133.000 / 60.000 | 84.000 / 100.000 / 58.000 | 104.500 / 116.500 / 59.000 | 4.83% / 0% | 0.51% |
| Mangrove | 110.000 / 128.000 / 58.000 | 74.000 / 96.000 / 56.000 | 92.000 / 112.000 / 57.000 | 6.05% / 0% | 0.49% |

Oak fresh leaves average **171.25 / 166.80 / 83.00**; their 90th-percentile channels are **178 / 173 / 87**, reaching toward the requested 175 / 170 / 85 tips. Fig and mangrove fresh leaves average **156.58 / 159.98 / 77.15** and **149.60 / 160.08 / 76.04**. Fresh growth is confined to the last two ranks of selected shoots, including opposite terminal pairs in mangrove. Visible undersides remain approximately half a percent. Shade has **zero fresh blades**, including in the construction records.

This is more than a channel gain. The best fitted linear-light RGB gain between shade and sun still leaves **6.47 / 6.67 / 8.86 sRGB levels RMS** for oak / fig / mangrove. An affine fit also cannot explain the leaf populations. Fine tissue within mature blades has sun/shade correlation **0.982 / 0.988 / 0.984**. The [oak](checks/oak_ecotype_alignment.jpg), [fig](checks/fig_ecotype_alignment.jpg), and [mangrove](checks/mangrove_ecotype_alignment.jpg) splice tests show leaf contours and relief crossing the colour boundary continuously.

The single `_skin_base.png` files remain. Each pixel is the **arithmetic average of the two delivered sRGB byte triples**, rounded to nearest with ties to even; its maximum rounding error is half a channel level. This explicitly defines “mean”; it is not a linear-light blend. All three pigment maps carry sRGB and gAMA tags. Height, normal and ORM remain linear data.

| Skin | Physical rectangle | Blade length / width | Clumps / shoots / leaves | Actual clump support diameter |
| --- | --- | --- | --- | --- |
| Oak | 4.8 × 2.4 m | 105–120 mm / 53–60 mm | 9 / 946 / 7,095 | 1.138–1.911 m |
| Fig / banyan | 6.4 × 3.2 m | 140–200 mm / 0.48–0.67 × length | 28 / 800 / 6,032 | 0.933–1.558 m |
| Mangrove | 4.0 × 2.0 m | 130–169 mm / 0.47–0.60 × length | 65 / 450 / 5,400 | 0.328–0.600 m |

The round-1 oak/fig size discrepancy is resolved in favour of the current cards. The [scale sheet](checks/card_skin_scale.jpg) places an unretouched cell-0 card alongside both skin pigments at **400 pixels/metre**. Oak card width is 0.9 m, fig 1.2 m, mangrove 0.8 m. The source contours are still extracted from the original locally retained atlas specimens, with broad source illumination removed and fine tissue retained.

Oak clump support sizes scale by **2.8125** (112.5 / 40 mm), fig by **17/12** (170 / 120 mm). Their clump count and shoot density scale inversely with area, while their texture rectangles, periodicity and height encodings remain fixed. These supports are overlapping groups with unequal shoulder lobes; their diameter is not the size of one fringe card. Oak consequently has fewer, broader mounds and softer broad slopes than round 1. The new leaf width also matches its cards. Mangrove geometry is unchanged: its delivered **height, normal and ORM hashes exactly match round 1**.

| Delivered role | Oak | Fig / banyan | Mangrove |
| --- | --- | --- | --- |
| Sun pigment, sRGB RGB8 | [oak_skin_sun_base.png](oak_skin_sun_base.png) | [fig_skin_sun_base.png](fig_skin_sun_base.png) | [mangrove_skin_sun_base.png](mangrove_skin_sun_base.png) |
| Shade pigment, sRGB RGB8 | [oak_skin_shade_base.png](oak_skin_shade_base.png) | [fig_skin_shade_base.png](fig_skin_shade_base.png) | [mangrove_skin_shade_base.png](mangrove_skin_shade_base.png) |
| Compatibility average, sRGB RGB8 | [oak_skin_base.png](oak_skin_base.png) | [fig_skin_base.png](fig_skin_base.png) | [mangrove_skin_base.png](mangrove_skin_base.png) |
| Metric height, linear grayscale16 | [oak_skin_height.png](oak_skin_height.png) | [fig_skin_height.png](fig_skin_height.png) | [mangrove_skin_height.png](mangrove_skin_height.png) |
| OpenGL normal, linear RGB8 | [oak_skin_normal.png](oak_skin_normal.png) | [fig_skin_normal.png](fig_skin_normal.png) | [mangrove_skin_normal.png](mangrove_skin_normal.png) |
| AO / roughness / zero metalness, linear RGB8 | [oak_skin_orm.png](oak_skin_orm.png) | [fig_skin_orm.png](fig_skin_orm.png) | [mangrove_skin_orm.png](mangrove_skin_orm.png) |

Height combines the overlapping rounded mounds with locally tangent, cupped and rolled leaf surfaces, small midribs and lifted tips. The encoding remains **black = 0 mm; white = 220 mm oak, 250 mm fig, 200 mm mangrove**. Actual reopened heights are **4.002–215.998 mm**, **4.002–245.998 mm**, and **4.001–195.999 mm**; their relief is **211.997 / 241.997 / 191.998 mm**. The normal is independently checked against the reopened 16-bit height using wrapped central differences at **2.34375 / 3.125 / 1.953125 mm per pixel**. Its convention is normalized `(-dH/dx, +dH/drow, 1)`, OpenGL green toward image top, encoded around 127.5.

Occlusion comes from narrow surface concavity, is bounded **0.6–1**, and affects sky illumination only. Roughness remains matte, with mangrove slightly glossier; metalness is zero everywhere. Toroidal placement, gap filling, filtering and derivatives preserve both periods. The remaining small interstices continue neighbouring tissue: **2.128% oak, 1.014% fig, 0.078% mangrove**. Every delivered map is opaque, with no alpha channel. Import all three base-colour variants as sRGB, all other maps as linear, and use repeat wrapping at the physical dimensions above.

| Measurement | Maximum normal/height error | Largest seam/interior ratio, six maps | Roughness | AO below 0.65 | Normal contribution at 30 / 60 m, RMS display luma |
| --- | --- | --- | --- | --- | --- |
| Oak | 0.379° | 1.218 | 0.941–0.965 | 0.037% | 6.18 / 6.28 |
| Fig | 0.383° | 1.085 | 0.941–0.961 | 0.023% | 6.54 / 6.29 |
| Mangrove | 0.382° | 1.092 | 0.918–0.937 | 0.080% | 9.62 / 7.91 |

The independent checker passes **235 / 235 assertions**. It reopens all 18 PNGs, checks dimensions, bit depths, channel types, colour tags, pigment means and floors, exact compatibility averaging, physical leaf/clump dimensions, fresh/underside/brown populations, matching tissue, source hashes, shared mangrove preservation, AO/roughness/metalness, metric height/normal agreement, and seams in both directions for every map. It also tests normal contribution at 30 and 60 m and the visible material selection on each purpose head. [metrics.json](checks/metrics.json) includes the darkest one percent, minima, narrow dark-region widths, seam measurements, geometry counts and every assertion. No pigment pixel falls below 40 / 52 / 38.

The retained visual checks are:

- Combined and individual layer contact sheets; [oak](checks/oak_tiling.jpg), [fig](checks/fig_tiling.jpg), and [mangrove](checks/mangrove_tiling.jpg) **JPEG-only** sheets showing all six maps tiled 2 × 2 and offset by half a period. I found no boundary seam or large isolated repeat landmark.
- The [distance sheet](checks/base_distance.jpg), showing **sun, shade and compatibility** at their native 15 / 30 / 60 m screen sizes, filtered in linear light.
- The three native-size purpose sheets linked above, plus labelled enlarged 30 m comparisons, [oak](checks/oak_purpose_30m_enlarged.png), [fig](checks/fig_purpose_30m_enlarged.png), and [mangrove](checks/mangrove_purpose_30m_enlarged.png).
- [Oak](checks/oak_normal_and_tier_controls.png), [fig](checks/fig_normal_and_tier_controls.png), and [mangrove](checks/mangrove_normal_and_tier_controls.png) controls for smooth normals, delivered normals, a 1024 texture cap, and the software tier without cast shadows.
- Paired unlit / 10:00 / 17:00 close-ups: [oak](checks/oak_leaf_detail.jpg), [fig](checks/fig_leaf_detail.jpg), [mangrove](checks/mangrove_leaf_detail.jpg). Every panel shows the same 1.2 × 0.6 m patch.
- Reading-range sheets from **5–120 m**, four independent UV origins under both lights, and native 5 m fig images. Leaf-scale breakup gives way to clump colour and shading at the distant end.

The purpose camera remains **1080 rows, 70° vertical field of view**, focal length 771.20 pixels. The oblate heads are 3 m across for oak/mangrove and 5 m for fig, height 78% of width; at 12 / 30 / 60 m their widths are **193 / 77 / 39 px** and **321 / 129 / 64 px**. Both hours use the same UVs and material assignment. The head selects a single ecotype for each triangle using the actual `broadleaf.py:skin()` rule:

```python
mean_vertex_normal_y + 0.25 * ((face_index * 0.618034) % 1 * 2 - 1) > -0.05
```

Thus upper faces wear sun pigment, lower faces shade pigment, and the boundary varies by face. Selection uses the smooth head normals and is independent of hour and detail normals. The test head has deterministic irregular triangles at approximately 0.42 m spacing. It uses continuous metric longitude/latitude UVs to isolate the material; the full crown's marching-tetrahedra geometry, dominant-axis unwrap and inter-head shadows are not reproduced. Main purpose renders include an analytic core self-shadow test for direct sun. The separate software control omits it. The concepts retain their painted illumination and approximate original registrations.

Lighting uses the frozen actual `skyFrame`/`domeLight` data in [game_lighting.json](source/game_lighting.json), captured by [capture_game_light.ts](source/capture_game_light.ts). The evaluator follows the game's diffuse, GGX, sky, exposure and tone curve. Its eight engine probes still agree within **0.000754 of 255**. Normals use the engine's RG decode, 128 centre and reconstructed Z. There is no artistic exposure lift or extra rim light.

The material now has warmer upper leaves and cooler undersides at the requested values, with larger oak/fig blades continuous with the cards. I still see a stronger selective yellow glow and deeper layered branch shadows in the concepts. A standalone smooth head also exposes the angular facewise pigment transition; the leaf contours and normal detail remain continuous across it. These are offline material tests, not new game captures. Wind, texture compression, the assembled core/card fringe and full crown UV seams still need assessment in the game. The report does not claim that the isolated head reproduces the complete concept crown.

The folder contains retained sources and reader-facing checks. The builder writes composition records and structure maps only into ignored **`.cache/`**; the cache has been removed from the delivery after checking. Full-size tiling PNGs, offset PNGs, obsolete tiny standalone distance/head renders and the superseded reference sheet are removed and are no longer generated. The compatibility maps are replaced by their new averages, while the original brief, round-2 brief and supplied feedback remain available. The card-reference crops are small check fixtures, hash-recorded in [provenance.json](source/provenance.json); they are not inputs to material construction. No new image generation, downloaded reference or network access was used.

Rebuild and audit offline, in this order:

```sh
python3 build_skins.py
python3 check_skins.py
python3 verify_rebuild.py
```

[requirements.txt](requirements.txt) pins NumPy, SciPy and Pillow. The builder needs the three original local specimen sheets and its fixed seeds. The checker also uses the retained lighting, concept and card fixtures. Running the builder recreates the ignored audit cache. [verify_rebuild.py](verify_rebuild.py) copies only retained scripts and source inputs into an empty temporary folder, runs the entire build and checker there, compares all 18 delivered PNG hashes, and removes that temporary folder.

**Cold rebuild verified: all 18 delivered PNGs reproduced byte for byte, and all 235 checks passed again.** The complete retained-input hashes, before/after output hashes and dependency versions are in [rebuild_verification.json](checks/rebuild_verification.json); the full build/check output is in [rebuild_run.log](checks/rebuild_run.log).

The retained folder is approximately **64.4 MiB** of file content, including **12.4 MiB in `checks/`** and all 18 delivered maps. No structure/composition cache or full-size tiling proof remains in the delivery.
