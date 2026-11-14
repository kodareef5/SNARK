# Wood: the poles, sticks and cut ends of the thatch building tier

You are making one material for a survival game in which players build bases out of square pieces by the thousand. This is the wood of the cheapest tier: the first shelter a player builds, of bundled reed thatch lashed to a frame of hand-cut poles. Every post, rail, rod, joist, door frame and foundation log of the tier wears this one material. It is seen from arm's length (a door jamb beside the player's face) to across a valley.

Work only in the current folder. Take as long as the job needs, and keep going until you would ship it.

## What the wood is

Young trunks and branches cut in the forest with a stone or iron axe the same afternoon, a few months out in the sun and rain. Not timber, not planks, nothing sawn or planed:

- **Bark in patches.** Some poles keep most of their bark: thin, rough, brown-grey bark with small fissures, lenticels and a few pale lichen flecks. Others were stripped with an axe or by hand, so the pale wood shows in long uneven strips between ragged islands of bark.
- **Peeled wood** is warm cream to honey where fresh, greying toward silver where the weather reaches it, with long fibres, shallow drying checks running along the grain, darker stains around knots.
- **Knots and branch scars**: round or oval, some cut flush with an axe, some a short broken stub's base, with the grain swirling round them.
- **Axe work**: shallow scalloped facets where a branch or a bump was trimmed.
- Colour warm and natural: brown bark, honey and cream wood, grey weathering. Nothing orange, red, or green beyond the odd lichen fleck. It sits beside golden straw and should look good with it.

## Layout, which the geometry depends on

One picture of **2048 by 2048** pixels covers **1.5 m by 1.5 m** (about 0.73 mm a pixel). The horizontal direction of the picture runs **along** a pole and must tile left to right. The vertical direction goes **round** the pole. The picture is a trim sheet of five horizontal bands, from the top row down:

| Band | Rows | Holds | Used on |
|---|---|---|---|
| 1 | 0 to 614 | bark-on pole surface: mostly bark, a few stripped patches | thick posts and foundation logs, 10 to 15 cm across |
| 2 | 614 to 1126 | half-peeled pole: pale wood in long strips, islands of bark | posts, jambs, lintels, joists, 8 to 12 cm across |
| 3 | 1126 to 1434 | thin sticks and rods with bark, finer texture, a few small knots | rods and door frames, 3 to 7 cm across |
| 4 | 1434 to 1782 | split and axe-hewn flat face: a pole split along its length, rough fibres, a few axe facets | split poles laid flat, hewn faces |
| 5 | 1782 to 2048 | six cut ends of poles in a row, each a disc filling its square: end grain with rings, a pith, radial drying cracks, a thin bark rim, axe-cut ends a little rough and facetted | the cut ends of every pole |

Each of bands 1 to 4 tiles left to right on its own. Within a band, vary along its length so that a pole 3 m long does not show its 1.5 m repeat. The top and bottom edges of a band are where a pole's seam is, so let each band wrap top to bottom on itself as well, or at least meet itself without a hard line. Band 5's discs are not tiled: lay them out on a regular grid of 6 squares, each disc centred in its square, and say exactly where in your report.

## What to deliver, all 2048 by 2048 and pixel-aligned

1. `wood_base.png`: base colour, sRGB, 8-bit RGB. Flat and unlit: no baked light, shadow, highlight or ambient occlusion beyond the real colour of the bark and wood.
2. `wood_height.png`: 16-bit greyscale height, white is high. Local relief only, since the geometry is already round: the bark's thickness and fissures, the checks, the axe facets, the rings and cracks of the end grain. Say how many millimetres the full range stands for.
3. `wood_normal.png`: tangent-space normal map, **OpenGL convention** (green points to the top of the picture), computed from the delivered height at the physical scale above, wrapping where the bands wrap.
4. `wood_orm.png`: one packed picture, linear, 8-bit RGB: red ambient occlusion (bark fissures, checks, cracks), green roughness (bark rough, about 0.8 to 0.95; worn wood a little smoother), blue metalness, 0 everywhere.

Keep the generated source pictures at full size in `source/`, and the scripts that build every layer (`build_material.py`) and check them (`check_material.py`) in this folder.

## What excellent looks like

The example to beat is the wood plank wall in `../../../../../../../planning/artist-test/wood/` (start with `checks/layers.jpg`, then `checks/tilings.jpg`, `checks/relighting.jpg` and `REPORT.md`): a complete, aligned, tileable set with its own build and check scripts. Beat it.

A first attempt at this material, in `../pole/`, was grey-brown, even and anonymous: it read as generic wood, not as poles cut by hand. Do better: these poles should look picked one by one from the forest edge, with character, and be a pleasure to see up close.

- The 2048 holds real detail at full size, not a blurred enlargement. The image tool returns about 1254 pixels a side; reach 2048 by composing generated elements in a larger master, adding fine detail by script, or both.
- No visible seam when tiled, no motif the eye picks out in a 3 by 3 tiling of each band.
- The layers agree. Relight the normal and occlusion from two or three directions and check that bark stands proud and checks cut in.
- Preview it the way it will be seen: wrap each band round cylinders of the sizes above, lit by a low sun, and look.

## Checks to leave in `checks/`

A contact sheet of the four layers; each band tiled 3 across; a half-offset with wrap-around; a relit preview from at least two light directions; the cylinder preview; a 1:1 crop; and a JSON of your measurements (wrap seams against interior differences, normal against height agreement).

## Report

Finish with `REPORT.md`: for each file, how it was made (generated, edited, or computed by script), the band layout exactly as delivered, the disc grid of band 5, the metres per tile and millimetres of the height range, which checks you ran and what you saw, how long it took, and anything you are not satisfied with.

Do not use or imitate pictures from any existing game, and do not search for or download reference images: work from these words.
