# Roof: the picture of a thatch ceiling

You are painting part of the cheapest building tier of a survival game, in which players build bases out of square pieces by the thousand. This tier is the first shelter a player builds: long reed thatch on a frame of hand-cut poles. This picture covers the **ceiling** piece: a flat slab 3 m square and 25 cm thick, laid edge to edge with others to make the flat roof of a house, whose top is also the floor of a storey above. It is seen from above (from a hill, from the storey above, by a flying player), and its underside is the ceiling seen from inside. Thousands of square metres of it may be on screen.

Work only in the current folder. Take as long as it needs and keep going until you would ship it.

## What it looks like

The design is set. Open the concept pictures in `../../ref/concept/`, above all `house_high.png` (the roof from above), then `house_hero.png`, `direction_a_inside.png` (the underside) and `DESIGN.md` if it exists. The top of each ceiling is a compressed mattress of long reeds all laid one way, combed flat and packed, held down by thin binding cords or split rods running across the reeds every 25 cm or so, stitched through at intervals. Each 3 m panel reads as a panel: where two panels butt, there is a slightly darker, rougher seam. The eaves (the shaggy fringe hanging over the walls) are not in this picture: they wear the wall's picture.

## The layout, which the geometry depends on

- One picture of 2048 by 2048 pixels covers one ceiling: 3 m by 3 m, 1.46 mm a pixel. Its left and right edges meet, and its top and bottom edges meet, since ceilings lie side by side both ways.
- **The reeds run up and down the picture.** Their ends are cut roughly square where each course of reeds begins.
- The geometry lays the top in **courses half a metre wide**: each course is a row of reeds whose butt ends begin on a line across the picture, about a centimetre higher than where the next course covers it. The course lines are at **rows 171, 512, 853, 1195, 1536 and 1877** (counting from the top row 0), each course running from its line **up** the picture to the next. So on each of those rows, a line of cut reed butts faces down the picture, with the course above lying over the tips of the course below. Put a binding across the reeds on each course line and another halfway between, so bindings fall every 256 pixels or so, a little irregular.
- The panel seam lies along all four edges of the picture: within the outer 15 to 30 pixels the reeds are a little more tousled and shadowed, so that four ceilings together show the cross of their joints, as `house_high.png` does.
- The same picture is seen from below as the underside of the roof, between joists that run across the reeds. It needs nothing special for that.

## What to deliver, all 2048 by 2048 and pixel-aligned

1. `roof_base.png`: base colour, sRGB, 8-bit RGB. Flat and unlit. Golden straw, a little more weathered and sun-bleached than the walls, since it faces the sky; nothing green or orange.
2. `roof_height.png`: 16-bit greyscale height, white high, local relief only (reeds, bindings, butts). Say how many millimetres the full range is.
3. `roof_normal.png`: tangent-space, **OpenGL convention** (green toward the top of the picture), computed from the delivered height, wrapping both ways.
4. `roof_orm.png`: linear 8-bit RGB: red occlusion, green roughness (dry reed, 0.7 to 0.95), blue metalness 0.

Keep the generated source pictures at full size in `source/`, and the scripts that build every layer (`build_material.py`) and check them (`check_material.py`) in this folder.

## What excellent looks like

The concept pictures are the bar. The example of a complete layer set to beat is the wood plank wall in `../../../../../../../planning/artist-test/wood/` (start with `checks/layers.jpg`). A first attempt at this tier was sent back because its flat roof wore the wall's picture and looked like a pattern printed on a box; this must look made as a roof, from reeds laid and bound by hand.

- Real detail at full size: individual reeds a few pixels wide, their butts, the bindings' twist. The image tool returns about 1254 pixels a side; reach 2048 by composing generated elements in a larger master and adding fine detail by script.
- No visible seam when tiled, and no motif the eye finds in a 3 by 3 tiling beyond the intended panel seams.
- Check it as it will be seen: tile it 2 by 2 as a roof and light it with a low sun from two directions.

## Checks to leave in `checks/`

A contact sheet of the four layers; a 3 by 3 tiling; a half-offset with wrap-around; a relit preview from two light directions; a 1:1 crop; and a JSON of your measurements (wrap seams against interior differences, normal against height agreement, base colour mean).

## Report

Finish with `REPORT.md`: for each file, how it was made, the rows where you put the course lines and bindings, the millimetres of the height range, which checks you ran and what you saw, how long it took, and anything you are not satisfied with.

Do not use or imitate pictures from any existing game, and do not search for or download reference images. The concept pictures in this repository are ours: use them freely.
