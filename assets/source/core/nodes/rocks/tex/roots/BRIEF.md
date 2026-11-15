# Fig roots: the bark of the roots that grip a boulder

You are making one surface material for a survival game, and you have the whole job: generation, every layer, your own build and check scripts, looking at the result and fixing it. Work only in this folder. Python 3 with Pillow, NumPy and SciPy is installed. Keep every picture the image tool gives you in `source/`, and every prompt you used in `prompts.md`.

## What it is for

The game is set on a ruined, overgrown subtropical coast. Some of its limestone boulders are gripped by the roots of strangler figs: roots 10 to 30 cm thick poured over the stone and down into the ground, fused where they cross, with the broken stump of the fig on top. Look at the lower right of `../../ref/concept/limestone.png`, the left of `shore.png`, and read `../../ref/concept/NOTES.md`. The roots and stump are modelled as solids; your material is their bark, projected onto them from three sides and baked into the boulder's own picture. So it must tile seamlessly in both directions and must look right at any rotation; a root runs every way over the stone.

## The material

**bark** — strangler fig root bark: smooth, thin and grey, pale grey-brown to silver-grey, with fine lengthwise wrinkles and creases where the root bends, horizontal lenticels, scuffed paler patches, a little green-grey lichen and dark grime in the creases, the odd shallow crack. Smooth enough that it is unmistakably living wood against the pitted limestone. Average roughly sRGB (146, 134, 116). 0.75 m across one picture. Because it is projected from three sides, avoid any strong direction in it: let the wrinkles wander.

## What excellent looks like

Our own example of the bar is the stone tier's wall stone in `/home/user/dev/SNARK/.claude/worktrees/agent-a9b3d7ade17206da2/assets/source/core/structures/stone/tex/masonry/` (its pictures and its `REPORT.md`): a complete, aligned, tileable layer set with its own build and checks. Flat and unlit: no light direction, no cast shadow, no highlight, no gradient across the picture.

## What to deliver, in this folder

At 2048 by 2048, pixel-aligned, each tiling in both directions:

- `bark_base.png`: base colour, RGB 8 bits, sRGB.
- `bark_height.png`: greyscale, 16 bits, white high, 10 mm black to white.
- `bark_normal.png`: tangent-space normal, RGB 8 bits, OpenGL, from the delivered height at its true scale.
- `bark_rough.png`: roughness, greyscale 8 bits, linear, about 0.55 to 0.85.

The image tool returns pictures of about 1,254 pixels; reaching 2,048 with real detail is part of the job. Keep `checks/` with `tiled3x3.jpg`, `offset.jpg`, `layers.jpg` and `relit.jpg`. Keep the folder to what rebuilds the delivery and what a reader needs: no superseded iterations. Finish with `REPORT.md`: how each file was made, what you checked and saw, the mean colour, and anything you are not satisfied with. Write plainly.
