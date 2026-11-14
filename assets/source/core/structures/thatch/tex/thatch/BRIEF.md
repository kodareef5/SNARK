# Thatch: the wall and roof material of the first building tier

You are making one tiling material for a survival game in which players build bases out of square pieces (foundations, walls, doorways, ceilings) by the thousand. This material is what the cheapest tier is made of: bundled reed thatch lashed to a frame of poles. It is the first shelter a player builds: light, uneven, quick to put up, and it should look it, and still be a pleasure to look at. It covers the faces of every thatch wall, doorway and door, and the top of every thatch ceiling, which is the roof. Thousands of square metres of it will be on screen at once, from arm's length to across a valley.

Work only in the current folder. Take as long as the job needs.

## What it shows

Reed or long-straw thatch hung in horizontal **courses**, like a thatched roof turned upright. Each course is a row of **bundles** standing side by side: a bundle is a sheaf of dry reed stems about 12 cm across, tied near its top with a twisted grass band and hung from a batten, and the stems run downward and end in a ragged fringe of tips. The fringe of each course hangs over the tied top of the course below, so the ties are only half visible in the shadow under it. Bundles in neighbouring courses are staggered by about half a bundle, like brickwork, so the wall reads as bundled, not as one sheet of straw.

- Stems: dry, sun-bleached reed and straw, from pale cream to golden tan, a few darker grey-brown older stems, a little greying toward the exposed tips. No green, nothing orange or saturated. The mean colour of the base colour should be close to sRGB (190, 166, 112).
- Bundles vary: width from about 9 to 15 cm, some fuller, some leaning a few degrees, the odd stray stem crossing its neighbours. The tips at the bottom of each course are ragged and uneven, not a straight cut.
- Handmade and a little rough, not tidy and not dilapidated: no holes, no rot, no moss.

## The layout, which the geometry depends on

- One tile covers **1.5 m by 1.5 m** of wall at **2048 by 2048 pixels** (about 0.73 mm a pixel).
- Columns of the picture run along the wall. Row 0 is the top. Stems run down the picture.
- There are exactly **four courses per tile**, each **512 pixels (37.5 cm) tall**. A course's top edge is at row 0, 512, 1024 and 1536. The game's geometry steps out at exactly those rows: each course is a face sloping outward from its top edge to its bottom edge, and under each course's bottom edge the surface steps back to the next course's top. So the top 10 to 15% of each course is the tied part, set back in shadow, with the previous course's fringe tips painted hanging over it; the body is stems; the lowest part is the start of its own fringe, which continues past the course boundary onto the next course's top.
- Each course must contain a whole number of bundles across the tile, so it tiles left to right; neighbouring courses are staggered.
- Each of the four courses should look different from the others (different bundle widths and leans), while all four belong together.

## What to deliver, all 2048 by 2048 and pixel-aligned (the same stem in the same place in every layer)

1. `thatch_base.png`: base colour, sRGB, 8-bit RGB. Flat and unlit: no baked light, no cast shadow, no highlights, no ambient occlusion darkening beyond the real colour of the stems. The tied part under the overhang is not painted dark here; its darkness belongs in the occlusion channel.
2. `thatch_height.png`: 16-bit greyscale height, white is high. Local relief only: the stems, the rounding of each bundle, the tie bands, the tips standing proud. **Do not** add the slope of each course or the step between courses: the geometry already has them, and a normal map that also had them would double them. Say in your report how many millimetres the full range stands for (about 25 to 40 mm is right).
3. `thatch_normal.png`: tangent-space normal map, **OpenGL convention** (green points to the top of the picture), computed from the delivered height with wrap-around, at the physical scale above, so it agrees with the height.
4. `thatch_orm.png`: one packed picture, linear, 8-bit RGB: **red** ambient occlusion (the shadow under each overhang, between bundles and between stems), **green** roughness (dry straw is rough, about 0.75 to 0.95, the tie bands a little smoother), **blue** metalness (0 everywhere).

Keep the generated source pictures at full size in `source/`, and the scripts that build every layer (`build_material.py`) and check them (`check_material.py`) in this folder, so the whole thing can be rebuilt.

## What excellent looks like

The example to beat is the wood plank wall in the repository's `planning/artist-test/wood/`, which from this folder is `../../../../../../../planning/artist-test/wood/` (start with `checks/layers.jpg`, then `checks/tilings.jpg`, `checks/relighting.jpg` and `REPORT.md`; the pictures attached show it). It is a complete, aligned, tileable set with its own build and check scripts. Beat it: a wall of this should look built by hand from real bundles, hold up at full size, and not look like wallpaper when tiled three by three.

- The 2048 must hold real detail at full size: individual stems a few pixels wide with their own light and dark, not a blurred enlargement of a smaller picture. The image tool returns about 1254 pixels a side whatever is asked; reach 2048 by composing generated elements (bundles, courses) in a larger master, by adding fine detail by script, or both.
- It tiles in both directions with no visible seam: check a half-offset with wrap-around and a 3 by 3 tiling, and fix what you see.
- No motif that repeats so that the eye finds it in a 3 by 3 tiling.
- The layers agree: overlay or set them side by side and look. Relight the normal and occlusion from two or three directions and check that the bundles, stems and overhangs read the right way round.

## Checks to leave in `checks/`

A contact sheet of the four layers; the base colour tiled 3 by 3; the half-offset of each layer; a relit preview from at least two light directions; a 1:1 crop of the 2048 base colour and normal; and a JSON of your measurements (wrap seam against interior differences, normal against height agreement, base colour mean).

## Report

Finish by writing `REPORT.md`: for each file, how it was made (generated, edited, or computed by script), which checks you ran and what you saw, the metres per tile and the millimetres of the height range, how long the work took, and anything you are not satisfied with.

Do not use or imitate pictures from any existing game, and do not search for or download reference images: work from the description above.
