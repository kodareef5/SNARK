# Flagstones: the floor of a stronghold

You are making one tiling material for a survival building game, and you have the whole job: generation, every layer, your own build and check scripts, looking at the result and fixing it. Work only in this folder. Python 3 with Pillow, NumPy and SciPy is installed. Keep every source picture the image tool gives you in `source/`, and every prompt you used in `prompts.md`.

## What it is for

Players build bases out of stone pieces by the hundred. This material is the top of every stone foundation and stone ceiling: the floor players walk on inside, and the flat roof they stand on outside. Stone is what a base becomes when its builders mean to keep it, so this is a heavy, worn, laid floor of big flagstones, not a printed pattern.

One tile is exactly one floor piece, 3 m by 3 m, seen from above. Floors join edge to edge in a grid, and a neighbour may be turned a quarter turn against this one, so the tile has a joint along all four of its edges and must tile in both directions with no visible seam.

## The pattern is fixed: paint to it

The flags are already decided, because the game models every flag as real geometry and your picture is laid over it. `layout/cells.png` (2048 by 2048) shows each flag as a flat colour of its own with the joints as black lines, the tile's edges included; `layout/layout.json` gives every flag's corners in metres and pixels. `layout/tiled.png` shows the pattern repeated.

- Every joint in your picture lies on a line of the layout, the four edges included, and every line is a joint. One flag of the layout is one flag in your picture: do not split or merge them.
- Along the tile's edges a joint is shared with the neighbouring tile: paint half of it at each edge so that two tiles side by side show one joint of the usual width.
- The modelled joint is a shallow vee: each flag's edge is cut back 12 mm across and 6 mm deep. Let mortar or packed grit show 4 to 12 mm either side of the line, irregular; the flag's surface starts within 20 mm of the line everywhere.
- Each flag is its own slab: its own tone, its own wear, a few of its own marks (a chipped corner, a shallow worn dish, a dark stain, a fine natural crack that stays inside the flag). No two neighbours alike, and no single flag that becomes the thing the eye finds repeating every 3 m.

## What excellent looks like

The bar to beat is the wood plank wall in `/home/user/dev/SNARK/.claude/worktrees/agent-a2517e755af91bae1/planning/artist-test/wood/` (start with `checks/layers.jpg`, then its `REPORT.md`): a complete, aligned, tileable layer set with its own build and checks, in which the layers agree to the pixel. Yours should be better, and should read as a laid floor both underfoot and from a cliff above a base.

- Colour: the same limestone family as the walls but greyer and a little darker, polished smooth where feet go and duller at the edges, with dirt packed into the joints. Mostly cool to neutral grey, a few flags warmer. No moss carpets, no tiles, no bricks, no pattern painted on.
- The mean of the whole base colour picture must be within 8 levels of sRGB (128, 128, 128) in each channel: the game draws distant floors in that one flat colour, so the textured floor must average to it.
- Flat and unlit: no baked light direction, no cast shadows, no highlight, no gradient across the tile.

## What the engine needs

All at 2048 by 2048, pixel-aligned with each other and with the layout, every one tiling in both directions:

1. `flags_base.png`: base colour, RGB, 8 bits, sRGB.
2. `flags_height.png`: greyscale, 16 bits, white high. Black to white is 12 mm. Flag surfaces high with 1 to 3 mm of wear and texture, joints about 6 mm below.
3. `flags_normal.png`: tangent-space normal, RGB 8 bits, OpenGL convention (+X right, +Y up the picture, +Z out), computed from the delivered height at the true scale: the tile is 3 m across 2048 pixels, 1.465 mm a pixel. It must agree with the height.
4. `flags_orm.png`: one packed picture, RGB 8 bits, linear. Red: ambient occlusion, mostly white, darker only in the joints and chips. Green: roughness, worn flag tops about 0.55 to 0.75, edges and joints 0.85 to 1.0. Blue: metalness, 0 everywhere.

The image tool returns pictures of about 1,254 pixels whatever you ask for. Reaching 2,048 with real detail is part of the job: one way that worked is generating elements and placing them in a larger master, or adding fine detail by script. Choose your own way, and say how you did it.

## Checks you run and keep in `checks/`

- `tiled3x3.jpg`: the base colour tiled 3 by 3, seen whole, and once more with alternate tiles turned a quarter turn. If the repeat jumps out, change the flags that make it.
- `offset.jpg`: each layer offset by half with wrap-around, to see the seams.
- `registration.jpg`: the layout's lines drawn over the base colour, and a measure of how far your joints lie from them.
- `layers.jpg`: all four layers side by side.
- `relit.jpg`: the base colour lit through the normal map from three or four directions.

Then look at what you made and send it back to yourself until a floor of it looks laid by hand. Finish with `REPORT.md`: for each file how it was made, what you checked and saw, the mean colour, how long it took, and anything you are not satisfied with. Write plainly.
