# Miami beach sand

Dry buff quartz with sparse cream, grey and pale pink shell chips. The 2.5 m tile has a texel pitch of 1.221 mm. Its measured mean colour rounds to sRGB **(205, 182, 156)**.

## Material files

| File | Construction and checks |
| --- | --- |
| `base.png` | Three flat-lit ImageGen sand sources supply the mineral colour. I reduced them to matching grain scales, removed broad colour drift and quilted 1,024 irregular patches across both wrap boundaries. A fourth source supplied the face colours and outlines of 100 shell chips. The 8-bit RGB PNG carries an sRGB tag and the four source prompts in its metadata. |
| `height.png` | The original 51–96 mm wind crests and deposits support the revised bed. I modelled small convex crowns inside individual light, dark and amber grain footprints. Each shell cutout received a separate tilted, bevelled face and an independently chosen exposure height. The middle 90% of samples span 1.58–3.60 mm. The 16-bit map uses both endpoints of its 0–6 mm range. |
| `normal.png` | I reopened the exported height, took centred differences across wrapped neighbours at the physical texel pitch, and normalised the vectors. Red points right and green points towards the top of the image. The result is 8-bit RGB. |
| `roughness.png` | The original dry-bed roughness carries the variation in packing. Resolved mineral grains and shell faces receive a smoother finish using their registered footprints. The linear 8-bit map ranges from 231 to 253 and averages 245.51. |
| `occlusion.png` | I measured the surrounding horizon in eight directions at seven distances out to 31 mm, relative to each texel’s tangent plane. Small pockets between grains carry most of the darkening. The map averages 251.32 out of 255. Across 64 × 64 texel blocks the means run from 250.79 to 251.76. |
| `tint.png` | The entire sand mixture takes the lot colour. All 4,194,304 samples equal 255. Quartz and shell are dielectric, so the set has no metal map. |
| `material.json` | Records the 2.5 m tile width, 6 mm height range, null laying module and rounded mean measured from the exported base. |

All six map headers were checked for 2048 × 2048 dimensions, channel count and bit depth. An independent reconstruction from the exported height matched every 8-bit normal component. The maximum angular error after quantisation was 0.370°.

## Inspection sheets

| Sheet | What I checked and saw |
| --- | --- |
| `checks/offset.png` | Base colour, height and roughness each wrap by 1024 texels in both directions. I also inspected the crossing at native scale. Grain density, height and tone continue across the centre. Boundary-to-neighbour RMS step ratios for those three maps fall between 0.91 and 1.03 on both axes. |
| `checks/tiled3.png` | Each panel contains nine native-resolution tiles. The first height proof had conspicuous groups of parallel crests. I interrupted and partly buried those groups. In the revised sheet, the short runs dissolve into irregular deposits and the base has no shell or dark patch that draws the eye to a repeat. |
| `checks/tiled12.png` | A 30 m square reduced to 2048 × 2048 by averaging each 12 × 12 footprint in linear light. The colour reads as pale buff throughout. I saw no grid, diagonal bands or isolated bright flecks. |
| `checks/tiled40.png` | A 100 m square reduced to 2048 × 2048 by averaging 40 × 40 texels per sample in linear light. The flecks merge into a steady buff colour across the field. |
| `checks/relit.png` | Opposing 15° suns and a 70° sun use the exported normal and linearised base colour. Each has diffuse fill and matched exposure on a flat surface. The bright side of a crest reverses under the two low suns. Under the high sun, the crests recede and the mineral colours remain. |
| `checks/layers.png` | The six columns show the same 39.1 cm square. The lower row enlarges its central 9.8 cm fourfold. Small pale chips line up with local relief and smoother roughness. The height crests leave the base colour free of stripes. |

## Round two

At 1:1, the mineral grains now read as cream, buff, pale grey and occasional darker flecks. The 1–4 mm shell fragments occupy about 1.05% of the tile. Their raised faces use the same cutouts as their colour and roughness. After smoothing over 8 texels, the RMS difference from the original height is 0.0013 mm. The 12 × 12 and 40 × 40 sheets both settle to an even pale shore.

`checks/comparison.png` puts both rounds beside a CC0 coastal sand scan. Each crop covers 54.7 cm. The game crops are 1:1. The 1K scan is resampled to the same ground scale using its published physical width. Its camera height is undocumented. The top row shows flat colour, and the bottom row lights all four panels with the same 15° sun. Two reference columns show the scan’s original colour and a global exposure and white-balance match. The revised grains are clearer than round one. The reference contains coarser dark grains and has stronger local relief.

## Remaining limitation

At this texel pitch the smallest shell chips occupy less than one texel. Their colour survives as a fleck, but only the coarser chips retain much of their fractured outline. The lighting and distance checks use the supplied maps offline. The game’s texture filtering and palette multiplication may change their final contrast.
