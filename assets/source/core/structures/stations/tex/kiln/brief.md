You are making one tiling material for the crafting stations of a survival game. Work only in the current folder. Do not run git commands that write.

## What it is for

A survival game's players build stations in their bases: a **refining forge**, a squat eight-sided furnace of stones stacked in clay with a chimney, where ore is smelted over a wood fire; and a **preserving bin**, a smoker cabinet whose firebox is the same blackened stone. They are seen from 1 to 10 metres, walked up to and opened, and seen across a base among buildings of pale limestone, planks and thatch. Their other materials already exist and you must sit beside them: honey-tan sawn `boards` (mean sRGB about (172, 128, 82)), black hand-forged `iron` (about (44, 41, 39)), and pale mortared limestone walls (about (156, 150, 138)) that the forge will stand among. The renderer lights it with one sun and a sky, and has no emissive light: the fire inside the forge is modelled as flat orange geometry.

**This material: `kiln`, the forge's and the firebox's body.** Fieldstones from a riverbed, rounded and split, set in courses in pale clay daub by hand, then blackened by years of fire: soot darkest on the stones, the clay between them paler and cracked, a few stones split by the heat, ash-grey dust in the hollows. Rough and dry, never wet or glossy. And smooth fired clay: the crucible, the lip round the furnace's mouth and the chimney's cap.

## The layout (exact: the 3D meshes are mapped to it)

A trim sheet that tiles in both directions. **One tile covers 2.0 m by 2.0 m**, 1,024 pixels a metre at 2,048. The meshes lay the furnace's courses **along image x**, so courses of stone run **left to right everywhere**. Bands are counted from the top of the image:

- **Rows 0 to 3/4 of the tile (1.5 m): stone in clay.** Courses of rounded and split fieldstones, each stone 12 to 30 cm across and 8 to 18 cm tall, in roughly level courses that wander a little (as a hand-built wall's do, not a brick bond), with clay joints 1.5 to 4 cm wide and pressed back from the stone faces by about 1 cm. Stones dark grey to soot-black with a little brown and blue-grey variety, mean about sRGB (80, 74, 68); the clay a pale warm grey-ochre, about (150, 124, 98), cracked in fine networks, sooted greyer in patches. The whole band's mean about (96, 86, 76). The band must also hold up cut into strips: a mesh cuts a course or two from it for a chimney 0.28 m wide, and an arch of it round the mouth.
- **Rows 3/4 to 1 of the tile (0.5 m): fired clay.** Smooth hand-smoothed clay, fired hard: warm terracotta-ochre about sRGB (168, 132, 100), with finger-smoothing marks along x, fine crazing cracks, scorch clouds of dark grey-brown (20 to 80 cm, soft), a few pale ash smears. Even enough that a crucible 0.8 m round shows no stripe.
- **Every band tiles along x**, and top and bottom wrap: the bottom of the clay band meets the top of the stone band, and that transition must be as soft and natural as the others (a smear of clay over the top course is right). A face of a mesh is mapped inside one band and never across a boundary.

## What the files must be

All PNG, pixel-aligned with one another, at **2,048 x 2,048** and the same set at **1,024 x 1,024** (the 1,024 must be what the 2,048 is when shrunk, within 30 dB; making it by shrinking the 2,048 is fine):

1. `kiln_base.png` (and `kiln_base_1024.png`): base colour, 8-bit sRGB. Flat and unlit: no baked light, no cast shadow, no highlight, no gradient across a band. Stones darker than the clay by their own colour, not by shading.
2. `kiln_height.png` (and `_1024`): 16-bit greyscale height, white high. Stones stand proud of the clay; give the physical range the full 0..65535 covers, in mm, in the report (about 40 mm).
3. `kiln_normal.png` (and `_1024`): tangent-space normal, 8-bit, OpenGL (+X right, +Y up the image, +Z out), computed from the height at that physical scale and agreeing with it.
4. `kiln_orm.png` (and `_1024`): 8-bit linear, red ambient occlusion (dark in the joints between stones and in cracks), green roughness (stone 0.8 to 0.95, soot 0.9 to 1.0, fired clay 0.75 to 0.9), blue metalness 0 everywhere.

## What excellent looks like

- From 3 m the forge reads as a furnace of fire-blackened stones in clay: chunky stones you could count, the joints between them deep and pale, nothing that looks like wallpaper or brick. From 10 m it is a dark, warm-grey mass against pale limestone walls, with a terracotta crucible and cap.
- In a 64-pixel inventory picture: a dark stone furnace with paler joints, a warm clay lip, an orange mouth when lit.
- No stone, crack or scorch so distinctive that it marks the repeat when a 1.2 m furnace wears 0.6 of the band's width on each of its eight faces.
- The layers agree.

## The examples to beat

Finished materials of this game, in the main checkout, read only: `/home/user/Desktop/SNARK/assets/source/core/structures/stone/tex/masonry/` (mortared limestone, a 3 m tile: `masonry_base.png`, `REPORT.md`) and `/home/user/Desktop/SNARK/assets/source/core/items/stone-tools/tex/stone/` (a trim sheet like this one: `stone_base_1024.png`, `REPORT.md`, `brief.md`). They are aligned, seamless, honest, with native detail. Beat them.

## How

Your method, your tools. Python 3 with Pillow, numpy and scipy is installed. The image tool returns pictures of about 1,254 pixels a side whatever you ask for; 2,048 can be reached by generating elements and placing them in a larger master, or by adding fine detail by script. Do not search the web for textures or use any picture you did not make. In your image prompts describe the surface in your own words and do not name any game, studio or franchise. Keep every generated source in `source/` at full size, and your scripts in this folder (`build_material.py`, `check_material.py`), so the whole thing can be rebuilt.

Check your own work and fix what you see:
- offset by half the tile with wrap-around and look at the seams; tile it 3 by 3 and look at it small and large;
- recompute the normal from the saved height and compare;
- draw the layers side by side and a simple lit preview of an eight-sided furnace or a cylinder wearing the stone band, and a pot wearing the clay band, from two light directions with a plain sky light;
- shrink the 2,048 and compare it with the 1,024;
- put a contact sheet of these in `checks/`.

Finish with `REPORT.md`: each file, how it was made, what you checked and saw, the height range in mm, the metres per tile, how long it took, and anything you are not satisfied with.
