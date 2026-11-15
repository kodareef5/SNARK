# The creeper atlas

Read `../BRIEF-common.md` first: it says what an atlas is, how the game uses it, the layout, the layers and the checks. This brief says what is on this one. The atlas's name is `creeper`.

## The plant

A mass of climbing and trailing vine that smothers whatever it grows over (rubble, a dead shrub, the foot of a wall): heart-shaped and lobed leaves on long runners, the runners spilling over the edges and out across the ground, a few trumpet flowers. Masses 0.6 to 2 m tall and 1.5 to 3 m across. The design is set by `../../ref/concept/coast/`: `creeper.png`, `creeper_individuals.png`, `creeper_parts.png`, `creeper_wall.png`, `creeper_cut.png` and `NOTES.md`.

## The elements

Each mass is a low lumpy dome under a blanket of leaves. The dome itself is modelled and wears a band of this atlas painted as a dense mat of leaves; on it lie 25 to 50 cards, each a leafy run of vine, and from its edges runners reach out over the ground. Paint:

- **Eight leafy runs**, `run1` to `run8`, 35 to 55 cm long: a runner with five to twelve leaves along it, leaves 6 to 15 cm, overlapping, all turned up to the light as they lie on the mound. Each its own: some dense, some open, one with a flower open and a bud, one with a few yellowing leaves, one at the growing tip with small young leaves and a curling tendril. Their foot (where the runner comes out from under the others) is the anchor.
- **Two hanging strands**, `hang1` and `hang2`: a runner 60 to 90 cm hanging down with small leaves along it, for the edges of the mound and the face of a wall. The anchor at the top of its rectangle, the tip below.
- **Two ground runners**, `ground1` and `ground2`: a runner 60 to 90 cm with sparse leaves, as it creeps out across bare sand away from the mass.
- **The mat band**, `mat`: the **bottom 512 pixels of the picture, across its whole width**, a dense mat of the same leaves, overlapping in shade, seen from above, **repeating seamlessly from left to right**; fully opaque. It is wrapped round the dome under the cards and is seen only in the gaps between them, so keep it a little darker than the runs. Give it `"role": "band"` and `metres` 2.0 (the real width the picture's whole width covers). Nothing else may enter those rows.

Scale: about 1200 pixels a metre throughout for the runs, strands and runners.

## Deliver, in this folder

`creeper_base.png`, `creeper_height.png`, `creeper_normal.png`, `creeper_orm.png`, `layout.json`, `source/`, `build_atlas.py`, `check_atlas.py`, `checks/`, `REPORT.md`, as the common brief describes. No regions.
