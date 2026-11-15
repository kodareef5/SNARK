Rebuilt the live-oak crown as twelve distinct leafy top charts, two twig-bearing underside charts, and one periodic dark interior. Start with the [50 / 25 / 12 pixel comparison beside the elder oak concept](checks/purpose_distance.png), its [phone-atlas counterpart](checks/purpose_phone.png), and the [underside test](checks/undersides.png).

All **116 checks pass**. An offline rebuild reproduces **all four delivered PNGs byte for byte**; see [verification](checks/rebuild_verification.json), [run log](checks/rebuild.log), and [measurements](checks/metrics.json).

| Delivered texture | Format and interpretation |
| --- | --- |
| [oak_crown_base.png](oak_crown_base.png) | 2048 × 2048, opaque 8-bit RGB, tagged sRGB. No alpha channel. |
| [oak_crown_normal.png](oak_crown_normal.png) | 2048 × 2048, 8-bit linear RGB, tangent normal `normalize(-dH/dx, +dH/drow, 1)`. |
| [oak_crown_height.png](oak_crown_height.png) | 2048 × 2048, linear 16-bit grayscale. **Black = 0 mm; white = 240 mm.** Actual encoded relief spans 29.84–178.18 mm. |
| [oak_crown_orm.png](oak_crown_orm.png) | 1024 × 1024, linear RGB: R occlusion, G roughness, B exactly zero. Aligned 2 × 2 area reduction of the full material layers. |

Import only base colour as sRGB. Height is relative foliage relief; it does not contain the head's whole spherical or ellipsoidal shape. The mesh must supply that curvature. Normal-map mips require vector renormalization after sampling.

The atlas uses 512-pixel cells, with disc centres at local `(255.5,255.5)` and radius **240.64 pixels**, exactly `0.94 × 256`. Row-major indices 0–3 are sun tops, 4–7 middle tops, 8–11 shade tops, and 12–13 undersides. Slots 14–15 form one **1024 × 512** interior rectangle at `(1024,1536)`. Repeat within that rectangle, not across the complete atlas. [layout.json](source/layout.json) records every rectangle, mean, and physical pixel pitch.

Disc radii represent 1.75 m of surface: **7.2723 mm per texel**. The interior represents 4.8 × 2.4 m: **4.6875 mm per texel**. All disc corners continue in dark foliage. The outer 12% of each disc radius blends toward a shared shaded ring; foliage continues and darkens beyond it.

| Population | Target mean RGB | Delivered mean RGB¹ | Median roughness² |
| --- | --- | --- | --- |
| Sun tops | 118, 126, 66 | 118.00, 126.00, 66.00 | 0.439 |
| Middle tops | 96, 108, 62 | 96.00, 108.00, 62.00 | 0.506 |
| Shade tops | 76, 90, 58 | 76.00, 90.00, 58.00 | 0.602 |
| Undersides | 82, 92, 70 | 82.00, 92.00, 70.00 | 0.798 |
| Interior | 48, 60, 42 | 48.00, 60.00, 42.00 | 0.682 |

¹ Arithmetic sRGB code-value means inside each disc, then averaged across that population; the interior uses its entire rectangle. Dark exterior padding is excluded from disc means. Every individual chart is within 0.01 code value of its population target. ² Average of the corresponding charts' median roughness values.

Every base-colour pixel is bounded by RGB **165,160,85**. No brown leaf population was added; the conservative brown-pixel audit reports 0%. Desaturated underside twigs remain visible. Occlusion reaches approximately 0.32 in the deepest head recesses, with upper-chart medians around 0.65–0.70. The underside is substantially rougher than the sun population.

The artwork contains small narrow oval blades, alternating twig-end sprays, and larger overlapping folds. Sun charts sample their source slightly wider to reduce blade size; shade charts sample slightly closer. The [native-detail sheet](checks/leaf_detail.png) provides unsharpened enlarged patches and physical rulers. Isolated bright blade-core medians are approximately **6.1 px sun, 6.9 px middle, 7.1 px shade, and 5.7–5.8 px underside**, consistent with the intended small-leaf scale. This is a scale proxy, not a segmentation or dimensional guarantee for every complete leaf; overlapping blades produce longer connected components. The measurement method and distributions are in the checker and metrics.

There is an existing asset conflict: [oak_leaves/REPORT.md](../oak_leaves/REPORT.md) and its builder specify **80–120 mm** blades on the 0.9 m rim cards. This brief specifies **30–50 mm** blades. The crown follows this brief's dimensions and matches the cards' olive sun / cool shade colour families. The [same-scale comparison](checks/leaf_scale_and_card.png) makes the difference visible. The sibling atlas was not altered; exact physical-scale agreement with those current cards remains unresolved.

[build_material.py](build_material.py) constructs all layers from three selected, unmodified generated originals. It separates the artwork into coarse folds, spray relief, and fine blade relief. These form one inferred height field, with nominal contributions of 66 mm, 20 mm, and 5.5 mm. They are art-directed amplitudes, not recovered physical measurements. Height is quantized to the delivered 16-bit values **before** differentiating it at each region's physical pixel pitch. The independent checker finds a worst normal/height disagreement of **0.385°**, attributable to 8-bit normal encoding.

Occlusion uses the same relief's recesses. Roughness varies with leaf detail and depth. Colour retains blade strokes and gentler fold occlusion. No world-sun direction is assigned: the generation prompts request omnidirectional diffuse light, and the builder removes first-order image-axis luminance gradients from each disc while preserving radial shading and local folds. The [all-heads review](checks/all_heads.png) shows every chart at 0° and 90° under a fixed side light. Maximum within-row neighbour correlations are **0.298, 0.155, and 0.019** after masking the rim, confirming that the four neighbours in each row differ.

The interior is joined with minimum-error paths through overlapping source edges, then filtered and differentiated periodically. It is not a mirrored tile. Inspect the [2 × 2 repeat](checks/interior_tiled_2x2.png) and [half-period offset](checks/interior_offset.png). Seam change divided by ordinary adjacent-pixel change measures:

| Map | Horizontal wrap | Vertical wrap |
| --- | --- | --- |
| Base | 1.401 | 1.066 |
| Height | 1.247 | 1.077 |
| Normal | 0.957 | 1.024 |
| ORM | 1.080 | 1.017 |

The distance checks use a closed **2.2 × 2.2 × 1.52 m ellipsoid**, with top and underside polar charts meeting at 1.75 radians from the top, slightly below the widest ring. The camera is 35° above the horizon for the main sheet and 70° below it for the underside sheet. The head is rendered at exact widths of 50, 25, and 12 pixels, then also enlarged with nearest-neighbour sampling for inspection. Materials use linear-light colour mips, linear normal/ORM mips, trilinear sampling at each subpixel's footprint, and 4 × 4 pixel integration. Both light positions use the same exposure. The comparison shows the unchanged project elder-oak concept, cropped and resized for context; it is not a calibrated camera match.

At **50 pixels**, the tops retain grain and directional spray strokes within distinct folded groups. At **25 pixels**, individual blades merge, but separated folds and the dark curled-under rim remain. At **12 pixels**, the head reads through a few irregular masses and its shaded underside; individual leaves cannot be resolved. After removing the circular colour profile, top-chart fold contrast still measures **11.3–15.6 sRGB luminance units standard deviation at 12 pixels**, so this is not merely a radial green gradient. The phone atlas changes the tested images by at most **one 8-bit code value**, with worst mean absolute difference **0.023**. Both tiers are already filtering below the native leaf scale at these distances.

The larger underside test exposes unequal twig forks and pale leaves over dark foliage. At 50 pixels, the major fork structure remains; at 12 pixels it merges into shade. The tests are **material diagnostics, not engine captures**. They omit rim cards to expose the head material, and do not reproduce the game's head placement, inter-head shadows, texture compression, or complete 120-head crown. The actual opaque mesh silhouette remains smooth in these tests; the game's rim sprays supply its leaf cutouts. In-game agreement with the concept therefore remains dependent on those geometry and renderer inputs, as well as the card-scale conflict above.

Rebuild offline with the installed dependencies pinned in [requirements.txt](requirements.txt):

```sh
python3 -B build_material.py
python3 -B check_material.py
python3 -B verify_rebuild.py
```

The checker covers PNG dimensions, bit depths, colour interpretation, opacity, metalness, pigment limits and means, edge darkening, nonradial fold retention, distinct neighbours, roughness ordering, periodic boundaries, normal/height agreement, and phone-image retention. [layers.jpg](checks/layers.jpg) shows all four maps together.

Generation used the **built-in imagegen tool**, guided only by words and the project's named oak lineup, hammock view, leaf sheet, design notes, and leaf atlas. No photographs, web images, or other games' imagery were used. The three selected originals are [top heads](source/top_heads_generated.png), [undersides](source/undersides_generated.png), and [interior](source/interior_generated.png). Exact initial and revision prompts are retained for the [tops](source/top_heads_prompt.txt), [top scale correction](source/top_heads_revision_prompt.txt), [undersides](source/undersides_prompt.txt), [underside scale correction](source/undersides_revision_prompt.txt), [interior](source/interior_prompt.txt), and [interior scale correction](source/interior_revision_prompt.txt). [Generation history](source/generation_history.json) records selection decisions and original hashes; [originals.json](source/originals.json) identifies the current builder inputs.

Superseded maps were replaced in place, superseded workspace source images were replaced, and obsolete working previews were removed. The [cleanup manifest](source/cleanup_manifest.json) records the old map and preview hashes. The supplied brief is retained. All scripts, delivered assets, reports, and checks are inside `tex/oak_crown/`; no git commands were run. The built-in image tool additionally retains its automatically managed originals outside the workspace, as recorded in generation history.
