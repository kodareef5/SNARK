# Door: the picture of a thatch door

You are painting part of the cheapest building tier of a survival game, in which players build bases out of square pieces. This tier is the first shelter a player builds: long reed thatch on a frame of hand-cut poles. This picture covers the **door**: 1.4 m wide, 2.31 m tall, a light panel of reeds carried on its own frame of thin poles, hung on cord loops in a doorway. Players open and shut it all day from arm's length, so it is looked at closely.

Work only in the current folder. Take as long as it needs and keep going until you would ship it.

## What it looks like

The design is set. Open the concept pictures in `../../ref/concept/`: `house_hero.png` and `house_high.png` show it open, `piece_door.png` (if it exists) both faces, and `DESIGN.md` if it exists. The door is a tight panel of straight reeds standing vertically side by side, packed in small bundles and cut fairly evenly at top and bottom, held by a frame of thin poles on its outside face: two stiles, three rails and a diagonal brace, lashed at every crossing with pale cord. It is neater than the walls, as a thing carried and swung should be, but still made by hand: bundles of slightly different thickness and tone, the odd reed out of line, short ragged ends.

## This is painted to a model

The door's shape is built, and this picture must land on it. `guide/layout.png` (2048 pixels square, covering exactly what your picture covers) and `guide/LAYOUT.json` give the layout:

- One picture covers **3 m by 3 m** (1.46 mm a pixel). The **outside face** of the door is drawn on its left half and the **inside face** on its right half, each 1.4 m wide and 2.31 m tall, upright, standing 0.3 m above the bottom edge of the picture. `layout.png` shows each reed bundle in its own colour. On the outside face, brown shows where the frame's poles lie on the reeds; the poles themselves are geometry, so paint the reeds under them, a little pressed and shadowed along their edges.
- Reeds run up and down. The top and bottom ends of the reeds are drawn **cut out**: the base colour has an alpha channel, 1 on reeds and 0 elsewhere, so the door's top and bottom edges are real, slightly ragged reed ends, staying inside the coloured shapes in `layout.png`. Everywhere outside the two faces alpha is 0, but paint a plausible reed colour there too, since filtering reaches a little way in.
- The inside face has no frame. Show the reeds' other side, with a couple of thin battens or a twined cord row across it where they are tied, and the shadowed side of the bundles.

## What to deliver, all 2048 by 2048 and pixel-aligned

1. `door_base.png`: base colour, sRGB, 8-bit **RGBA** as above. Flat and unlit. Straw gold, a little lighter and more even than the walls, with sun-bleached outer reeds.
2. `door_height.png`: 16-bit greyscale height, white high, local relief only: reeds, bundles, cord rows. Say how many millimetres the range is.
3. `door_normal.png`: tangent-space, **OpenGL convention** (green toward the top of the picture), computed from the delivered height.
4. `door_orm.png`: linear 8-bit RGB: red occlusion, green roughness (0.7 to 0.95), blue metalness 0.

Keep the generated source pictures at full size in `source/`, and the scripts that build every layer (`build_material.py`) and check them (`check_material.py`) in this folder.

## What excellent looks like

The concept pictures are the bar, and the example of a complete layer set to beat is the wood plank wall in `../../../../../../../planning/art-trial/wood/` (start with `checks/layers.jpg`). Individual reeds a few pixels wide with their own light and dark, real ends, bundles that differ. The image tool returns about 1254 pixels a side; reach 2048 by composing generated elements in a larger master laid out on the guide, and by adding fine detail by script. Check it composited over the guide, and relit from two directions with the alpha cut out over a dark background.

## Checks to leave in `checks/`

A contact sheet of the four layers; the base over `layout.png`; the alpha over a dark background; a relit preview; a 1:1 crop; a JSON of your measurements.

## Report

Finish with `REPORT.md`: for each file, how it was made, which checks you ran and what you saw, the millimetres of the height range, how long it took, and anything you are not satisfied with.

Do not use or imitate pictures from any existing game, and do not search for or download reference images. The concept pictures in this repository are ours: use them freely.
