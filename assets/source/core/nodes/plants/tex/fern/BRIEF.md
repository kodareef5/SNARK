# The fern atlas

Read `../BRIEF-common.md` first: it says what an atlas is, how the game uses it, the layout, the layers and the checks. This brief says what is on this one. The atlas's name is `fern`.

## The plant

A clump of arching sword-shaped fronds rising from a crown at the ground, in the shade at the foot of ruined walls: young fronds uncurling at the middle, old ones browned and lying at the edge. Clumps 0.5 to 1.0 m tall, 0.8 to 1.5 m across. The design is set by `../../ref/concept/ground/`: `fern.png`, `fern_individuals.png`, `fern_frond.png`, `fern_cut.png` and `NOTES.md`.

## The elements

Each clump is built from 12 to 24 fronds, each a long narrow card bent into an arch along its length. Paint each frond **straight and flat**, its stalk's foot at the bottom of its rectangle, its tip at the top: the script does the arching.

- **Six green fronds**, `frond1` to `frond6`, each its own: lengths from 55 to 110 cm, widths from 14 to 26 cm; leaflets (pinnae) in pairs along the stalk, longest a little below the middle, small toward the tip and the base, the lower 15 to 25% of the stalk bare. Make them differ: one fresh and bright, one darker and older, one with a broken or nibbled tip, one with a few leaflets browning, one narrow, one broad. The leaflets lie flat on the table, as a pressed frond does.
- **Two dead fronds**, `deadfrond1` and `deadfrond2`: brown and grey-brown, dry, leaflets curled and some missing, 50 to 90 cm.
- **Two young fronds**, `young1` and `young2`: 20 to 35 cm, pale bright green, the tip still curled in a crosier.
- **The crown column**, `bark`: the rightmost 96 pixels, full height: the fern's crown and stalk bases, brown and scaly with fine hairs, repeating from bottom to top; `metres` 0.5.

Scale: about 1400 pixels a metre throughout, so a 1.1 m frond is about 1540 pixels long and a 26 cm frond about 360 pixels wide.

## Deliver, in this folder

`fern_base.png`, `fern_height.png`, `fern_normal.png`, `fern_orm.png`, `layout.json`, `source/`, `build_atlas.py`, `check_atlas.py`, `checks/`, `REPORT.md`, as the common brief describes. No regions.
