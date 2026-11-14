# Thatch wall — round 4

The tips now fade to **warm straw cream**, with retained golden reeds and a few paler ends. Bleaching begins **44.2–55.9% down each skirt from its tie**, varies by bundle and reed, and grows gradually toward the ends. The bodies keep the requested mean while gaining more bundle variation and deeper dark fibre pigmentation.

Start with [the skirt beside our house concept](checks/skirt_vs_house_hero.png), [round 3 beside round 4](checks/round3_vs_round4.png), and [the reduced-size comparison](checks/distance_comparison.png). The former white hems are less prominent under the same low warm sun; in ambient shade the ends remain warm brown straw. The skirt silhouettes, bundle edges and tie impressions are preserved.

| Unlit sRGB measurement | Accepted round 3 | Round 4 | Requested |
| --- | --- | --- | --- |
| Opaque body mean | (191.5, 146.9, 83.1) | **(191.2, 145.7, 81.8)** | about (191, 146, 82) |
| Visible tip mean | (225.8, 205.9, 162.6) | **(214.5, 184.2, 131.8)** | about (214, 184, 132) |
| Bundle body mean standard deviation | (9.0, 7.9, 7.1) | **(11.6, 10.1, 8.0)** | more variation |
| Body channel fifth percentiles | (144, 103, 48) | **(135, 96, 44)** | stronger darks |

Means use the same visible guide regions in both revisions. The fifth percentiles describe each channel's dark tail, not a single sampled reed. The existing 196 dark reeds are deepened; 265 of the 1,533 analytic reeds retain extra gold at their ends, and 126 have paler warm endpoints. Every visible tip passes the warm-chroma check. Mean tip colour under the ambient-shade preview is (126.1, 106.3, 72.6).

The fade uses a smoothstep with different start and end coordinates per bundle, plus smaller per-reed changes. Its endpoint lies at 96.0–107.7% of the rod-to-envelope length, so some ends remain incompletely bleached. The [delivered RGB profiles](checks/fade_profiles.png) and [per-bundle measurements](checks/fade_profiles.json) show the longer transition; adjacent 1%-length bin means change by at most 2.94 RGB levels. This samples rendered texture pixels independently of the recipe curve. Individual reed variation remains visible.

| Delivered file | Construction and change |
| --- | --- |
| [thatch_base.png](thatch_base.png) | 2048², 8-bit sRGB RGBA. Rebuilt from the unchanged generated reed sources and the accepted analytic paths, using [the round 4 palette](source/round4_palette.json). Only RGB changes; alpha channel bytes match round 3 exactly. Stronger pigmentation uses existing dark reeds and fine fibre residuals, without adding directional lighting or broad hollow shadows. |
| [thatch_height.png](thatch_height.png) | 2048², linear 16-bit greyscale. **Entire PNG byte-identical to round 3.** Full black–white range remains **16 mm**, with actual samples 0–9.631 mm at 1.46484375 mm/pixel. Local reed, node, stray and cord relief only. |
| [thatch_normal.png](thatch_normal.png) | 2048², linear 8-bit RGB, OpenGL. Recomputed from the quantized height at physical scale and **entire PNG byte-identical to round 3**. |
| [thatch_orm.png](thatch_orm.png) | 2048², linear 8-bit RGB. Roughness follows the longer bleaching and retained-gold stems. **Occlusion and metalness channel bytes match round 3 exactly.** AO remains 71–242, roughness 0.698–0.945 after quantization, metalness zero. |

[Preservation proof](checks/round4_preservation.json) records matching SHA-256 hashes and zero changed pixels for base alpha, both tier-master alphas, AO and metalness. It also verifies exact file bytes for height, normal and the relief NPZ. All guides, original generated sources, the original palette and placement are retained. The geometry and legacy appearance random streams are unchanged; new colour variation uses a separate seed.

| Check / evidence | Result |
| --- | --- |
| [Layer contact sheet](checks/layers.jpg), [base over layout](checks/base_over_layout.png) | Correct 2048² dimensions, alignment, modes, bit depths and colour tags. |
| [Alpha over envelope](checks/alpha_over_envelope.png), [upper contour](checks/upper_alpha_over_layout.png) | Binary 0/255; zero pixels outside the envelope, zero body holes, zero detached tips. Clearance remains 14.04 px upper / 15 px lower. |
| [Bundle alignment](checks/bundle_alignment.png), [edge JSON](checks/bundle_edges.json) | All 26 construction edges exact. 21 RGB detections exact; remaining five within 3 px. Shifted-image and old-layout negative controls reject misregistration. |
| [Tie details](checks/tie_details.png) | Darkest rows remain 157 and 1127. Tie compression remains 1.22 / 1.18 mm. |
| [Opposing low suns](checks/relit_relief.jpg), [ambient shade](checks/ambient_shade.png) | Warmer ends, longer fade and deeper reed pigmentation remain legible. Identical lighting settings are used for the round 3/4 comparison. |
| [Three adjoining walls](checks/three_walls.jpg) | Continuous edge-crossing sheaf; no new seam stripe. |
| [Tips at 1:1](checks/skirt_tips_1to1.png), [lit/raw tips](checks/skirt_tips_comparison.png) | Accepted ragged tips and strays retained. |
| [Concept comparison](checks/concept_comparison.png), [sun/shade/base comparison](checks/skirt_vs_house_hero.png) | Native texture crop beside `house_hero.png` crop (545,318)–(797,538), enlarged 3.05× without colour grading. |
| [Measurements](checks/measurements.json), [validation log](checks/validation.log) | **All assertions pass.** Normal error: mean 0.172°, p99 0.316°, maximum 0.386°; encoded difference at most one byte. |
| [Rebuild proof](checks/rebuild.json) | **All four PNGs reproduce byte for byte.** Build 18.486 s; checking and evidence 35.492 s. |

Horizontal seam difference divided by mean interior adjacent-pixel difference: RGB **0.763**, alpha **0.510**, height **0.991**, normal **1.026**, ORM **0.997**.

The accepted [round 3 snapshot](source/round3/REPORT.md) preserves 56 files, including its maps, source recipe, guides and evidence. All **38 + 48 + 56** archived files pass SHA-256 validation. [The round 4 source record](source/ROUND4.md) documents the changes. Only our repository's `house_hero.png`, `piece_wall.png` and `details.png` were consulted. No existing-game pictures, external image searches, downloads or new image generation were used.

Rebuild and validate with the pinned dependencies in `requirements.txt`:

```sh
python3 build_material.py
python3 check_material.py
python3 check_material.py --rebuild
```

Revision work took **6.5 minutes**, from 2026-11-14 21:09:02 UTC to 2026-11-14 21:15:31 UTC, excluding initial inspection. Builder/checker syntax and diff whitespace checks also pass.

The remaining validation limit is the actual game renderer. These previews use the existing orthographic guide relief and do not exercise the final mesh, shader or mipmapped cutout. The 256-pixel-wide wall comparison is a distance-readability proxy, not a calibrated ten-metre camera capture. The fixed wall still repeats every 3 m.
