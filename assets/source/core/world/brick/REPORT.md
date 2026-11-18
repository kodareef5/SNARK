# Weathered Miami brick

The 1.92 m tile contains 192 stretchers in 24 courses of eight. The exported base averages **sRGB (160, 112, 85)**. In the 16-bit height map, the median brick interior stands **4.77 mm** above the median recessed mortar. Reversing the low sun moves the bright rim across the joint and leaves the firing colour in place.

## The maps

All six maps share a 2048 × 2048 grid at 0.9375 mm per texel. The wall, its mortar and its aggregate are dielectric.

| File | Construction and check |
| --- | --- |
| [base.png](base.png) | Each brick combines independently positioned crops from three generated fired-clay samples. I removed broad value changes from two sandy samples and used colour-channel ratios from the flakier sample to isolate its mineral colours. Small variations in firing, exposed grog and occasional salt in pores sit over the clay. Mortar has a separate sand-and-binder colour field. The material edges use the same coverage as the tint map. Mean interior colours are (162, 105, 75) for clay and (150, 145, 135) for mortar. This RGB PNG carries an sRGB tag. |
| [height.png](height.png) | Modelled in millimetres from 230 × 70 mm faces on a 240 × 80 mm pitch. Rounded edges, clipped corners and small individual chips descend into the raked mortar. Shallow folds, irregular pits and protruding pieces of fired clay and sand supply the fine relief. The binder has its own erosion and grain heights. The 16-bit export reaches both 0 and 65535. Its median interior levels are 8.78 mm for clay and 4.01 mm for mortar. |
| [normal.png](normal.png) | Wrapped central differences of the saved height, using the physical texel spacing. The upward image axis is positive green. An independent calculation from the reloaded PNG matched every channel within one 8-bit step. |
| [roughness.png](roughness.png) | Fired skin, roughened folds, pore interiors and mineral grains have slightly different finishes. Clay spans 0.851–0.949 and averages 0.900 in the interior. The sandy mortar averages 0.950. |
| [occlusion.png](occlusion.png) | Sampled the height horizon in sixteen directions out to about 16 mm and integrated the blocked portion of the hemisphere above each local surface. Dark marks collect under chipped edges, inside pores and along joint sides. Brick interiors average 248 out of 255. |
| [tint.png](tint.png) | The ceramic footprint supplies 255 on brick and 0 on mortar. A narrow antialiased transition follows the broken edges. The area-weighted brick coverage is 82.76%. |
| [material.json](material.json) | Records the 1.92 m width, 12 mm height span, measured mean colour and module `[0.125, 0.0833333]`. The laying grid advances 240 mm along a course and 160 mm between matching courses, with a 120 mm stagger on alternate courses. |

## Inspection sheets

| Sheet | What I checked and saw |
| --- | --- |
| [Half-tile offset](checks/offset.png) | Wrapped base, height and roughness by 1024 pixels on each axis. Clay grain, bed joints and mortar texture continue through the centre of each panel. The average base-colour step across the wraps was 5.6–5.7 code values, within the ordinary neighbouring-pixel variation. |
| [Full-size 3 × 3](checks/tiled3.png) | Upper square is base colour, lower square is a greyscale display of height. Each square is 6144 × 6144. The courses carry across the joins. The chips read individually up close and I could not pick out a recurring chip or salt patch at wall scale. |
| [Distant 12 × 12](checks/tiled12.png) | Filtered the periodic colour in linear light to 2048 × 2048. An earlier pass grouped several pale faces. I rebalanced firing tones across neighbouring bricks and courses. The final sheet retains the narrow mortar lines without a conspicuous tile-sized block or diagonal stripe. All sixteen quarter-width patches average within 1.05 sRGB code values of the target in each channel. |
| [Opposing and high sun](checks/relit.png) | Multiplied linear base colour by diffuse illumination, including height-field visibility toward each sun. The first two panels use opposite 15° lights and the last uses 70°. At 15° the joint floor falls into shade beside the sunward brick. At 70° the floor opens up and the salt and sandy specks remain visible. |
| [Aligned layer crop](checks/layers.png) | Six native-size views of the same 500 × 430 pixels. The small bites from the brick edges coincide in the colour mask, height shoulder, normal, roughness transition and cavity map. |

I also counted the joints in the exported tint mask. Every mid-course sample crosses eight head joints. The tile has 24 bed joints. Median sampled joint width is 10.31 mm. Local edge wear moves the measured head-joint centres by up to 1.59 mm from the nominal grid.

## Remaining limitation

The palest salt flecks and the smallest pieces of exposed sand are difficult to distinguish under the high sun. At this texel size both can occupy a single pixel. Their contrast stays low enough that they disappear from the distant sheet. I checked diffuse relief in the relighting sheets. The wet specular response still needs an in-game view.

<details>
<summary>Generated pigment sources and original prompts</summary>

The built-in image generator produced three 1254 × 1254 colour samples. Each was filtered before sampling. The 2048 master combines different face-sized crops with grains, chips, mortar and pore shapes built at the final resolution.

1. Use case: photorealistic-natural. Create a square, edge-to-edge 2D diffuse colour scan of the FACE MATERIAL of a weathered ordinary unglazed red-brown sandstock clay brick. One completely continuous field of fired clay skin, no block outlines, mortar, gaps or joints. At this scale the frame represents about 550 mm of material. Dense very fine naturally irregular grog and sand grains, soft-edged iron-fired pigment flecks, subtle small clusters of pale exposed sand and pressed folded clay, occasional short wispy mineral lamination, friable surface. Dry and matte. Restrained soft irregularity and finely resolved ceramic colour, realistic material identity. Orthographic flat albedo under perfectly omnidirectional cross-polarised lighting, no raking light, no directional texture or shadow, no specular, no macro patches, big cracks, no dramatic feature, no watermark. Uniform muted terracotta body colour from edge to edge. This is a source of fine pigment information for a PBR brick wall material.

2. Use case: photorealistic-natural. Produce a perfectly flat PBR intrinsic pigment atlas of old sand-moulded fired earth brick skin. One continuous field, square image, full bleed with no border, no individual bricks, divisions or mortar. An orthographic conservation scan filled with a close-up of the streaky earthy body, dull lightly abraded warm buff-red sandy clay. Very fine close-grained matrix interrupted by irregular floury flecks, subdued tiny tan chamotte inclusions, subtle curled wisps of pressed clay, fine soft grain clusters and softly mottled terra rossa. The whole square should represent about 700 mm of material. Everything is evenly lit by a diffuse integrating sphere so the colour is readable without shadows or highlights. No black pits, no crack network, no big veins, no large discolouration, no vignetting. Authentic granular, lightly weathered masonry. Avoid arrangements, pattern, drawn marks, photographic angle, or text.

3. Orthographic macro materials scan, perfectly square. Fill the entire image with the weathered red-brown granular pressed clay of an old common brick, no edges or joints visible. At this magnification the square is roughly 260 mm across. Authentic variegated dry ceramic body with a little pale straw-coloured grog and thin folded russet clay laminations; some of the old fired crust is abraded away exposing duller coarsely mixed, flaky clay underneath, short scrapes of lighter buff sand trapped in the folds. Unglamorous, subtle ordinary fabric, gritty broken short striae and small angular flecks, avoid round pebbles, concrete, or any prominent crack. Uniform flat cross-polarised albedo illumination, no direction, no bright highlights, no side light, no shadowed depressions. No objects, text, frame, borders, gradients or mortar.

</details>

## Round two

I halved the difference between each of the 192 brick face colours and the average clay colour. The darkest-to-palest span in mean face brightness fell from 22.96 to 11.48 sRGB code values. Short stretches of bed and head joint now carry darker dirt, with trapped fines and exposed sand picking out a few existing eroded pockets. The revised mortar averages (146, 141, 131) and the whole tile averages **(160, 112, 85)**.

In the 3 × 3 sheet, the darkest and palest bricks are harder to track between repeats. The 12 × 12 field still shows the courses, and the 40 × 40 field settles into an even red-brown. I also checked the half-offset, aligned layers and native-size low- and high-sun crops. The chipped edges and face grain still read at close range. File hashes confirm the original relief, roughness, tint and bond metadata. [3 × 3](checks/tiled3.png) · [40 × 40](checks/tiled40.png) · [Relighting](checks/relit.png)
