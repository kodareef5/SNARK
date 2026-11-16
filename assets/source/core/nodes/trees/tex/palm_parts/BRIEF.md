# Palm parts: the crownshaft, the crown, the nuts, the roots and the cut

You are painting one picture that dresses the smaller parts of the two palms of a survival game's ruined subtropical city: the royal palm's glossy green crownshaft, the coconut palm's fibrous crown, its coconuts, the thin roots that grip the ground at both palms' feet, their flower stalks, and the fibrous end a palm trunk shows when a player has hacked it down with a stone hatchet. Work only in the current folder. Take as long as it needs and keep going until you would ship it.

## What it looks like

The design is set. Open the concept pictures in `../../ref/concept/palms/`: `palm_parts.png` (the royal crownshaft, the coconut crown from below with its nuts and stalks, both feet), `palm_stumps.png` (the hacked stumps: a field of torn fibres, no growth rings), `grove_near.png`, and `DESIGN.md`, which gives the colours and roughness of each part. Paint to those.

## The layout: six regions of one picture

`guide/layout.png` and `guide/LAYOUT.json` show the regions in pixels. Each is laid on the model as follows; paint each to fill its region edge to edge.

- **crownshaft** (top left quarter, 1024 by 1024): the royal palm's smooth green sheath, laid round the shaft once: across the region is once round it (about 1.1 m of circumference), down the region is its length (about 1.9 m), the top row where the frond stalks leave and the **bottom row where it meets the grey trunk**. Glossy mid green with broad soft lighter streaks running down it, a few long smooth overlapping sheath edges running up it, a lighter green lip near the top, a thin ring of tan and grey at the very bottom where the trunk begins. **Its left and right edges must meet**, since it goes round.
- **sheath** (top right quarter): the coconut palm's crown: the thick bases of its frond stalks wrapped in brown woven-looking fibre that holds them to the trunk top. Laid round the head once (about 1.2 m round) and 0.75 m down, top row where the green stalks leave. Brown fibre mesh, darker in the gaps, stalk bases yellow-green to brown. Its left and right edges meet.
- **cut** (bottom left quarter): the end of a palm trunk hacked through by a stone hatchet, seen from straight above: a disc filling 80% of the region's width (the circle in the guide), its rim a ring of grey bark 2 to 3 cm wide, inside it a field of pale straw torn fibres and splinters, denser and darker toward the rim, with the facets of hatchet blows; no growth rings, no saw marks. Outside the disc, bark grey.
- **nut** (the left half of the bottom right quarter, 512 by 512): coconut husk, in three horizontal bands of a third each: **green** (top), **yellow** (middle), **brown** (bottom). Each band is laid round one nut once, from its top (the band's top row) to its tip (the band's bottom row), so each band's left and right edges must meet. Waxy smooth green and yellow with faint ridges; a dry, rough, fibrous brown.
- **root** (the right half of the bottom right quarter): a palm's thin roots, 2 to 10 mm across, laid along each root: down the region runs along the root from the trunk (top row) into the ground (bottom row), across goes once round it. Dusty orange-brown, darker and soil-caked toward the bottom. Left and right edges meet.
- **stalk** (bottom right eighth): flower and fruit stalks, laid along them as the roots are: pale ochre to tan, dry, finely ridged, with small knots. Left and right edges meet.

Leave a few pixels of matching colour at each region's border, so that a shrunk picture does not bleed one region into the next.

## Deliver, all 2048 by 2048 and pixel-aligned

1. `palm_parts_base.png`: base colour, sRGB, 8-bit RGB. Flat and unlit: no baked light or cast shadow.
2. `palm_parts_height.png`: 16-bit greyscale, white high: the sheath edges and streaks of the crownshaft, the fibres of the coconut crown, the torn fibres of the cut, the husk ridges. Say how many millimetres the full range is.
3. `palm_parts_normal.png`: tangent-space normal map, **OpenGL convention** (green toward the top of the picture), computed from the delivered height at the physical scale of each region.
4. `palm_parts_orm.png`: linear 8-bit RGB: red ambient occlusion, green roughness (about 0.25 to 0.35 on the glossy crownshaft, 0.4 to 0.6 on green nuts, 0.8 to 0.9 on fibre, roots, cut and brown husk), blue metalness 0.

Keep the generated source pictures at full size in `source/`, and the scripts that build every layer (`build_material.py`) and check them (`check_material.py`) in this folder, so the whole set rebuilds.

## What excellent looks like

The bar is the concept pictures, and the bar for a complete layer set is the wood plank wall in `../../../../../../../planning/art-trial/wood/` (start with `checks/layers.jpg`). Close up a player stands under the crown and looks up at it, and kneels at the stump to hack it: both must hold at arm's length. The image tool returns about 1254 pixels a side; reach 2048 by composing generated pictures in a larger master laid out on the guide and by adding fine detail by script.

## Checks to leave in `checks/`

A contact sheet of the four layers; the base colour over `layout.png`; each region that goes round something tiled twice across to show its left and right edges meet; the cut seen lit from two directions; and a JSON of your measurements (how hard each wrapping region jumps across its left and right edges against inside it, normal against height agreement).

## Report

Finish with `REPORT.md`: for each file, how it was made, which checks you ran and what you saw, the millimetres of the height range, and anything you are not satisfied with.

Do not use or imitate pictures from any existing game, and do not search for or download reference images. The concept pictures in this repository are ours: use them freely.
