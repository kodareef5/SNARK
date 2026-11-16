# Mangrove leaves, second set: the picture a mangrove's crown is built from

You are painting the foliage of the red mangrove, the low tree on arching roots at the water's edge of a survival game's ruined subtropical city. Work only in the current folder. Take as long as it needs and keep going until you would ship it.

A first set was made here and the crowns built from it failed (`../../ref/renders/lineup_mangrove.jpg`, `game_near_mangrove_3.jpg` beside `../../ref/concept/broadleaf/mangrove_lineup.png`): sparse plates, no mass. The model is being rebuilt on a new crown system, which the live oak already uses; its leaf atlas, `../oak_leaves/`, is the nearest example of what this set must be (read its `BRIEF.md`, `BRIEF_ROUND2.md`, `BRIEF_ROUND3.md` and `REPORT.md`: three rounds of what worked on the crowns in the game and what did not). This set replaces the first, in a new layout.

## What it looks like

Open `../../ref/concept/broadleaf/mangrove_lineup.png`, `hammock_near.png`, `leaves.png` (the mangrove twig) and `DESIGN.md` (the mangrove section and the colour table). A mangrove's crown is low, rounded and dense, a scalloped mass of clumps; its leaves are thick smooth ellipses 9 to 13 cm long in opposite pairs, crowded in rosettes at the twig ends, glossy dark green above with a pale midrib, yellow-green underneath, a few fresh yellow-green and a very few brown ones.

## How the picture is used

A crown is five to nine lobes, each a few rounded billows. Every billow is a closed low-polygon shell wearing **the mass**, with **cluster** cards lying on its top, standing out round its rim and hanging under it. Shell and cards are lit by normals that round the whole billow, so the crown's light and shade come from the model; under the billows the shell's lower faces also wear the rim clusters, cut out, so from beneath there is sky between clumps. A mangrove is seen from 3 m as a player wades to it and from 500 m as a dark band along the shore.

The layout is `guide/layout.png`, with its numbers in `guide/LAYOUT.json`:

- **Cells 0 to 3** (the top left quarter, 512 pixels each, **0.8 m across**): each a cluster of leafy twig ends seen from above, a short grey-brown twig entering at the middle of the cell's bottom edge. Cells 0 and 2 lie on the tops of the billows: (0) a full rounded clump of three to five rosettes of opposite leaves; (2) the same with fresh yellow-green pairs at a few tips and one brown leaf. Cells 1 and 3 stand round the rims and hang beneath, seen from the side and below as often as above: (1) a broader, lop-sided clump; (3) a longer spray with more leaves turned to show their undersides.
- **Strips 1 and 2** (each 512 by 1024 pixels at the top right, **0.45 m wide, 0.9 m long**): two long sprays of a twig's end seen from above, the twig entering at the middle of the bottom edge, its opposite pairs of leaves crowding toward the tip; one straight, one bending. They stand out of the crown's edge.
- **The mass** (the bottom half, 2048 by 1024, **4 m across and 2 m down**): the outside of a full crown, leaves over leaves, no sky and no transparent pixel, tiling left to right and top to bottom with nothing the eye catches twice.

## What the oak's rounds taught

- **Paint the leaves larger than botany** so they read on a crown: about 13 to 17 cm long here.
- **Rosettes over rosettes, overlapping like shingles**, sizes varied, at different depths. Never a tiling of discs, never a line drawn round a rosette or clump (the oak's second round read as cobblestones from that).
- **Shade is pooled, not drawn**: where the eye looks down between groups of rosettes, an irregular darker hollow of deeper leaves, darker in base colour and in occlusion.
- **Each leaf tilted** 20 to 50 degrees its own way, and that tilt in the height (let its range be 100 to 160 mm), so under the game's sun the leaves facing it light up and the rest go dark.
- **The clusters and the mass are the same leaves in the same light**, so a card shows as a ragged edge and a little relief, not a spot of another tone.

## Colour and light

In this game a leaf lit head on by the sun shows its base colour, one facing away about half of it, with nothing bounced and no cast shadows. Paint the concept's sunlit middle tones, unlit. For the mangrove: the clusters' mean near **(76, 98, 56)**, a cooler, deeper green than the oak's olive; the pale midribs visible up close; fresh tips toward (150, 160, 72); the mass near **(62, 82, 48)**, darker only in its hollows. Undersides yellower and paler, as an occasional turned leaf. In this light leaves read glossy only by the normal map's relief, so keep them **matte**: roughness **0.9 to 0.95**; occlusion 0.75 to 1 on the clusters, down to 0.45 in the mass's hollows.

## Deliver, all 2048 by 2048 and pixel-aligned

1. `mangrove_leaves_base.png`: base colour, sRGB, 8-bit **RGBA**. Alpha cut at one half in the game, soft over one to two pixels round every leaf; colour continued under transparent parts to each cell's edge; nothing within 12 pixels of a cell's or strip's edge but the twigs. The mass is opaque edge to edge.
2. `mangrove_leaves_height.png`: 16-bit greyscale, white high. Say how many millimetres the full range is.
3. `mangrove_leaves_normal.png`: tangent-space, **OpenGL convention** (green toward the top of the picture), computed from the delivered height at the physical scale.
4. `mangrove_leaves_orm.png`: linear 8-bit RGB: occlusion, roughness, metalness 0.

Keep the generated source pictures you build from at full size in `source/`, and the scripts that build every layer (`build_material.py`) and check them (`check_material.py`) here, so the set rebuilds. When yours is done, remove the first set's scripts, checks, sources and report, keeping anything of it you reused.

## What excellent looks like

The bar is the concept paintings; for a complete layer set the wood plank wall in `../../../../../../../planning/art-trial/wood/` (start with `checks/layers.jpg`) and the palm frond sets in `../coconut_frond/` and `../royal_frond/`, which were accepted. The best broadleaf foliage you know of in any game. The image tool returns about 1254 pixels a side; reach 2048 by composing generated pictures in a larger master and adding detail by script.

## Checks to leave in `checks/`

A contact sheet of the four layers; the base over the layout; the alpha alone; the clusters shrunk to a half, a quarter, an eighth and a sixteenth over mid-grey and over a pale sky, cut at one half; the mass tiled two by two; the layers lit by the normal map from two sides. Then the purpose: clusters over a shell of the mass, as on a billow, at the size a 20 m view would draw it, under the sun behind the viewer and high behind the billow, beside a crop of `mangrove_lineup.png` at the same scale. A JSON of your measurements: alpha in the margins (none), each cluster's coverage of its outline at each shrink, the mass all opaque, mean colours, roughness and occlusion ranges, normal against height.

## Report

Finish with `REPORT.md`: for each file, how it was made, which checks you ran and what you saw, the millimetres of the height range, and anything you are not satisfied with.

Do not use or imitate pictures from any existing game, and do not search for or download reference images. The concept pictures in this repository are ours: use them freely.
