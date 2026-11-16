# Live oak leaves, second set: the picture a crown is built from

You are painting the foliage of the live oak, the broad dark hardwood of the hammock in a survival game's ruined subtropical city. Work only in the current folder. Take as long as it needs and keep going until you would ship it.

A first set was made here and the crowns built from it failed: open `../../ref/renders/game_near_tree_2.jpg` and `../../ref/renders/lineup_tree.jpg` beside `../../ref/concept/broadleaf/oak_lineup.png`. The crowns read as torn grey-green paper with white flecks, see-through from every side. Part of that was the model (cards alone, scattered), which is being rebuilt; part was the picture: leaves too glossy, so they caught the sky and went grey-white; pale undersides as bright flecks everywhere; sprays so open they never massed. This set replaces it, with a new layout.

## What it looks like

The design is set. Open `../../ref/concept/broadleaf/oak_lineup.png`, `oak_trunk.png`, `hammock_near.png`, `leaves.png` (the live-oak twig, the Spanish moss) and `DESIGN.md` (the live oak section and the colour table). The concept's crowns are dense rounded billows of small dark leaves, stacked in shallow terraces, each billow lit on top and shaded beneath, with dark hollows and some sky between the billows, never through them. Live-oak leaves are narrow ovals 3 to 5 cm long and 1.2 to 2 cm wide, leathery, entire, crowded on short shoots.

## How the picture is used

A crown is about fifteen lobes, each a few rounded billows. Every billow is a closed low-polygon shell wearing **the mass**, with **cluster** cards laid over its surface at every angle, some standing out to break its outline. Shell and cards are lit by normals that round the whole billow, so the light and shade of a crown come from the model, not from the picture. Seen from 5 m the clusters and the mass between them are what a player sees; from 30 to 60 m they merge into billows; from 200 m the crown is drawn without this picture at all, in flat colours.

The layout is `guide/layout.png`, with its numbers in `guide/LAYOUT.json`:

- **Cells 0 to 3** (the top left quarter, 512 pixels each, **0.9 m across**): each a rounded cluster of leafy shoots seen from above, a short twig entering at the middle of the cell's bottom edge. Dense: a clump, its outline scalloped by leaf tips and a few shoots reaching out, its alpha covering most of its outline with only small gaps, so that a card shows leaves and, through it, the darker mass beneath. Four different ones: (0) a full round clump; (1) a broader, lop-sided clump of two or three sub-clumps; (2) a clump with fresh yellow-green tips and a very few brown leaves; (3) a smaller, longer spray of shoots for the crown's ragged edge.
- **Strip 1** (512 by 1024 pixels at the top right, **0.6 m wide, 1.2 m long**): a beard of Spanish moss hanging from the top edge where it clings under a limb: silvery grey-green curled filaments in tresses, denser near the top, tapering into airy wisps, with air between them. It must still read as a beard at 20 m, so its tresses need some body.
- **Strip 2** (the next 512 by 1024, **0.5 m wide, 1.0 m tall**): a tuft of fern standing on the bottom edge where it grows along the top of a limb: several fronds 15 to 35 cm long arching up and out, fresh green.
- **The mass** (the bottom half, 2048 by 1024, **4.8 m across and 2.4 m down**): leaves over leaves as the inside of a full crown shows them, the same leaves as the clusters at the same size, with no sky and no transparent pixel anywhere. It is the crown in its own shade: darker than the clusters, deepening to near black-green in the gaps between shoots. It is laid on the shells in pieces up to about 2.4 m across anywhere in its rectangle, so it must have nothing the eye catches twice, and it must tile left to right and top to bottom.

## Colour and light

In this game a leaf lit head on by the sun shows its base colour, one facing away shows about half of it, and there are no cast shadows. So paint the base colour as the concept's sunlit middle tones, not its shade, and keep it unlit: no light or shadow from a direction. For the oak: mature leaves around RGB 70 to 95, 88 to 112, 50 to 66, a cluster's mean near (82, 100, 60), fresh tips toward (135, 148, 75), the mass's mean near (52, 66, 42). Pale undersides only as an occasional turned leaf, under 3% of a cluster and no lighter than about (120, 128, 100): bright flecks read as noise from any distance. Moss `#929C87` with `#BBC0A5` tips; fern `#4F7435` with `#8DA647` young fronds, kept apart from the moss's grey.

Leaves here are **matte**: roughness 0.82 to 0.90 (twigs 0.85, moss 0.9, fern 0.85). Occlusion: the clusters 0.75 to 1, darker under overlapping leaves and toward a clump's middle; the mass deeper, down to 0.4 in its darkest gaps.

## Deliver, all 2048 by 2048 and pixel-aligned

1. `oak_leaves_base.png`: base colour, sRGB, 8-bit **RGBA**. Alpha cut at one half in the game, soft over one to two pixels round every leaf; colour continued out under transparent parts to each cell's edge so filtering shows no fringe; nothing within 12 pixels of a cell's or strip's edge but the twig, the moss's top and the fern's foot. The mass is opaque edge to edge.
2. `oak_leaves_height.png`: 16-bit greyscale, white high. Say how many millimetres the full range is.
3. `oak_leaves_normal.png`: tangent-space, **OpenGL convention** (green toward the top of the picture), computed from the delivered height at the physical scale.
4. `oak_leaves_orm.png`: linear 8-bit RGB: occlusion, roughness, metalness 0.

Keep the generated source pictures you build from at full size in `source/`, and the scripts that build every layer (`build_material.py`) and check them (`check_material.py`) here, so the set rebuilds. This set replaces the first: when yours is done, remove the first set's scripts, checks, sources and report, keeping anything of it you reused.

## What excellent looks like

The bar is the concept paintings, and for a complete layer set the wood plank wall in `../../../../../../../planning/art-trial/wood/` (start with `checks/layers.jpg`) and the palm frond sets in `../coconut_frond/` and `../royal_frond/`, which were accepted. The best broadleaf foliage you know of in any game. The image tool returns about 1254 pixels a side; reach 2048 by composing generated shoots and leaves in a larger master and adding fine detail by script.

## Checks to leave in `checks/`

A contact sheet of the four layers; the base over the layout; the alpha alone; the clusters shrunk to a half, a quarter, an eighth and a sixteenth, over mid-grey and over a pale sky, cut at one half; the mass tiled two by two; and the layers lit by the normal map from two sides. Then one test of the purpose: lay the clusters over the mass, as a card lies over a shell, and look at it at a size a 30 m view would draw it. A JSON of your measurements: alpha in the margins (none), each cluster's alpha against its outline at each shrink, the mass's alpha (all opaque), the mean colours, roughness and occlusion ranges, normal against height.

## Report

Finish with `REPORT.md`: for each file, how it was made, which checks you ran and what you saw, the millimetres of the height range, and anything you are not satisfied with.

Do not use or imitate pictures from any existing game, and do not search for or download reference images. The concept pictures in this repository are ours: use them freely.
