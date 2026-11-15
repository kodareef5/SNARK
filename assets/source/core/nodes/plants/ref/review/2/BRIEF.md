# A second look at the low plants

You reviewed these five plants once (`../CRITIQUE.md`, from the pictures in `..`) and held them for another modelling pass. That pass is done, and the pictures in this folder are the rebuilt models drawn by the game's own renderer in the same way: one sun, its sky, no shadows, a plain checkered test ground (ignore the ground and sky).

- `game_patch.png`, `game_inside.png`: the 20 m square of all five from its edge and from inside, on medium.
- `game_row_<kind>.png`: every individual of a kind in front, what is left of each when harvested behind.
- `game_bush_four_sides.png`: one berry bush from four sides at 3 m.
- `game_colours.png`, `game_colours_lowpoly.png`: the berry bush dyed white, near-black, orange, violet, blue and red (left to right), on medium and on low, at about 7 m.
- `game_patch_lowpoly.png`: the patch on the low setting, flat palette colours, no textures.

What changed, in short: the bush is stems, forked branches and twigs carrying sprays turned 15 to 40 degrees from their neighbours, inner sprays across its holes, fruit atlas darker and redder; the palmetto has 9 to 20 fans folded deeper, the tall side behind, greener mix, and a cut state of square-cut stalks with a few fans on the ground; the fern's fronds arch over and down, with a feathered edge kept at the low setting, and its cut state keeps stalks, partial fronds and a fiddlehead; the sea grape's leaves come in groups of three to eight at nodes along its twigs, held every way; the creeper's mass sits inside its leaf fringe, and torn off it shows the rubble under it. Each plant must stay under 1600 triangles near, about 1600 at the second level, 400 and 60 beyond, so counts were traded against that.

Look as the same art director, and write `CRITIQUE.md` in this folder, shorter than the first:

1. For each kind, which of your first points are now met, which are not, and what is still most wrong, in terms a modeller can act on. Say plainly if a change made something worse.
2. The berry colours: can a player tell all six apart, and from the rest of the undergrowth?
3. The low setting, one line a kind.
4. Your verdict: ship, or hold, and if hold the few changes that must come first.

Do not paint or change anything; write the critique only. Work only in this folder.
