# Reed mat: the floor material of the first building tier

You are making one tiling material for a survival game in which players build bases out of square pieces (foundations, walls, doorways, ceilings) by the thousand. The cheapest tier is bundled reed thatch lashed to a frame of poles: light, uneven, quick to put up, and it should look it, and still be a pleasure to look at. This material is the floor of that tier: the top of every thatch foundation is a woven reed mat laid over a frame of logs. Players stand on it, drop their things on it and look down at it all the time, and from a distance a village of foundations shows a lot of it.

Work only in the current folder. Take as long as the job needs.

## What it shows

A coarse, hand-plaited floor mat of split reed or flattened rush, laid flat and seen straight from above.

- Strips about 3.75 cm wide, woven in a **two-over, two-under twill**, so the weave runs in shallow diagonals. Each strip is flat, with fine lengthwise fibres and the odd node or crease.
- Handmade: strips vary a little in width, hue and straightness; a few are split or frayed at an edge; the weave is not perfectly square everywhere. Some patches are worn paler and smoother where people walk; grit and dust sit in the hollows where strips cross. Not dilapidated: no holes, no rot, no mould.
- Colour: dry pale reed, khaki to light tan, a touch greyer and paler than golden straw so it reads as a floor next to the straw walls, with strips from cream to light brown. No green, nothing saturated. The mean colour of the base colour should be close to sRGB (178, 160, 118).
- No border, no binding, no mat edges: it is an endless weave. The frame of the piece covers its edges.

## The layout

- One tile covers **1.5 m by 1.5 m** of floor at **2048 by 2048 pixels** (about 0.73 mm a pixel).
- The strips run along the picture's rows and columns: **40 strips across the tile in each direction**, so the twill repeats exactly and tiles in both directions. Variation in the strips themselves must still wrap.

## What to deliver, all 2048 by 2048 and pixel-aligned (the same strip in the same place in every layer)

1. `mat_base.png`: base colour, sRGB, 8-bit RGB. Flat and unlit: no baked light, no cast shadow, no highlights, no occlusion darkening beyond the strips' real colour and the real grit.
2. `mat_height.png`: 16-bit greyscale height, white is high: each strip arching over the one it crosses and dipping under the next, the hollows between, the fibres. Say in your report how many millimetres the full range stands for (about 6 to 10 mm is right).
3. `mat_normal.png`: tangent-space normal map, **OpenGL convention** (green points to the top of the picture), computed from the delivered height with wrap-around at the physical scale above, so it agrees with the height.
4. `mat_orm.png`: one packed picture, linear, 8-bit RGB: **red** ambient occlusion (the hollows where strips cross), **green** roughness (dry reed about 0.7 to 0.9, the worn patches a little smoother), **blue** metalness (0 everywhere).

Keep the generated source pictures at full size in `source/`, and the scripts that build every layer (`build_material.py`) and check them (`check_material.py`) in this folder, so the whole thing can be rebuilt.

## What excellent looks like

The example to beat is the wood plank wall in the repository's `planning/artist-test/wood/`, which from this folder is `../../../../../../../planning/artist-test/wood/` (start with `checks/layers.jpg`, then `checks/tilings.jpg`, `checks/relighting.jpg` and `REPORT.md`; the pictures attached show it). It is a complete, aligned, tileable set with its own build and check scripts. Beat it: a floor of this should look woven by hand, hold up at full size, and not look like wallpaper when tiled three by three. A perfect mechanical weave is the failure to avoid: it must be regular enough to read as a weave and irregular enough to read as made by someone.

- The 2048 must hold real detail at full size: fibres in each strip, crisp crossings, not a blurred enlargement of a smaller picture. The image tool returns about 1254 pixels a side whatever is asked; reach 2048 by composing generated strips or patches into a larger master, by adding fine detail by script, or both.
- It tiles in both directions with no visible seam: check a half-offset with wrap-around and a 3 by 3 tiling, and fix what you see.
- No blemish or worn patch so distinctive that the eye finds its repeat in a 3 by 3 tiling.
- The layers agree: overlay or set them side by side and look. Relight the normal and occlusion from two or three directions and check that the crossings read the right way round.

## Checks to leave in `checks/`

A contact sheet of the four layers; the base colour tiled 3 by 3; the half-offset of each layer; a relit preview from at least two light directions; a 1:1 crop of the 2048 base colour and normal; and a JSON of your measurements (wrap seam against interior differences, normal against height agreement, base colour mean).

## Report

Finish by writing `REPORT.md`: for each file, how it was made (generated, edited, or computed by script), which checks you ran and what you saw, the metres per tile and the millimetres of the height range, how long the work took, and anything you are not satisfied with.

Do not use or imitate pictures from any existing game, and do not search for or download reference images: work from the description above.
