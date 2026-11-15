You are making one tiling material for the early guns and weapons of a survival game. Work only in the current folder. Do not run git commands that write.

## What it is for

A survival game's players start with sticks and stones and, after some hours, forge their first metal: a crossbow with a steel prod, a five-shot cap-and-ball revolver, a long single-shot rifle, a double-barrelled shotgun, an iron grenade, a tranquilizer dart. These are held in first person at the bottom of the screen, closer than anything else in the game. Their other materials already exist and you must sit beside them: a pale honey-tan stripped `wood` (mean about sRGB (164, 120, 76)), a straw-tan fibre `lashing` cord (about (176, 152, 88)), a dark knapped flint and a grey stone, and a brown `hide` leather being made now (about (122, 86, 56)).

**This material: `steel`, the metal of every one of them.** Hand-forged iron and steel from a village smithy, not a factory: dark browned-and-blued steel with the soft sheen of oil, long fine file and draw marks along the part, a few shallow hammer and pitting marks, faint scratches, a little rust-brown in the deepest pits only. Worn bright where hands and holsters rub. And some brass fittings: bands, a trigger guard, a dart's barrel, in warm aged brass. Honest, handled, slightly rough: a survivor made this, and kept it oiled.

## The layout (exact: the 3D meshes are mapped to it)

A trim sheet that tiles in both directions. **One tile covers 0.20 m by 0.20 m**, about 10,240 pixels a metre at 2,048. The meshes lay each part's **length along image x**, so file and draw marks run **along x (left to right) everywhere**. Bands are counted from the top of the image:

- **Rows 0 to 1/8 of the tile (25 mm): brass.** Aged yellow brass, mean about sRGB (168, 136, 74), with a few darker tarnish clouds and fine scratches along x; metallic, roughness about 0.35 to 0.5. Bands, a trigger guard, a dart's barrel are mapped here.
- **Rows 1/8 to 1/4 of the tile (25 mm): worn bright edge.** The same steel as the face, rubbed bare and bright where it is handled: pale steel grey, about sRGB (150, 150, 150), with fine polishing scratches along x, smoother (roughness about 0.25 to 0.35). The arrises of a barrel's flats, a hammer's spur, a cylinder's front, a prod's edges are mapped onto its middle.
- **Rows 1/4 to 1 of the tile (150 mm): the face.** The dark browned-blued steel: mean about sRGB (64, 64, 68), a very faint cool blue-brown variation in patches 20 to 60 mm long, file marks, a few pits, faint scratches; metallic, roughness about 0.4 to 0.6, even in tone, nothing so distinctive that it shouts when it repeats.
- **Every band tiles along x**, and top and bottom wrap: the bottom of the face meets the top of the brass, and that transition must be as soft as the others. A face of a mesh is mapped inside one band and never across a boundary, so soft natural transitions over about 3 to 4 mm are right.

## What the files must be

All PNG, pixel-aligned with one another, at **2,048 x 2,048** and the same set at **1,024 x 1,024** (the 1,024 must be what the 2,048 is when shrunk, within 30 dB; making it by shrinking the 2,048 is fine):

1. `steel_base.png` (and `steel_base_1024.png`): base colour, 8-bit sRGB. Flat and unlit: no baked light, no reflections, no occlusion, no gradient across a band. For a metal the base colour is its reflectance colour: so the dark steel face is dark-to-mid grey, not black.
2. `steel_height.png` (and `_1024`): 16-bit greyscale height, white high. Say in the report the physical range the full 0..65535 covers, in mm (a small one: about half a millimetre).
3. `steel_normal.png` (and `_1024`): tangent-space normal, 8-bit, OpenGL (+X right, +Y up the image, +Z out), computed from the height at that physical scale and agreeing with it.
4. `steel_orm.png` (and `_1024`): 8-bit linear, red ambient occlusion (shallow: only in pits and deep scratches), green roughness, blue metalness (255 on brass, bright edge and steel face alike; lower only in a rust pit).

## What excellent looks like

- In first person the pistol's barrel and the rifle's receiver are 100 to 300 pixels across on screen, lit by one sun and a sky with no reflections of an environment: the metal must read as metal from its own variation of roughness and the scratches catching light, not from a mirror. File marks you can follow along a barrel, a bright worn arris, brass that reads warm against the steel.
- In a 64-pixel inventory picture: dark steel against the honey wood, with a warm brass accent.
- The layers agree.

## The examples to beat

Finished materials of this game, in the main checkout, read only: `/home/user/Desktop/SNARK/assets/source/core/items/stone-tools/tex/stone/` (a trim sheet like this one: `stone_base_1024.png`, `flint_base_1024.png`, `REPORT.md`, `brief.md`), and `/home/user/Desktop/SNARK/assets/source/core/items/stone-tools/tex/wood/`. They are aligned, seamless, honest, with native detail. Beat them.

## How

Your method, your tools. Python 3 with Pillow, numpy and scipy is installed. The image tool returns pictures of about 1,254 pixels a side whatever you ask for; 2,048 can be reached by generating elements and placing them in a larger master, or by adding fine detail by script. Do not search the web for textures or use any picture you did not make. In your image prompts describe the metal in your own words and do not name any game, studio or franchise. Keep every generated source in `source/` at full size, and your scripts in this folder (`build_material.py`, `check_material.py`), so the whole thing can be rebuilt.

Check your own work and fix what you see:
- offset by half the tile with wrap-around and look at the seams; tile it 3 by 3 and look at it small and large;
- recompute the normal from the saved height and compare;
- draw the layers side by side and a simple lit preview of a metal sphere or cylinder from two light directions, with a plain sky light and no environment map;
- shrink the 2,048 and compare it with the 1,024;
- put a contact sheet of these in `checks/`.

Finish with `REPORT.md`: each file, how it was made, what you checked and saw, the height range in mm, the metres per tile, how long it took, and anything you are not satisfied with.
