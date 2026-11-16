# Stump cuts: the hacked tops of the broadleaf stumps

You are painting the wood a player leaves behind in a survival game's ruined subtropical city when they have cut a tree down with a stone hatchet: the top of each stump, seen from above. A used-up tree stands as its stump until it grows back, so these are seen often and close, at a player's feet. Work only in the current folder. Take as long as it needs and keep going until you would ship it.

## What it looks like

The design is set. Open `../../ref/concept/broadleaf/stumps.png`, `banyan_stump.png` and `DESIGN.md` (its "Harvest remains" section, and the colour table's cut-wood rows: fig `#D9C392` with inner fibres `#B69A68` and torn edges `#E7D5AE`; oak `#DCC296` with heartwood `#AE855B` and torn fibres `#EAD6B1`; mangrove `#D2AA7F` with fresh fibres `#E3C49A` and a redder inner `#A87853`). A stone hatchet does not saw: it bites in irregular wedge-shaped facets from two or three sides, leaves a ridge or an off-centre knot of torn fibres where the last wood broke, splinters standing up along the break, growth rings interrupted by the facets, and the bark rim chipped and lifted where blows landed.

## The layout and how it is used

The picture is four quarters of 1024 pixels (`guide/layout.png`), each the top of one stump seen from straight above: **a disc filling 80% of the quarter's width**, centred, its rim the tree's bark 2 to 4 cm wide, inside it the hacked wood. The model lays the disc on the stump's cut so that the disc's edge falls on the stump's edge; outside the disc paint more of the bark, since a little of it may show at the rim.

- **Top left: fig** (and banyan), about 1.5 m across: pale, fibrous, rather soft wood, faint rings, and, because a strangler fig grew round something, a patch near one side where grey concrete shows through the wood.
- **Top right: live oak**, about 2 m across: dense pale sapwood round a darker brown heartwood, clear rings broken by the facets, dark furrowed bark at the rim.
- **Bottom left: mangrove**, about 0.5 m across: reddish wood, fine rings, grey-brown bark.
- **Bottom right: banyan main trunk**, about 2.2 m across: like the fig, with seams where its fused roots grew together across the cut.

## Deliver, all 2048 by 2048 and pixel-aligned

1. `stump_cuts_base.png`: base colour, sRGB, 8-bit RGB. Flat and unlit: no cast light or shadow; the darkness down in a facet belongs in the occlusion.
2. `stump_cuts_height.png`: 16-bit greyscale, white high: the facets, the ridge of torn fibres, splinters, the bark rim. Say how many millimetres the full range is (a few centimetres).
3. `stump_cuts_normal.png`: tangent-space normal map, **OpenGL convention** (green toward the top of the picture), computed from the delivered height at the physical scale of each quarter.
4. `stump_cuts_orm.png`: linear 8-bit RGB: red ambient occlusion, green roughness (fresh wood 0.75 to 0.9), blue metalness 0.

Keep the generated source pictures at full size in `source/`, and the scripts that build every layer (`build_material.py`) and check them (`check_material.py`) in this folder, so the whole set rebuilds.

## What excellent looks like

The bar is the concept pictures, the palm stump cut you can see in `../palm_parts/` (the bottom left quarter of `palm_parts_base.png`), and the bar for a complete layer set is the wood plank wall in `../../../../../../../planning/art-trial/wood/` (start with `checks/layers.jpg`). Fresh, raw, hacked wood that a player knows they made. The image tool returns about 1254 pixels a side; reach 2048 by composing generated pictures in a larger master and by adding fine detail by script.

## Checks to leave in `checks/`

A contact sheet of the four layers; the base colour over the layout; each disc lit from two directions with the normal map; and a JSON of your measurements (normal against height agreement).

## Report

Finish with `REPORT.md`: for each file, how it was made, which checks you ran and what you saw, the millimetres of the height range, and anything you are not satisfied with.

Do not use or imitate pictures from any existing game, and do not search for or download reference images. The concept pictures in this repository are ours: use them freely.
