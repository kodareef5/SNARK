# Dressed stone: the cut blocks of a stronghold

You are making one tiling material for a survival building game, and you have the whole job: generation, every layer, your own build and check scripts, looking at the result and fixing it. Work only in this folder. Python 3 with Pillow, NumPy and SciPy is installed. Keep every source picture the image tool gives you in `source/`, and every prompt you used in `prompts.md`.

## What it is for

Players build bases out of stone pieces by the hundred. This material covers the stone that masons cut square and finished by hand: the jamb stones beside every door and window, the blocks of stone pillars, the plinth blocks round every foundation, the stair treads and the threshold, the underside of stone ceilings. It sits beside a rough-cut limestone wall, so it is the same limestone family, a little lighter and finer, dressed true.

The game models every block as real geometry, chamfered edges and joints included, and cuts its blocks from anywhere in this tile. So this picture has no joints, no edges and no arrises at all: it is a continuous dressed stone surface, 3 m by 3 m, that tiles in both directions with no seam.

## What excellent looks like

The bar to beat is the wood plank wall in `/home/user/dev/SNARK/.claude/worktrees/agent-a2517e755af91bae1/planning/artist-test/wood/` (start with `checks/layers.jpg`, then its `REPORT.md`): a complete, aligned, tileable layer set with its own build and checks, in which the layers agree to the pixel. Yours should be better: a block cut from any part of it, from 0.25 m to 1 m across, should look like a stone a mason worked.

- The face is tooled: rows of fine chisel strokes (a batted or dragged finish) and here and there a coarser punched or clawed patch. Real tooling changes direction and character from block to block, so let it change in patches of about 0.3 to 0.6 m with soft, irregular borders, as if several masons had worked it. No regular grid of patches.
- The stone itself: faint bedding lines, a few small shell fragments or darker inclusions, the odd tiny pit, slight colour drift across the stone. Weathered a little, clean enough to read as the good stone of the building.
- Colour: pale warm grey limestone, a touch lighter and creamier than the wall stone. The mean of the whole base colour picture must be within 8 levels of sRGB (196, 195, 190) in each channel: the game draws distant blocks in one flat colour, so the textured stone must average to it.
- Flat and unlit: no baked light direction, no cast shadows, no highlight, no gradient across the tile. The tooling lives in the height and normal maps; the base colour keeps only the faint tonal trace tooling leaves.

## What the engine needs

All at 2048 by 2048, pixel-aligned with each other, every one tiling in both directions:

1. `dressed_base.png`: base colour, RGB, 8 bits, sRGB.
2. `dressed_height.png`: greyscale, 16 bits, white high. Black to white is 6 mm.
3. `dressed_normal.png`: tangent-space normal, RGB 8 bits, OpenGL convention (+X right, +Y up the picture, +Z out), computed from the delivered height at the true scale: the tile is 3 m across 2048 pixels, 1.465 mm a pixel. It must agree with the height.
4. `dressed_orm.png`: one packed picture, RGB 8 bits, linear. Red: ambient occlusion, nearly white, darker only in pits and deep tool marks. Green: roughness about 0.7 to 0.9. Blue: metalness, 0 everywhere.

The image tool returns pictures of about 1,254 pixels whatever you ask for. Reaching 2,048 with real detail is part of the job: one way that worked is generating elements and placing them in a larger master, or adding fine detail by script. Choose your own way, and say how you did it.

## Checks you run and keep in `checks/`

- `tiled3x3.jpg`: the base colour tiled 3 by 3, seen whole. If the repeat jumps out, change what makes it.
- `blocks.jpg`: a dozen rectangles of 0.25 to 1 m cut from random places, each drawn on its own as a block would be: every one should look worked by hand, none blank and none alike.
- `offset.jpg`: each layer offset by half with wrap-around, to see the seams.
- `layers.jpg`: all four layers side by side.
- `relit.jpg`: the base colour lit through the normal map from three or four directions.

Then look at what you made and send it back to yourself until you would ship it. Finish with `REPORT.md`: for each file how it was made, what you checked and saw, the mean colour, how long it took, and anything you are not satisfied with. Write plainly.
