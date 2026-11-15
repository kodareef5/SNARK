**Current delivery, round 3:** the mat is now deep shaded inner foliage, mean sRGB **(29.99, 42.03, 14.15)**, with shallow relief and high roughness. Every texture pixel outside its existing rectangle is unchanged. The standalone final-atlas check passes, including an isolated, byte-identical rebuild of all 35 outputs. See the appended round-3 record and comparison below. Earlier records are historical; their superseded source files and checks have been removed.

The creeper atlas contains eight leafy runs, two hanging strands, two sparse ground runners, and an opaque, horizontally repeating leaf mat. All four texture layers are 2048 × 2048. No regions map is used.

The design follows the repository's five creeper concept images and `NOTES.md`: olive-green heart-shaped and shallow lobed leaves, ochre-green runners, a small lavender trumpet, yellowing foliage, and young curling growth. The common brief and the project's wood layer benchmark were reviewed before building. No web references or images from existing games were used.

| File | Contents and construction |
| --- | --- |
| `creeper_base.png` | 8-bit RGBA, with an sRGB chunk. Twelve individually generated cutouts, uniformly scaled without changing their aspect ratios. Source alpha dust and tiny accidental holes are removed; opaque interiors retain one-pixel antialiasing at most contours. Edge RGB extends 40 pixels into transparency, then blends over eight pixels to each element's mean colour. |
| `creeper_height.png` | 16-bit grayscale. The encoded full range is **0–12 mm**; this atlas uses approximately 0–7.15 mm. Annotated blade centres guide a watershed separation into leaves. Each blade gets shallow doming and an overlap elevation, with fine vein relief from local source detail. Thin stems get rounded relief, and the flower gets a raised rim and cupped centre. Alpha-zero texels have height zero. The mat uses source-guided leaf-scale relief and fine veins. |
| `creeper_normal.png` | 8-bit RGB, OpenGL tangent space, +Y/green toward image top. Computed after reopening the delivered quantized height PNG. Card gradients use 1200 px/m; the mat uses 1024 px/m and periodic horizontal differences. |
| `creeper_orm.png` | Linear 8-bit RGB: red AO from local concavity, leaf junctions and crowded interiors; green roughness varying with healthy, young and yellowing surfaces; blue metalness identically zero. The mat's darker inter-leaf structure is carried primarily by AO. |
| `layout.json` | Exclusive pixel rectangles, physical lengths, and anchors/tips on the silhouettes. Hanging anchors are at the top; the other anchors are at the bottom. `run6` has an explicitly annotated terminal point inside its curled tendril. |
| `build_atlas.py` | Rebuilds the four texture layers, layout, prepared cutouts, leaf IDs and build metadata from frozen local sources. No model calls or external files are needed. |
| `check_atlas.py` | Independently validates delivered files and generates the required review images and measurements. Returns nonzero on a failed check. Its normal calculation is independent of the builder. |
| `source/` | Fourteen untouched full-resolution generated PNGs, exact generation prompts, original save-path provenance, build settings and blade annotations, dependency versions, session timing, source SHA-256 hashes, and derived prepared cutouts/leaf IDs. Thirteen originals are selected. `run7_v2_original.png` replaces the first run7 because it has better source-edge clearance; the first original is retained. |
| `checks/` | Layer contact sheet, backgrounds at 2048 and 256, layout overlay, alpha diagnostic, two-light views of every element, mat repeat/seam inspection, source contact sheet, measurements and rebuild verification. |

The cards use **1200 pixels per metre**. Anchor-to-tip distances are about 0.38–0.54 m for the leafy runs and 0.73–0.80 m for the long strands/runners. Main leaf blades are approximately 6–15 cm, with intentionally smaller unfolding leaves and smaller leaves on the long runners. `run1`, `run3` and `run7` supply denser coverage; `run2` and `run8` are more open. `run4` carries one open flower and one bud, `run5` carries mottled yellowing leaves, and `run6` supplies the curled growing tip.

The mat occupies exactly `[0, 1536, 2048, 2048]`, with `role: "band"` and `metres: 2.0`. Its 2 m width gives 1024 px/m; square texels imply a 0.5 m band height. The source is cropped without stretching, and a minimum-cost overlap seam joins its head and tail without a broad crossfade. Two matched edge columns make colour, height, derived normals and ORM repeat exactly. The band is fully opaque. Its mean sRGB luminance is about 77.25, compared with 110.89 on the cards.

To rebuild and validate from this directory:

```sh
python3 build_atlas.py
python3 check_atlas.py
```

Dependencies are Python 3, NumPy, Pillow and SciPy; the versions used are recorded in `source/requirements.txt`. Sources and paths are relative to the scripts, so the folder can be moved intact.

Automated validation passed:

- Correct dimensions, PNG bit depths/channel types, element names and non-overlapping rectangles; no cutout enters the mat rows.
- At least 26 pixels of empty silhouette clearance on every side of every cutout, exceeding the required 24.
- Anchors and tips lie on visible plant pixels, face the required direction, and agree with the physical lengths in the layout.
- Every cutout retains one connected alpha component. Partial alpha is **0.944% of the whole atlas**, confined to the one/two-pixel silhouette band.
- The first 32 transparent pixels agree exactly with their nearest edge RGB; farther empty pixels match the element mean within rounding.
- Height is zero wherever alpha is zero. Metalness is zero throughout.
- Independent height-to-normal recomputation has **zero quantized channel error**. Maximum angular error against the unquantized mathematical normal is **0.383°**, from 8-bit normal encoding; surface mean error is about **0.172°**.
- The left/right mat edges match exactly in every delivered layer.

`checks/layers.jpg` shows all four layers. `base_dark_*`, `base_white_*` and `base_green_*` show the required backgrounds; the 256-pixel versions deliberately average RGB independently of alpha, matching the brief's stated mip behaviour. `checks/layout.png` marks rectangles and endpoints. `checks/lit_elements.jpg`, the full-atlas lit images, and the native-size files in `checks/lit/` show each element under two opposing lights. `checks/mat_repeat.png` and `mat_seam_closeup.png` expose the horizontal join. `checks/measurements.json` contains the per-element coverage and other numerical results.

Visual review: heart/lobed silhouettes remain distinct at 256 pixels, with no black, white or grey matte fringe on the three backgrounds. The thin runners are connected at full resolution; their finest shoots naturally become faint at 256 pixels. The flower and yellowing variants remain recognizable. Opposing-light views show shallow blade and vein relief without a strong fixed lighting direction on the cutouts. The repeated mat has no obvious vertical join. The curled tip was checked separately to place its terminal marker correctly.

Limits: relief and occlusion are inferred from generated two-dimensional images, not measured plant scans. Overlap elevations are an approximation; the mat's fine source shading cannot be perfectly separated from pigmentation. These are atlas-level checks, not a test of the assembled mound, bent cards, alpha-test thresholds or distant LODs in the game. The very thin tendril and flower bud need that eventual engine review.

A final rebuild reproduced all four PNGs, layout.json and build metadata byte for byte (SHA-256 comparison in `checks/rebuild.json`). That rebuild took 10.2 seconds. Total elapsed work time from source setup through final verification was 16.7 minutes, including generation, authoring and review; exact UTC timestamps are in `source/session.json`.

**Round 2 — exposed rubble beneath torn creeper**

Added `rubble`, a non-repeating, fully opaque square of pale coastal limestone and broken cut masonry, rounded weathered edges, mortar crumbs, sand, recessed gaps, dead brown vines, sparse torn olive leaf scraps and pale attachment traces. The source was made with the built-in image generation tool and frozen unchanged as `source/rubble_original.png` (1254 × 1254). Its exact prompt is the `rubble` entry in `source/prompts.json`; provenance is in `source/generated_paths.json`. No external reference images were used.

`layout.json` gives rubble `role: "patch"`, `rect: [0, 0, 600, 600]`, `metres: 2.4` and `height_range_mm: 60.0`. Its scale is exactly **250 px/m**. It overlaps no rectangle and is well clear of the unchanged mat band at `[0, 1536, 2048, 2048]`. The card rectangles were repacked by trimming empty padding and translating their contents; every card still has at least 24 px of empty silhouette clearance. Plant sizes, colours, alpha, material values, relief, normals and endpoint vectors are unchanged. Source images and all non-placement plant build settings are unchanged too.

The height layer deliberately has two documented decoding ranges: **12 mm for all original elements; 60 mm for rubble**. Decode a height sample as `sample / 65535 * element.height_range_mm`, falling back to the atlas-level range when the element has no override. This preserves every original height texel and its physical meaning. Rubble uses approximately **0.712–60.000 mm**. `source/rubble_relief.json` traces 31 stone footprints with face heights and tilts, and nine woody strands. The builder rounds the stone edges, adds fine mineral and mortar relief, and raises the traced stems over the substrate. Broad stone heights come from these annotations, so dark vine pigment does not become a deep trench. Height remains zero outside alpha.

Rubble normals are computed from the reopened delivered height at 250 px/m, with derivatives confined to its rectangle. They use the same OpenGL convention as the plants. Gap occlusion averages **0.721**, versus **0.976** on high exposed faces. Encoded roughness spans **0.851–0.949**; metalness is zero. The base receives a modest lift in recessed darkness so AO carries more of the gap shading.

`build_atlas.py` rebuilds every layer from the frozen local sources and annotations, with no generation or network access. It also refreshes `sprites.json`: existing card geometry is preserved from `source/sprites_round1.json`, only cached UV origins move, and rubble receives its own patch bounds. The parent sprite generator is not used because it predates the patch role.

`check_atlas.py` now validates rubble dimensions, opacity, role, physical scale, roughness, height range and gap occlusion, alongside all prior checks. `source/round1_invariants.json` records the original source and element hashes. **All 52 original element/layer comparisons pass**, including a 24-pixel perimeter around each card and the entire mat. Independent normal recomputation has **zero quantized channel error**, with maximum angular error **0.383°** from 8-bit encoding. All mat edge comparisons remain exact. Atlas partial alpha remains **0.944%**; rubble has 360,000 opaque pixels and no partial alpha.

Updated every standard review image and added `checks/rubble_layers.jpg` plus native-size opposing-light previews in `checks/lit/rubble_left.png` and `rubble_right.png`. Visual review shows exposed pale stone, dark inter-chunk gaps and sparse vine remnants; it reads as a stripped heap surface. Rounded chunk relief changes under the opposing lights. The 256-pixel background previews retain clean plant silhouettes, and the mat remains visually unchanged. Relief is an annotated approximation of the generated photograph, not a measured scan; the new patch has not been reviewed on the game's assembled heap.

A second `python3 build_atlas.py` reproduced **35 output files byte for byte**, including all four atlas PNGs, layout, sprites, metadata and prepared maps. It took **28.23 seconds**; current hashes are in `checks/rebuild.json`. `python3 check_atlas.py` passes; full measurements are in `checks/measurements.json`. Round 2 took **10.46 minutes** from freezing the original baseline through final verification, excluding initial inspection. Timestamps are recorded separately in `source/session_round2.json`.

**Round 3 — shade inside the vine**

The mat now represents foliage buried behind overlapping leaf cards on a few low inner clumps. Its rectangle remains **[0, 1536, 2048, 2048]**, fully opaque and repeating horizontally over 2 m. The runs, hangs, ground runners, rubble, empty texels and every other rectangle remain unchanged.

![The old mat beside the deep-shade mat, shown at identical scale and display exposure](checks/mat_before_after.png)

Left: the previous band. Right: the delivered band. Both are downsampled identically from the atlas without brightening either preview. The comparison image is [checks/mat_before_after.png](checks/mat_before_after.png); the full new band is [checks/mat_band.png](checks/mat_band.png).

The built-in image generation tool edited the existing full-resolution leaf tangle, preserving the heart-shaped and lobed leaves, stems and overlapping arrangement while moving the entire surface into deep shade. Its unmodified generated output is frozen as `source/mat_original.png` (2172 × 724). The exact edit prompt is the `mat` entry in [source/prompts.json](source/prompts.json); the original reference prompt remains there as `mat_reference`. The offline builder crops and quilts this source, applies a monotone calibration to the requested dark olive palette, and rolls off isolated bright stems and veins. No model call is part of a rebuild.

| Mat measurement | Delivered result |
| --- | --- |
| Mean sRGB | (29.99, 42.03, 14.15), previously (65.53, 86.41, 20.96) |
| Mean weighted sRGB value | 37.46, approximately 48% of the previous 77.25 |
| Mean of darkest 5% | (11.38, 19.25, 6.08); deepest gaps approach (10, 16, 6) |
| Maximum weighted sRGB value | 69.18 after the bright-detail rolloff; no sunlit patch |
| Packed occlusion | 0.353–0.600; dark gaps average 0.370, nearest faces 0.569 |
| Packed roughness | 0.788–0.820; metalness zero |
| Height | 0.233–1.172 mm, previously 0.900–7.150 mm |
| Normal tilt, 95th percentile | 3.98°, previously 31.13°; maximum now 9.34° |

The height range encoding remains 0–12 mm for plants and 0–60 mm for rubble. Normals are recomputed from the delivered 16-bit height with the existing physical scales and OpenGL +Y convention. An independent recomputation gives **zero quantized channel error**. The colour, height, normal and ORM left/right mat edges match exactly.

`check_atlas.py` now validates the final atlas independently of any previous delivery. It checks PNG sizes and channel formats, sRGB/linear declarations, final element names and rectangles, alpha opacity and edge width, connected silhouettes, colour bleed, anchors and physical scales, material ranges, height/normal alignment, mat shade and periodic seams, source hashes, prepared cutout alignment, sprite outlines, UVs and colour means. It then copies only declared inputs into an empty temporary directory, runs the build there, and compares all four PNGs, layout, sprites, metadata and 28 prepared images byte for byte. It never rebuilds over the files being checked. Results are in [checks/measurements.json](checks/measurements.json) and [checks/rebuild.json](checks/rebuild.json).

The build no longer reads historical invariants or sprite snapshots. `source/card_geometry.json` holds only the twelve current local card outlines and coverage measurements; the build derives their UVs and colour averages from the final layout and base. The mat's cached sprite mean is refreshed, while every other sprite entry retains exactly the same values, including rubble's inset patch UVs. `layout.json` is byte-identical to the incoming file.

Source cleanup removed `round1_invariants.json`, `sprites_round1.json`, both session notes, unused generated save-path notes and the unused `run7_original.png`. The old mat source was replaced by the selected shade edit; all **14 generated originals used by the build** remain at full resolution, including `run7_v2_original.png`. Exact prompts remain. Dependencies moved to the atlas-level `requirements.txt`. There was no README in the incoming source folder, so [source/README.md](source/README.md) now documents every retained input, the final material contract and the rebuild/check commands. Every remaining non-documentation file in `source/` is read by the build or the check.

Final verification: `python3 build_atlas.py` and `python3 check_atlas.py` pass; **35/35 outputs reproduce byte for byte** in the isolated build. Separate temporary baseline comparisons found **zero changed pixels outside the mat in all four layers**, including transparent texels. Full alpha and all non-mat sprite values are unchanged. These one-time preservation measurements are recorded in [checks/mat_change_review.json](checks/mat_change_review.json); the final checker has no dependency on that record or on any prior atlas. Disposable corruption tests confirm that a single changed pixel and a wrongly sized layer fail validation, and that the corrupt delivered file is left untouched: [checks/validator_failure_checks.json](checks/validator_failure_checks.json).

Refreshed all standard review images. Visual inspection of the comparison, seam closeup, opposing-light band and 256-pixel background previews shows a recessed dark tangle with subdued veins, black-green inter-leaf depth and no visible vertical join. The bright foreground cutouts and exposed rubble remain visually identical. This is an atlas-level review; the rebuilt card-and-clump vine has not been rendered in the game here.

The final isolated rebuild took 4.05 seconds. Work from temporary baseline capture through final verification took approximately 8.4 minutes, including the image edit, build/check rewrite, cleanup and visual review.
