Round 3 brightens only **rows 1 and 2 of [oak_crown_base.png](oak_crown_base.png)**. The accepted leaves, spray arrangement and dark folds remain in place. Start with the [before/after colour comparison](checks/round3_colour_comparison.png), including the game's warm tint, and the [50 / 25 / 12-pixel test beside the oak concept](checks/purpose_distance.png).

**All 249 checks pass.** The complete height, normal and ORM PNGs are **byte-identical to round 2**. Base-colour row 3, both undersides and the entire interior are **pixel-identical**. The checks compare them with hashes captured before editing in [round3_baseline.json](source/round3_baseline.json). An offline rebuild reproduces all four delivered PNGs byte for byte: [verification](checks/rebuild_verification.json), [log](checks/rebuild.log), [measurements](checks/metrics.json).

| Population | Round-2 mean RGB | Round-3 target RGB | Delivered mean RGB¹ | Median roughness² |
| --- | --- | --- | --- | --- |
| Sun | 118, 126, 66 | 140, 146, 72 | **140.00, 146.00, 72.00** | 0.431 |
| Middle | 96, 108, 62 | 108, 120, 64 | **108.00, 120.00, 64.00** | 0.501 |
| Shade, unchanged | 76, 90, 58 | 76, 90, 58 | 75.99, 89.99, 58.00 | 0.596 |
| Undersides, unchanged | 82, 92, 70 | 82, 92, 70 | 82.00, 92.00, 70.01 | 0.788 |
| Interior, unchanged | 48, 60, 42 | 48, 60, 42 | 48.00, 60.00, 42.00 | 0.682 |

¹ Arithmetic sRGB means inside discs, averaged across each population; exterior padding excluded. Interior uses its whole rectangle. Every chart is within **0.016 code value** of its target in every channel. ² Average of chart medians; the entire roughness map is unchanged.

The sun heads' brightest tenth, selected separately in each disc by luminance and then averaged, is **(179.03, 177.36, 90.00)**, toward the requested (180, 178, 90). Their pigment ceiling is now **(180, 178, 90)**. All other rows retain the accepted **(165, 160, 85)** ceiling. The atlas contains zero metalness and the conservative brown-pixel audit remains 0%.

[build_material.py](build_material.py) first reconstructs the accepted round-2 uint8 colour from the unchanged generated sources. It then applies per-channel monotonic lookup tables to the eight sun and middle charts. There is no spatial filtering, resampling, repainting or new generation in this colour adjustment. Equal input channel values receive equal output values, and their ordering is preserved; the checks verify this against reconstructed round-2 artwork whose pixel hash must match the frozen original.

The lookup tables preserve low values, then raise the remaining pigment through the rational curve `t / (p + (1-p)*t)`. The parameter is fitted to each chart's quantized disc mean. Channel knees are **(32, 53, 26)** for sun and **(32, 52, 34)** for middle. These enclose every original pixel with sRGB-code luminance `0.2126 R + 0.7152 G + 0.0722 B <= 45`: **469,897 deep-fold pixels across the eight complete cells, including padding, remain byte-identical**. The final knees, ceilings and fitted parameters are recorded per chart in [layout.json](source/layout.json).

The brighter faces retain their separation from the folds. Sun inner-chart 90th-to-10th-percentile luminance separation rises from **113–115 to 130–131** code values; middle separation rises from **126 to 129**. Fifth-percentile disc luminance remains **28 for sun** and **22 for middle**. Across all eight edited charts at 50, 25 and 12 pixels, nonradial fold contrast retains at least **93.59%** of its previous value. At 12 pixels, sun contrast is **10.51–11.81** luminance units standard deviation and middle contrast is **12.47–15.60**. These checks measure preservation of the accepted clump structure, as well as absolute visibility.

The game's **linear RGB tint (0.96, 1.00, 0.72) is not baked into the atlas**. The new [colour comparison](checks/round3_colour_comparison.png) applies it once, in linear light before lighting, to both the accepted and revised material with identical geometry, lights and exposure. Its upper patches show the unlit, untinted texture. The original distance, phone and other diagnostic sheets retain their previous untinted lighting setup, so their comparisons remain consistent with earlier rounds.

| Delivered map | Format and interpretation |
| --- | --- |
| [oak_crown_base.png](oak_crown_base.png) | 2048 × 2048, opaque 8-bit RGB, tagged sRGB; no alpha. Only rows 1 and 2 changed. |
| [oak_crown_normal.png](oak_crown_normal.png) | Unchanged 2048 × 2048, linear 8-bit RGB; normalized tangent convention `(-dH/dx, +dH/drow, 1)`. |
| [oak_crown_height.png](oak_crown_height.png) | Unchanged 2048 × 2048, linear 16-bit grayscale; **black = 0 mm, white = 240 mm**. Actual relief: **33.02–152.93 mm**. |
| [oak_crown_orm.png](oak_crown_orm.png) | Unchanged 1024 × 1024, linear RGB: occlusion, roughness, zero metalness; aligned 2 × 2 area reduction. |

Import only base colour as sRGB. Normal mips need vector renormalization. Height is local foliage relief; the mesh supplies the head's overall curvature. The unchanged relief uses nominal fold, spray and blade contributions of **66, 20 and 5.5 mm**. Height is quantized to uint16 before normal differentiation at the physical pitch. Worst independent normal/height disagreement remains **0.385°**.

The atlas retains 512-pixel cells, disc centres `(255.5,255.5)`, and radius **240.64 pixels**. Cells 0–3 are sun tops, 4–7 middle tops, 8–11 shade tops, and 12–13 undersides. Slots 14–15 remain one periodic **1024 × 512** interior rectangle at `(1024,1536)`; repeat inside that rectangle. Geometry, physical pitches, relief metadata and generated-source hashes are verified unchanged.

Each disc radius represents **1.75 m**, giving **137.51 pixels/metre**, or **7.2723 mm/texel**. The accepted round-2 leaf target remains **80–120 mm**, equivalent to **11.0–16.5 native pixels**. The interior's scale remains 4.6875 mm/texel. The [spray-scale sheet](checks/leaf_scale_and_card.png), [native detail](checks/leaf_detail.png) and [centre / rim / corner review](checks/edge_detail.png) are refreshed from the brighter atlas. The bright-face-core proxy now reports median lengths of **13.0–13.8 px sun**, **14.5–14.9 px middle**, **13.5–14.3 px shade**, and **10.5–10.9 px underside**. Its sun/middle measurements change with pigment thresholds, not with the drawing; it measures isolated bright portions rather than every complete blade. The four neighbours in each top row remain distinct, with maximum within-row correlations **0.104, 0.115 and 0.154**.

The [distance review](checks/purpose_distance.png), [phone counterpart](checks/purpose_phone.png), [all-head rotation review](checks/all_heads.png), [undersides](checks/undersides.png), and [layers](checks/layers.jpg) are regenerated. They retain the accepted closed **2.2 × 2.2 × 1.52 m ellipsoid**, polar-chart seam at 1.75 radians, 35° upper view, −70° underside view, overhead and side lights, fixed exposure, linear-light colour mips, trilinear sampling and 4 × 4 pixel integration. Across all 30 phone comparisons, worst mean absolute difference is **0.0293 code value**, and worst individual-channel difference is **3 code values**.

At 50 pixels the sun surfaces are brighter while their gaps remain dark. At 25 pixels the same clumps remain separated; at 12 pixels the brighter upper mass retains its shaded turn-under. Individual leaves are not resolvable at the smallest sizes. These are **CPU material diagnostics, not new game captures**: they omit the game's cutout sprays, inter-head shadows and texture compression. The supplied whole-crown capture explains the requested correction; this work does not claim a new measured in-game crown brightness.

The unchanged [ground-view comparison](checks/feedback_comparison.png) retains its explicit round-2 underside labels. It uses `feedback/round1_game_20m_detail.jpg`, cropped at `(72,80)–(356,290)`. The manually identified opaque-core span x=104–340 is reduced from 236 to **50 pixels**, beside the accepted undersides at the same width. The supplied capture is only cropped and resized, with no brightness change; this is a size comparison, not a matched camera or lighting setup.

The interior retains its [2 × 2 repeat](checks/interior_tiled_2x2.png), [half-period offset](checks/interior_offset.png), and seam-energy ratios: base **1.401 / 1.066**, height **1.247 / 1.077**, normals **0.957 / 1.024**, ORM **1.080 / 1.017** (horizontal / vertical). All four interior rectangles also continue to match the older [round-2 preservation baseline](source/round2_baseline.json).

No new imagery was generated in round 3. The accepted unmodified imagegen originals remain [tops](source/top_heads_generated.png), [undersides](source/undersides_generated.png), and [interior](source/interior_generated.png), with unchanged [source hashes](source/originals.json). Their original prompts and selection history remain in [generation_history.json](source/generation_history.json), including the final [top scale prompt](source/round2_tops_final_scale_prompt.txt) and [underside scale prompt](source/round2_undersides_final_scale_prompt.txt). No external imagery was used.

The superseded base atlas, report, layout measurements and affected review sheets were replaced in place. The temporary round-2 atlas copy and obsolete `artist-last.txt` / `artist-last-round2.txt` summaries were removed; [cleanup_manifest.json](source/cleanup_manifest.json) records the changes. Source originals, historical generation prompts, supplied briefs, feedback and preservation baselines remain. All writes stayed in this folder. No git commands were run.

Rebuild offline with the pinned [requirements](requirements.txt):

```sh
python3 -B build_material.py
python3 -B check_material.py
python3 -B verify_rebuild.py
```
