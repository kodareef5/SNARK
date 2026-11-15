Coconut palm bark — round 2

All four existing delivery maps have been replaced with aligned **2048 × 2048** PNGs. One tile still covers **1.1 m around × 1.6 m up** the trunk, with image top higher. This revision follows `BRIEF-palm-bark-2.md` and the user's second-round instructions, which supersede the first brief's ring spacing and its exclusion of dark ring tissue from base colour. The two trunk studies in `palm_parts.png` and `grove_near.png` were inspected again. No external or existing-game reference was used.

Twenty-two leaf-scar rings replace the previous thirteen. Pale, frayed lips and thin dark recessed-tissue lines now carry the ring structure directly in base colour. Their thickness, spacing, drift and wear vary; some are broken and four rings have short forked lips that merge back into their parent. Closer groups interrupt the spacing without a single large identifying mark. Warm grey-brown vertical fibres remain between rings. Larger colonies from the original skin paintings were suppressed and new lichen is small and sparse.

Successive ring-centre spacings, **including the vertical wrap**, are **7.3, 5.6, 6.1, 9, 6.8, 8.3, 9.5, 5.8, 7.6, 6.4, 8.7, 6.9, 5.4, 7.9, 9.3, 7.1, 6, 8.5, 7.7, 6.6, 8.2, 5.3 cm**. The sequence totals 1.6 m. Spacing is authored in physical units rather than inferred from the generated painting. The mean delivered body-plus-detail colour is **132.33, 125.46, 107.64** sRGB. Lichen above a 0.25 mask threshold occupies **0.088%** of the tile.

| Delivery | Construction and measured result |
| --- | --- |
| `coconut_bark_base.png` | 8-bit RGB, frozen sRGB ICC. The original two skin paintings remain composed from nine native crops into a 2304 px toroidal master, then reduced to 2048. New ring masks come from `coconut_rings_v2.png`; calibrated pale epidermis and darker adjacent tissue colours replace source illumination. Full-resolution fibres, cracks and mottling complete the surface. No overall sun gradient, cylindrical shading or external cast shadow is baked in, and AO is not multiplied into base. The requested local pale/dark ring pair is intentional. |
| `coconut_bark_height.png` | 16-bit grayscale, white high. **Full black-to-white range: 16 mm** (previously 5 mm). Delivered values occupy **1.118–14.039 mm**, span **12.921 mm**, without clipping. The separately measured local ring contribution spans **8.925–11.725 mm** per ring. Nominal skin level is 2.2 mm. The encoding includes headroom; it is not the rise of each ridge. |
| `coconut_bark_normal.png` | 8-bit RGB linear data, **OpenGL +Y toward image top**, derived from the reopened, quantized delivered height using central differences and wrapped neighbours. Metric pixel pitches: 0.537109 mm across, 0.78125 mm down. Independent agreement: **0.171° mean, 0.384° maximum** error from RGB quantization. |
| `coconut_bark_orm.png` | 8-bit RGB linear data: R height-horizon occlusion, G roughness, B exactly zero. AO min/mean **0.149/0.879**. Roughness **0.710–0.890**, mean **0.777**; lichen mean **0.834**. **Zero nonzero metalness pixels**. |

The new full-size **1254 × 1254** source is [source/coconut_rings_v2.png](source/coconut_rings_v2.png), produced with the **built-in image_gen tool** by editing the first-round ring source. The exact prompt and input reference are in [source/coconut_rings_v2_prompt.txt](source/coconut_rings_v2_prompt.txt). No API fallback was used. The original generated sources remain in `source/`. `source/ridge_extraction.png` shows the paired crest (red) and recess (green) mask bank. `source/construction_masks.npz` retains aligned rings, recesses, lichen, fissures, scars and weathering. `material.json` records spacing, relief, physical scale, crop provenance, colours and source hashes. `source/round1/` archives the previous four maps, scripts, report, masks and measurements for comparison.

I inspected the final base maps at **256 and 128 native pixels**, including their physical aspect squeeze, without lighting or AO. Both retain visible rings; the coconut reads as stacked irregular lips rather than a plain brown surface. [checks/distance_readability.png](checks/distance_readability.png) puts old and new beside one another. Reductions use **linear-light box filtering with no sharpening**. Median measured lip-to-recess contrast, in sRGB luminance code values, is:

| Reduction | Round 1 | Round 2 |
| --- | ---: | ---: |
| 256 px | 8.86 | 33.30 |
| 128 px | 8.25 | 26.97 |

The requested 3×3 and 3×8 sheets use the correct circumferential squeeze and identical repeats. The 14 m cylinders show three azimuths, both unlit and under one sun plus ambient sky with **AO and cast shadows absent**. Rings remain visible there. The long views show continuous ring rhythm without a conspicuous tile-boundary stripe or large repeated lichen badge. Intentional inspection can still identify the exact repeating sequence.

Visual checks retained in `checks/`: `layers.jpg`, `detail_1to1.jpg`, `offsets.jpg`, `base_tile3x3.jpg`, `base_tile3x8.jpg`, `relighting.jpg` (opposite light directions), `trunk_preview.jpg`, `no_shadow_14m.jpg`, `distance_readability.png`, and the standalone `base_256.png` / `base_128.png`. The relights confirm aligned crest, recess, normal and occlusion detail. `metrics.json` records independent format, channel, colour-profile, spacing, height-range, normal, roughness, metalness, mip-readability and wrap checks. All numeric checks passed.

Seam step divided by the 95th percentile of full interior line steps (adjacent samples, not forced-identical edge pixels):

| Layer | Left/right | Top/bottom |
| --- | ---: | ---: |
| Base | 0.923 | 0.400 |
| Height | 0.901 | 0.159 |
| Normal | 1.000 | 0.455 |
| Orm | 0.908 | 0.275 |

Rebuild from either material folder with the pinned dependencies in `requirements.txt`:

```sh
python3 build_material.py
python3 check_material.py
python3 check_rebuild.py
```

`check_rebuild.py` performs another full build and compares SHA-256 hashes for all four maps, the master, extraction, construction masks and metadata; **all eight artifacts matched byte-for-byte** in the completed second build; results are saved in `checks/rebuild.json`.

Import base as sRGB and the other three maps as linear data; repeat both axes and keep the normal green channel as delivered. Use the **new full height range** above for displacement.

Remaining limits: a single fixed UV tile still repeats exactly every **1.6 m**; irregular spacing and subdued landmarks reduce its salience but cannot remove that mathematical period. The previews are material diagnostics, not game captures. The 256/128 images are the requested screen-size proxies; exact 10/20 m appearance depends on engine field of view, mip choice and compression, which were not exercised here.
