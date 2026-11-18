# Crushed limestone and granite

This tile covers 1.5 × 1.5 m. The gravel bed contains 19,075 stones in the 8–20 mm grade, 889 in the 25–35 mm grade, and smaller chippings worked into the gaps. The coarse pieces gather in short, loose drifts. All six maps use the same 2048 × 2048 texel grid.

## Material maps

| File | How it was made |
| --- | --- |
| [base.png](base.png) | I traced interiors of stone faces in three flat-lit image-tool gravel photographs, removed broad illumination slopes, and fitted different crops and rotations to each modelled chip. A fourth generated photograph supplied grey screenings for the gaps and a light dusting on broken rims. The transfer used four samples per texel. The 8-bit RGB file carries an sRGB tag and the four source prompts. |
| [height.png](height.png) | Stones with irregular plan outlines, inclined fracture faces, chipped edges, and fine surface pits overlap a granular dust bed. At each sample I took the uppermost surface. I averaged the four sample heights and mapped the total relief to 0–65535 in 16-bit greyscale. Black to white represents 30 mm. |
| [normal.png](normal.png) | I took centred differences of the encoded height with wraparound, using the 0.7324 mm texel pitch. The unit normals use OpenGL tangent space, with positive green toward the top of the image. An independent calculation from the delivered height agreed in every 8-bit channel. |
| [roughness.png](roughness.png) | I assigned roughness by the exposed mineral, then varied it locally with the transferred grain and dust coverage. The grey granite breaks sit toward the smoother end and the powder is roughest. Linear values span 217–242, or 0.851–0.949. |
| [occlusion.png](occlusion.png) | I measured the local horizon in 16 directions out to 17.6 mm, accounting for the surface slope and reducing the contribution of distant obstructions. Stone crowns stay open and the strongest occlusion sits in narrow contacts. |
| [tint.png](tint.png) | Exposed stone contributes 80 and dust contributes 255. Intermediate values record the fraction of each material within an edge texel. By coverage, the exposed surface is 74.6% stone and 25.4% fines. Fully tintable dust averages sRGB (118, 115, 110). |
| [material.json](material.json) | Records the physical size, relief, and measured mean sRGB rounded to **[146, 131, 113]**. Random packing gives the tile a null module. All constituents are dielectric. |

## Checks

| Sheet | What I checked and saw |
| --- | --- |
| [offset.png](checks/offset.png) | I shifted base colour, height, and roughness by 1024 texels on both axes. Stone edges and dust channels continue across the old corners at the centre of each panel. |
| [tiled3.png](checks/tiled3.png) | Each half contains nine native-size copies, colour on the left and height on the right. Individual coarse pieces resolve up close. Across the sheet, the mix stays even without a conspicuous outlier or boundary. |
| [tiled12.png](checks/tiled12.png) | This is an 18 m square reduced to 2048 pixels by area averaging in linear light. The little colour differences merge into a pale warm surface. I could see fine grain but no grid or diagonal band. |
| [relit.png](checks/relit.png) | I multiplied linear-light base colour by diffuse illumination and constant ambient fill. The 15° suns from WNW and ESE exchange the bright and dark flanks of the chips. The 70° sun picks out the broad upper faces. |
| [layers.png](checks/layers.png) | All six panels show the same 448 × 448 native-pixel crop. The grey powder between the chips follows the high-tint mask. The normal turns at the same broken edges that define the height and narrow occlusion pockets. |

At the horizontal and vertical wraps, a one-texel step measured 1.05 and 1.04 times the average interior colour change, respectively. Mean luma across 256 × 256 blocks ranged from 132.3 to 133.9 on the 8-bit scale.

## Close-range limitation

A few broad limestone fracture planes are especially regular under grazing light. The real comparison bed is cooler overall. The in-game wetness response and texture filtering are untested.

## Round two

I replaced the single-colour look of the chips with photographic limestone grain, quartz, and feldspar from 55 sampled faces. I reduced the orange-brown fraction and let grey powder interrupt portions of the stone edges. After the restart I rebuilt all six maps from one packing of stones and dust. The rebuilt 16-bit height, OpenGL normal, occlusion, and tint each matched the approved first-round map at every pixel.

Both columns of the close comparison span 32.8 cm. The game crop is 1:1. The right column uses a real 1K gravel scan, enlarged from 168 pixels to cover the same width. The bottom row gives both surfaces the same 15° sun. The game mix reads warmer and slightly coarser in this comparison. At 12 × 12 and 40 × 40 repeats, the pale chips merge into an even apron. [Close comparison](checks/comparison.png) · [40 × 40 field](checks/tiled40.png) ·
