# Coconut palm frond material

Four pixel-aligned **2048 × 2048** maps, authored for the supplied 5.0 m × 1.9 m slots. Slot 0 is mature green, slot 1 is older olive/yellow with brown damage, and slot 2 is dry cinnamon, grey and straw. The straight midribs occupy the guide's exact columns; each reaches the top and bottom row. The bare proximal stalk is 0.85 m. The three fronds contain 170, 171 and 180 surviving leaflets respectively, in a single rank on each side.

## Files and construction

| File | Construction and interpretation |
| --- | --- |
| `coconut_frond_base.png` | 8-bit **RGBA**, embedded sRGB profile, straight alpha. Painted leaflet interiors are remapped onto individually curved, tapered straps at the guide's physical scale. Whole-leaflet pigment variation, longitudinal fibres, veins, uneven senescence, brown tips, split ends and ragged breaks are composed at 2× resolution, then coverage is resolved to 2048. The stalk has a pale longitudinal stripe. No directional lighting, specular highlight or cast shadow is added to the base. Every transparent pixel contains the nearest opaque leaflet's RGB **within its own slot**, including the outer margins. |
| `coconut_frond_height.png` | **16-bit grayscale**, white high, linear data. Full black-to-white range is **8.0 mm**. Geometry supplies each leaflet's shallow folded cross-section, rounded shoulders and narrow raised vein. Subtle longitudinal fibres add small relief; the pale dead rachis has fine longitudinal cracks. The rachis rises to about 7.5 mm. This is local surface relief, separate from the card's large arch and V fold. Colour spots are not interpreted as deep holes. Transparent height is extended from the nearest surface and gently smoothed farther from the cutout. |
| `coconut_frond_normal.png` | 8-bit RGB linear data, **OpenGL tangent space**: +X image-right, +Y image-up, +Z outward. Computed only after reloading the delivered quantized height PNG. Uses 359.298245614 pixels/metre across and 409.6 pixels/metre along, with central differences and one-sided differences at image borders. Thus the anisotropic texture scale is included. |
| `coconut_frond_orm.png` | 8-bit RGB linear data. **R:** authored cavity AO near leaflet attachments and overlapping margins; open leaf faces approach 1. **G:** mature waxy foliage around 0.50, older foliage around 0.64 with rougher damaged tips, dead foliage around 0.85. **B:** zero everywhere. All fields use the same leaflet geometry and coverage as base and height. |

The base's small changes across the crease are pigment variation. The stronger lit/shaded halves come from the normal map under lighting, so light can reverse cleanly. Both sides can use the same texture; a foliage shader should handle back-face normals and transmission consistently.

## Source and rebuild

`source/generated_leaflets.png` is the unmodified **1254 × 1254 RGBA** source returned by the built-in image tool. It contains nine separate painted leaflets: three mature, three older and three dead. Its exact prompt is in `source/generation_prompt.txt`. No external reference images, existing-game images, web search, downloaded art or fallback image API were used. I inspected this repository's `palm_parts.png`, `coconut_lineup.png`, `grove_near.png`, `DESIGN.md`, the supplied layout and the wood material contact sheet.

`source/rectified_leaflet_swatches.png` is a derived sampling library, not a claim of a native 2K source. The builder uses opaque source interiors, excludes the source's unreliable edge colours, removes broad transverse illumination bias, and targets the design's sRGB colours. The generated source alpha remains preserved in the original source PNG; final atlas silhouettes are explicitly authored to satisfy the layout and scale.

`source/leaflet_placement.json` records every surviving leaflet's root, length, width, angle, source choice and damage flags. `source/build_metadata.json` records scale, seed, height range, counts and the source hash. Local 2K fibres, creases and silhouette detail are authored by script; the deliverables are not simply enlarged copies of a 1254 image.

Rebuild from this folder with Python 3, NumPy, SciPy and Pillow:

```sh
python3 build_material.py
python3 check_material.py
```

The source PNG, prompt and guide are frozen inputs. Neither script makes network calls. Both locate their inputs relative to their own file. The builder has a fixed seed. The checker independently calculates normals from the saved height and writes review images plus `checks/metrics.json`; failures raise assertions.

## Review and changes

The first assembly retained strong coverage but made the older frond uniformly yellow. I restored coherent olive patches, distinguished grey dead leaflets from cinnamon and straw ones, and changed damaged ends from simply shorter points to actual ragged breaks. I also corrected colour/coverage handling at antialiased boundaries, strengthened the shallow leaflet creases and removed detached subpixel fragments. The geometry itself remains inside the 12-pixel margins; it is checked rather than trimmed against those margins.

I inspected the native-resolution detail crops, complete atlas, guide overlay, alpha silhouette, reduced images and opposing-light previews. The mature frond reads as a dense green comb; the older one keeps its structure while showing uneven age and missing teeth. The dead frond is narrower and more open, with twisted strips and blunt/split ends. The unlit base remains deliberately restrained; gloss and crease shading belong to the material response.

## Checks left in `checks/`

- `layers.jpg`: four-layer contact sheet, with the shared cutout applied for display.
- `base_over_layout.png`: base over the supplied guide.
- `alpha_margins.png`: alpha in white on black, orange safe-margin lines and blue midrib guides.
- `mip_1024_*`, `mip_512_*`, `mip_256_*`, `mip_128_*`: exact-size reductions over mid-grey and pale blue sky, all cut at alpha 0.5. `mips_grey.jpg` and `mips_sky.jpg` collect these at native display sizes.
- `lit_upper_left.png`, `lit_lower_right.png`, `relighting.jpg`: the three fronds under two opposing directions, using the delivered normals and ORM. These are diagnostic previews rather than an engine render.
- `detail.jpg`: native-pixel crops of each age across all four maps.
- `metrics.json`: formats, profiles, hashes, margin violations, connected components, hidden RGB dilation, stalk checks, height/roughness ranges, reductions and independent normal agreement.
- `review_v01.jpg`: the first assembly, retained to show the colour/damage revision. Final review artifacts use the unversioned names above.

Reduction measurements use box/area filtering and the literal **0.5 cutoff**, without alpha-coverage preservation or per-mip sharpening. RGB is filtered in linear light from the delivered dilated colours. “Frond area” is the sum of the full-resolution leftmost-to-rightmost opaque span on every row, including the stalk; it is not the whole mostly-empty rectangular slot. `metrics.json` also records rectangular-slot occupancy and retention relative to the original opaque pixel count. At small sizes some gaps close as tips disappear, so retained opaque area can slightly exceed 100%.

Final checks: **PASS**. All primary PNGs have the required dimensions, channels and bit depths. Only the base carries an sRGB profile. Metalness is zero throughout.

| Check | Result |
| --- | --- |
| Nonzero alpha in forbidden slot margins | **0 pixels** |
| Connected alpha shapes | One per slot, both before and after the 0.5 cutoff; no detached fragments |
| Transparent RGB versus nearest visible colour | Maximum error **0/255**, all three slots |
| Foot, tip and bare stalk | Present at the required rows; no outlying leaflet pixels in the checked bare-stalk region |
| Normal versus delivered height, visible pixels | Mean **0.173°**, 99th percentile **0.298°**, maximum **0.363°** |

Coverage of each frond’s full-resolution row envelope after alpha cutoff:

| Texture height | Mature | Older | Dead |
| --- | ---: | ---: | ---: |
| 2048 px | 78.1% | 78.0% | 53.8% |
| 1024 px | 78.2% | 78.1% | 54.0% |
| 512 px | 78.6% | 78.6% | 54.1% |
| 256 px | 79.6% | 79.9% | 54.4% |
| 128 px | 81.0% | 81.8% | 54.9% |

At 256 px, retained opaque area relative to each original cutout is **101.9%**, **102.5%**, **101.0%** respectively. All three keep majority coverage, including the intentionally sparse dead frond.

| Slot | Mean roughness | Visible roughness range | Mean AO |
| --- | ---: | ---: | ---: |
| 0 | 0.506 | 0.447–0.600 | 0.979 |
| 1 | 0.638 | 0.580–0.804 | 0.979 |
| 2 | 0.852 | 0.792–0.906 | 0.975 |

## Shipping notes and remaining limits

Use sRGB decoding **only for the base**. Import height, normal and ORM as linear data, keep the OpenGL green channel convention, and use alpha cutoff 0.5. The atlas is not a repeating tile. Use the slot coordinates in `guide/LAYOUT.json` and keep the intended 5 m × 1.9 m material scale. A row-trimmed, arched V-folded card supplies the large frond form; the texture does not bake that arch into a curved midrib.

I would ship this texture set. The remaining uncertainty is its final appearance under the game's compression, foliage transmission, mesh deformation and distant crown LODs, which were not available for an in-engine test. At 128 px the smallest distal teeth necessarily merge or disappear, while the main comb and stalk survive; the more open dead frond is the most sensitive. AO and roughness are authored plausible values, not measured or ray-traced data. A single card cannot give each leaflet independent three-dimensional twisting, and the nine painted source leaflets are reused with varied mapping and geometry. These limitations are visible and documented rather than hidden by a baked lighting pass.
