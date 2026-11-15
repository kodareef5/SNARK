# Palms: concept art

You are painting the concept art for the palms of a survival game's world. Work only in the current folder. Do not run git commands that write. Do not look up, copy or feed any other game's pictures, or any photograph, to the image tool; this is our own design, painted from words.

## What it is for

The game is a survival game closely modelled on ARK: Survival Evolved for how things behave, with its own art. Its first real map is a ruined, overgrown subtropical city on a bay: a drowned and broken coastal city a few generations after people left, which the plants of a hot coast are taking back. Palms, strangler figs, mangroves and hardwood hammock trees grow through cracked roads, plazas and the shells of buildings.

Trees are what a player harvests for wood and thatch, by walking up to the trunk and striking it with a stone hatchet; a used-up tree leaves a stump until it grows back. They are also most of what fills the view: a player sees one tree at arm's length while chopping it and thousands at once as a hillside 500 m away. So a tree must be handsome at 3 m and must still say "palm" as a few dozen pixels on a far slope.

A 3D modeller will build each tree by script, to your pictures, and a material artist will paint the bark and the leaves to the model. Paint what should be built, clearly enough to build it.

There are two kinds of palm, and each needs several individuals, because a grove of one tree copied looks false:

- **The tall palm: a royal palm.** A smooth, pale grey column, 14 to 20 m tall, nearly straight, swelling a little below its middle and narrowing above; faint pale rings where old fronds fell. At its top a long, glossy, bright green crownshaft (the smooth green sheath the fronds grow from), then a crown of long feathery fronds that arch up and out and droop at their tips, the lowest hanging down past the crownshaft before they fall. The kind that once lined the city's boulevards in rows; now some lean, some have lost fronds, some are half dead.
- **The leaning coast palm: a coconut palm.** A slender, ringed, grey-brown trunk 9 to 14 m long that leans out (toward the water, the light) and curves back upward, often with a kink or an S-bend; a swollen base with a mat of thin roots gripping the sand. A big, loose, drooping crown of long fronds with leaflets hanging from both sides of each midrib, a cluster of coconuts and old flower stalks under the crown, and a few dead brown fronds hanging against the trunk.

Sizes, so a modeller can build them: a royal palm's trunk is about 0.5 m across at breast height, swelling to 0.6 m, and its crownshaft about 1.5 to 2 m long; its fronds 3 to 4 m long. A coconut palm's trunk is 0.3 to 0.4 m across, swelling to 0.6 to 0.8 m at its very base; its fronds 4 to 5 m long, its crown 8 to 10 m across. A person is 1.8 m tall: put one in the pictures for scale.

Rules that come from the game:
- The trunk is what is struck, and the game treats it as a simple post for collision. Nothing wide may stand at the foot where a player would walk through it: the roots grip the ground in a tight mat close round the base, not sprawling.
- The tree must stand any rotation about its vertical and a range of sizes, so do not rely on one "front".
- Leaves are drawn as cut-out cards in the game, so the crown is made of distinct fronds with clear silhouettes, not a cloud.

## What to paint

Painted concept art in the look of a finished, high-end survival game at its best settings: stylized realism, readable chunky shapes, rich materials, believable light. Not photographs, not cartoons. Warm late-afternoon sun, real shadows, sky light in the shade.

1. **`royal_lineup.png`**: four royal palms side by side, each a different individual (height, swell, how full the crown is, one with a dead lower frond hanging, one leaning a few degrees, one young and short), standing on cracked old pavement with weeds, a person for scale, seen from the side at a distance that shows each whole tree. Plain, quiet background so the silhouettes read.
2. **`coconut_lineup.png`**: the same for four coconut palms: different leans, curves and kinks, crowns of different fullness, coconuts on some, dead fronds hanging on some, standing in sand and broken concrete at the edge of a beach.
3. **`palm_parts.png`**: a sheet of parts close up, labelled: a royal palm's foot (where the trunk meets the ground, with its mat of roots) and its crownshaft where the fronds leave it; a coconut palm's foot and its crown seen from below (frond bases, coconuts, flower stalks); one frond of each kind laid flat and seen from above, and seen from its side as it arches; a dead brown frond; the trunk surface of each at arm's length (rings, scars, texture).
4. **`palm_stumps.png`**: what is left when each kind is cut down by a player with a stone hatchet: a stump about 0.5 to 0.8 m tall, its top hacked and splintered. A palm is not wood like an oak: its cut shows a mass of fibres, not growth rings. Show both kinds, and a few fronds or chips lying by them.
5. **`grove_near.png`**: a player's view at eye height (1.7 m) of a grove of both kinds growing among the ruins of a boulevard by the bay: broken road, the stumps of lamp posts, a collapsed building with a palm through it, a couple of palms 3 to 10 m away and many more behind.
6. **`grove_far.png`**: the same kind of place seen from about 400 m: a hillside and a shore with hundreds of palms, where each tree is a few dozen pixels tall. This is the picture that matters most: what makes a far palm read as a palm (the dark crown star on a thin line, the lean, the spacing), and how the crowns' colours sit against the ground and the sea.
7. **`grove_far_flat.png`**: the same view drawn as a low-poly game draws it: every palm a few solid flat-coloured shapes (a trunk of a few faces, a crown of a handful of flat green blades), no textures at all, still clearly palms and still handsome.

## What excellent looks like

- **Every tree is an individual,** with a life written in its shape: the lean it grew into, the fronds it lost, the scar where something hit it.
- **Real structure, not a ball of noise.** A crown is a set of distinct fronds, each with its midrib, its arch and its droop; the crown has a clear star-shaped silhouette from below and from the side; you can count the fronds.
- **The foot grips the ground.** A palm's base flares a little and is wrapped in a mat of thin roots pushing into the sand or the cracks of the pavement; it does not stand on the ground like a pole stuck in.
- **Colour that is true and varied:** pale grey royal trunks, warm grey-brown coconut trunks; fronds from fresh bright green at the top through deeper green to yellowing and brown at the oldest; glossy crownshafts; coconuts green, yellow and brown.
- **It reads from far away,** as a silhouette and as a few colours.
- **Its own design.** Someone who knows ARK's tropical island should feel at home, and nothing is copied from any game.

## Deliver

The pictures above as PNG in this folder, each as large as the image tool gives. Then `DESIGN.md`: for each kind, the shape of an individual and the range among individuals (heights, trunk diameters along the trunk, lean and curve, number of fronds and their lengths, how they leave the trunk and arch, how many hang dead), the colours you intend for each part (sRGB), and what makes each read as itself at 3 m and at 500 m, so a modeller can build them from your notes and pictures. Keep everything you generate and do not keep in `source/`, and your exact prompts in `prompts.md`. Look hard at each picture, argue with it, and paint again until it is the best palm art you have seen in any game.
