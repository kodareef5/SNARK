# The berry bush atlas, round 2

Read `BRIEF.md` and `../BRIEF-common.md` again: everything there still holds. Your first set is well made (clean cut-outs, true twins, good stripped tips and bark), and the bush built from it is wrong in a way only the elements can fix. Look at it: `checks/round1_in_game.png` is the bush built from 30 of your sprays, drawn by the game's own renderer from 2.6 m, beside `../../ref/concept/berry/direction_a.png`, which is what it must look like.

## What is wrong

1. **The sprays are too thin.** Each is one stem with a single file of leaves along it, mostly empty space between them. Thirty of them make a see-through broom, not a rounded shrub. A spray must be **the end of a branch**: a short woody stem that forks two to four times into side shoots, each crowded with leaves, so that the spray is a **leafy mass about as wide as it is long**, leaves overlapping in two or three layers, filling 60 to 75% of its outline, with small gaps of shadow between them and a ragged, lobed outline. Look at `above.png` and `direction_a.png`: every part of that bush's outside is made of such masses. `twig.png` is the least a spray may carry; most should carry more.
2. **The berry clusters are too small and too few** to be seen across a clearing. Make each cluster a full rounded bunch of 15 to 30 berries, 9 to 13 cm across, berries 1.1 to 1.4 cm, standing out at the tips of the shoots and along the outer side of the spray, two to four clusters on every berried spray. The twins lose all of them.
3. **The leaves read blue, not green, in the game.** The game lights a glossy surface with its sky, so a leaf of roughness 0.35 to 0.45 seen at an angle turns sky-blue. Keep the leaf faces at roughness 0.55 to 0.65, the berries at 0.35 to 0.45, and keep the base colour a full deep green, not grey-green.
4. **The space is wasted.** The sheet is mostly empty between narrow sprays. With sprays as wide as they are long, fill it.

## What to change

- The twelve sprays and twins, and the two inner sprays, as above: each 32 to 45 cm long and 25 to 40 cm wide, at about 1300 pixels a metre. Keep the stem foot (the anchor) at the bottom middle of each rectangle, a few centimetres of bare stem showing below the leaves.
- Keep `dead1`, `fallen1`, `stripped1`, `stripped2` and the bark column as they are, unless the new scale asks otherwise. The three single leaves may be made larger (8 to 10 cm) so they read on the ground.
- Everything else in the briefs stands: twins pixel for pixel, berries light grey and marked red in the regions, edge colours carried 32 pixels out, all checks.

Keep the first round's sources in `source/round1/` and its built layers out of the way, so this folder builds the new set. Add to `REPORT.md` what you changed and why.
