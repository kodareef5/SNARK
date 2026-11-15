# The berry bush atlas

Read `../BRIEF-common.md` first: it says what an atlas is, how the game uses it, the layout, the layers and the checks. This brief says what is on this one. The atlas's name is `bush`.

## The plant

The berry bush is the first thing every new player looks for: they strip it by hand for berries and fibre. Several kinds of berry grow on the same bush and are told apart only by colour (red, deep blue, violet, yellow-orange, near black, white), so the game colours the berries itself. The design is set by the concept pictures in `../../ref/concept/berry/`: read `DIRECTIONS.md` and use the direction it chose, and its pictures `twig.png` and `twig_picked.png` where they exist (otherwise `direction_a.png`, the strongest so far). A rounded shrub about 1.1 m tall of small glossy leaves on stiff twigs, with berry clusters at the tips of the sprays and along them, on the outside where a hand reaches them.

## The elements

The bush is built from about 25 to 35 cards, each one leafy spray (the end of a branch: a twig with its leaves, 30 to 45 cm long), set on a short woody frame of stems. Paint:

- **Six berried sprays**, each different: different lengths (30 to 45 cm), shapes (upright and narrow, wide and fanning, leaning, forked into two tips), leaf counts and directions, with one to three berry clusters each (5 to 25 berries a cluster, each berry 0.8 to 1.3 cm) at and near their tips, hanging a little under their weight. Name them `spray1` to `spray6`.
- **Their six picked twins**, `spray1_bare` to `spray6_bare`: the same spray, pixel for pixel where it is unchanged, after a hand has stripped it. The berries are gone and the short stalks they hung from are left snapped and bare; a few leaves near them are torn away or torn half through. The script puts these on the inside of a full bush and everywhere on a picked one, so each must also look right as a spray that simply never bore fruit. Give each berried spray `"twin"` in `layout.json`.
- **Two inner sprays**, `inner1` and `inner2`: older growth from deep inside the bush, 30 to 40 cm, fewer and larger leaves, a little darker, some yellowing, no berries.
- **One dead twig**, `dead1`: a bare, grey, broken twig 30 to 40 cm with a few branchlets and one or two dry curled leaves.
- **One fallen spray**, `fallen1`: a spray snapped off and wilting, its leaves starting to droop, for the ground under a raided bush.
- **Two stripped tips**, `stripped1` and `stripped2`: the end of a branch after a hand has raked it, 25 to 35 cm: a bare twig with the empty berry stalks still on it and only one or two leaves left, as `picked.png` shows them standing out of a raided bush.
- **Three single leaves**, `leaf1` to `leaf3`, as they lie on the ground under a raided bush: one fresh and dark, one bruised, one yellowing; each with its short stalk as the anchor.
- **The stem column**, `bark`: the rightmost 96 pixels, full height, the bark of the bush's woody stems (smooth grey-brown with lenticels and a little lichen, 1.5 to 4 cm thick stems), repeating from bottom to top; `metres` 0.6.

Scale: about 1300 pixels a metre throughout, so a 40 cm spray is about 520 pixels long.

**Berries.** In the base colour, paint every ripe berry a light neutral grey (about 200 of 255), even and unshaded apart from a slightly darker calyx dot at its tip: the game multiplies it by the berry's colour and lights it with the normal map. Mark exactly those berries red in `bush_regions.png`. Leave two or three unripe berries in a few clusters painted in their own green or yellow-green and not marked, as real clusters have. Berry stalks are not marked. The leaves must stay a green that red, deep blue, violet, yellow-orange, near black and white berries all stand out against, and the bush's leaves must read as darker, cooler and glossier than the grasses, palmetto and fern around it.

## Deliver, in this folder

`bush_base.png`, `bush_height.png`, `bush_normal.png`, `bush_orm.png`, `bush_regions.png`, `layout.json`, `source/`, `build_atlas.py`, `check_atlas.py`, `checks/`, `REPORT.md`, as the common brief describes.
