# Mission terracotta

The 2 m square contains four cap-and-pan pairs across and six courses down. The cap noses flare as they approach the lower edge. The pan noses sit about 5 cm uphill, so the two laps cast separate shadows. All six maps were constructed on the same 2048 × 2048 grid, at 0.977 mm per texel.

## Material files

| File | Construction and check |
| --- | --- |
| [base.png](base.png) | Each of the 48 faces combines two independently sampled crops of flat-lit, image-generated terracotta. The firing colour changes along the face. Bleaching favours the cap crowns, with discontinuous brown deposits in the pans and just below the laps. Pale core follows the chips in the existing lip geometry. The exported sRGB image averages **(163, 114, 83)** to the nearest code value. |
| [height.png](height.png) | Convex tapered caps sit above concave pans. Each face rises towards its rounded lower lip, then steps down onto the next course. Small bites remove material from selected lips. Shallow forming marks, pits and grains add millimetre-scale relief. The 16-bit grayscale export reaches both 0 and 65,535 across a 60 mm span. |
| [normal.png](normal.png) | Wrapped central differences of the exported height use the physical texel spacing. Red points right and green points towards the top of the image. Recomputing and encoding the vectors from the saved PNG reproduced every RGB byte. |
| [roughness.png](roughness.png) | The worn crowns run smoother than the sheltered silt, exposed cores and lichen. Fine ceramic grain and the local wear masks share the base map’s coordinates. The linear grayscale map ranges from 204 to 230, with a median of 215, or 0.843. |
| [occlusion.png](occlusion.png) | Eight directions sample nearby relief out to 15 mm. Opposing horizon angles cancel on a flat incline and rise beside an obstruction. The darkening follows the pockets, cap margins and undersides of the laps. The mean is 251.9 and the median is 255. |
| [tint.png](tint.png) | The same coverage masks used to paint lichen and pale chipped cores remove palette colour there. Edges retain fractional coverage. Fully tintable clay occupies 99.59% of the image. At the lichen patch in the layer sheet, the holes between lobes expose tintable clay. |
| [material.json](material.json) | Records the two-metre repeat, 60 mm relief, rounded mean sRGB and the laying module of one pair by one course. The placement functions repeat at exactly one quarter of the width and one sixth of the height. |

## Inspection sheets

| Sheet | Method and observation |
| --- | --- |
| [offset.png](checks/offset.png) | Base, height and roughness shifted 1,024 texels on each axis with wrap. Clay grain and course profiles continue through the centre cross. The mean base-colour step across the original left/right border is 0.982 times the nearby step. Across the top/bottom border it is 1.002 times the nearby step. |
| [tiled3.png](checks/tiled3.png) | Two full-resolution 3 × 3 fields, base on the left and height on the right. The height carries a continuous roofing pattern. I could follow the rows but found no isolated chip or grey patch that picked out the two-metre boundary. |
| [tiled12.png](checks/tiled12.png) | Twelve repeats per axis averaged in linear light to a 2,048 px square. The longer pale firing marks initially formed a visible motif. Reducing their broad value swings kept the grain and shorter streaks legible. At twelve repeats the field shows fine mottling across an even warm background. |
| [relit.png](checks/relit.png) | Base reflectance lit in linear light with diffuse fill and height-field shadows. The two opposing 15° suns move the bright flank across each cap and change the lap shadows. At 70° those shadows draw up to the lips. The grey flecks stay fixed in all three views. |
| [layers.png](checks/layers.png) | The same 416 px crop in all six maps. A small bite in the cap lip registers in colour, relief and tint. The branched grey colony at lower right registers in colour, roughness and tint. |
| [crop.png](checks/crop.png) | A 640 × 640 texel crop at native scale in unlit colour, 15° sun and 70° sun. The iron grains, worn slip and small colonies stay attached to the clay as the shadows move. |
| [tiled40.png](checks/tiled40.png) | Forty repeats per axis, averaged in linear light to 1,024 px. The firing marks resolve into a warm roof plane. I could find no continuous light or dark column. |

## Round two

Four 1,254 px square sources were generated straight on under diffuse overcast light. Three supplied the fired clay. The fourth supplied 32 crust fragments placed in 15 groups. The clay crops are downsampled into the master with their fine grain intact. The broad column-average brightness span is 1.38 sRGB code values after smoothing across 22 texels. [Source prompts](.r2/prompts.txt)

After the restart, all six maps and the metadata were written from one build. The saved height, recomputed OpenGL normal and recomputed occlusion match the accepted files byte for byte. The inspection sheets use that build’s PNGs.

## Remaining limitation

Under the high sun the course spacing still looks quite orderly for an abandoned roof. The age reads most clearly at arm’s length, in the exposed lip cores and broken lichen crusts. At street distance the shape of the caps does most of the work.
