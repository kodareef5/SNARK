# The sea grape atlas

Read `../BRIEF-common.md` first: it says what an atlas is, how the game uses it, the layout, the layers and the checks. This brief says what is on this one. The atlas's name is `seagrape`.

## The plant

A sprawling coastal shrub of the dunes and the beach edge: big round leathery leaves on short stalks along crooked smooth grey branches; some old leaves red and orange; hanging bunches of round fruit, green ripening to purple. Shrubs 1.2 to 2.5 m tall and 2 to 3 m across. The design is set by `../../ref/concept/coast/`: `seagrape.png`, `seagrape_individuals.png`, `seagrape_parts.png`, `seagrape_cut.png` and `NOTES.md`.

## The elements

Each shrub is built from 60 to 120 single leaves, each a card of its own, set along twisting modelled branches, and a few fruit bunches. Paint each leaf **with its short stalk**, the stalk's foot at the bottom middle of its rectangle, the blade above it.

- **Ten leaves**, `leaf1` to `leaf10`, each its own, 12 to 25 cm across: round to kidney-shaped, the base heart-shaped where the stalk joins, the edge a little wavy, flat or slightly cupped. Most are mature leathery green with pale or reddish midribs and veins; among them one young small yellow-green leaf, one with strong red veins, two old ones turning orange and red, one yellowing, one with holes eaten in it and one with a torn edge.
- **Three fruit bunches**, `fruit1` to `fruit3`: hanging bunches 12 to 25 cm long on a stalk, round fruit 1.5 to 2 cm, loose along the stalk; one mostly green, one green ripening to purple, one mostly purple. The stalk's foot is the anchor at the top of its rectangle here, since a bunch hangs: give `anchor` and `tip` as they are (the tip below the anchor).
- **One twig spray**, `twig1`: the end of a branch, 30 to 45 cm, a crooked grey twig with five to eight small young leaves at its tip, for the outer edge of a shrub.
- **The branch column**, `bark`: the rightmost 128 pixels, full height: the smooth grey-brown bark of the branches, mottled pale grey and tan, a little flaking, repeating from bottom to top; `metres` 0.7.

Scale: about 1300 pixels a metre throughout, so a 25 cm leaf is about 325 pixels across.

## Deliver, in this folder

`seagrape_base.png`, `seagrape_height.png`, `seagrape_normal.png`, `seagrape_orm.png`, `layout.json`, `source/`, `build_atlas.py`, `check_atlas.py`, `checks/`, `REPORT.md`, as the common brief describes. No regions.
