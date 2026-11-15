# Palm bark: the royal palm's column and the coconut palm's ringed trunk

You are painting the two trunk materials of the palms of a survival game's ruined subtropical city. A trunk is what a player walks up to and strikes with a stone hatchet to harvest it, so it is seen at arm's length, and it is also the pale or brown line that carries every crown on a far hillside. Work only in this folder's `royal_bark/` and `coconut_bark/` subfolders: one complete layer set in each. Take as long as it needs and keep going until you would ship it.

## What they look like

The design is set. Open the concept pictures in `../ref/concept/palms/`: `palm_parts.png` (both trunk surfaces at arm's length, both feet), `royal_lineup.png`, `coconut_lineup.png`, `grove_near.png`, `palm_stumps.png`, and `DESIGN.md`, which gives the colours, ring spacing and roughness. Paint to those.

- **royal_bark**: the royal palm's tall column. Smooth, chalky, pale grey, almost like weathered concrete, with slight warm and cool mottling; quiet, narrow, interrupted pale leaf-scar rings 15 to 30 cm apart, soft and low in contrast, never a ladder of stripes; fine short vertical fissures and hairline cracks between them; a few small grey-green lichen and algae patches and faint rain streaks; the odd shallow old scar. Nearly smooth in relief: a millimetre or two.
- **coconut_bark**: the coconut palm's slender leaning trunk. Warm grey-brown, worn and fibrous, with irregular pale raised ring ridges 7 to 18 cm apart where old fronds were (their spacing and thickness varying, some ridges broken or merging, a few closer together), shallow darker recesses between them, vertical fibrous grain and small checks within each band, patches of grey lichen. Relief of a few millimetres, not centimetre-deep corrugation.

## How they are laid on the trunk: tiling

Each picture is wrapped round its trunk once and repeated up it:

- **Across** the picture is once round the trunk; **down** the picture is **2.0 m of royal trunk** or **1.6 m of coconut trunk**, the top row higher up the trunk. A 14 m trunk shows the picture seven to nine times, one above the other, so the repeat must not show: no ring, scar or patch that the eye catches twice at the same spacing, no band of tone that steps at the picture's edge, a spread of rings that does not fall into a pattern at a 2 m or 1.6 m period.
- **Both pairs of edges must meet**: left with right (round the trunk) and top with bottom (up it). Check it by tiling the picture three by three.
- Across is about 1.6 m of circumference on the royal and 1.1 m on the coconut, so a ring runs straight across the picture, horizontal, and a fissure runs down it. Down the picture the scale is 1024 pixels a metre on the royal and 1280 on the coconut; across about 1280 and 1860, so the coconut's details are finer across than down. Paint them to look right when the picture is squeezed across by those amounts; a little stretch is fine.

## Deliver, in each folder, all 2048 by 2048 and pixel-aligned

1. `<name>_base.png`: base colour, sRGB, 8-bit RGB. Flat and unlit: no baked light or cast shadow; the darkness of a crevice belongs in the occlusion.
2. `<name>_height.png`: 16-bit greyscale, white high. Say how many millimetres the full range is.
3. `<name>_normal.png`: tangent-space normal map, **OpenGL convention** (green toward the top of the picture), computed from the delivered height at the physical scale, wrapping both ways.
4. `<name>_orm.png`: linear 8-bit RGB: red ambient occlusion, green roughness (about 0.65 to 0.85, lichen rougher), blue metalness 0.

Keep the generated source pictures at full size in each folder's `source/`, and the scripts that build every layer (`build_material.py`) and check them (`check_material.py`) in each folder, so the whole set rebuilds.

## What excellent looks like

The bar is the concept pictures, and the bar for a complete layer set is the wood plank wall in `../../../../../../planning/artist-test/wood/` (start with `checks/layers.jpg`). A player hacking at the trunk should see a real trunk, worn by sun and salt; a player looking up it should see it go on without a visible repeat. The image tool returns about 1254 pixels a side; reach 2048 by composing generated pictures in a larger master and by adding fine detail by script.

## Checks to leave in each `checks/`

A contact sheet of the four layers; the base colour tiled three by three, and three across by eight up, squeezed across as it sits on the trunk; a relit preview from two directions; and a JSON of your measurements (how hard each pair of edges jumps against inside it, normal against height agreement).

## Report

Finish with `REPORT.md` in each folder: for each file, how it was made, which checks you ran and what you saw, the millimetres of the height range, and anything you are not satisfied with.

Do not use or imitate pictures from any existing game, and do not search for or download reference images. The concept pictures in this repository are ours: use them freely.
