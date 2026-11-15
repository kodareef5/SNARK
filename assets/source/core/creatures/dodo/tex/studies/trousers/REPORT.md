# Trousers study — round 3

Revised the tile to restore soft volume, expose recognizable feathers and remove its regular row rhythm. **The accepted `trousers_fringe` set is unchanged:** all five PNGs, its complete metadata, and all accepted individual source layers match their round-2 SHA-256 hashes. The generated originals are unchanged too. No new generation was needed.

The tile now shows rounded vanes and locks above softer underlying feathers. Light from opposite sides changes which sides of those locks catch light; soft occlusion remains beneath their overhangs. The existing fine drawing is still in the base. At the 200-pixel bird size, the earlier repeated arrow rows have become an uneven downward fall.

## What changed

The foreground has 92 irregular placements instead of a staggered grid. Three independent underlying beds contain 125 feathers each. Positions are sampled on a torus with a minimum separation, without rows or columns. Length, width, direction, mirroring and volume vary; source selection avoids the nearest existing placement's original. Angles range up to 32 degrees either side of downward, and each specimen remains 60–90 mm long with a 33–49 mm wide placement. Upper feathers overlap the roots below them. Bare stem ends fade into the underlying plumage over the first 9% of a specimen, leaving the shaft inside its upper vane visible.

The deepest continuous layer is reconstructed from the originals using the round-2 placement recipe. Its contribution is small, but it ensures that every opening reveals real feather drawing. There is no blank ground beneath the new placements. All twelve approved specimens are reused, without changing their source colour, alpha, shaft or accepted fringe relief.

Tile-specific volume follows a gently rounded cross-section of the actual vane and free locks. It combines that broad volume with the preserved fine strand relief and source-following lock rounding. The height blend softens the overlap across about a millimetre; the colour keeps the fine strand coverage. Underlying beds are lower and flatter than the visible fall. The delivered height uses 0.598–3.176 mm, rather than round 2's 0.511–0.755 mm. Its height standard deviation is 0.555 mm, versus 0.020 mm before. This gives volume across the field, rather than merely stretching a few extreme pixels.

Occlusion is computed from the delivered height using eight directions and six radii, approximately 0.6–15 mm. Its mean is now 0.898, versus 0.993 before. The shadows are broad hollows between the layers; fine tips do not sit on hard extruded walls.

After rearrangement, a broad illumination bias became measurable against the fuller geometry. A correction restricted to fields blurred over 18 pixels (3.75 mm) removes it. No fine normal modes are fitted away, and no AO is put into the base. Fine-barb contrast after this correction is 0.999958 of the composed source drawing, with correlation 0.999979. The accepted individual base layers remain untouched.

## Pictures and reuse

| Set | Resolution and span | Behaviour | Height encoding | Region 0 mean, linear |
| --- | --- | --- | --- | --- |
| `trousers` | 2048 × 2048; 0.427 m; 4796 px/m | Opaque; wraps both ways; tips down | **4 mm** full normalized range | 0.500002 |
| `trousers_fringe` | 2048 × 2048; 0.341 m; 6006 px/m | Accepted twelve-element RGBA sheet; cut at 0.5 | **2 mm**, unchanged | 0.500003 |

Read each set's own `height_mm` in `study.json`; the tile and fringe now use different encodings. Every base pixel remains neutral. The tile's mean sRGB byte is 187.065; its linear mean is the required 0.50.

| Picture | Production this round |
| --- | --- |
| `trousers_base.png` | Script-computed placement of the unchanged generated feather drawing over a continuous feather bed. Broad illumination/mean correction only. RGB8, sRGB; no occlusion baked in. |
| `trousers_height.png` | Script-computed rounded vane/lock volume and fine barb relief, with soft layered overlap. Grayscale16 linear; 4 mm full range. |
| `trousers_normal.png` | Script-computed from that exported uint16 height at 0.427 m using wrapped central differences. RGB8 linear, OpenGL green-up. |
| `trousers_packed.png` | Script-computed height occlusion in R, preserved dry vane/shaft roughness in G, zero metalness in B. RGB8 linear. |
| `trousers_regions.png` | Script-computed pure red, region 0, everywhere. RGB8 categorical. |
| `trousers_fringe_base.png` | Unchanged accepted RGBA8 source-derived drawing, wispy alpha and extended neutral gutter colour. |
| `trousers_fringe_height.png` | Unchanged accepted grayscale16 relief, 2 mm encoding and flat matching 24-pixel borders. |
| `trousers_fringe_normal.png` | Unchanged accepted RGB8 OpenGL normal computed from the sheet's exported height. |
| `trousers_fringe_packed.png` | Unchanged accepted RGB8 occlusion, matte roughness and zero metalness. |
| `trousers_fringe_regions.png` | Unchanged accepted pure region-0 red, including transparent gutters. |

`source/generated_a.png`, `source/generated_b.png` and `source/generated_c.png` retain the three immutable generated RGBA sheets, with their corresponding `source/prompt_*.txt` files. `build.py` prepares all twelve specimens from those originals, writing `source/elements.json` and the aligned `source/feather_*` layers. It also regenerates the deepest feather bed in `source/underlay/`, preserving its accepted 8-bit colour/roughness and 16-bit height quantization before compositing the upper layers.

The new `source/tile_volume/` keeps a separate height, rooted alpha and volume/blend NPZ for each of the twelve tile feathers. Its `elements.json` records the layer paths and height formula. Reuse these for fuller opaque plumage; use the original accepted layers for fringe cards. The source colour and shaft are shared. `source/layout.json` records all positions and per-placement parameters. `source/tile_layers.npz` keeps the assembled linear colour, physical height in millimetres and roughness before export. `source/build_config.json` supplies study metadata, original-sheet hashes, all ten accepted PNG hashes and the accepted fringe metadata.

Run from any directory:

```sh
python3 /path/to/trousers/build.py
python3 /path/to/trousers/check.py
```

The build regenerates both sets from the original sheets and verifies every delivered PNG against the accepted SHA-256 hashes. It needs no saved output, per-feather cache or earlier-round picture. `--scale 0.9 --direction 90` changes tile feather dimensions and rotates the field clockwise; square repeats support quarter-turn rotations. Variants retain the accepted sheet. Individual source placement supports arbitrary angles through `sample_element`. `check.py --output-dir /path/to/preview-folder` can write new checks without replacing the retained review pictures.

## Checks and visual review

The final `check.py` run passed for both sets. It independently checks exported PNG sizes, bit depths, colour, quarter means, lighting correlation, physical normals, region colours, metalness, seams, cut-out reductions, coordinates and fringe preservation.

| Tile measurement | Result |
| --- | --- |
| Maximum base RGB channel spread | 0 |
| Relative spread of four quarter means | 0.000894% |
| Largest absolute base/normal or base/light correlation tested | 0.000688 |
| Normal/height correlation X, Y | 0.999863, 0.999755 |
| Maximum independent normal byte error | 1 |
| Maximum normal unit-length error | 0.005907 |
| RMS lateral normal component | 0.1706, versus 0.0526 in round 2 |
| Largest wrap jump / interior neighbour jump | 0.9720 |
| AO minimum / mean / maximum | 0.659 / 0.898 / 1.000 |
| Roughness range | 0.871–0.922 |
| Metalness and regions | Zero metalness; red only |

Independent padded boundary neighbourhoods match exactly one period apart. The accepted fringe retains its 0.99295 wrapped vertical normal agreement, matching borders, and all twelve elements at 512 and 128. Its PNG and source-layer hashes all match.

Reviewed `checks/tile_volume_review.png` at the same crop size: round-2 and round-3 unlit, upper-left light and lower-right light. Rounded locks and the hollow behind their lower halves now change with the light. `tile_relief_isolated.png` separates the new relief and AO from the feather colour for inspection. `tile_small_repeat.png` compares two-by-two repeats at 131 pixels per tile, the material span for a 200-pixel bird: the regular arrow rows are gone.

Also reviewed the full slate tile, half offsets, full two-by-two repeat, physical 200/50-pixel bird previews, the concept lower-flank comparison at 1500 px/m, and the neighbouring body study at the same span. Slate, hot pink, lime, near-black and near-white were checked under three directions. The close fall retains shafts, vanes and soft parted locks; near-white shows the rounded overlap, while near-black retains the larger locks without relying on a painted light direction. At 50 pixels, the material settles toward an even region colour. The fringe comparisons remain the accepted round-2 result.

## Limits

The generated family is more finely divided than the concept's broad rounded lower-body vanes; the revised tile makes individual feathers clearer without replacing that accepted family. The final painter should mix its sources progressively with body feathers and use the accepted cards to break the actual belly outline. This flat study does not prove the final UV placement or creature silhouette. Height and occlusion are authored estimates, and these diffuse previews do not simulate transmission through down. A large repeat can reveal the twelve source shapes; subpixel barbs still simplify at distance.

Round 3 began 2026-11-14 22:01:31 UTC. This report was written at 22:15:49 UTC, about 14.3 minutes later; final preview inspection followed. The original round-3 build took 121.80 seconds. Work stayed inside this study's folder.

Final preview inspection finished at 22:16:25 UTC, approximately 14.9 minutes after the start. The final checks and preservation verification passed.

## Files

The build reads `source/generated_a.png`, `source/generated_b.png` and `source/generated_c.png`, preserved with their matching `prompt_a.txt`, `prompt_b.txt` and `prompt_c.txt`. Its only other persistent input is `source/build_config.json`; all per-feather layers, underlay and placement fields are regenerated. Earlier rounds and unused files are archived in ignored `superseded/`. Existing `checks/` files are unchanged.

With all outputs and derived layers removed, the clean rebuild reproduced **all ten delivered PNGs byte for byte (SHA-256)** in 93.76 seconds. All set metadata and 72 per-feather PNGs also matched. Reads from `superseded/` were blocked; none were attempted. Both sets passed `check.py`, with new check output directed into `superseded/cleanup_validation/`.
