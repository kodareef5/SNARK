# Fig bark, second set

You are painting the bark of the strangler fig and the banyan, the great pale figs of a survival game's ruined subtropical city. It covers the fig's wall of fused roots, every limb up into the crown, and each of the banyan's pillar roots, so it is the whole of a fig but its leaves. Work only in the current folder. Take as long as it needs and keep going until you would ship it.

The first set here is clean and tiles well, but on the trees in the game it reads as **white plastic**: pale, even, smooth pipes. Open `../../ref/renders/lineup_banyan.jpg` and `../../ref/renders/game_near_fig_2.jpg`, then `../../ref/concept/broadleaf/fig_trunk.png`, `fig_lineup.png`, `banyan_lineup.png` and `banyan_hall.png`. The concept's fig is pale too, but it is living wood: warm cream on the crowns of its folds, cool grey in the older parts, grey-green films of algae and lichen in patches, darker damp streaks running down from forks, pale lichen rosettes, fine horizontal lenticel dashes, and creases and wrinkles bunched where the wood bends or two roots meet. This set replaces the first.

## What it must do

The game lights it with one sun and the sky's even light, with **no cast shadows and no light bounced**. A surface facing the sun shows about its base colour, so a pale even base colour turns into a white tube whatever the model does. So:

- **Base colour**: a mean near **(150, 150, 138)**, a grey with a little warmth, never brighter than about (190, 185, 165) on the palest crowns of folds. Variation that reads from 10 to 30 m: mottled patches 20 to 80 cm across of warmer cream, cooler grey (`#6E7770`), grey-green film (`#59634A`, sparse), and darker damp streaks (around (95, 98, 85)) a few centimetres wide and up to a metre long, running along the picture's height; then at arm's length the lenticels, lichen rosettes (pale grey-white, 2 to 6 cm), and small healed scars. Not a pattern that repeats inside the picture, and nothing loud enough to catch the eye twice across a tree.
- **Height**: smooth but not flat: soft folds and wrinkles running along the picture's height, a few bunched creases across it, shallow lenticels; 10 to 20 mm of range, so the normal map gives the folds a lit and a shaded side under a low sun.
- **Occlusion**: in the creases and wrinkles, 0.6 to 1.
- **Roughness**: 0.8 to 0.92; the algae film and damp streaks a little smoother.

## Layout and tiling

The picture is wrapped round each root, limb and pillar and repeated along it: across it is **1.6 m** of surface round the stem and down it is **2.0 m** along it, the top row further from the ground. Both pairs of edges must meet. It is shown dozens of times on a tree, so check it tiled three by three and four across by eight up.

## Deliver, all 2048 by 2048 and pixel-aligned

1. `fig_bark_base.png`: base colour, sRGB, 8-bit RGB, unlit.
2. `fig_bark_height.png`: 16-bit greyscale, white high. Say how many millimetres the full range is.
3. `fig_bark_normal.png`: tangent-space, **OpenGL convention** (green toward the top of the picture), computed from the delivered height at the physical scale, wrapping as the picture wraps.
4. `fig_bark_orm.png`: linear 8-bit RGB: occlusion, roughness, metalness 0.

Keep the generated source pictures at full size in `source/` and the scripts that build every layer (`build_material.py`) and check them (`check_material.py`) here, so the set rebuilds. When yours is done, remove what of the first set you did not reuse (its sources, checks, report) and update `material.json`.

## What excellent looks like

The bar is `fig_trunk.png`. For a complete layer set, the wood plank wall in `../../../../../../../planning/art-trial/wood/` (start with `checks/layers.jpg`), and `../oak_bark/`, just remade to this bar.

## Checks to leave in `checks/`

A contact sheet of the four layers; the base tiled three by three and four by eight; the layers lit from two low directions with no shadows, as the game lights them, flat and wrapped on a 1.8 m thick cylinder and a 0.4 m thick one seen at 3 m, 10 m and 30 m, each lit from in front of the viewer and from the side; and a JSON of your measurements (how hard each pair of edges jumps against inside it, normal against height, the base colour's mean and spread).

## Report

Finish with `REPORT.md`: for each file, how it was made, which checks you ran and what you saw, the millimetres of the height range, and anything you are not satisfied with.

Do not use or imitate pictures from any existing game, and do not search for or download reference images. The concept pictures in this repository are ours: use them freely.
