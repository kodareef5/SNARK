You are making one tiling material for the hand tools of a survival game. Work only in the current folder. Do not run git commands that write.

## What it is for

A survival game starts every player with nothing; in the first minutes they make three tools from a stick, a rock and some plant fibre: a stone pick, a stone hatchet and a spear. They are what a player holds most of the game, and in first person they sit at the bottom of the screen closer than anything else, for hours. Three tiling materials are being made for them at once, one each: `wood` (the hafts), `lashing` (this one) and `stone` (the knapped heads, in grey stone and dark flint). They are used together on every tool.

**This material: `lashing`, the binding that holds each head on.** Cord twisted by hand from plant fibre (the stripped inner fibres of a grass, a palm leaf or a nettle-like plant): two plies twisted together into a cord about 3.5 mm thick, slightly uneven, a little hairy with stray fibre ends, wound tightly turn beside turn round the haft and over the head. It is the visual centre of each tool: the thing that says "made by hand this morning". Straw tan with a faint green cast where the fibre is fresher, sun-bleached paler on the tops of the turns, darker and greener down in the grooves between turns.

## The layout (exact: the 3D meshes are mapped to it)

- **One tile covers 0.20 m by 0.20 m.** About 10,240 pixels a metre at 2,048.
- **The cord runs along image x**, every turn horizontal (a very slight slope is fine if it wraps), turn stacked beside turn down image y. A wrap round a haft is mapped with x going round the haft; a band of cord crossing over a stone head is mapped with x along the band.
- **Exactly 56 turns per tile**, each 1/56 of the tile tall (about 3.57 mm, 36.57 pixels at 2,048), so the turns wrap from bottom to top. Let the turns vary a little in thickness and twist, with the odd turn slightly proud or slightly sunk, so a wrap does not look machined; keep each turn's middle on its line.
- **It tiles in both directions.** The twist of each cord carries across the left-right wrap.
- Even in tone across the tile, no gradient.

## What the files must be

All PNG, pixel-aligned with one another, at **2,048 x 2,048** and the same set at **1,024 x 1,024** (the 1,024 must be what the 2,048 is when shrunk, within 30 dB; making it by shrinking the 2,048 is fine):

1. `lashing_base.png` (and `_1024`): base colour, 8-bit sRGB. Flat and unlit: no baked light, no shadows (the darker grooves between turns are pigment only where the fibre really is darker; the occlusion belongs in the occlusion map). Mean colour about sRGB (176, 152, 92).
2. `lashing_height.png` (and `_1024`): 16-bit greyscale height, white high: each turn a rounded cord with the twist of its two plies in it, the grooves between turns deep. Say in the report the physical range the full 0..65535 covers, in mm.
3. `lashing_normal.png` (and `_1024`): tangent-space normal, 8-bit, OpenGL (+X right, +Y up the image, +Z out), computed from the height at that physical scale and agreeing with it.
4. `lashing_orm.png` (and `_1024`): 8-bit linear, red ambient occlusion (strong in the grooves between turns), green roughness (fibre is matte: about 0.75 to 0.95), blue metalness (all 0).

## What excellent looks like

- In first person the binding is a band about 60 to 140 pixels across on screen: each turn readable as a twisted cord, the plies catching the light, stray fibres, the grooves dark. Native detail at 2,048, not an upscale.
- Further off and in a 64-pixel inventory picture: a pale tan, finely ribbed band that clearly stands out from the warm wood and the grey stone.
- The layers agree.

## The examples to beat

Finished materials of this game, in the main checkout, read only: `/home/user/Desktop/SNARK/assets/source/core/structures/wood/tex/timber/` (`timber_base.png`, `timber_normal.png`, `REPORT.md`), `/home/user/Desktop/SNARK/planning/artist-test/feather/` (`qa/layers_contact.png`, `REPORT.md`: a fibrous material from an earlier test). They are good: aligned, seamless, honest. Beat them: the most tactile material in the game.

## How

Your method, your tools. Python 3 with Pillow, numpy and scipy is installed. The image tool returns pictures of about 1,254 pixels a side whatever you ask for; 2,048 can be reached by generating elements and placing them in a larger master, or by building the cord procedurally and taking its fibre and colour detail from generated sources. Do not search the web for textures or use any picture you did not make. Keep every generated source in `source/` at full size, and your scripts in this folder (`build_material.py`, `check_material.py`), so the whole thing can be rebuilt.

Check your own work and fix what you see:
- offset by half the tile with wrap-around and look at the seams; tile it 3 by 3 and look at it small and large;
- check the 56 turns sit on their lines;
- recompute the normal from the saved height and compare;
- draw the layers side by side and a simple lit preview from two light directions;
- wrap a strip round a cylinder about 30 mm thick in a simple render if you can;
- shrink the 2,048 and compare it with the 1,024;
- put a contact sheet of these in `checks/`.

Finish with `REPORT.md`: each file, how it was made, what you checked and saw, the height range in mm, the metres per tile, how long it took, and anything you are not satisfied with.
