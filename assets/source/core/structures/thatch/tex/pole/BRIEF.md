# Pole: the frame wood of the first building tier

You are making one tiling material for a survival game in which players build bases out of square pieces (foundations, walls, doorways, ceilings) by the thousand. The cheapest tier is bundled reed thatch lashed to a frame of poles: light, uneven, quick to put up, and it should look it, and still be a pleasure to look at. This material is the poles: the posts at the ends of every wall, the rails and battens across it, the logs round every foundation, the joists under every ceiling and the frame of every door. They are cut saplings and branches 6 to 18 cm thick, stripped and left in the weather.

Work only in the current folder. Take as long as the job needs.

## What it shows

The surface of a round pole, unrolled flat: the grain runs **along the rows of the picture** (left to right is along the pole), and the picture's height goes round the pole.

- Mostly peeled wood: weathered, pale grey-tan to warm light brown, with the long fine grain of a young trunk, shallow drying checks and splits running along the grain (from a few centimetres to 40 cm long), small knots and the oval scars of trimmed side branches (1 to 4 cm), a few axe or knife facets where it was trimmed.
- Strips and patches of the dark brown bark left on, about 15% of the surface, ragged at their edges and following the grain.
- Some darker weathering streaks along the grain. No moss, no rot, no paint, no metal.
- The mean colour of the base colour should be close to sRGB (132, 112, 88).

## The layout

- One tile covers **1.5 m along the pole by 1.5 m round it** at **2048 by 2048 pixels** (about 0.73 mm a pixel). A pole uses a band of the picture as tall as its girth (20 to 55 cm), and different poles take different bands, so every band of rows should be interesting on its own, with no band that is all bark or all plain.
- Seamless in both directions: along, because poles are longer than a tile; round, because a pole that wraps the whole band must close.

## What to deliver, all 2048 by 2048 and pixel-aligned (the same check in the same place in every layer)

1. `pole_base.png`: base colour, sRGB, 8-bit RGB. Flat and unlit: no baked light, no cast shadow, no highlights, no occlusion darkening beyond the wood's and bark's real colour.
2. `pole_height.png`: 16-bit greyscale height, white is high: the grain, the checks cut into it, the bark standing a few millimetres proud of the wood, the knots and branch scars. Say in your report how many millimetres the full range stands for (about 8 to 15 mm is right). No overall curvature: the geometry is round already.
3. `pole_normal.png`: tangent-space normal map, **OpenGL convention** (green points to the top of the picture), computed from the delivered height with wrap-around at the physical scale above, so it agrees with the height.
4. `pole_orm.png`: one packed picture, linear, 8-bit RGB: **red** ambient occlusion (inside the checks, along the bark edges), **green** roughness (weathered wood about 0.7 to 0.85, bark about 0.9), **blue** metalness (0 everywhere).

Keep the generated source pictures at full size in `source/`, and the scripts that build every layer (`build_material.py`) and check them (`check_material.py`) in this folder, so the whole thing can be rebuilt.

## What excellent looks like

The example to beat is the wood plank wall in the repository's `planning/artist-test/wood/`, which from this folder is `../../../../../../../planning/artist-test/wood/` (start with `checks/layers.jpg`, then `checks/tilings.jpg`, `checks/relighting.jpg` and `REPORT.md`; the pictures attached show it). It is a complete, aligned, tileable set with its own build and check scripts. Beat it: this should look like a real stripped pole at arm's length, hold up at full size, and not look like wallpaper when tiled three by three.

- The 2048 must hold real detail at full size: crisp grain and checks, not a blurred enlargement of a smaller picture. The image tool returns about 1254 pixels a side whatever is asked; reach 2048 by composing generated elements in a larger master, by adding fine detail by script, or both.
- It tiles in both directions with no visible seam: check a half-offset with wrap-around and a 3 by 3 tiling, and fix what you see.
- No knot or bark patch so distinctive that the eye finds its repeat in a 3 by 3 tiling.
- The layers agree: overlay or set them side by side and look. Relight the normal and occlusion from two or three directions and check that the checks read as cut in and the bark as standing proud.

## Checks to leave in `checks/`

A contact sheet of the four layers; the base colour tiled 3 by 3; the half-offset of each layer; a relit preview from at least two light directions; a 1:1 crop of the 2048 base colour and normal; and a JSON of your measurements (wrap seam against interior differences, normal against height agreement, base colour mean).

## Report

Finish by writing `REPORT.md`: for each file, how it was made (generated, edited, or computed by script), which checks you ran and what you saw, the metres per tile and the millimetres of the height range, how long the work took, and anything you are not satisfied with.

Do not use or imitate pictures from any existing game, and do not search for or download reference images: work from the description above.
