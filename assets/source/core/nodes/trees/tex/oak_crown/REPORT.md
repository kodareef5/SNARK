Round 2 replaces the heads' fine strokes with larger, distinct oval live-oak leaves carried on overlapping twig sprays. The twelve top charts have crisp leaf faces and deep, irregular gaps; both undersides show pale shaded leaf backs and their branching twigs. Start with the [same-scale comparison against all four existing spray cards](checks/leaf_scale_and_card.png), [underside review](checks/undersides.png), and [50-pixel comparison with the supplied game capture](checks/feedback_comparison.png).

All **191 checks pass**, including the original 116 checks. The accepted layout, colour targets, formats and physical pitches are preserved. The interior rectangles in **all four maps are pixel-identical to round 1**, proved against [the captured baseline](source/round2_baseline.json). The offline rebuild reproduces all four PNGs byte for byte: [verification](checks/rebuild_verification.json), [log](checks/rebuild.log), [measurements](checks/metrics.json).

| Delivered map | Format and interpretation |
| --- | --- |
| [oak_crown_base.png](oak_crown_base.png) | 2048 × 2048, opaque 8-bit RGB, tagged sRGB; no alpha. |
| [oak_crown_normal.png](oak_crown_normal.png) | 2048 × 2048, linear 8-bit RGB; normalized tangent convention `(-dH/dx, +dH/drow, 1)`. |
| [oak_crown_height.png](oak_crown_height.png) | 2048 × 2048, linear 16-bit grayscale; **black = 0 mm, white = 240 mm**. Actual relief: **33.02–152.93 mm**. |
| [oak_crown_orm.png](oak_crown_orm.png) | 1024 × 1024, linear RGB: occlusion, roughness, zero metalness; aligned 2 × 2 area reduction. |

Import only base colour as sRGB. Normal mips need vector renormalization. Height is local foliage relief; the mesh supplies the head's overall curvature.

The atlas still has 512-pixel cells, disc centres `(255.5,255.5)`, and radius **240.64 pixels**. Cells 0–3 are sun tops, 4–7 middle tops, 8–11 shade tops, and 12–13 undersides. Slots 14–15 remain one periodic **1024 × 512** interior rectangle at `(1024,1536)`; repeat inside that rectangle. [layout.json](source/layout.json) records all regions.

Each disc radius represents **1.75 m**, giving **137.51 pixels/metre**, or **7.2723 mm/texel**. Round 2's leaf target is **80–120 mm**, equivalent to **11.0–16.5 native pixels**. This supersedes the first brief's 30–50 mm requirement and resolves the earlier intended-scale conflict with the current spray cards. The interior's scale and content remain unchanged at 4.6875 mm/texel.

The [scale sheet](checks/leaf_scale_and_card.png) compares 124-pixel head patches with the four 0.9 m cards reduced to 124 pixels, at the same enlargement; the rounding mismatch is below 0.2%. The [native detail sheet](checks/leaf_detail.png) has 80 and 120 mm rulers for the heads. Whole leaves overlap and foreshorten, so these visual comparisons remain necessary. The automated bright-face-core proxy measures median lengths of **13.0–13.3 px sun**, **13.7–15.3 px middle**, **13.5–14.3 px shade**, and **10.5–10.9 px underside**. It measures isolated bright portions, not every complete blade, and does not certify that every painted leaf falls inside the target interval. Its area limits allow merged sprays rather than selecting only components of the desired length.

Leaves remain crisp through the turn into the rim and throughout the dark corners: see [centre / rim / corner patches](checks/edge_detail.png). The builder changes pigment toward the edge without spatially blurring the artwork. A smooth, monotonic colour mapping meets the row means without the previous hard clipping of broad leaf faces. The darkest gaps are protected; the underside mapping also keeps blue below green while retaining its pale tissue. The four neighbours in every top row remain distinct: maximum within-row correlations are **0.119, 0.128 and 0.154**.

| Population | Target RGB | Delivered mean RGB¹ | Median roughness² |
| --- | --- | --- | --- |
| Sun | 118, 126, 66 | 118.00, 126.00, 66.01 | 0.431 |
| Middle | 96, 108, 62 | 95.99, 108.01, 62.00 | 0.501 |
| Shade | 76, 90, 58 | 75.99, 89.99, 58.00 | 0.596 |
| Undersides | 82, 92, 70 | 82.00, 92.00, 70.01 | 0.788 |
| Interior | 48, 60, 42 | 48.00, 60.00, 42.00 | 0.682 |

¹ Arithmetic sRGB means inside discs, averaged across each population; exterior padding excluded. Interior uses its whole rectangle. Every chart is within **0.02 code value** of its target in every channel. ² Average of chart medians.

The pigment ceiling remains RGB **165,160,85**; metalness is zero, and the conservative brown-pixel audit remains 0%. Within the inner charts, the 90th-to-10th-percentile face/gap luminance separation is **113–126 code values above** and **78 beneath**. Fifth-percentile disc luminance is about **20–28 above** and **39–40 beneath**; the underside's deeper recesses receive further occlusion in the rendered material.

[build_material.py](build_material.py) derives relief from the selected generated art. Coarse folds, spray relief and blade relief retain nominal contributions of **66, 20 and 5.5 mm**. The leaf/spray separation uses a 5.5-pixel filter scale for the new heads; the interior retains its original 3-pixel path. These are inferred, art-directed amplitudes. Height is quantized to the delivered uint16 values before normal differentiation at the corresponding physical pitch. Worst independent normal/height disagreement is **0.385°**. The first-order image-axis luminance gradient is removed from each head; local leaf structure and radial shading remain. No fixed sideways sun is painted into the pigment.

The [50 / 25 / 12-pixel test beside the oak concept](checks/purpose_distance.png), [phone counterpart](checks/purpose_phone.png), [all-head rotation review](checks/all_heads.png), and [layers](checks/layers.jpg) are regenerated. They retain the accepted closed **2.2 × 2.2 × 1.52 m ellipsoid**, polar-chart seam at 1.75 radians, 35° upper view, −70° underside view, overhead and side lights, fixed exposure, linear-light colour mips, trilinear sampling and 4 × 4 pixel integration. Phone retention now also covers both undersides under both lights at all three widths. Across all 30 phone comparisons, worst mean absolute difference is **0.0293 code value**, and worst individual-channel difference is **3 code values**.

At 50 pixels the material has a more distinct broken pattern of sprays and gaps. At 25 pixels the leaves merge into separated clumps; at 12 pixels the remaining signal is the bright upper mass and shaded turn-under. Top-chart nonradial fold contrast at 12 pixels remains **10.4–17.4 luminance units standard deviation**, and underside contrast is **5.24–5.27**. Individual leaves are not resolvable at the smallest sizes.

The [feedback comparison](checks/feedback_comparison.png) uses `round1_game_20m_detail.jpg`, cropped at `(72,80)–(356,290)`. A manually identified opaque-core span of x=104–340 is reduced from 236 to **50 pixels**, beside revised undersides rendered at the same core width. Both are also enlarged 6× with nearest-neighbour sampling. The supplied game capture is only cropped and resized; its brightness is unchanged. This is a size comparison, not a matched camera or lighting setup.

These are material diagnostics, **not new game captures**. The test omits the game's surrounding cutout sprays, inter-head shadows and texture compression. Its opaque ellipsoid has a smooth geometric silhouette; the game's sprays provide the broken outer edge. The revised texture provides the leafy surface and dark irregular folds exposed between those sprays.

The unchanged interior retains its [2 × 2 repeat](checks/interior_tiled_2x2.png), [half-period offset](checks/interior_offset.png), and seam-energy ratios: base **1.401 / 1.066**, height **1.247 / 1.077**, normals **0.957 / 1.024**, ORM **1.080 / 1.017** (horizontal / vertical).

Generation used the **built-in imagegen tool** with the project's own crown sources, spray atlas and named oak concept. The selected unmodified originals are [tops](source/top_heads_generated.png), [undersides](source/undersides_generated.png), and the unchanged [interior](source/interior_generated.png). Exact round-2 prompts and selection history are recorded in [generation_history.json](source/generation_history.json), including the final [top scale prompt](source/round2_tops_final_scale_prompt.txt) and [underside scale prompt](source/round2_undersides_final_scale_prompt.txt). [originals.json](source/originals.json) records current source hashes. No external imagery was used.

Superseded maps, top/underside sources, report and review sheets were replaced in place. Obsolete round-1 head prompts and the temporary scale preview were removed; the [cleanup manifest](source/cleanup_manifest.json) records them. Supplied briefs, feedback and the preservation baseline remain. No git commands were run. All authored project files are in this folder; imagegen's automatically managed originals remain at its tool-owned location.

Rebuild offline with the pinned [requirements](requirements.txt):

```sh
python3 -B build_material.py
python3 -B check_material.py
python3 -B verify_rebuild.py
```
