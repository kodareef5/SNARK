Round two strengthens **only the face surface**. The edge and cortex retain their appearance, layout, boundaries and source fields. All 12 delivery filenames remain unchanged. The face now has broad conchoidal ripple sets, larger shallow flake scars, soft termination ridges, occasional hinges, richer mineral colour, and slightly glossier flint crests.

Start with the [matched blade comparison](checks/round_comparison.png), the [100–250-pixel individual facets](checks/facet_screen_sizes.png), and the [complete contact sheet](checks/contact_sheet.png). The complete first round is retained under [checks/round1/](checks/round1/), including its 12 maps, original scripts, source fields, report and previews. The archive is hash-checked and has not been modified.

One tile still covers **0.20 × 0.20 metres**, at **2048 × 2048** and **1024 × 1024**. The master is native 2048 detail, **0.09765625 mm per texel**. The new full height encoding is **0–65535 = 0–2.5 mm**, white high. Actual saved values occupy **0.704814–1.946174 mm**; do not stretch those extrema. Both colourways share the same height and normal maps.

| Files | Encoding | Final construction |
| --- | --- | --- |
| `stone_base.png`, `stone_base_1024.png` | RGB, 8-bit sRGB, explicit sRGB chunk | Fine salt-and-pepper grains and restrained mottling. Face mean **(128.000, 126.000, 120.000)**; channel standard deviation **6.19**, up from 3.31 in round one. Original polished pale edge and grey cortex preserved. |
| `flint_base.png`, `flint_base_1024.png` | RGB, 8-bit sRGB, explicit sRGB chunk | Cloudy paler material, faint banding, and blue-black to brown-grey mineral variation. Face mean **(74.000, 72.000, 76.000)**. A small pale mineral component follows selected ripple crests. Original pale edge and buff cortex preserved. |
| `stone_height.png`, `stone_height_1024.png` | Single-channel, 16-bit grayscale, linear | Shared relief: new broad pressure ripples and larger secondary scars inside the face; retained grain, pores, inclusions, bands and transitions. Full **0–2.5 mm** encoding. |
| `stone_normal.png`, `stone_normal_1024.png` | RGB, 8-bit linear | OpenGL tangent space: **+X right, +Y up the image, +Z out**. Each map is derived from its own reopened saved height at the actual 200 mm tile scale. |
| `stone_orm.png`, `stone_orm_1024.png` | RGB, 8-bit linear | R: shallow cavity AO; G: roughness; B: zero. Face roughness mean **0.775**, central 98% **0.718–0.831**. Polished edge mean 0.500; cortex 0.910. |
| `flint_orm.png`, `flint_orm_1024.png` | RGB, 8-bit linear | Same cavity AO, with crest-dependent roughness. Face roughness mean **0.411**, central 98% **0.333–0.482**. Edge mean 0.320; cortex 0.910. Metalness is zero everywhere. |

Base colour is unlit. It contains no light direction, surface-normal dot product, AO multiplication, cast shadows or artificial brightness gradient across the face. The modest crest pigment is an authored mineral-colour variation, gated by the cloud/mineral field; it is not a rendered highlight. Changes in lighting are supplied by the physical normal and roughness maps. Use sRGB only for the base maps; all data maps have no gamma, ICC or sRGB chunks.

The new face uses **20 overlapping fracture domains**, at different angles. Each has one point of percussion just beyond its footprint. Individual pressure pulses are separated by **2.2–6.0 mm**; their spacing and strength vary, and they diminish with distance from the origin. Neighboring domains blend smoothly, so a facet sees portions of coherent arc sets. This replaces the first round's weak, small ripple fans in the face interior. The existing legacy fans remain in the protected bands and margins.

There are **94 larger secondary scars**, sampled at **10.81–39.75 mm** across. Their nominal hollow depths are **0.20–0.40 mm**, with **0.13–0.22 mm** termination ridges. The ridge Gaussian width is **1.0–1.6 mm sigma**, giving a soft rounded boundary. Feathered sides blend into the face. Scar overlap attenuates the preceding ripples, and **13 occasional hinge terminations** add small steps. The mesh still carries the large flat facets and their crisp ridges.

Flint roughness follows the same ripple-crest field. High crests average **0.371** roughness; trough areas average **0.420**. The difference is about **0.049**, enough to concentrate moving highlights without changing the surface into metal. Stone's matte roughness is retained. AO remains white outside actual pores, steps and retouch notches: broad ripple troughs and open scar hollows receive no baked occlusion. Both AO channels are identical, and both metalness channels are entirely zero.

| Face relief measurement | Round one | Round two |
| --- | ---: | ---: |
| Actual minimum-to-maximum span | 0.267 mm | 1.241 mm |
| 1st-to-99th percentile span | 0.139 mm | 0.744 mm |
| Height standard deviation | 0.029 mm | 0.162 mm |
| Median normal tilt | 1.91° | 7.20° |
| 95th-percentile normal tilt | 4.94° | 23.68° |

These measurements use the interior face, rows 615–1955, and the actual physical height scale. The central height span is **5.35 times** the first round. No normal-strength multiplier or exaggerated preview scale is used. Palette and roughness means use rows 564–2006, as in round one.

| Region | Master rows, end exclusive | 1024 rows, end exclusive |
| --- | --- | --- |
| Edge | 0–256 | 0–128 |
| Cortex | 256–512 | 128–256 |
| Face | 512–2048 | 256–1024 |

The original 4 mm transitions, periodic ragged cortex boundary, pale middle third of the edge, and 85 retouch cuts are retained. The new face edit fades in at **55–60 mm** and fades out at **191–197 mm**, entirely inside the face region. This leaves the existing cortex-to-face transition and top/bottom edge wrap untouched. All original region masks are byte-identical. Source components for the cortex, retouch, pits, inclusions and fine grain are also unchanged.

The protected regions' **base and ORM pixels are byte-identical at both resolutions**. To provide room for deeper face relief, the neutral height coordinate moved from **0.78 to 1.35 mm**, a constant **+0.57 mm** offset. Subtracting that constant, protected height profiles differ by at most **0.000030 mm** at 2048 and **0.000047 mm** at 1024, entirely from re-encoding and reduction. Their normals differ by at most **one 8-bit level**; fewer than 0.7% of protected master normal channels change. For displacement, 1.35 mm is the authored neutral reference, or 0.54 in the normalized height encoding. This offset does not alter band slopes or lighting.

All **118 numerical checks passed**. Both normals have **zero mismatched channels** against an independent wrapped central-difference calculation from the saved height, `normalize(-dh/dx, +dh/drow, 1)`. Average quantization error remains approximately 0.172°. Dimensions, PNG bit depths, channel counts, colour-space chunks, archive hashes, band locations, physical source reconstruction, zero metalness, cavity-only AO, palette means, protected pixels and increased face relief were checked. [checks/metrics.json](checks/metrics.json) records the exact results.

The smaller base, height and ORM maps use aligned 2 × 2 area averages with integer rounding. The smaller normal is regenerated from the smaller saved height. Normal agreement with the area-filtered large map is **46.93 dB**; the lowest comparison across all maps using a Lanczos reference is **46.21 dB**. Every map remains well above 30 dB.

Every review was regenerated: [half offsets](checks/offset.png), [3 × 3 repeats](checks/tiled3x3.png), [aligned layers](checks/layers.png), [native layer alignment](checks/alignment.png), [two light directions](checks/relit.png), [native detail](checks/native_detail.png), [neutral relief](checks/neutral_relief.png), [row profiles](checks/band_layout.png), [native transition strips](checks/seam_strips.png), and [native horizontal repeat joins](checks/native_repeat_join.png). The 6144 × 6144 native repeat images and individual full-resolution offset and lit PNGs remain in `checks/`. There is no new vertical stitch or hard wrap discontinuity. Maximum wrap jump relative to the neighboring line-difference 95th percentile is **1.03**. The intended horizontal trim bands remain visible when a complete tile is repeated.

The [hatchet previews](checks/hatchet_facets.png) retain exactly the first round's 34 flat triangles, UVs, two light directions and exposure, including the edge strip along the cutting edge. Their normals are transformed through each facet's tangent frame. The [matched comparison](checks/round_comparison.png) shows a clear increase in readable surface arcs; the flint catches stronger highlights and the grey stone remains matte. [Whole-head screen sizes](checks/screen_sizes.png) cover 64–250-pixel frames. Separate [stone](checks/facet_screen_sizes_stone.png) and [flint](checks/facet_screen_sizes_flint.png) sheets compare individual 20, 40 and 80 mm surface samples at **100, 175 and 250 pixels**, under both lights, with identical UV crops before and after. These small-facet views guided the last adjustment to preserve ripples through overlapping scars.

The first stronger trial looked too evenly ribbed. The final version varies the spacing and strength of individual pressure pulses, fades the sets across their scars, broadens secondary ridges and lets overlapping scars interrupt the waves. The result intentionally retains substantially more relief than round one. At 64 pixels, material identity still comes mainly from grey versus dark flint and the pale rim; the finer arcs belong to the larger first-person view.

Rebuild with Python 3, NumPy and Pillow:

```sh
python3 build_material.py
python3 check_material.py
```

The original band construction still runs from seed **481936**; new face construction uses independent seed **962417** and per-fan pressure seeds. All random fields and wrapped footprints are created at 2048. No external images or web textures were used. [source/construction_fields.npz](source/construction_fields.npz) preserves every delivered component and face edit/crest field at full size. [source/construction.json](source/construction.json) contains the original band-support records and the new face records under `round2_face`, including all pressure intervals, scar dimensions and percussion origins. The two source visualization PNGs remain full size. Rebuilding the delivery does not depend on the archive; checking round-one preservation does.

Remaining limits: the construction is procedural, and the organizing arc sets can still be recognized under prolonged close inspection. The normal map cannot represent true undercuts. The pale edge suggests thin flint but the supplied opaque channels do not implement transmission. Previews use a simple linear-light diffuse plus dielectric GGX renderer, not the game's renderer; compression and first-person engine lighting remain untested. No illumination is baked into the base to conceal these limits.

All writes stayed in this folder. No git commands were run. Round-one work and timing remain documented in its archived report. Round-two work began **15 November 2026 at 15:18:26 UTC / 10:18:26 EST**; final duration and the clean rebuild verification follow below.

The final clean rebuild reproduced **all 12 delivery PNGs and all four source files byte-for-byte**; [checks/rebuild_verification.json](checks/rebuild_verification.json) records all 16 comparisons. The final build took **25.059 seconds** and the full independent check/render pass took **35.471 seconds**. Round-two work ran approximately **15:18:26–15:34:35 UTC / 10:18:26–10:34:35 EST** on 15 November 2026, about **16 minutes**, including archive creation, construction, visual revisions, checks, comparison renders, rebuild verification and reporting.
