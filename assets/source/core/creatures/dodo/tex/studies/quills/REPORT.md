# Quills study — round 3

Refined the approved round 2 feathers with fine barb-tip fringes, more distinct sweeping strands in diffuse and height, and darker tail shafts. The broad silhouettes, crescent-band field, eight element names, placement, roots, tips and physical dimensions are retained. Finger shafts remain pale. All five production maps and the individual working layers have been rebuilt.

Start with the [concept-size comparison](checks/concept_comparison_native.png), showing the relit slate/cream fan and fingers beside the original concept at **1500 px/m**. The [full-size comparison](checks/concept_comparison_full.png) samples the delivered cards at **6005.87 px/m**; only the concept is enlarged to match their physical scale. Neither card image is a thumbnail enlarged for presentation. Separate full-size transparent assemblies are [tail](checks/assembled_tail_full.png) and [fingers](checks/assembled_fingers_full.png). The [flat fan and fingers in four dyes](checks/card_assemblies.png) retain the previous review arrangement; full-density flat assemblies are [tail](checks/flat_tail_full.png) and [fingers](checks/flat_wing_full.png).

No new source image was generated this round. The unchanged [tail original](source/tail_r2_original.png), [wing original](source/wing_r2_original.png) and their exact prompts remain in `source/`. Their hashes match round 2. `barbs.py` traces 1,301–1,367 curved paths per tail master and 621–666 per finger. Each path starts at the anatomical shaft, sweeps through the vane, and ends individually. Adjacent endpoints share irregular length variation, producing small groups of tips; the rounded cap gets more free ends. Sparse small clefts follow parted barbs. The final 0.5 cutout contains exactly eight connected elements, with isolated resampling specks removed.

The same path field supplies light/dark barb drawing and shallow physical relief. The source's finer drawing is retained after broad illumination removal; intrinsic darker inner vanes and lighter fringes remain in diffuse. Tail shafts gain a narrow dark pigment core. Material fields are filtered while shrinking the masters to the atlas so that fine strands do not become stippling; cutout coverage uses a sharper filter. Total regional diffuse contrast is slightly greater than round 2, while the highest-frequency noise energy is lower. The [before/after material view](checks/barb_before_after.png), [0.5-cut edge comparison](checks/edge_cutoff_comparison.png), and [registered source / neutral base / relit comparison](checks/source_base_relit.png) show these changes directly.

| Delivered picture | How it was made |
|---|---|
| [quills_base.png](quills_base.png) | Edited/computed from unchanged generated luminance plus explicit barb, shaft and vane value drawing. Neutral sRGB RGBA; linear-light regional means calibrated to 0.50. Final fringed alpha and nearest-covered RGB padding. |
| [quills_height.png](quills_height.png) | Computed 16-bit physical relief: 0.06 mm vane crown, 0.16 mm raised shaft, source texture up to ±0.020 mm, and the centered filament field multiplied by 0.035 mm, over a 0.22 mm datum. Full white = 1.4 mm. |
| [quills_normal.png](quills_normal.png) | Computed OpenGL +Y central differences from the saved, quantized atlas height at its physical span. |
| [quills_packed.png](quills_packed.png) | Computed restrained height-derived AO, dry matte roughness with a smoother shaft, and zero metalness. |
| [quills_regions.png](quills_regions.png) | Computed pure red body and yellow fingers/crescents, with a 24-pixel categorical gutter and black in unused transparency. Band pigment is identical to round 2 everywhere both cutouts are covered. |

Each element keeps its own generated crop, registered original, approved alpha, final cutout, alpha, height, shaft, bands, regions, normal and packed maps. New `barbs.png`, `fringe.png` and `splits.png` preserve the added structure independently. `atlas_semantics.npz` records aligned owners and masks. Earlier reports, scripts and comparison maps have been moved to ignored `superseded/`; the accepted build and checker do not read them.

The sheet remains **2048 × 2048 over 0.341 m**, non-tiling, two-sided, cut at **alpha 0.5**. At 512 it is 1501.47 px/m: approximately 165 pixels per 110 mm tail and 75 per 50 mm finger. The bands remain nominally 4.5 mm wide, separated by 5 mm of body colour along the shaft, with a 4 mm terminal body margin. Measured band widths remain 4.43–4.55 mm. [study.json](study.json) lists the same roots and tips and updated tight boxes for the fine fringe; right and bottom box coordinates are exclusive.

| Element | Cutout bounding length, mm | Cutout bounding width, mm |
|---|---:|---:|
| `tail_center` | 110.39 | 30.14 |
| `tail_side_1` | 110.39 | 28.81 |
| `tail_side_2` | 107.89 | 29.80 |
| `tail_side_3` | 105.40 | 28.97 |
| `wing_finger_1` | 50.62 | 17.82 |
| `wing_finger_2` | 51.62 | 17.98 |
| `wing_finger_3` | 48.62 | 18.15 |
| `wing_finger_4` | 49.29 | 18.32 |

These are bounds including the new free barb ends; the approved anatomical dimensions and card landmarks are unchanged. The central feather is exactly symmetric. Side masters retain their source asymmetry and are mirrored on the bird to make three pairs. Smoothed silhouette overlap with round 2 is 97.80% by intersection-over-union; the intended differences are confined to the fine boundary treatment.

All final checks passed; details are in [checks/checks.json](checks/checks.json); the historical round-comparison measurements are retained only in ignored `superseded/`.

| Region | Mean linear grey | Linear value standard deviation |
|---|---:|---:|
| 0 | 0.500018 | 0.07111 |
| 5 | 0.500021 | 0.05730 |

RGB channel spread is **0**. Quarter means differ by **0.0094%**. Maximum tested base/light correlation is **0.000509**. Height/normal correlation is **0.999576 X / 0.998291 Y**; maximum normal unit error is **0.005660** and visible angular error **0.359°**. Visible height spans **0.201–0.473 mm**, roughness **0.776–0.902**, AO **0.776–1.000**. Region alignment is exact, metalness is zero, and the 24-pixel RGB gutter matches its nearest covered texel exactly. Tail shaft-core diffuse averages 0.334 linear versus 0.428 in the adjacent inner vane.

I inspected the final full-size and concept-size assemblies, alpha at 2048 and 512, four dyes, three light directions, the source comparison, and the 128/105/26-pixel reductions. Full-size tips resolve into irregular fine fringes; at 512 the finest strands merge into small uneven groups around the caps. Two bands remain separate and all four fingers remain distinct. Near-black suppresses the finest value drawing but keeps the silhouette and white bands. Near-white and pink/lime preserve the shafts and sweeping vane detail. The sharper barb relief responds to relighting without adding thick carved steps.

The smallest views remain a limit: at a 128 atlas most individual fringe strands are subpixel; at a 200-pixel bird the pattern softens, and at 50 pixels the individual bands and barbs average away. The comparison is still a two-dimensional curved-card placement with transformed tangent normals and soft overlap shadows. It has less inflated volume and overlap depth than the concept. It does not validate final mesh curl, backface shading, PBR highlights or engine mip/alpha behavior. Finger roots are exposed here; the wing coverts hide them on the creature. The original concept is only 1500 px/m, so its enlarged full-size comparison has no additional source detail.

Rebuild from the dodo directory with `python3 tex/studies/quills/build.py --span-m 0.341 --direction-deg 0`, then `python3 tex/studies/quills/check.py`. Span and direction remain numeric controls shared by all layers. `--numbers-only` skips rendered reviews. No service calls or Blender runs are needed.

Round 3 ran from **2026-11-14 22:26:38 UTC** to **2026-11-14 22:46:46 UTC**, approximately **20.1 minutes**, including visual iterations. The final build took **20.98 seconds**; the final complete check/review pass took **40.50 seconds**.

## Files

The accepted build reads only `source/tail_r2_original.png` and `source/wing_r2_original.png`, with their exact prompts retained as `tail_r2_prompt.txt` and `wing_r2_prompt.txt`. `barbs.py` supplies the deterministic fibre paths; `assemble.py` supplies the checker’s previews. Earlier rounds, timestamp notes and obsolete regression tools are in ignored `superseded/`. Review pictures remain in ignored `checks/`. Derived per-element layers and `atlas_semantics.npz` are rebuilt in `source/`.

For the repository tidy, all delivered maps, `study.json`, per-element layers and semantic fields were removed from their build locations before running `build.py`. SHA-256 hashes of **all five delivered PNGs and `study.json` matched the accepted files byte for byte**. Nothing in `superseded/` was needed. The before/after hashes are recorded in [checks/tidy_rebuild.json](checks/tidy_rebuild.json).
