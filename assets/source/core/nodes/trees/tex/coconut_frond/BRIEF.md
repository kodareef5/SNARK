# Coconut palm fronds: the picture of a crown

You are painting the fronds of the coconut palm, the leaning coast palm of a survival game's ruined subtropical city. A crown is twenty or more fronds, and this picture is every one of them, so it is most of what a coconut palm is from 2 m to 500 m away: the drooping green fountain a player stands under, and the dark green star on a curved line across the bay. Work only in the current folder. Take as long as it needs and keep going until you would ship it.

## What it looks like

The design is set. Open the concept pictures in `../../ref/concept/palms/`: start with `palm_parts.png` (the coconut frond seen from above and from its side, the crown from below, a dead frond), then `coconut_lineup.png` and `grove_near.png`; `DESIGN.md` there, if it exists, has the numbers and colours. A coconut frond is 4 to 5 m long: a stout yellow-green stalk, then a midrib carrying two rows of long, narrow, regularly spaced leaflets, up to a metre long at the middle of the frond and shorter toward both ends. Unlike the royal palm's feathery frond, a coconut's leaflets lie in one rank either side, close and parallel like the teeth of a comb but each its own: a little different in length and angle, a few torn by wind, the odd one missing. Each leaflet is a strap 3 to 5 cm wide with a crease down its middle, tapering to a fine tip. Fresh fronds are a warm yellow-green to mid green, glossy; older ones yellower with brown torn tips; dead ones hang brown and grey against the trunk, their leaflets curled and shrivelled.

## How it is used: a card folded along the midrib

Each frond in the game is one long card that runs along the frond's arching midrib and is folded along it into a V that opens downward, both sides drawn, so its two halves are its two hanging wings of leaflets. Your picture is that frond seen from straight above and laid flat, and it is drawn **cut out**: where alpha is under one half nothing is drawn. So:

- **The picture is three fronds side by side**, each in a slot a third of the picture wide and the whole picture tall: its midrib straight up the middle of its slot, its foot (the cut end of the stalk) at the bottom row, its tip at the top row. `guide/layout.png` and `guide/LAYOUT.json` give every number: the slot edges, the midrib's column, how long the bare stalk is before the first leaflets, and a tick every half metre. A slot covers **5.0 m along the frond and 1.9 m across it** (0.95 m either side of the midrib): 410 pixels a metre along and 359 across, so paint to those proportions and a leaflet a metre long at 55 degrees reaches about 0.8 m out from the midrib.
- **Slot 0**: a mature, healthy frond, the one most of a crown wears. **Slot 1**: an older frond, yellower, its tips browned and a few leaflets torn or missing, so a crown has its age written in it. **Slot 2**: a dead frond: dry brown and grey, leaflets curled, twisted and shrivelled to narrow strips, several missing, the midrib pale and cracked.
- **The outline of the alpha becomes the card's shape.** The modeller measures, row by row, how far the leaflets reach either side of the midrib and cuts the card to that outline, so a tighter frond is a cheaper card on a phone. Keep every leaflet well inside its slot's margin (12 pixels, the dark green area of the guide), and leave no stray pixels outside the frond.
- **Colour under the alpha.** Where alpha is 0, the colour must still be the leaf's colour, continuing the nearest leaflet (dilated out to the slot's edge), so that the filtered and shrunk picture shows no dark or pale fringe round the leaflets.
- **It must hold at a distance.** The game shrinks the picture by halves as a palm goes away. Leaflets must stay leaflets, not dust: at an eighth of its size (256 pixels tall) a frond must still read as a green comb with its midrib, and its alpha must still cover most of the frond's area. Check this by shrinking it yourself. Do not paint hair-thin leaflets with wide gaps; give them real width.
- Both sides of the card wear the same picture, so the frond must look right seen from above and from below. Paint it as seen from above in even daylight.

## Deliver, all 2048 by 2048 and pixel-aligned

1. `coconut_frond_base.png`: base colour, sRGB, 8-bit **RGBA**, alpha as above. Flat and unlit: no cast shadow, no light baked in, but true colour differences (paler midrib, browned tips, darker old leaflets) are welcome.
2. `coconut_frond_height.png`: 16-bit greyscale, white high: each leaflet's crease and rounded edges, the midrib standing up. Say how many millimetres the full range is (about 5 to 10).
3. `coconut_frond_normal.png`: tangent-space normal map, **OpenGL convention** (green toward the top of the picture), computed from the delivered height at the physical scale.
4. `coconut_frond_orm.png`: linear 8-bit RGB: red ambient occlusion (darker close in along the midrib and where leaflets overlap, 1 in open leaflet), green roughness (a fresh leaflet is waxy, about 0.45 to 0.6; the dead frond dry, about 0.85), blue metalness 0.

Keep the generated source pictures at full size in `source/`, and the scripts that build every layer (`build_material.py`) and check them (`check_material.py`) in this folder, so the whole set rebuilds.

## What excellent looks like

The bar is the concept pictures, and the bar for a complete layer set is the wood plank wall in `../../../../../../../planning/art-trial/wood/` (start with `checks/layers.jpg`). The best palm foliage in any game you know of, on one card per frond. Real detail at full size: every leaflet its own strap with a lit and a shaded half either side of its crease, a lighter vein, a tip that tapers, browns and sometimes splits; the midrib a smooth stalk with a pale stripe. Not clip art, not a comb of identical teeth: leaflets of different lengths and angles, the odd gap. The image tool returns about 1254 pixels a side; reach 2048 by composing generated fronds or leaflets on the guides in a larger master and by adding fine detail by script.

## Checks to leave in `checks/`

A contact sheet of the four layers; the base colour over `layout.png`; the alpha alone (white on black) with the slot margins drawn; the picture shrunk to a half, a quarter, an eighth and a sixteenth, each over mid-grey and over a pale blue sky, with the alpha cut at one half; the three fronds lit from two directions using the normal map; and a JSON of your measurements (how much alpha falls outside the margins, which must be none; the share of each slot's frond area covered by alpha at each shrink; normal against height agreement).

## Report

Finish with `REPORT.md`: for each file, how it was made, which checks you ran and what you saw, the millimetres of the height range, and anything you are not satisfied with.

Do not use or imitate pictures from any existing game, and do not search for or download reference images. The concept pictures in this repository are ours: use them freely.
