You are making one tiling material for the weapons of a survival game. Work only in the current folder. Do not run git commands that write.

## What it is for

A survival game's players make their weapons from what they gather: wood, plant fibre, stone, flint, animal hide, and later forged metal. A bow with a leather-wrapped grip, a rifle with a laced leather cheek pad, a bola of three stones sewn into leather pouches, arrows with cut leather vanes, a grenade with a leather grip band. These are held in first person at the bottom of the screen, closer than anything else in the game. Their other materials already exist and you must sit beside them: a pale honey-tan stripped `wood` (mean about sRGB (164, 120, 76)), a straw-tan fibre `lashing` cord (about (176, 152, 88)), dark knapped flint (about (74, 72, 76)), grey stone, and a dark forged `steel` being made now (about (64, 64, 68)).

**This material: `hide`, the leather.** Animal hide scraped, smoked and worked by hand: a supple, slightly oily, mid-to-dark warm brown leather, clearly darker and redder than the wood and browner than the cord. The grain side of a hide: fine pores and a faint pebbled grain, soft creases and wrinkles where it was bent and handled, a few healed scratches and a scar or two, slight variation in tone where it was smoked unevenly, a little burnished shine where it is gripped. No stitches, no seams, no cut edges, no tooling or patterns: the mesh's strips and pouches give the shapes.

## The layout (exact: the 3D meshes are mapped to it)

- **One tile covers 0.20 m by 0.20 m**, about 10,240 pixels a metre at 2,048. It is wrapped round grips in strips 15 to 30 mm wide, laid over pouches and cut into small flat vanes, so it has no direction: creases run every way, and no feature is wider than about 30 mm.
- **It tiles in both directions** without a seam. Even in tone across the tile (no gradient); its variety comes from grain, creases and the few features, spread evenly, nothing so distinctive that it shouts when it repeats.

## What the files must be

All PNG, pixel-aligned with one another, at **2,048 x 2,048** and the same set at **1,024 x 1,024** (the 1,024 must be what the 2,048 is when shrunk, within 30 dB; making it by shrinking the 2,048 is fine):

1. `hide_base.png` (and `hide_base_1024.png`): base colour, 8-bit sRGB. Flat and unlit: no baked light, no occlusion, no shadows. Mean colour about sRGB (122, 86, 56).
2. `hide_height.png` (and `_1024`): 16-bit greyscale height, white high. Say in the report the physical range the full 0..65535 covers, in mm (a small one: about a millimetre).
3. `hide_normal.png` (and `_1024`): tangent-space normal, 8-bit, OpenGL (+X right, +Y up the image, +Z out), computed from the height at that physical scale and agreeing with it.
4. `hide_orm.png` (and `_1024`): 8-bit linear, red ambient occlusion (shallow: only in creases and pores), green roughness (about 0.55 to 0.75, smoother where burnished), blue metalness (all 0).

## What excellent looks like

- In first person a bow's grip wrap fills a patch of the screen 60 to 150 pixels across, at about 1,500 to 3,000 pixels a metre: it should look like real worked leather you could feel, its pores and creases catching the light, softly satin where it is gripped. Native detail at 2,048, not an upscale.
- In a 64-pixel inventory picture: it reads as dark warm leather, clearly darker and redder than the wood and the cord.
- The layers agree.

## The examples to beat

Finished materials of this game, in the main checkout, read only: `/home/user/Desktop/SNARK/assets/source/core/items/stone-tools/tex/lashing/` and `/home/user/Desktop/SNARK/assets/source/core/items/stone-tools/tex/wood/` (`*_base_1024.png`, `*_normal_1024.png`, `REPORT.md`, `brief.md`). They are aligned, seamless, honest, with native detail. Beat them.

## How

Your method, your tools. Python 3 with Pillow, numpy and scipy is installed. The image tool returns pictures of about 1,254 pixels a side whatever you ask for; 2,048 can be reached by generating elements and placing them in a larger master, or by adding fine detail by script. Do not search the web for textures or use any picture you did not make. In your image prompts describe the leather in your own words and do not name any game, studio or franchise. Keep every generated source in `source/` at full size, and your scripts in this folder (`build_material.py`, `check_material.py`), so the whole thing can be rebuilt.

Check your own work and fix what you see:
- offset by half the tile with wrap-around and look at the seams; tile it 3 by 3 and look at it small and large;
- recompute the normal from the saved height and compare;
- draw the layers side by side and a simple lit preview from two light directions, and wrap a strip 25 mm wide round a 30 mm cylinder in a simple render if you can;
- shrink the 2,048 and compare it with the 1,024;
- put a contact sheet of these in `checks/`.

Finish with `REPORT.md`: each file, how it was made, what you checked and saw, the height range in mm, the metres per tile, how long it took, and anything you are not satisfied with.
