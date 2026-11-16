# Broadleaf bark: fig, live oak and mangrove

You are painting the bark of three broadleaf trees of a survival game's ruined subtropical city: the strangler fig (and the banyan, which wears the same bark), the live oak of the hammock, and the red mangrove. Bark is what a player walks up to and strikes with a stone hatchet to harvest a tree, so it is seen at arm's length; it also carries every limb up into the crown. Work only in this folder's `fig_bark/`, `oak_bark/`, `mangrove_bark/` and `mangrove_roots/` subfolders: one complete layer set in each. Take as long as it needs and keep going until you would ship it.

## What they look like

The design is set. Open the concept pictures in `../ref/concept/broadleaf/`: `fig_trunk.png` and `fig_lineup.png`, `oak_trunk.png` and `oak_lineup.png`, `mangrove_lineup.png`, `stumps.png`, and `DESIGN.md`, which gives the colours of each part (its "Material colours" table). Paint to those.

- **fig_bark**: smooth, pale, living grey (`#A6A79C`), muscular rather than cracked: faint horizontal lenticel marks and creases, soft pale patches (`#C5C1AE`), cooler aged patches (`#6E7770`), a sparse damp green film (`#59634A`) in places, the odd small healed scar. Nearly smooth in relief, a millimetre or two, with gentle long folds. It is laid on the fig's fused root ribbons, its trunk and its limbs, so it must look right running along a root as well as up a stem.
- **oak_bark**: the live oak's dark, deeply furrowed bark (`#493F34`): long irregular plates 5 to 15 cm wide running up the stem, separated by deep narrow cracks (`#2E322C`), their ridges catching a lighter brown (`#6D5A43`) and small weathered grey edges (`#81725A`), patches of lichen. Plates that break and rejoin, never a regular grid. Relief of 1 to 2 cm: this is the bark that should make a player want to touch it.
- **mangrove_bark**: the red mangrove's upper trunk and limbs: pale grey-brown (`#8A8371`), smoothish, with fine vertical fissures, scattered lenticels, pale dry patches (`#A99C83`) and aged creases (`#655F50`). Relief of a few millimetres.
- **mangrove_roots**: the mangrove's prop roots, which stand in the mud and the tide. This one is laid **by height above the ground**, not repeated up the root: the picture's bottom row is 0.2 m below the mud, its top row 2.0 m above it, so the lowest 0.15 to 0.35 m above the mud (0.35 to 0.55 m up from the picture's bottom edge) is the wet band: dark grey-brown (`#4D5142`), darkest at the base (`#343F38`), with sparse green algae (`#6D734C`), a few barnacle-like specks and dried mud; then a soft, irregular wet line; and above it the same pale dry bark as `mangrove_bark`, with root texture (finer, more vertical, smoother than the trunk's). **Left and right edges meet** (it goes round each root); top and bottom need not.

## How they are laid on the tree: tiling

`fig_bark`, `oak_bark` and `mangrove_bark` are wrapped round each stem, root and limb and repeated along it: across the picture is once round a 0.5 m thick limb (about 1.6 m of circumference; thicker parts wear it more times round, thinner ones fewer), and down the picture is **2.0 m** of bark along it, the top row further from the ground. **Both pairs of edges must meet**, and a tree shows the picture dozens of times, so the repeat must not show: no scar, lichen patch or band of tone that the eye catches twice. Check it by tiling the picture three by three and four across by eight up.

## Deliver, in each folder, all 2048 by 2048 and pixel-aligned

1. `<name>_base.png`: base colour, sRGB, 8-bit RGB. Flat and unlit: no baked light or cast shadow; the darkness of a crack belongs in the occlusion.
2. `<name>_height.png`: 16-bit greyscale, white high. Say how many millimetres the full range is.
3. `<name>_normal.png`: tangent-space normal map, **OpenGL convention** (green toward the top of the picture), computed from the delivered height at the physical scale, wrapping as the picture wraps.
4. `<name>_orm.png`: linear 8-bit RGB: red ambient occlusion (deep in the oak's cracks), green roughness (about 0.6 to 0.9; the wet mangrove band glossier, 0.35 to 0.5), blue metalness 0.

Keep the generated source pictures at full size in each folder's `source/`, and the scripts that build every layer (`build_material.py`) and check them (`check_material.py`) in each folder, so the whole set rebuilds.

## What excellent looks like

The bar is the concept pictures, and the bar for a complete layer set is the wood plank wall in `../../../../../../planning/art-trial/wood/` (start with `checks/layers.jpg`). Three barks that a player could tell apart with their eyes shut: the fig's smooth pale skin, the oak's deep dark plates, the mangrove's fine grey-brown, and the wet band where the tide reaches. The image tool returns about 1254 pixels a side; reach 2048 by composing generated pictures in a larger master and by adding fine detail by script.

## Checks to leave in each `checks/`

A contact sheet of the four layers; the base colour tiled three by three (and, for the roots, two across); a relit preview from two directions; and a JSON of your measurements (how hard each pair of edges that must meet jumps against inside it, normal against height agreement).

## Report

Finish with `REPORT.md` in each folder: for each file, how it was made, which checks you ran and what you saw, the millimetres of the height range, and anything you are not satisfied with.

Do not use or imitate pictures from any existing game, and do not search for or download reference images. The concept pictures in this repository are ours: use them freely.
