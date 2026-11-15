You are making one tiling material for the crafting stations of a survival game. Work only in the current folder. Do not run git commands that write.

## What it is for

A survival game's players start with sticks and stones; after many hours they rivet together their first machine, the **fabricator**: a long, low, squat cabinet of painted steel panels on iron feet, with a hatch and a window, gauges, a lever, caged lamps, a stovepipe and a jerrycan of fuel strapped to its side. It is about 1.7 m wide and 1.3 m tall, seen from 1 to 10 metres, walked up to and switched on, and seen among stone, plank and thatch buildings. Its other material already exists and you must sit beside it: black hand-forged `iron` (mean sRGB about (44, 41, 39)), for its feet, handle, lever and pipe. The renderer lights it with one sun and a sky and no environment reflections: a fully metallic dark surface mirrors the sky and reads blue, so dull metal here is only partly metallic (see the packed map below).

**This material: `plate`, the fabricator's skin.** Sheet steel, hand-cut and riveted, painted a muted industrial green-grey: the paint brushed on, slightly uneven, with chips and scuffs down to bare steel at edges and round handled places, grime and oil darkening it near seams and at the foot, a few runs of rust from a chip, faint brush marks. Honest workshop machinery made by a survivor, kept running: not new, not wrecked.

## The layout (exact: the 3D meshes are mapped to it)

A trim sheet that tiles in both directions. **One tile covers 1.5 m by 1.5 m**, about 1,365 pixels a metre at 2,048. The meshes lay a panel's **width along image x**. Bands are counted from the top of the image:

- **Rows 0 to 1/12 of the tile (125 mm): a riveted seam.** A strip where two painted plates overlap: a lap edge running along x across the band's middle, and one row of round domed rivet heads along it, each about 14 mm across, every 60 mm, their paint worn through to bare steel on their tops. The mesh lays this strip along every seam and frame of the machine.
- **Rows 1/12 to 1/6 of the tile (125 mm): bare worn steel.** The same steel with the paint long gone: pale steel grey about sRGB (150, 150, 148), fine scratches along x, a few dark pits, smoother than the paint. Edges, handles' backplates, gauge rims and the jerrycan's cap are mapped here.
- **Rows 1/6 to 1 of the tile (1.25 m): the painted face.** The green-grey paint, mean about sRGB (98, 110, 100), uneven in soft patches 10 to 40 cm, faint brush marks along x, small chips to bare steel (each 3 to 30 mm, scattered, more of them toward the band's top and bottom edges than its middle), a few short rust runs downward from a chip, a little soot and oil grime in soft clouds. Even in tone overall: nothing so distinctive that it marks the repeat on a 1.5 m panel.
- **Every band tiles along x**, and top and bottom wrap: the bottom of the face meets the top of the rivet strip, and that transition must be as soft and natural as the others. A face of a mesh is mapped inside one band and never across a boundary.

## What the files must be

All PNG, pixel-aligned with one another, at **2,048 x 2,048** and the same set at **1,024 x 1,024** (the 1,024 must be what the 2,048 is when shrunk, within 30 dB; making it by shrinking the 2,048 is fine):

1. `plate_base.png` (and `plate_base_1024.png`): base colour, 8-bit sRGB. Flat and unlit: no baked light, no reflections, no gradient across a band. For bare steel the base colour is its reflectance: a mid-light grey, not white.
2. `plate_height.png` (and `_1024`): 16-bit greyscale height, white high. Say in the report the physical range the full 0..65535 covers, in mm (rivet heads about 4 mm proud; paint chips about 0.2 mm deep).
3. `plate_normal.png` (and `_1024`): tangent-space normal, 8-bit, OpenGL (+X right, +Y up the image, +Z out), computed from the height at that physical scale and agreeing with it.
4. `plate_orm.png` (and `_1024`): 8-bit linear, red ambient occlusion (shallow: round rivet heads and in the lap), green roughness (paint 0.6 to 0.75, grime 0.8, bare steel 0.45 to 0.6), blue metalness: **0 on paint**, about 0.35 (sRGB value 89) on bare steel and chips and about 0.45 (115) on the brightest worn rivet tops, lower in rust.

## What excellent looks like

- From 2 m the fabricator reads as a painted steel machine somebody made and uses: panels and riveted seams, chipped paint at the edges, bright steel where hands go. From 10 m it is a muted green-grey box with darker iron, distinct from every stone, wood and thatch building beside it.
- In a 64-pixel inventory picture: a green-grey machine with a pale steel trim and dark iron.
- The layers agree.

## The examples to beat

Finished materials of this game, in the main checkout, read only: `/home/user/Desktop/SNARK/assets/source/core/items/weapons/firearms/tex/steel/` (a metal trim sheet: `steel_base_1024.png`, `REPORT.md`, `brief.md`), and `/home/user/Desktop/SNARK/assets/source/core/structures/stone/tex/iron/` (hand-forged iron, a 3 m tile). They are aligned, seamless, honest, with native detail. Beat them.

## How

Your method, your tools. Python 3 with Pillow, numpy and scipy is installed. The image tool returns pictures of about 1,254 pixels a side whatever you ask for; 2,048 can be reached by generating elements and placing them in a larger master, or by adding fine detail by script. Do not search the web for textures or use any picture you did not make. In your image prompts describe the surface in your own words and do not name any game, studio or franchise. Keep every generated source in `source/` at full size, and your scripts in this folder (`build_material.py`, `check_material.py`), so the whole thing can be rebuilt.

Check your own work and fix what you see:
- offset by half the tile with wrap-around and look at the seams; tile it 3 by 3 and look at it small and large;
- recompute the normal from the saved height and compare;
- draw the layers side by side and a simple lit preview of a box with chamfered edges wearing the face, its chamfers the bare band and its seams the rivet strip, from two light directions with a plain sky light and no environment map;
- shrink the 2,048 and compare it with the 1,024;
- put a contact sheet of these in `checks/`.

Finish with `REPORT.md`: each file, how it was made, what you checked and saw, the height range in mm, the metres per tile, how long it took, and anything you are not satisfied with.
