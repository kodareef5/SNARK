# Royal palm fronds: the picture of a crown

You are painting the fronds of the royal palm, the tall pale palm of a survival game's ruined subtropical city. A crown is twelve to sixteen fronds, and this picture is every one of them, so it is most of what a royal palm is from 2 m to 500 m away: the thing a player looks up at, and the dark green star on a pale column across a valley. Work only in the current folder. Take as long as it needs and keep going until you would ship it.

## What it looks like

The design is set. Open the concept pictures in `../../ref/concept/palms/`: start with `palm_parts.png` (the royal frond seen from above and from its side, the crownshaft they leave), then `royal_lineup.png` and `grove_near.png`; `DESIGN.md` there, if it exists, has the numbers and colours. A royal palm frond is 3 to 4 m long: a short pale stalk, then a straight yellow-green midrib carrying many long, narrow leaflets, up to 80 or 90 cm at the middle of the frond and shorter toward both ends. The leaflets leave the midrib in several ranks at different angles, so the frond is feathery and full, not a flat comb: some point forward along the frond, some out to the side, some cross their neighbours. Each leaflet is a narrow blade 2.5 to 4 cm wide with a crease down its middle, tapering to a fine tip that droops. Fresh fronds are a clean bright to mid green, glossy; older ones deeper green; a dying one turns yellow, then orange-brown from its tip, its leaflets hanging and some broken.

## How it is used: a card folded along the midrib

Each frond in the game is one long card that runs along the frond's arching midrib and is folded along it into a shallow V, both sides drawn, so its two halves are its two wings of leaflets. Your picture is that frond seen from straight above and laid flat, and it is drawn **cut out**: where alpha is under one half nothing is drawn. So:

- **The picture is three fronds side by side**, each in a slot a third of the picture wide and the whole picture tall: its midrib straight up the middle of its slot, its foot (the cut end of the stalk) at the bottom row, its tip at the top row. `guide/layout.png` and `guide/LAYOUT.json` give every number: the slot edges, the midrib's column, how long the bare stalk is before the first leaflets, and a tick every half metre. A slot covers **4.2 m along the frond and 1.6 m across it** (0.8 m either side of the midrib): 488 pixels a metre along and 426 across, so paint to those proportions and a leaflet 85 cm long at 50 degrees reaches about 0.65 m out from the midrib.
- **Slot 0**: a mature, healthy frond, full and feathery, the one most of a crown wears. **Slot 1**: another healthy individual, a little younger and fresher green, its leaflets a little shorter and stiffer, so two neighbouring fronds never look the same. **Slot 2**: a dying frond: yellow-green at its foot through yellow and orange to brown at its tip, leaflets hanging, a few broken or missing.
- **The outline of the alpha becomes the card's shape.** The modeller measures, row by row, how far the leaflets reach either side of the midrib and cuts the card to that outline, so a tighter frond is a cheaper card on a phone. Keep every leaflet well inside its slot's margin (12 pixels, the dark green area of the guide), and leave no stray pixels outside the frond.
- **Colour under the alpha.** Where alpha is 0, the colour must still be leaf green, continuing the nearest leaflet (dilated out to the slot's edge), so that the filtered and shrunk picture shows no dark or pale fringe round the leaflets.
- **It must hold at a distance.** The game shrinks the picture by halves as a palm goes away. Leaflets must stay leaflets, not dust: at an eighth of its size (256 pixels tall) a frond must still read as a dark feathered blade with its midrib, and its alpha must still cover most of the frond's area. Check this by shrinking it yourself. Do not paint hair-thin leaflets with wide gaps; give them real width and let them overlap where they cross.
- Both sides of the card wear the same picture, so the frond must look right seen from above and from below. Paint it as seen from above in even daylight.

## Deliver, all 2048 by 2048 and pixel-aligned

1. `royal_frond_base.png`: base colour, sRGB, 8-bit **RGBA**, alpha as above. Flat and unlit: no cast shadow, no light baked in, but true colour differences (paler midrib, darker older leaflets, glossy highlights are not colour) are welcome.
2. `royal_frond_height.png`: 16-bit greyscale, white high: each leaflet's crease and rounded edges, the midrib standing up, leaflets crossing over one another. Say how many millimetres the full range is (about 5 to 10).
3. `royal_frond_normal.png`: tangent-space normal map, **OpenGL convention** (green toward the top of the picture), computed from the delivered height at the physical scale.
4. `royal_frond_orm.png`: linear 8-bit RGB: red ambient occlusion (darker where leaflets cross and close in along the midrib, 1 in open leaflet), green roughness (a fresh leaflet is waxy, about 0.45 to 0.6; the dying frond rougher), blue metalness 0.

Keep the generated source pictures at full size in `source/`, and the scripts that build every layer (`build_material.py`) and check them (`check_material.py`) in this folder, so the whole set rebuilds.

## What excellent looks like

The bar is the concept pictures, and the bar for a complete layer set is the wood plank wall in `../../../../../../../planning/art-trial/wood/` (start with `checks/layers.jpg`). The best foliage in any game you know of, on one card per frond. Real detail at full size: every leaflet its own blade with a lit and a shaded half either side of its crease, a vein of lighter green, a tip that tapers and sometimes splits; the midrib a smooth rounded stalk with a pale stripe. Not a symmetrical clip-art fern, not a comb of identical teeth: leaflets of different lengths and angles, some crossing, a gap where one is missing. The image tool returns about 1254 pixels a side; reach 2048 by composing generated fronds or leaflets on the guides in a larger master and by adding fine detail by script.

## Checks to leave in `checks/`

A contact sheet of the four layers; the base colour over `layout.png`; the alpha alone (white on black) with the slot margins drawn; the picture shrunk to a half, a quarter, an eighth and a sixteenth, each over mid-grey and over a pale blue sky, with the alpha cut at one half; the three fronds lit from two directions using the normal map; and a JSON of your measurements (how much alpha falls outside the margins, which must be none; the share of each slot's frond area covered by alpha at each shrink; normal against height agreement).

## Report

Finish with `REPORT.md`: for each file, how it was made, which checks you ran and what you saw, the millimetres of the height range, and anything you are not satisfied with.

Do not use or imitate pictures from any existing game, and do not search for or download reference images. The concept pictures in this repository are ours: use them freely.
