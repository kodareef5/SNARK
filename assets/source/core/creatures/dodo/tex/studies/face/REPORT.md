# Face study — round 4

Revised **skin only**. Its pebbles keep round 3's centres, size and rounded crown profile; their lower sides now extend to shared polygonal boundaries, with a thin continuous crease in both height and intrinsic base value. The five skin maps retain their names, 2048-square resolution and 0.205 m span.

**Brow, pouch and folds are unchanged.** SHA-256 checks confirm all 52 accepted PNGs are byte-identical: their 15 primary maps, fold alpha and delta, and 35 aligned element crops. Their per-set metadata is also identical. The repository-ready manifest now covers all 57 delivered PNGs: [source/accepted_sha256.json](source/accepted_sha256.json).

Start with [checks/concept_scale.png](checks/concept_scale.png). It uses the same concept crops, physical calibration, default dyes and lighting as round 3. The four accepted comparison rows are pixel-identical to the previous board. [checks/head_comparison.png](checks/head_comparison.png) shows the materials beside the whole head at native concept scale.

## Skin revision

The tile retains the same 30,276 relaxed, periodically warped cell centres and the same radial dome crowns. Added lower flanks occupy the spaces between crowns and terminate at shared cell edges. There is no separate flat background-skin field. A narrow groove follows every shared polygon boundary, including the junctions between cells.

The centre-spacing parameter remains **1.18 mm**. Equivalent cell diameters are **1.07 / 1.31 / 1.57 mm** at the 10th / 50th / 90th percentiles. These measure the shared polygon territories; round 3 measured the dominant Gaussian dome territories, so that earlier statistic differs slightly despite identical centres and crown profiles. No global scale change was applied.

Creases have an authored **0.100 mm full width at half maximum**, before antialias filtering. That is approximately one texel at this study's density. Their pigment is darker than the pale crowns, neutral and independent of light direction. The base therefore shows a fine cell network when dyed and unlit. Linear base standard deviation is **0.04371**, with mean **0.50000209**. Roughness and source micrograin retain their previous settings.

## How the pictures were made

| Pictures | Method and status |
| --- | --- |
| `skin_height.png` | Revised by script: original dome envelope, added lower flanks, shared narrow polygon grooves and restrained grain derived from the saved generated skin original. Periodic in both directions; mean height centred before encoding. |
| `skin_base.png` | Revised by script: pale crowns and slightly darker crease floors, plus subtle tissue variation. Residual normal-component bias removed, mean centred at 0.50 linear, then neutral sRGB encoding. No selected light, cast shadow or hue. |
| `skin_normal.png` | Recomputed from the saved 16-bit height at its physical density, using wrapped central differences and OpenGL +Y. |
| `skin_packed.png` | Recomputed eight-direction horizon AO / unchanged waxy-skin roughness field / zero metalness. Mean roughness 0.49002. |
| `skin_regions.png` | Exact green `(0,255,0)`, region 1. |
| Accepted `folds_height.png` | Retained round 3 script output: four thick elliptical eye rolls, the downturned 4 mm mouth crescent, three single creases, deep crease floors and locally finer pebbling. |
| Accepted `brow_height.png` | Retained round 3 script output: faint larger-cell reticulation, very low crown relief and restrained generated micrograin. |
| Accepted `pouch_height.png` | Retained round 3 script output: approximately 2 mm transverse rounded pleats, narrow grooves, modest row variation and seven local forks. |
| Accepted bases, normals, packed maps and regions | Retained round 3 outputs: neutral intrinsic drawing; normals derived from saved heights; AO / roughness / zero metalness; green face or cyan brow/pouch region labels. Mean roughness is 0.490 for folds, 0.345 for brow and 0.470 for pouch. |
| `folds_alpha.png`, base alpha, `folds_delta_height.png` | Retained continuous blend coverage and height delta relative to the regenerated **round 3 skin substrate**. Alpha is not a cutout. |
| `elements/*/*.png` | Retained exact atlas crops, seven aligned layers per element. Their boxes, roots, tips, spans and paths remain in `study.json`. |

The build reads two untouched generated originals and their prompts under `source/`. They supply micrograin; the softer unused alternative has moved to `superseded/`. No outside images are used. [checks/source_comparison.png](checks/source_comparison.png) compares the active originals with delivered base and relit maps over equal 40 mm spans. The complete accepted-set algorithms are in `build.py`.

## Scale and checks

All primary maps are 2048 square. Base is 8-bit sRGB; height is 16-bit linear; normal, packed and regions are linear data. Skin, brow and pouch tile both ways; folds is an element sheet with continuous opacity.

| Set | Span | Full height encoding | Used relief, mm | Region / mean linear grey | Normal–height correlation X / Y |
| --- | --- | --- | --- | --- | --- |
| skin | 0.205 m | 8.0 mm | -0.14520 to 0.09735 | 1 / 0.50000209 | 0.999933 / 0.999933 |
| folds, unchanged | 0.205 m | 8.0 mm | -0.38544 to 3.24132 | 1 / 0.50000091 | 0.999932 / 0.999943 |
| brow, unchanged | 0.256 m | 0.3 mm | -0.02801 to 0.01213 | 3 / 0.49996770 | 0.997470 / 0.997472 |
| pouch, unchanged | 0.256 m | 1.6 mm | -0.43146 to 0.17152 | 3 / 0.50000208 | 0.997137 / 0.999982 |

Decode regular height as `(sample / 65535 - 0.5) * height_mm`. Its full encoding range is unchanged; it is not the amount of relief used.

`check.py` passes with no failures. For the revised skin, the worst edge/interior jump ratio is **1.00024**, quadrant mean spread is **0.03481%**, and maximum base/light correlation across 48 directions is **0.002613**. RGB channels are identical, labels are exact and metalness is zero. Across all tiled sets, the worst edge ratio is **1.02777**. The largest normal-length error is **0.006526**; reconstruction differs by at most one encoded level. Full results are in [checks/metrics.json](checks/metrics.json).

The accepted folds still validate against their regenerated reference skin: exact zero-alpha base/height, exact eight-pixel box borders, exact individual crops, and delta reconstruction within one 16-bit step. Existing eye-roll and pouch-pitch checks also pass unchanged.

Inspected the concept comparison, native head comparison, source comparison, 1:1 detail, three lights, six dyes, wrap intersections and 200/50-pixel bird read sizes. The skin now reads as touching rounded cells with a continuous fine network in the unlit base. At close range the light moves across the crowns. No seam was visible at the wrap intersections. At the smallest bird sizes the millimetre detail filters into an even tone.

The concept-scale board retains the **136-pixel / 22 mm eye calibration**, or 6.182 concept pixels/mm, with both reference and delivery enlarged 2×. Crop coordinates remain in `checks/concept_scale.json`; no crop or scale was adjusted to improve the match.

## Rebuild and placement

From this folder:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 build.py
PYTHONDONTWRITEBYTECODE=1 python3 check.py
```

The consolidated build writes all four sets, fold alpha/delta and all element crops from scratch, then verifies their accepted SHA-256 hashes. `--detail-scale`, `--fold-scale` and `--pouch-angle` retain numeric controls for reuse; default arguments reproduce the accepted delivery. `--reuse-grain` is optional and was not used for the clean verification. Fold-reference skin under `fields/` and caches under `checks/` are regenerated outputs. `compare.py` independently regenerates the comparison boards. NumPy, SciPy and Pillow are required. No file in `superseded/` is read by the build or checker.

Decode base to linear and multiply by `linear_dye / 0.50`. Defaults remain **#DDA089** for face/folds and **#C49C58** for brow/pouch. Toward the eye and beak, the painter can sample the skin at 0.75–0.85 lateral scale while following the anatomy.

The accepted fold sheet retains its round 3 substrate. **Its delta is relative to that regenerated substrate under `fields/fold_reference_skin/`, not the revised tile.** Blend the complete fold height and linear base onto the destination skin with the supplied continuous alpha, then derive normals and AO from the composite. [checks/folds_on_revised_skin.png](checks/folds_on_revised_skin.png) demonstrates this under two lights without modifying any accepted map. The transition softens into the finer skin on the rolls; no rectangular patch edge is present.

The skin remains a generic periodic field; the concept has anatomy-directed stretching and secondary wrinkles that the painter must place. The accepted fold surface is softer than the revised standalone cell network, so its blend remains a material transition. The comparisons use flat or analytic diagnostic patches, not the final bird's UVs. Final geometry, dye-region joins and the required black rings remain later painting work.

## Time

Round 4 recorded work: **2026-11-14 22:47:40 UTC** to **22:58:40 UTC**, approximately **11 minutes** through final visual inspection. Full skin build: **9.72 s**. Final validation and board generation: **13.29 s**.


## Files

The accepted build reads `source/skin_relief_original.png` and `source/brow_relief_original.png`, with their original `skin_prompt.txt` and `brow_prompt.txt` kept beside them. `source/accepted_sha256.json` records the accepted output hashes. Superseded scripts, reports, configs, picture copies and the unused soft-skin original/prompt have moved to ignored `superseded/`; `checks/` was retained.

A clean default rebuild on 2026-11-14 started with all 57 delivered PNGs absent, regenerated the fold-reference fields and source-grain caches without using the cache option, and reproduced **all 57 PNGs byte for byte** against the hashes recorded before tidying. This includes the 20 primary maps, fold alpha/delta and all 35 element layers. Full rebuild: **31.14 seconds**. No delivered picture changed.
