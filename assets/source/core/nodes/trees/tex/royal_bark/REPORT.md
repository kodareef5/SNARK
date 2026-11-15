Royal palm bark — round 2

All four existing delivery maps have been replaced with aligned **2048 × 2048** PNGs. One tile still covers **1.6 m around × 2 m up** the trunk, with image top higher. This revision follows `BRIEF-palm-bark-2.md` and the user's second-round instructions, which supersede the first brief's ring spacing and its exclusion of dark ring tissue from base colour. The two trunk studies in `palm_parts.png` and `grove_near.png` were inspected again. No external or existing-game reference was used.

Fifteen leaf-scar rings replace the previous nine. Their interrupted pale lips now have a thin, faint darker tissue line beside them in base colour. Warm/cool mottling is stronger, with more small grey-green weathering marks and a gentle lower-tile bias in the elongated algae flecks. The body remains a smooth chalky pale grey; the stronger distance read comes primarily from pigment rather than deeper relief.

Successive ring-centre spacings, **including the vertical wrap**, are **11.5, 16.2, 9.2, 13.8, 18, 10.6, 15.2, 12.6, 19.5, 8.4, 14.6, 11.8, 17.1, 9.8, 11.7 cm**. The sequence totals 2 m. Spacing is authored in physical units rather than inferred from the generated painting. The mean delivered body-plus-detail colour is **183.98, 183.15, 171.05** sRGB. Lichen above a 0.25 mask threshold occupies **0.765%** of the tile.

| Delivery | Construction and measured result |
| --- | --- |
| `royal_bark_base.png` | 8-bit RGB, frozen sRGB ICC. The original two skin paintings remain composed from nine native crops into a 2304 px toroidal master, then reduced to 2048. New ring masks come from `royal_rings_v2.png`; calibrated pale epidermis and darker adjacent tissue colours replace source illumination. Full-resolution fibres, cracks and mottling complete the surface. No overall sun gradient, cylindrical shading or external cast shadow is baked in, and AO is not multiplied into base. The requested local pale/dark ring pair is intentional. |
| `royal_bark_height.png` | 16-bit grayscale, white high. **Full black-to-white range: 2.5 mm** (previously 2 mm). Delivered values occupy **0.542–1.956 mm**, span **1.414 mm**, without clipping. The separately measured local ring contribution spans **0.683–0.901 mm** per ring. Nominal skin level is 0.92 mm. The encoding includes headroom; it is not the rise of each ridge. |
| `royal_bark_normal.png` | 8-bit RGB linear data, **OpenGL +Y toward image top**, derived from the reopened, quantized delivered height using central differences and wrapped neighbours. Metric pixel pitches: 0.78125 mm across, 0.976562 mm down. Independent agreement: **0.172° mean, 0.359° maximum** error from RGB quantization. |
| `royal_bark_orm.png` | 8-bit RGB linear data: R height-horizon occlusion, G roughness, B exactly zero. AO min/mean **0.910/0.998**. Roughness **0.714–0.890**, mean **0.766**; lichen mean **0.824**. **Zero nonzero metalness pixels**. |

The new full-size **1254 × 1254** source is [source/royal_rings_v2.png](source/royal_rings_v2.png), produced with the **built-in image_gen tool** by editing the first-round ring source. The exact prompt and input reference are in [source/royal_rings_v2_prompt.txt](source/royal_rings_v2_prompt.txt). No API fallback was used. The original generated sources remain in `source/`. `source/ridge_extraction.png` shows the paired crest (red) and recess (green) mask bank. `source/construction_masks.npz` retains aligned rings, recesses, lichen, fissures, scars and weathering. `material.json` records spacing, relief, physical scale, crop provenance, colours and source hashes. `source/round1/` archives the previous four maps, scripts, report, masks and measurements for comparison.

I inspected the final base maps at **256 and 128 native pixels**, including their physical aspect squeeze, without lighting or AO. Both retain visible rings; the royal remains pale and smooth with fine interrupted traces. [checks/distance_readability.png](checks/distance_readability.png) puts old and new beside one another. Reductions use **linear-light box filtering with no sharpening**. Median measured lip-to-recess contrast, in sRGB luminance code values, is:

| Reduction | Round 1 | Round 2 |
| --- | ---: | ---: |
| 256 px | 2.29 | 11.50 |
| 128 px | 1.77 | 7.33 |

The requested 3×3 and 3×8 sheets use the correct circumferential squeeze and identical repeats. The 14 m cylinders show three azimuths, both unlit and under one sun plus ambient sky with **AO and cast shadows absent**. Rings remain visible there. The long views show continuous ring rhythm without a conspicuous tile-boundary stripe or large repeated lichen badge. Intentional inspection can still identify the exact repeating sequence.

Visual checks retained in `checks/`: `layers.jpg`, `detail_1to1.jpg`, `offsets.jpg`, `base_tile3x3.jpg`, `base_tile3x8.jpg`, `relighting.jpg` (opposite light directions), `trunk_preview.jpg`, `no_shadow_14m.jpg`, `distance_readability.png`, and the standalone `base_256.png` / `base_128.png`. The relights confirm aligned crest, recess, normal and occlusion detail. `metrics.json` records independent format, channel, colour-profile, spacing, height-range, normal, roughness, metalness, mip-readability and wrap checks. All numeric checks passed.

Seam step divided by the 95th percentile of full interior line steps (adjacent samples, not forced-identical edge pixels):

| Layer | Left/right | Top/bottom |
| --- | ---: | ---: |
| Base | 0.910 | 0.484 |
| Height | 0.942 | 0.519 |
| Normal | 0.946 | 0.624 |
| Orm | 0.780 | 0.260 |

Rebuild from either material folder with the pinned dependencies in `requirements.txt`:

```sh
python3 build_material.py
python3 check_material.py
python3 check_rebuild.py
```

`check_rebuild.py` performs another full build and compares SHA-256 hashes for all four maps, the master, extraction, construction masks and metadata; **all eight artifacts matched byte-for-byte** in the completed second build; results are saved in `checks/rebuild.json`.

Import base as sRGB and the other three maps as linear data; repeat both axes and keep the normal green channel as delivered. Use the **new full height range** above for displacement.

Remaining limits: The extra low-area weathering is biased within the seamless tile, not fixed to world height. A basal stain that appears only once at the actual foot of a 14 m trunk requires a separate mesh/vertex/world-height mask; painting it strongly into this repeated tile would create recurring green bands. a single fixed UV tile still repeats exactly every **2 m**; irregular spacing and subdued landmarks reduce its salience but cannot remove that mathematical period. The previews are material diagnostics, not game captures. The 256/128 images are the requested screen-size proxies; exact 10/20 m appearance depends on engine field of view, mip choice and compression, which were not exercised here.
