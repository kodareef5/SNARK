# Live oak bark, second set

You are painting the bark of the live oak, the broad dark hardwood of a survival game's ruined subtropical city. A player walks up to its trunk and strikes it with a stone hatchet to harvest it, so it is seen at arm's length, and the same bark carries every limb up into the crown. Work only in the current folder. Take as long as it needs and keep going until you would ship it.

The first set here is technically sound but does not hold up on the tree: open `../../ref/renders/near_tree_2.jpg` and `../../ref/renders/game_near_tree_2.jpg` beside `../../ref/concept/broadleaf/oak_trunk.png`. On the trunk it reads as a flat brown cylinder with thin dark squiggles. The concept's bark is chunky: long blocky plates standing out from deep dark fissures, their faces and edges catching warm light, grey weathering on the oldest edges, a few lichen flecks, the whole grain flowing up the stem and round its bends. This set replaces the first.

## What it must do

Look at `oak_trunk.png`, `oak_lineup.png`, `hammock_near.png` and the oak section and colour table of `DESIGN.md` in `../../ref/concept/broadleaf/`. Live oak bark is dark and deeply furrowed into small, irregular, roughly rectangular plates, longer than wide (about 4 to 15 cm across, 6 to 25 cm along), separated by narrow fissures 1 to 3 cm deep, plates breaking and rejoining, never a grid or a brick wall.

The game lights it with one sun and the sky's even light, with **no cast shadows and no light bounced**: what makes a fissure dark in the game is its base colour and its occlusion, and what makes a plate stand out is its normal. So:

- **Base colour**: plate faces a warm mid brown (around `#6D5A43`, varying to `#5A4A38` and `#7A6550`), their worn edges and oldest faces greyer (`#81725A`), the fissures near black-brown (`#2E2A24` and darker in the deepest), occasional small grey-green lichen. The overall mean dark (near `#493F34`), but with a real spread from fissure to plate so the pattern reads at 10 m.
- **Height**: deep, so the normal map gives each plate a lit side and a shaded side under a low sun. Aim for 40 to 50 mm of range, most of it in the fissures.
- **Occlusion**: deep in the fissures (0.2 to 0.35), open on the plate faces.
- **Roughness**: 0.85 to 0.95, the lichen and weathered edges the roughest.

## Layout and tiling

The picture is wrapped round each stem and limb and repeated along it: across it is **1.6 m** of surface round the stem and down it is **2.0 m** along the stem, the top row further from the ground. Both pairs of edges must meet, and a tree shows the picture dozens of times, so no plate, scar or lichen patch may catch the eye twice. The fissures run mostly along the picture's height, wandering and branching.

## Deliver, all 2048 by 2048 and pixel-aligned

1. `oak_bark_base.png`: base colour, sRGB, 8-bit RGB, unlit.
2. `oak_bark_height.png`: 16-bit greyscale, white high. Say how many millimetres the full range is.
3. `oak_bark_normal.png`: tangent-space, **OpenGL convention** (green toward the top of the picture), computed from the delivered height at the physical scale, wrapping as the picture wraps.
4. `oak_bark_orm.png`: linear 8-bit RGB: occlusion, roughness, metalness 0.

Keep the generated source pictures at full size in `source/` and the scripts that build every layer (`build_material.py`) and check them (`check_material.py`) here, so the set rebuilds. This set replaces the first: when yours is done, remove what of the first you did not reuse (its sources, checks, report) and update `material.json`.

## What excellent looks like

The bar is `oak_trunk.png`, and for a complete layer set the wood plank wall in `../../../../../../../planning/art-trial/wood/` (start with `checks/layers.jpg`). Bark a player wants to touch.

## Checks to leave in `checks/`

A contact sheet of the four layers; the base tiled three by three; the layers lit from two low directions with no shadows, as the game lights them, flat and wrapped on a 2 m thick cylinder seen at 3 m and at 10 m; and a JSON of your measurements (how hard each pair of edges jumps against inside it, normal against height, the base colour's spread from fissure to plate).

## Report

Finish with `REPORT.md`: for each file, how it was made, which checks you ran and what you saw, the millimetres of the height range, and anything you are not satisfied with.

Do not use or imitate pictures from any existing game, and do not search for or download reference images. The concept pictures in this repository are ours: use them freely.
