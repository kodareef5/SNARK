# The saw palmetto atlas

Read `../BRIEF-common.md` first: it says what an atlas is, how the game uses it, the layout, the layers and the checks. This brief says what is on this one. The atlas's name is `palmetto`.

## The plant

A low clumping fan palm of the sunny lots and sandy ground of a ruined subtropical city: stiff fans split into many narrow pointed segments, on long thin toothed stalks, rising from fibrous trunks that creep along the ground; old fans turn orange-brown and hang down at the base. Clumps 0.9 to 1.6 m tall, 1.5 to 2.5 m across. The design is set by `../../ref/concept/ground/`: `palmetto.png`, `palmetto_individuals.png`, `palmetto_fan.png`, `palmetto_cut.png` and `NOTES.md`.

## The elements

Each clump is built from 10 to 20 fans. A fan is a card bent along its middle into a shallow V, as real palmetto fans are folded; the stalk under it is a thin modelled stem. So paint each fan **without its stalk**, the point where the stalk meets the blade (the hastula) at the bottom middle of its rectangle as the anchor, the segments radiating up and out from it.

- **Six fans**, `fan1` to `fan6`, each 55 to 85 cm across, each its own: a fresh one, yellow-green and stiff; two mature ones, blue-green to silvery green; an older one, duller, a few segment tips dry and split; one with segments torn and hanging loose; one bleached and yellowing. Real fans are not full circles: most are a little more than a half circle, segments longest in the middle, some segments split at their tips into two points, and the odd one broken.
- **Two dead fans**, `deadfan1` and `deadfan2`: orange-brown to grey-brown, dry and curled, segments splitting, as they hang at the base of a clump.
- **One spear**, `spear1`: the new leaf before it opens, a tight folded spike 40 to 60 cm, pale green, rising from the middle of the clump.
- **The stalk column**, `stalk`: 64 pixels wide, immediately left of the trunk column, full height: the leaf stalk seen straight on, 1.5 cm thick, pale yellow-green with a darker edge and small sharp teeth along both edges, repeating from bottom to top; `metres` 1.0.
- **The trunk column**, `bark`: the rightmost 128 pixels, full height: the creeping trunk, 8 to 15 cm thick, covered in old leaf bases and brown fibre, repeating from bottom to top; `metres` 0.8.

In `layout.json` give the stalk column `"role": "bark"` too. Scale: about 1100 pixels a metre throughout, so an 80 cm fan is about 880 pixels across. The fans are the largest elements: arrange them first.

## Deliver, in this folder

`palmetto_base.png`, `palmetto_height.png`, `palmetto_normal.png`, `palmetto_orm.png`, `layout.json`, `source/`, `build_atlas.py`, `check_atlas.py`, `checks/`, `REPORT.md`, as the common brief describes. No regions.
