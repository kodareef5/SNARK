# Painted sand-float stucco

The tile covers 2.5 × 2.5 m. At arm’s length the sand tooth breaks up the light and a few torn edges stand proud of the paint. At street distance the finish settles to a warm white. Its measured mean is sRGB **(197.43, 192.46, 182.74)**. Exposed cement averages **(182, 180, 175)** and occupies **0.10%** of the surface by coverage.

## Maps

| File | Construction |
| --- | --- |
| `base.png` | Sixteen native 608² crops from four ImageGen paint studies provide the pigment and chalk. I removed broad exposure drift, used channel ratios for pigment and local grain density for chalk, then blended the crops across staggered, wrapped overlaps. Two further close-ups supply the cement samples and flake contours. The 8-bit RGB PNG carries an sRGB tag. |
| `height.png` | I rasterized 703,000 individual grains and 104,200 small voids at 4096² and integrated their footprints down to the master grid. The previous grain bed, float marks and hairline fissures carry through. Each traced flake perimeter defines a break in the film. Film thickness, distance to that break and partial edge lift set the relief there. Earlier paint sits at an intermediate depth. The 16-bit map spans 0–65535 over 3 mm. |
| `normal.png` | Wrapped central differences of the quantized height at 1.2207 mm per texel give the tangent-space slopes. The normal points away from rising relief. Red increases toward image right and green toward the top. |
| `roughness.png` | Chalking increases paint roughness and wear smooths the high points. The exposed sand and binder use a rougher response. Median linear roughness is about 0.80 on paint and 0.925 on render. |
| `occlusion.png` | Eight short horizon searches measure obstruction above the local tangent plane. Their reach is at most 14 mm. The median is 254/255 and the darkest values sit underneath flake edges and inside small voids. |
| `tint.png` | Both coats and thin paint on grain tips accept the building colour. Cement in the 18 openings keeps its own grey. Intermediate values measure partial pixel coverage at the edges. |
| `material.json` | Stores the physical width, relief range and measured mean of the exported base. The module is null for this freehand finish. All constituents are dielectric. |
| `build_material.py` | Rebuilds the maps and proof sheets using the plates in `sources/`, a fixed seed, wrapped filters and periodic placement. Run with `python3 build_material.py` from this folder. |

## Inspection

| Sheet | What I checked and saw |
| --- | --- |
| [Half-tile offset](checks/offset.png) | I moved base, height and roughness by 1024 pixels along both axes. The old borders pass through the middle of each panel with continuous tooth and tone. Mean absolute height steps across the two joins were 0.079 and 0.087 mm, compared with 0.086 mm inside the tile. |
| [Nine repeats at native resolution](checks/tiled3.png) | Base occupies the upper half and height the lower half. The fine grain crosses each boundary. The upper field reads as warm paint, with occasional pale flake openings. |
| [Twelve repeats per axis](checks/tiled12.png) | This is a 30 m square, area-averaged in linear light to 2048². The palest grey openings become faint pinpoints. I saw no square boundaries, bands or broad colour patches in the field. |
| [Opposing and high sun](checks/relit.png) | The upper row shows the whole tile and the lower row enlarges the same 39 cm patch under each light. Sand shoulders and flake lips switch bright sides between the two 15° views. Under the 70° sun, the grey of the exposed render persists. All three use linear-light diffuse shading with the same ambient fill. |
| [Aligned layers](checks/layers.png) | The same 320 × 320 source pixels appear in every panel. At the larger chip below centre, the grey break in the paint matches the tint opening and rough render. The rim and depression are visible in height and normal. |
| [Forty repeats per axis](checks/tiled40.png) | A 100 m square reduced to 2048² reads as the mean paint colour. |
| [Same-scale comparison](checks/comparison.png) | Both columns cover 62.5 cm. The left is a native 1:1 game crop. The right uses a 320-pixel crop from an independent 2 m material sample, resized to match physical width and given the same mean paint colour. Both lower panels use the same 15° light and sky fill. The sample is a CC0 stucco scan. |

I checked the dimensions and PNG channel encodings of all six maps. An independent double-precision calculation from the saved height reproduced every RGB sample in the normal map. Across 256-pixel square blocks, the mean base colour varied by less than one sRGB code per channel.

The hairline crazing is the least legible detail. A texel spans 1.22 mm, so most fissures share a pixel with intact paint. They are easiest to see at a grazing angle. Their diffuse contrast stays low to preserve the even colour of a distant wall.

## Round two

I replaced the two-tone centimetre-scale wear with softly varying photographic chalk and grain-sized pigment. On intact paint, red-channel contrast at roughly 1–3 cm fell by 79% in a band-pass measurement against the first version. At matched scale, the revised finish has a slightly finer, sharper tooth under the raking sun than the independent stucco reference. The reference documents physical width. Its camera distance is unrecorded.

The 2.5 m tile now contains 18 individual flake openings, 1.3–5.3 cm across, or 2.88 per square metre. Each uses a different source contour. Seven show a partial celadon or cream earlier coat. The revised lips turn with the light, and the cement floors stay pale grey. The six source plates and exact built-in ImageGen prompts are saved together. [Source prompts](sources/prompts.txt)
