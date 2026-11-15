# Straw eye and upper lid — round 3

The accepted **eye is unchanged, byte for byte**. Only the lid material and its review shell have been revised. Both sets keep their names, 1024-square resolution and physical spans: eye 26 mm, lid 30 mm. The lid is now explicitly a **single non-tiling anatomical panel**.

## What changed and why

Round 2's three analytic rolls and tiny grain produced a padded, tubular surface. This round replaces that anatomy with a new generated folded-skin source, guided by our two head concepts. The full source has a broad lopsided upper fold, a thinner fold that branches and merges near the left corner, and a short shallow lower crease. Their curvature, length, width, depth and endpoints differ. The original fold composition is retained; it is not reconstructed as three repeated Gaussian ridges.

Pebbles now occupy the requested roughly 0.5–1 mm scale. They continue across raised tissue and into creases, with intrinsic paler tops and darker junctions in the base. The generated cell field is enlarged independently of the folds, and its relief is rounded over 0.088 mm to avoid brittle edges under grazing light. A line-scan measurement of prominent height crests gives a median spacing of **0.850 mm**, with the middle half between 0.674 and 1.084 mm. This is an approximate spacing measurement, not a claim that every irregular cell has the same diameter; broad or merged cells can exceed 1 mm.

The smooth rim retains its **1 mm width, 0.35 mm rise and low roughness**. It sits just inside the bottom guard band so the edge can return to the same flat value as the top. The skin becomes smooth immediately before it.

The base retains neutral value drawing throughout. Cell pigment comes from the aligned cell field; fold pigment concentrates on crests and crease floors. Neither uses a light vector, normal shading or AO. Its linear luminance standard deviation is **0.03948**, compared with 0.01302 in round 2, so the skin remains visible under soft or unlit display.

## Maps and production

| Map | How it was made |
| --- | --- |
| `eye_base.png` | Accepted round-2 generated iris, polar remapping and intrinsic pigment. Unchanged. |
| `eye_height.png` | Accepted constant grayscale16 cornea. Unchanged. |
| `eye_normal.png` | Accepted constant OpenGL normal `(128,128,255)`. Unchanged. |
| `eye_packed.png` | Accepted AO 1, roughness 19/255, metalness 0. Unchanged. |
| `eye_regions.png` | Accepted pure black, never dyed. Unchanged. |
| `lid_base.png` | Computed neutral pigment from generated cells and asymmetric fold relief; mean corrected in linear light. RGB8 sRGB. |
| `lid_height.png` | Generated scalar source separated into fold and cell fields, physically scaled, combined with the retained smooth rim and flat boundary bands. Grayscale16. |
| `lid_normal.png` | Computed from the exact saved height at the physical scale, OpenGL +Y. RGB8 linear. |
| `lid_packed.png` | Height-horizon AO over eight azimuths and six distances; aligned skin/rim roughness; metalness 0. RGB8 linear, R=AO, G=roughness, B=metalness. |
| `lid_regions.png` | Computed pure green `(0,255,0)`, face region 1 throughout. RGB8 linear data. |

All ten maps are opaque and pixel-aligned. Only base colour is loaded as sRGB; all other layers are linear data. There are no cutouts or element sheets.

## Scale, borders and sampling

| Set | Physical span | Encoded height range | Actual excursion | Mean colour |
| --- | --- | --- | --- | --- |
| Eye | 0.026 m, 39,385 px/m | 0.01 mm reserved | 0 mm | Natural colour; linear RGB `(0.337783,0.279493,0.099190)` |
| Lid | 0.030 m, 34,133 px/m | 1.6 mm | 1.009122 mm | Face region 1: linear RGB `(0.499827,0.499827,0.499827)`; mean sRGB `(187.325,187.325,187.325)` |

**Clamp both axes on both sets.** The lid runs from front corner to back corner across U and from brow to rim down V. Its tapering anatomy does not repeat. `study.json` now records `tiles: {"x": false, "y": false}`; no seam test is used to imply anatomical tileability.

The outer **12 pixels**, approximately 0.352 mm, match exactly at opposite boundaries in base, height, normal and packed maps. The relief has a slightly wider guard to leave the complete normal stencil flat. The top and bottom height both return to 32768; their normals are flat. The independent validation wraps **both** axes when differentiating the lid, reproducing the game's boundary treatment.

Skin roughness averages 0.45227; the rim reaches 0.25098. AO averages 0.93317 and bottoms at 0.71373. The eye's accepted wet cornea stays at roughness 0.07451.

## Review and checks

I inspected the final lid on the revised shell beside unchanged native-size crops of **both** head concepts in `checks/concept_comparison.png`. The comparison uses nominal iris diameters of 128 pixels for the side detail and 100 pixels for the front detail. The upper folds remain unequal and the pebbling stays visible. The shell now uses plain pebbled tissue below the eye, instead of reflecting the upper fold pattern into an inflatable-looking ring.

I also inspected the generated source beside the delivered unlit and relit skin at the same panel scale (`checks/source_comparison.png`), the full-size relight, upper-left, upper-right and low grazing illumination, and rose, ivory, dusky taupe, hot pink, lime, near-black and near-white dyes. The softened cell relief retains the pebbled structure while avoiding the scratchy appearance of the initial round-3 relief. At 200- and 50-pixel whole-bird heights, these tiny details average away; the 100-pixel eye comparison is the useful close inspection.

The checks pass:

- The five eye PNG hashes match `source/accepted_eye_sha256.json` exactly.
- Dimensions, PNG bit depths and colour-space tags are correct; region maps contain only their exact pure colours; metalness is zero; height is not clipped.
- Lid RGB channels are identical. Mean linear grey is 0.499827; quadrant spread is 1.622%, below 2%.
- Maximum base/normal-light correlation over 16 azimuths is **0.04416**, below the original 0.05 limit. No validation exemption is used.
- With both axes wrapped, normal-versus-height correlations are **0.999750 across / 0.999929 down**. Every delivered normal byte matches the independently calculated quantized normal. Maximum RGB8 unit-length error is 0.00609; maximum angular error is 0.377 degrees.
- Opposite 12-pixel boundary bands match exactly. Three principal creases are detected at centre-column rows 497, 649, 803.

Rebuild from this folder with:

```sh
python3 build.py
python3 check.py
python3 check.py --verify-rebuild
```

Pillow, NumPy and SciPy are sufficient. `config.json` controls footprint, source, cell size, relief, rounding, rim and left/right orientation. The acceptance measurements and rebuild record are archived in `superseded/validation.json` and `superseded/rebuild.json`; the check commands above regenerate these records.

Before repository cleanup, the round-3 verification rebuild reproduced all ten PNGs and `study.json` byte for byte, preserved the five accepted eye hashes, and left all seven generated originals unchanged. That verification build took 5.31 seconds.

## Sources and reuse

This round used the **built-in image-generation tool**, with our `head_side.png` and `head_front.png` as anatomical references. The untouched full-resolution 1254-square source is `source/lid_round3_original.png`; the exact prompt is `source/lid_round3_prompt.txt`. `superseded/source/generation.json` records the generation history and selection. No external references were searched for or downloaded.

The source is separated into reusable aligned fields in `source/lid_fields.npz`: fold relief, rounded cell relief, cell pigment, combined pigment, rim, boundary guard and final physical height. That NPZ is a reproducible local cache under the repository's existing ignore rule. The original PNG, configuration and `build.py` are sufficient to recreate it. The accepted eye's source and build code remain available. Round 2's report, scripts, configuration, metadata and lid maps are preserved in `superseded/source/round2_history/`.

## Remaining limits

This is generated and reconstructed relief, not a measured skin scan. The scalar source does not contain true undercuts; final geometry supplies the folded silhouette and contact shadows. It represents one particular asymmetric lid, so it should be fitted or mirrored deliberately rather than repeated.

The shell is a material-review aid with compressed vertical UVs, a simplified lower support and no ochre brow. It shows the revised material at the concept's size but does not reproduce the complete head anatomy. The final mesh and UV layout still determine the precise sleepy expression.

## Time

Round 3 took approximately 17 minutes on 2026-11-14, from 22:04:30 to about 22:21 UTC. This includes one successful image-generation call, source interpretation, fold and cell revisions, border repair, visual review, numerical validation and the final rebuild verification.

## Files

The accepted build reads two generated originals, retained untouched with their prompts:

- `source/iris_round2_refined_original.png` — `source/iris_round2_refine_prompt.txt`.
- `source/lid_round3_original.png` — `source/lid_round3_prompt.txt`.

It also reads `config.json` and `source/accepted_eye_sha256.json`. Unused sources, prompts and earlier records are in `superseded/`; no build dependency is there.

After removing all delivered maps, `study.json` and both derived field caches, `python3 build.py` rebuilt **all ten accepted PNGs byte for byte**, verified by before/after SHA-256 hashes. It recreated the caches; `study.json` changed only to list the two retained originals. All 27 files in `checks/` remained unchanged. The cleanup hash record is `superseded/clean_rebuild_result.json`.
