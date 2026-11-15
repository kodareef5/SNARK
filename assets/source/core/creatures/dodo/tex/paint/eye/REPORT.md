# Eye and lids painted to the dodo

`paint.py` paints `eye_l`, `lid_l_out` and `lid_l_in` into the 2048-square atlas. It covers exactly their **136,083 texels**, with opaque alpha on every owned texel and zero outside them. The accepted study is unchanged.

## Placement and materials

**Eyeball — 93,363 texels.** The accepted `tex/studies/eye/eye_base.png` is projected from the front onto the baked eyeball, using centre `(0.043, 0.583, 0.177)` and normalized look direction `(0.70, 0, 0.71)`. Its 26 mm picture preserves the **22 mm iris and 3 mm pupil**. The back hemisphere receives only the accepted dark straw margin, avoiding a second pupil. Fine radial pigment, crypts, collar and limbal ring come directly from the accepted map. Height is constant; roughness is **19/255 = 0.07451** and material AO is 1. The eye stays black in the region map. Highlights belong entirely to lighting.

**Outer lid — 41,937 texels.** The kept `lid_round3_original.png` is separated into uneven fold relief and fine cells with the accepted builder's filters, normalization and relief strengths. No ignored working cache is required. The folds follow physical arc coordinates along the free edge of the 17.1 mm outer hood. Distance above that edge is measured from the model's 10-degree rim plane. This puts the few unequal folds parallel to the rim, with the heavy fold toward the brow, rather than aligning them to the atlas rectangle.

The fold panel is fitted to **30 mm along the lid and 18 mm from brow to rim** so the folds occupy the exposed hood. Cells retain their independent **30 mm source scale**, approximately **0.5–1 mm** across, instead of shrinking with the fold arrangement. The source's 0.105 mm cell-relief multiplier and 0.088 mm rounding are retained. Cell tops and crease floors remain drawn in neutral pigment. The far attachment and the chart's hidden convergence fade calmly into surrounding skin.

The **1 mm smooth rim** has the accepted 0.35 mm rise and approximately 0.25 roughness. It follows the actual free edge, including where that edge curves across the atlas.

**Inner lid — 783 texels.** Smooth, neutral, slightly moist skin has approximately **0.32 roughness**, transitioning to the same rim. Both surfaces evaluate identical height, pigment and roughness at their shared physical edge. Their separate atlas sampling can resolve it differently. This tiny island averages **1.1313 mm per texel**, so drawing sub-millimetre cells there would alias; its finer surface is represented by smooth relief and lower roughness.

Both lid pieces use face region green. Combined face mean is **0.499818 linear**, with identical RGB channels. Outer and inner means are 0.499859 and 0.497602 respectively. Pigment contains no directional light or baked form shading.

## Delivery and rebuild

`layers/` contains `dodo_base.png` (RGBA8 sRGB), `dodo_height.png` (grey16), `dodo_rough.png` and `dodo_occlusion.png` (grey8), `dodo_regions.png` (RGB8), and `layers.json`. The full encoded height range is **1.6 mm**; the outer lid uses 0.182718–1.149065 mm within that range. The constant 0.8 mm datum is not extra eyeball geometry. The composer derives normals from the height at the baked texel size.

Every destination texel uses **4 × 4 physical-footprint samples**, with colour averaged in linear light. Fine AO is computed from the painted relief only; `compose.py` supplies the model's form occlusion. The delivered regions equal the bake exactly on all owned texels. No normal map or cards are delivered by this group.

Reproduce the layers and reviews from the dodo folder:

```sh
python3 -I tex/paint/eye/paint.py
python3 -I tex/paint/compose.py --out tex/paint/eye/checks/composed
python3 -I tex/paint/eye/check.py
```

After moving the entire `layers/` directory aside, a clean paint run reproduced **all five PNGs and `layers.json` byte for byte**. Before/after SHA-256 hashes are in `checks/rebuild.json`. Input hashes are recorded in `layers.json`; the paint run reads only the retained study inputs and shared layout/bake files. No new generated original was needed.

## Checks and visual review

`checks/metrics.json` records coverage, bit depth, outside-mask emptiness, region agreement, grey neutrality, cornea flatness and rim continuity. Sampling the delivered pupil's antialiased contour at half the surrounding iris luminance measures **3.0000 × 2.9725 mm**. The darker limbal ring remains distinct from the iris interior. The compositor reports full eye-group coverage and no eye-group region errors; the composed region map has zero colour-ring violations. Its log also contains work-in-progress messages for other groups.

I inspected the atlas layers, unlit and relit skin, rose buff, ivory, dusky taupe, lime, near-black and near-white dyes, and the composed head from front, side and back. In `checks/concept_comparison.png`, the actual baked eye is shown at **100 pixels per nominal iris diameter**, beside both concept details. The small black bead, straw field, pebbled hood and uneven folds remain legible at that size. `checks/cornea_relighting.png` isolates the baked eyeball under three lights; form AO from the surrounding head is omitted only in this isolated material probe.

## Layout limits

The corrected position maps and object-normal bake both describe the **positive-X left side**. Painting decodes the current `pieces.json` position box directly, with no reflection of positions or normals. The full-head preview duplicates this canonical half only to display the bird's opposite side.

Review images project texel footprints through the actual position maps with a depth buffer. They are Python previews, not the game's mesh renderer; conservatively sized footprints and the mesh's faceting affect silhouettes. The rim's physical thickness and the rest-pose opening come from the model. The lower lid and its folds belong to the face group; the refreshed composition includes that group's available layers. Other groups' painting and the final renderer's lighting affect how closely the whole expression matches the concept.

This pass took approximately 20 minutes on 2026-11-14, including physical mapping, preview orientation correction, visual review and the clean rebuild check.

## Shared position-map correction

Removed the old absolute-X workaround and repainted from the corrected maps. The decoder already reads `position_box`, so it automatically uses the widened bounds `(-0.1464, -0.0012, -0.2187)` to `(0.1464, 0.6547, 0.3510)` m. The eye group lies below the former crown clipping, so its layout changes are small resampling differences: maximum height change is 0.01199 mm, and the region image is byte-identical.

The iris remains centred on the stated look axis, the pupil remains approximately 3 mm, and the uneven folds and smooth rim remain aligned to the physical lid edge in the refreshed side/front comparison. The eye's radial vector and supplied object normal now agree directly (median cosine 0.99957). Coverage, neutrality, rim continuity and a clean byte-for-byte rebuild pass with the corrected inputs. Previous layers and records are archived in `superseded/before_position_map_correction/`; the change measurements are in `checks/position_map_correction.json`.
