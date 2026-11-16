# Timber: the hewn oak of a stronghold

You are making one tiling material for a survival building game, and you have the whole job: generation, every layer, your own build and check scripts, looking at the result and fixing it. Work only in this folder. Python 3 with Pillow, NumPy and SciPy is installed. Keep every source picture the image tool gives you in `source/`, and every prompt you used in `prompts.md`.

## What it is for

Players build bases out of stone pieces by the hundred. Stone walls carry their openings on heavy oak: this material is every lintel over a door or window, every window sill, the beams under a stone ceiling, and the thick planks of the iron-bound door. It sits beside limestone, so it should be dark enough and warm enough to read clearly against pale stone from across a valley.

The game models every beam and plank as real geometry, chamfered edges, joints and plank gaps included, and cuts each from a strip of this tile with the grain running along the strip. So this picture has no joints, no plank edges, no ends and no nails: it is one continuous surface of hewn oak, 3 m by 3 m, the grain running left to right the whole way across, tiling in both directions with no seam.

## What excellent looks like

The bar to beat is the wood plank wall in `/home/user/dev/SNARK/.claude/worktrees/agent-a2517e755af91bae1/planning/art-trial/wood/` (start with `checks/layers.jpg`, then its `REPORT.md`): a complete, aligned, tileable layer set with its own build and checks, in which the layers agree to the pixel. Yours should be better: it is heavier, older wood, worked by an adze and not a saw.

- Oak, hewn: shallow scalloped adze facets across the grain, long drying checks (splits) running with the grain, a few knots and the swirl of grain round them, medullary ray fleck, open pores. Weathered to a warm grey-brown on the surface with darker brown in the checks and pores. No paint, no planks, no saw marks, no rot.
- A strip of it 0.1 to 0.4 m tall cut from anywhere must look like the face of one beam. So no feature runs across the whole tile's height, and none is so striking that it marks a repeat.
- Colour: the mean of the whole base colour picture must be within 8 levels of sRGB (118, 92, 66) in each channel: the game draws distant timber in one flat colour, so the textured wood must average to it.
- Flat and unlit: no baked light direction, no cast shadows, no highlight, no gradient across the tile.

## What the engine needs

All at 2048 by 2048, pixel-aligned with each other, every one tiling in both directions:

1. `timber_base.png`: base colour, RGB, 8 bits, sRGB.
2. `timber_height.png`: greyscale, 16 bits, white high. Black to white is 10 mm: adze facets a few millimetres deep, checks the deepest.
3. `timber_normal.png`: tangent-space normal, RGB 8 bits, OpenGL convention (+X right, +Y up the picture, +Z out), computed from the delivered height at the true scale: the tile is 3 m across 2048 pixels, 1.465 mm a pixel. It must agree with the height.
4. `timber_orm.png`: one packed picture, RGB 8 bits, linear. Red: ambient occlusion, nearly white, darker in checks and pores. Green: roughness about 0.65 to 0.9. Blue: metalness, 0 everywhere.

The image tool returns pictures of about 1,254 pixels whatever you ask for. Reaching 2,048 with real detail is part of the job: one way that worked is generating elements and placing them in a larger master, or adding fine detail by script. Choose your own way, and say how you did it.

## Checks you run and keep in `checks/`

- `tiled3x3.jpg`: the base colour tiled 3 by 3, seen whole. If the repeat jumps out, change what makes it.
- `beams.jpg`: a dozen strips 0.1 to 0.4 m tall and 1 to 2 m long cut from random places, each drawn as a beam face would be: every one should look like a beam, none blank and none alike.
- `offset.jpg`: each layer offset by half with wrap-around, to see the seams.
- `layers.jpg`: all four layers side by side.
- `relit.jpg`: the base colour lit through the normal map from three or four directions.

Then look at what you made and send it back to yourself until you would ship it. Finish with `REPORT.md`: for each file how it was made, what you checked and saw, the mean colour, how long it took, and anything you are not satisfied with. Write plainly.
