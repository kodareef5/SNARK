# Rubble: the surfaces of the city's broken buildings

You are making the surface materials of the rubble heaps in a survival game, and you have the whole job: generation, every layer, your own build and check scripts, looking at the result and fixing it. Work only in this folder. Python 3 with Pillow, NumPy and SciPy is installed. Keep every picture the image tool gives you in `source/`, and every prompt you used in `prompts.md`.

## What they are for

The game is set in a ruined, overgrown subtropical city by a bay, long after its people left. Its fallen buildings lie in heaps along the streets, and a player quarries them for stone with a pick as they would a boulder. The concept art is in `../../ref/concept/`: start with `rubble.png`, `ruins.png`, `used_up.png` and the lower right of `surfaces.png`, and read `NOTES.md` there (its colour table and "what the modeller must not miss"). That is the look to reach.

Every heap is modelled as solids: slabs of reinforced concrete with broken edges, chunks of wall with their stucco face, cut coral-stone blocks, hollow cinder blocks, a column drum, a scatter of broken pieces, and rebar as real rods. Their large forms (slab thickness, broken edges and chips down to about 3 cm, block cavities) are real geometry. Your materials are the skin laid over that geometry: everything finer, and all of the colour. Each is projected onto the heap's surfaces from three sides and blended, then baked with the heap's own occlusion and masks (which face is painted, where sand and grime lie) into one picture per heap. So each must tile seamlessly in both directions, look right at any rotation, carry no light direction, and not show its repeat over a 3 m heap.

## The materials

1. **broken** — the broken face of old concrete: coarse aggregate (pale limestone gravel and some darker stones) in grey cement, hackly and crumbling, with small voids. This is where slabs and walls snapped.
2. **cast** — the cast, weathered face of concrete: the top of a floor slab, the underside of a beam, the sides of a column. Smoother, pocked with small air holes, faint board or form marks, rain-stained, gritty, a few hairline cracks.
3. **stucco** — the painted stucco face of a wall: a thin render coat over the concrete, its paint chalked and faded, flaking in patches to the pale render underneath, crazed with fine cracks. Deliver the paint as a separate layer so the bake can give each heap its own colour (chalky pink, faded mint, aqua, pale yellow, as in the concept): a `stucco_base.png` of the bare render, a `stucco_paint.png` greyscale layer of how much paint is left at each pixel (white where it is whole, black where it has flaked off), and a `stucco_paint_tone.png` greyscale layer of the paint's own fading and dirt (mid grey on average), which the bake multiplies into whatever colour the paint is.
4. **coral** — a sawn block of coral stone, the local building stone: pale cream-buff, full of fossil coral heads, shells and holes seen in section, the saw marks weathered off.
5. **block** — the face of a hollow cinder block: grey, fine and gritty, open-textured, with small voids.
6. **rust** — the rusted surface of rebar: dark corroded iron, flaking, orange-brown at the flakes, at the scale of a rod about 2 cm thick.

Each material is 1.5 m across one picture, except `rust`, which is 0.25 m across one picture.

## What excellent looks like

Our own example of the bar is the stone tier's wall stone in `/home/user/dev/SNARK/.claude/worktrees/agent-a9b3d7ade17206da2/assets/source/core/structures/stone/tex/masonry/` (look at its pictures and read its `REPORT.md`): a complete, aligned, tileable layer set with its own build and checks, in which the layers agree to the pixel. Yours should be as good: real old concrete, real coral stone, real flaking paint, not noise patterns.

Flat and unlit: no light direction, no cast shadow, no highlight, no gradient across the picture. Ambient occlusion only as a faint darkening deep in voids. Colours as `NOTES.md` gives them for concrete, aggregate, stucco and rebar.

## What to deliver, in this folder

For each material, at 2048 by 2048, pixel-aligned within a material, each tiling in both directions:

- `<name>_base.png`: base colour, RGB 8 bits, sRGB.
- `<name>_height.png`: greyscale, 16 bits, white high, 30 mm black to white (8 mm for `rust`).
- `<name>_normal.png`: tangent-space normal, RGB 8 bits, OpenGL (+X right, +Y up the picture, +Z out), from the delivered height at its true scale.
- `<name>_rough.png`: roughness, greyscale 8 bits, linear.
- and for `stucco`, the two paint layers above, aligned with its others: flaked paint must sit a little proud of the bare render in the height.

The image tool returns pictures of about 1,254 pixels whatever you ask for. Reaching 2,048 with real detail is part of the job: generating elements and placing them in a larger master, or adding fine detail by script, has worked. Choose your own way, and say how you did it.

## Checks you run and keep in `checks/`

- `tiled3x3.jpg` of each base colour, `offset.jpg` of each layer offset by half with wrap-around, `layers.jpg` of all layers side by side.
- `relit.jpg`: each material lit through its normal from three or four directions.
- `paint.jpg`: the stucco painted in each of the four colours of `NOTES.md` through its paint layers.

Then look at what you made and send it back to yourself until it looks like the rubble in the concept art. Finish with `REPORT.md`: for each file how it was made, what you checked and saw, the mean colours, and anything you are not satisfied with. Write plainly.
