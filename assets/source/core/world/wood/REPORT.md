# Silvered timber

The repeat covers a 2 m square. Thirteen courses give a pitch of 153.85 mm. The long edges have narrow, worn lips, with fine lifted fibres on the faces and occasional pin knots. Seven small empty nail sockets interrupt the grain near board ends.

## Round two

The board faces now come from four generated, straight-on panoramas of overcast decking. Each is 2,172 px wide, enough to cut a continuous 2,048 px face from each selected timber. A fifth close-up supplies small knot eyes and traces of rust around empty nail sockets. In the first trial, joining shorter samples changed the grain direction mid-board. Full-length cuts removed those joins. The arm’s-length sheet shows three locations in flat colour and under three sun directions. [Native-size crops](checks/arm-length.png)

## Map construction

[make_wood.py](make_wood.py) lays thirteen distinct source strips into the 2 m square at a texel pitch of 0.9766 mm. It follows the edges in each panorama, trims away the photographed gaps and fits the strips to the accepted board outlines. One short feathered cut closes the through-running timber. All five photographic sources were made with the built-in image generation tool. [Sources and prompts](sources/prompts.txt)

| File | Construction |
| --- | --- |
| [base.png](base.png) | An 8-bit RGB map with an embedded sRGB profile. The photographed fibre colour is balanced per specimen. Broad exposure drift and residual directional contrast across the ridges are reduced. The end fibres darken over several millimetres, and each plank takes a small warm or cool seasoning offset. A constant RGB correction sets the tile mean. |
| [height.png](height.png) | Local colour ratios identify the outlines of pale fibre bundles against warmer worn wood. Elongated footprints receive a rounded cross-section based on their width. Fibre thickness, erosion and board cup are modelled separately. Tapering drying checks follow the local grain direction and have distinct lips and floors. Knots and nail sockets have their own profiles. The full 16-bit span represents 10 mm. |
| [normal.png](normal.png) | Wrapped central differences of the quantized height at the physical texel pitch. The normalized vector is proportional to `(-dh/dx, +dh/drow, 1)`, with image rows increasing downwards. RGB stores the OpenGL tangent-space vector in 8 bits per component. |
| [roughness.png](roughness.png) | Raised cellulose and frayed latewood use a rougher finish. Worn channels are smoother. Fine broken fibres, check lips and empty sockets add local roughness variation. |
| [occlusion.png](occlusion.png) | Local horizon occlusion from the height in eight directions, sampled out to 12 texels along each direction. A 0.13 mm tolerance leaves shallow open fibre relief bright. |
| [tint.png](tint.png) | The board outlines provide antialiased coverage. Sound wood, knots and grain checks take the tint. The joint floor and the centres of empty nail sockets retain their colour. |
| [material.json](material.json) | Records the 2 m repeat, 10 mm height span, requested shift and the rounded RGB mean measured from the exported tile. |

The sockets contain exposed fibre, dirt and old iron oxide. The faint rust bleed affects pigment only. The material has no exposed metal.

## Laying pattern and its limit

Butt joints lie at either the wrap or the midpoint of the tile. Twelve courses alternate those two positions. One board runs through the repeat so the odd course count does not force a pair of directly stacked ends. The specified module `[0.5, 0.0769231]` preserves the course grid. Where the through-running board is involved, a shift by that module cannot superimpose every butt joint. An exact two-course stagger cannot close after thirteen courses.

## Inspection

| Picture | Reading the sheet | Observations |
| --- | --- | --- |
| [offset.png](checks/offset.png) | Base colour, height and roughness, each rolled 1,024 texels along both axes. Height previews use the high eight bits. | The board that crosses the upper edge continues through the middle of the offset. Fibre direction and surface density carry across. The vertical cuts at the old edge stop at their own course boundaries. |
| [tiled3.png](checks/tiled3.png) | Two full-resolution 6,144 px squares, base colour on the left and height on the right. | The stagger is easiest to see in height. In colour the end cuts are quieter, and the small knots and nail sockets recede among the fibres. I could still trace the repeat by following the series of butt joints. |
| [tiled12.png](checks/tiled12.png) | A 24 m square of decking, area-filtered in linear light to 2,048 px. | Fine horizontal courses remain visible. The field reads as one grey-brown surface, with no conspicuous knot, bright fleck or diagonal band. |
| [relit.png](checks/relit.png) | Left and centre use opposite suns at 15° elevation. The right uses 70°. Each multiplies linear base colour by diffuse light plus constant ambient. | At low sun the bright rim changes sides at the butt and the raised grain. At high sun the faces flatten and their silvered colour shows through. |
| [layers.png](checks/layers.png) | The same 320 × 320 px crop in all six maps, at native scale. | The butt, the two horizontal gaps and the nail socket line up. Tint covers the faces right up to their chipped edges. Occlusion is strongest inside the gaps. |
| [tiled40.png](checks/tiled40.png) | An 80 m square, area-filtered in linear light to 2,048 px. | At thumbnail size, the boards merge into the mean grey-brown. |
| [arm-length.png](checks/arm-length.png) | Three 320 × 204 px crops at one texel per pixel. Each row shows the same wood in base colour, at opposite 15° sun angles and at 70°. | The softer channels and broken edges of the raised fibres are easiest to compare between the two low suns. |

## Readback of the final build

All six maps, the material settings and the seven check sheets were written together. I reopened each PNG and checked its format and dimensions. The saved tint matches the accepted board and socket coverage pixel for pixel. A slice at x = 512 crosses thirteen gaps.

| Measurement | Result |
| --- | --- |
| Mean base colour, rounded to 8-bit sRGB | **(93, 86, 77)** |
| Green-channel means over 256 × 256 px blocks | 84.27–87.82 |
| Height endpoints over the 10 mm span | 0 and 65,535 |
| Linear roughness, range and mean | 0.800–0.949, mean 0.858 |
| Mean roughness on the highest and lowest fifths of solid wood | 0.884 and 0.834 |
| Median occlusion on fully tinted wood and in fully untinted recesses | 253 and 149 out of 255 |
| Maximum normal error against the independently differentiated saved height | 0.387° |
| Maximum error against a separate calculation of occlusion from saved height | One 8-bit level |

The repeated butt joints remain the easiest way to trace the tile on the three-by-three sheet. At forty repeats the individual splits and knot eyes disappear.
