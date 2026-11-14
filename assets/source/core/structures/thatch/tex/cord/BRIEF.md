# Cord: the lashing material of the first building tier

You are making one tiling material for a survival game in which players build bases out of square pieces (foundations, walls, doorways, ceilings) by the thousand. The cheapest tier is bundled reed thatch lashed to a frame of poles: light, uneven, quick to put up, and it should look it, and still be a pleasure to look at. Nothing in it is nailed: every joint is lashed. This material is the lashing, the bands of cord wound round a pole where it meets another, round the corners of every foundation, the ends of every rail and the hinges of every door. The lashings are small, but they are what tells a player how the thing is held together.

Work only in the current folder. Take as long as the job needs.

## What it shows

Many tight, side-by-side turns of hand-twisted plant-fibre cord, as they lie wound round a pole, unrolled flat.

- The cord is two-ply, twisted from grass and bark fibre, about 8 to 10 mm thick. Each turn shows the diagonal twist of its two plies, with fine fibres along each ply and a few loose fibre ends sticking out.
- The turns run **down the columns** of the picture (top to bottom is round the pole), lying side by side across the picture (left to right is along the pole). They are not machine-perfect: spacing and thickness vary a little, some turns sit slightly higher or press into their neighbours, and here and there a turn crosses over at a slight angle, as hand lashing does.
- Colour: dry fibre, a mid olive-brown to tan, darker than the straw and the wood it binds, with lighter and darker plies so the twist reads. Nothing saturated. The mean colour of the base colour should be close to sRGB (118, 96, 64).

## The layout

- One tile covers **1.5 m by 1.5 m** at **2048 by 2048 pixels** (about 0.73 mm a pixel), the same scale as the other materials of this tier, so cord sits beside wood and straw with the same detail.
- Seamless in both directions. A lashing uses a small patch of the picture (a band 3 to 10 cm wide and as tall as the pole's girth), and different lashings take different patches, so any patch should look like good lashing on its own.

## What to deliver, all 2048 by 2048 and pixel-aligned (the same turn in the same place in every layer)

1. `cord_base.png`: base colour, sRGB, 8-bit RGB. Flat and unlit: no baked light, no cast shadow, no highlights, no occlusion darkening beyond the fibre's real colour.
2. `cord_height.png`: 16-bit greyscale height, white is high: each turn round in section, the twist of the plies, the grooves between turns. Say in your report how many millimetres the full range stands for (about 6 to 10 mm is right).
3. `cord_normal.png`: tangent-space normal map, **OpenGL convention** (green points to the top of the picture), computed from the delivered height with wrap-around at the physical scale above, so it agrees with the height.
4. `cord_orm.png`: one packed picture, linear, 8-bit RGB: **red** ambient occlusion (the grooves between turns and between plies), **green** roughness (about 0.8 to 0.95), **blue** metalness (0 everywhere).

Keep the generated source pictures at full size in `source/`, and the scripts that build every layer (`build_material.py`) and check them (`check_material.py`) in this folder, so the whole thing can be rebuilt.

## What excellent looks like

The example to beat is the wood plank wall in the repository's `planning/artist-test/wood/`, which from this folder is `../../../../../../../planning/artist-test/wood/` (start with `checks/layers.jpg`, then `checks/tilings.jpg`, `checks/relighting.jpg` and `REPORT.md`; the pictures attached show it). It is a complete, aligned, tileable set with its own build and check scripts. Beat it: this should look like real hand-twisted cord at arm's length and hold up at full size.

- The 2048 must hold real detail at full size: crisp plies and fibres, not a blurred enlargement of a smaller picture. The image tool returns about 1254 pixels a side whatever is asked; reach 2048 by composing generated elements in a larger master, by adding fine detail by script, or both.
- It tiles in both directions with no visible seam: check a half-offset with wrap-around and a 3 by 3 tiling, and fix what you see.
- The layers agree: overlay or set them side by side and look. Relight the normal and occlusion from two or three directions and check that the turns read as round and the grooves as cut in.

## Checks to leave in `checks/`

A contact sheet of the four layers; the base colour tiled 3 by 3; the half-offset of each layer; a relit preview from at least two light directions; a 1:1 crop of the 2048 base colour and normal; and a JSON of your measurements (wrap seam against interior differences, normal against height agreement, base colour mean).

## Report

Finish by writing `REPORT.md`: for each file, how it was made (generated, edited, or computed by script), which checks you ran and what you saw, the metres per tile and the millimetres of the height range, how long the work took, and anything you are not satisfied with.

Do not use or imitate pictures from any existing game, and do not search for or download reference images: work from the description above.
