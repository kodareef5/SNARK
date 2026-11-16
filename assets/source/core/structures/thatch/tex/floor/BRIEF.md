# Floor and earth: the pictures of a thatch foundation

You are painting part of the cheapest building tier of a survival game, in which players build bases out of square pieces by the thousand. This tier is the first shelter a player builds: long reed thatch on a frame of hand-cut poles. This job is the **foundation**: a platform 3 m square and 37.5 cm tall, laid edge to edge with others as the floor of a house. Its sides are a crib of round logs with packed earth showing between them; its top is the floor the player walks on. You make two materials: `floor` (the top) in this folder and `earth` (the sides) in `../earth/`.

Work only in this folder and `../earth/`. Take as long as it needs and keep going until you would ship it.

## What it looks like

The design is set. Open the concept pictures in `../../ref/concept/`: `house_hero.png` and `house_high.png` (the floor seen through the door and the crib round the base), `direction_a_inside.png` (the floor from inside), `piece_foundation.png` and `DESIGN.md` if they exist.

- **The floor** is reed matting laid over the platform: long reeds laid side by side, flattened by feet, bound into mats with rows of twined cord running across them, the mats butting at seams, a little loose straw here and there. Golden, a little darker and more worn than the walls where people walk. It is a floor: no tall loose tufts, nothing that would read as a hole.
- **The earth** is the packed fill of the crib, seen between the logs: tamped earth and clay, warm mid brown, with small stones, roots, flecks of straw, a few dry cracks and crumbled edges.

## The layout

- `floor`: one picture of 2048 by 2048 covers one foundation's top, **3 m by 3 m** (1.46 mm a pixel), tiling both ways since floors lie side by side. Reeds run **left to right** across the picture. Make three mats a tile, each 1 m wide, with seams along rows 683 and 1365 and along the picture's top and bottom edges (where two foundations meet), and cord rows across the reeds every 25 to 30 cm, a little irregular. The left and right edges of the picture meet the next foundation's, so let the reeds run on across them.
- `earth`: one picture of 2048 by 2048 covers **1.5 m by 1.5 m** (0.73 mm a pixel), tiling both ways. Horizontal in the picture is along the foundation's side, vertical is up. It is only seen in bands about 10 to 20 cm tall between logs, so spend detail at that scale.

## Deliver, all 2048 by 2048 and pixel-aligned, for each of `floor` (here) and `earth` (in `../earth/`)

1. `<name>_base.png`: base colour, sRGB, 8-bit RGB. Flat and unlit.
2. `<name>_height.png`: 16-bit greyscale height, white high, local relief only. Say how many millimetres the range is.
3. `<name>_normal.png`: tangent-space, **OpenGL convention** (green toward the top of the picture), computed from the delivered height, wrapping both ways.
4. `<name>_orm.png`: linear 8-bit RGB: red occlusion, green roughness, blue metalness 0.

Keep the generated source pictures at full size in `source/` of each folder, and the scripts that build every layer (`build_material.py`) and check them (`check_material.py`) beside them, with a `REPORT.md` in each folder.

## What excellent looks like

The concept pictures are the bar. The example of a complete layer set to beat is the wood plank wall in `../../../../../../../planning/art-trial/wood/` (start with `checks/layers.jpg`). Real detail at full size, not a blurred enlargement: the image tool returns about 1254 pixels a side, so reach 2048 by composing generated elements in a larger master and adding fine detail by script. No visible seam when tiled, no motif the eye finds in a 3 by 3 tiling beyond the intended mat seams. Check each tiled 3 by 3 and relit from two directions.

## Checks to leave in `checks/` of each folder

A contact sheet of the four layers; a 3 by 3 tiling; a half-offset with wrap-around; a relit preview; a 1:1 crop; a JSON of your measurements (wrap seams against interior differences, normal against height agreement, base colour mean).

## Report

Finish with a `REPORT.md` in each folder: for each file, how it was made, the layout as delivered, the millimetres of the height range, which checks you ran and what you saw, how long it took, and anything you are not satisfied with.

Do not use or imitate pictures from any existing game, and do not search for or download reference images. The concept pictures in this repository are ours: use them freely.
