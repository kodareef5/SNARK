You are making one tiling material for the hand tools of a survival game. Work only in the current folder. Do not run git commands that write.

## What it is for

A survival game starts every player with nothing; in the first minutes they make three tools from a stick, a rock and some plant fibre: a stone pick, a stone hatchet and a spear. They are what a player holds most of the game, and in first person they sit at the bottom of the screen closer than anything else, for hours. Three tiling materials are being made for them at once, one each: `wood` (this one, the hafts), `lashing` (the fibre cord binding) and `stone` (the knapped heads, in grey stone and dark flint). They are used together on every tool.

**This material: `wood`, the hafts.** A straight branch of a pale hardwood (think ash, hickory or a sapling of some tough shrub), cut green, its bark stripped off with a stone edge and left to dry in the sun. Warm honey tan, unpainted, unvarnished. The long fine grain of a young branch, with slightly darker growth streaks; a few small pin knots where twigs grew; thin shallow scrape facets along the grain where the bark was shaved off with a stone (slightly flat strips 5 to 15 mm wide with soft edges, the tool marks of a hand, not a machine); one or two fine drying checks a few centimetres long; here and there a thin dark sliver of bark or cambium left in a hollow. Natural, honest, handled.

The same material covers three hafts: the pick's and the hatchet's (about 30 mm thick, 0.5 m long) and the spear's (about 26 mm thick, 1.9 m long), so nothing in it may be so distinctive that it shouts when it repeats.

## The layout (exact: the 3D meshes are mapped to it)

- **One tile covers 0.40 m by 0.40 m.** The haft's surface is unrolled onto it: image x goes **around** the haft and image y goes **along** it. So **the grain runs up and down the image (along y) everywhere**. About 5,120 pixels a metre at 2,048.
- **It tiles in both directions** with the grain carrying across the wrap. A haft's circumference (about 0.08 to 0.095 m) is a narrow vertical strip of the tile, so its seam runs along the grain: keep the texture even across x (no feature wider than about 30 mm across the grain), so that any strip reads as a whole haft.
- Even in tone across the tile (no gradient); its variety comes from grain, streaks and the few features, spread evenly.

## What the files must be

All PNG, pixel-aligned with one another, at **2,048 x 2,048** and the same set at **1,024 x 1,024** (the 1,024 must be what the 2,048 is when shrunk, within 30 dB; making the 1,024 by shrinking the 2,048 is fine):

1. `wood_base.png` (and `wood_base_1024.png`): base colour, 8-bit sRGB. Flat and unlit: no baked light, no occlusion, no shadows. Mean colour about sRGB (164, 120, 76), honey tan.
2. `wood_height.png` (and `_1024`): 16-bit greyscale height, white high. Say in the report the physical range the full 0..65535 covers, in millimetres (a small one: a few millimetres).
3. `wood_normal.png` (and `_1024`): tangent-space normal, 8-bit, OpenGL convention (+X right, +Y up the image, +Z out), computed from the height at that physical scale and agreeing with it.
4. `wood_orm.png` (and `_1024`): 8-bit linear, red ambient occlusion, green roughness, blue metalness (all 0).

## What excellent looks like

- In first person the haft fills a strip of the screen about 50 to 80 pixels wide at about 1,500 pixels a metre. It should look like a real stick someone stripped: fine grain you can follow, scrape facets that catch the light, a knot or two, a dry, slightly satiny surface (roughness about 0.55 to 0.7, a little smoother where polished). Native detail at 2,048, not an upscale.
- In the inventory, a 64-pixel picture: it reads as pale warm wood, clearly lighter and warmer than the tan binding and the grey stone.
- The layers agree. Occlusion only in real cavities: checks, knot holes, the scrape edges.

## The examples to beat

Two finished materials of this game are in the main checkout: `/home/user/Desktop/SNARK/assets/source/core/structures/wood/tex/timber/` (heavy hewn timber: look at `timber_base.png`, `timber_normal.png` and `REPORT.md`) and `/home/user/Desktop/SNARK/planning/art-trial/wood/` (an earlier test: `checks/layers.jpg`, `REPORT.md`). Read them only. They are good: aligned, seamless, honest, with native detail. Beat them at a much smaller scale: this is a stick in a hand, not a beam in a wall.

## How

Your method, your tools. Python 3 with Pillow, numpy and scipy is installed. The image tool returns pictures of about 1,254 pixels a side whatever you ask for; 2,048 can be reached by generating elements and placing them in a larger master, or by adding fine detail by script. Do not search the web for textures or use any picture you did not make. Keep every generated source in `source/` at full size, and your scripts in this folder (`build_material.py`, `check_material.py`), so the whole thing can be rebuilt.

Check your own work and fix what you see:
- offset by half the tile with wrap-around and look at the seams; tile it 3 by 3 and look at it small and large;
- recompute the normal from the saved height and compare;
- draw the layers side by side and a simple lit preview from two light directions;
- crop strips 0.08 to 0.095 m wide, as one haft's circumference shows them, and wrap one round a cylinder in a simple render if you can;
- shrink the 2,048 and compare it with the 1,024;
- put a contact sheet of these in `checks/`.

Finish with `REPORT.md`: each file, how it was made, what you checked and saw, the height range in mm, the metres per tile, how long it took, and anything you are not satisfied with.
