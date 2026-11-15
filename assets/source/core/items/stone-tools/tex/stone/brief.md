You are making one tiling material, in two colourways, for the hand tools of a survival game. Work only in the current folder. Do not run git commands that write.

## What it is for

A survival game starts every player with nothing; in the first minutes they make three tools from a stick, a rock and some plant fibre: a stone pick, a stone hatchet and a spear. They are what a player holds most of the game, and in first person they sit at the bottom of the screen closer than anything else, for hours. Three tiling materials are being made for them at once, one each: `wood` (the hafts), `lashing` (the fibre cord binding) and `stone` (this one). They are used together on every tool.

**This material: the knapped stone heads.** The pick's head is a chunky pointed piece of **grey stone**; the hatchet's blade and the spear's point are **dark flint**. Both are knapped: struck with a hammerstone so flakes spall off, leaving big shallow scoop-shaped flake scars. The 3D meshes are low-poly: each big flake scar is a flat facet of the mesh, with crisp ridges between facets. This material is what each facet's surface holds: the fine relief and colour inside a flake scar, seen up close.

- **Relief, shared by both colourways:** the concentric ripples of conchoidal fracture (fine arcs a few millimetres apart, like ripples from a dropped stone, fading out across the scar), small secondary flake scars 3 to 15 mm across overlapping one another, the odd tiny step fracture, a few hairline inclusions. Shallow: the facets themselves are geometry.
- **`stone` colourway (the pick):** cool mid grey, a fine-grained hard stone like a chert or a fine basalt, matte, slightly speckled with paler and darker grains. Mean about sRGB (128, 126, 120). Roughness about 0.7 to 0.85.
- **`flint` colourway (the hatchet and the spear):** dark blue-grey-brown flint, slightly glassy and translucent-looking at thin edges, with faint banding and cloudy paler patches. Mean about sRGB (74, 72, 76). Roughness about 0.3 to 0.5: it catches highlights in its ripples.

## The layout (exact: the 3D meshes are mapped to it)

A trim sheet that tiles in both directions. **One tile covers 0.20 m by 0.20 m**, about 10,240 pixels a metre at 2,048. Bands are counted from the top of the image:

- **Rows 0 to 1/8 of the tile (25 mm): the fresh edge.** The pale, freshly knapped rim of a cutting edge, running along image x: in `flint`, a pale grey band (about sRGB (156, 152, 144)) with a row of tiny retouch notches along its middle, like the edge of a knapped blade seen face-on; in `stone`, the same band as worn, polished, paler stone (about sRGB (168, 164, 156)), where a pick's point has been rubbed smooth by use. The band's middle third is the palest; it fades softly into the face above and below.
- **Rows 1/8 to 1/4 of the tile (25 mm): cortex.** The chalky rind of the original nodule: off-white, about sRGB (200, 188, 164), rough (roughness about 0.9), lumpy and pitted, with a ragged boundary fading into the face above and below. The same in both colourways, a little greyer in `stone`.
- **Rows 1/4 to 1 of the tile (150 mm): the face.** Flake-scar surface as described, even in tone, nothing so distinctive that it shouts when it repeats.
- **Both bands tile along x.** Top and bottom wrap: the bottom of the face meets the top of the edge band, so that transition must be as soft as the others. Faces of the mesh are mapped inside one region and never across a band boundary, so the boundaries need not be crisp: soft, natural transitions over about 4 mm are right.

## What the files must be

All PNG, pixel-aligned with one another, at **2,048 x 2,048** and the same set at **1,024 x 1,024** (the 1,024 must be what the 2,048 is when shrunk, within 30 dB; making it by shrinking the 2,048 is fine):

1. `stone_base.png` and `flint_base.png` (and `_1024`): base colour, 8-bit sRGB. Flat and unlit: no baked light, no occlusion, no shadows, no gradient across a region.
2. `stone_height.png` (and `_1024`): 16-bit greyscale height, white high, **one height for both colourways**. Say in the report the physical range the full 0..65535 covers, in mm (a small one: a millimetre or two).
3. `stone_normal.png` (and `_1024`): tangent-space normal, 8-bit, OpenGL (+X right, +Y up the image, +Z out), computed from the height at that physical scale and agreeing with it. One for both colourways.
4. `stone_orm.png` and `flint_orm.png` (and `_1024`): 8-bit linear, red ambient occlusion (shallow: only in pits, steps and notches), green roughness, blue metalness (all 0).

## What excellent looks like

- In first person the hatchet's blade and the pick's head are 100 to 250 pixels across on screen. Each facet should read as a real flake scar: ripples that catch the light when the tool moves, the flint glassy and dark with a pale crisp edge, the grey stone matte and granular. Native detail at 2,048, not an upscale.
- In a 64-pixel inventory picture: the pick reads grey, the hatchet and spear dark with a pale edge.
- The layers agree.

## The examples to beat

Finished materials of this game, in the main checkout, read only: `/home/user/Desktop/SNARK/assets/source/core/structures/wood/tex/timber/` (`timber_base.png`, `timber_normal.png`, `REPORT.md`) and `/home/user/Desktop/SNARK/assets/source/core/structures/stone/` if it holds finished stone materials (look under its `tex/`). They are good: aligned, seamless, honest. Beat them at a much smaller scale: a knapped stone in a hand, not a wall.

## How

Your method, your tools. Python 3 with Pillow, numpy and scipy is installed. The image tool returns pictures of about 1,254 pixels a side whatever you ask for; 2,048 can be reached by generating elements and placing them in a larger master, or by building the relief procedurally and taking colour detail from generated sources. Do not search the web for textures or use any picture you did not make. Keep every generated source in `source/` at full size, and your scripts in this folder (`build_material.py`, `check_material.py`), so the whole thing can be rebuilt.

Check your own work and fix what you see:
- offset by half the tile with wrap-around and look at the seams; tile it 3 by 3 and look at it small and large;
- check the bands sit on their rows;
- recompute the normal from the saved height and compare;
- draw the layers side by side and a simple lit preview of each colourway from two light directions;
- map it onto a few flat facets of a simple low-poly hatchet blade in a simple render if you can, with the edge band along the cutting edge;
- shrink the 2,048 and compare it with the 1,024;
- put a contact sheet of these in `checks/`.

Finish with `REPORT.md`: each file, how it was made, what you checked and saw, the height range in mm, the metres per tile, how long it took, and anything you are not satisfied with.
