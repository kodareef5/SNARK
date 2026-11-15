# Body study — final adjustment and repository tidy

The accepted plain plumage is unchanged in all five PNGs. The seven barred card elements and `body_barred` now retain longer generated pale barb ends, with substantially less tip relief. The nine plain card cells also remain unchanged in all five maps.

## What changed

The accepted generated atlas already contains the grey-to-ivory transition along individual barbs. The final build restores the distal drawing from the previous 0.75 length factor to 1.15, while preserving full feather length and applying the same transform to every source channel. The colour separation retains the less saturated pale strands in that transition. It does not draw a crescent or an offset edge around the feather.

The pale region has no height offset. Height is a gentle vane with small shaft relief; fine luminance contrast is attenuated where the generated pigment changes to ivory, and the former edge-value boost is removed. Both regions remain neutral and independently centred at 0.50 linear. The pure red/yellow IDs resolve the generated strands at 2048; their interleaved edge softens under the game's filtering.

The barred tile's pale coverage is 22.70%, up from 14.17%. Dividing pale area by twelve rows gives an equivalent band depth of 8.08 mm, versus 5.04 mm before. This is a visible-area measurement, not a claim that every individual strand is exactly that long. The checker records unoccluded source depth separately; that older source-only metric had overstated how deep the previous rendered band looked.

## Delivered sets and checks

| Set | Span | Encoding | Mean grey, linear | Normal/height correlation, x / y |
|---|---|---|---|---|
| `body_plain` | 0.427 m | 2048, 4 mm height | region 0: 0.500002 | 0.999603 / 0.999591 |
| `body_barred` | 0.427 m | 2048, 4 mm height | region 0: 0.500000, region 5: 0.500002 | 0.999249 / 0.997363 |
| `body_tips` | 0.341 m | 2048, 4 mm height | region 0: 0.500023, region 5: 0.499703 | 0.999579 / 0.999456 |

Height is 16-bit; normals are OpenGL and derived from the delivered quantized height. Packed channels are restrained fine AO, matte roughness, and zero metalness. Card gutters return to a common flat height with quiet normals and extended neutral colour. Each of the sixteen barred sources retains its untouched crop, physically resampled crop, cut-out, height, shaft, free edge, distance field and strand regions; plain sources are rebuilt from their accepted original.

`check.py` passes dimensions, neutrality, regional and quadrant means, light correlation, physical normal agreement, pure regions, seam steps, periodic neighbourhoods, source alignment, card gutters, unchanged plain maps and unchanged plain card cells. Full-sized relighting, hot pink, near-black, near-white, small-size and half-offset previews are in `checks/`. The latest concept-scale comparison remains [round3_bars_comparison.png](checks/round3_bars_comparison.png); the historical filename is retained for the review link.

The selected image-tool original and its recorded prompt are reused; no new generation was necessary for this adjustment. The generated terminal tufts are still coarser than the concept's finest strands. The final study comparison is a material swatch, while the actual model and game-renderer review live in `../../paint/body/checks/`. The final clean build took about 72 seconds on this machine, including regeneration of the accepted plain sources.

## Files

The accepted build reads two untouched generated originals: `source/generated_atlas_round2.png` with `source/prompt_round2.txt`, and `source/generated_barred_atlas_round5_beards.png` with `source/prompt_round5_beards.txt`. `plain_sources.py` is the retained recipe for the accepted plain maps and card cells; `barred_sources.py` derives the final barred elements. `source/plain_manifest.json` verifies the frozen plain maps. The supplied concept crop and matching coordinates remain for `check.py`.

Superseded originals, prompts, maps, scripts, reports and trial data were moved to `superseded/`. All delivered maps and derived element fields were removed before a clean rebuild. All fifteen delivered PNGs then matched their accepted pre-tidy SHA-256 hashes byte for byte. Nothing in `superseded/` is read by the build. The rebuild proof is `checks/tidy_rebuild.json`; working layers are regenerated where the build writes them.
