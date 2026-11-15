# The live oak's heads, round 2: the same leaves as the sprays

Read your `REPORT.md` and `BRIEF.md` first. Your layout, tiers, means, interior tile, formats and checks all stand. What has to change is the leaves.

## What the game showed

Your heads are on the elder oak in the game (`feedback/`). Each head is now drawn as an opaque core, about 0.7 of its reach, with a dozen cut-out sprays from `../oak_leaves/` cells 0 to 3 radiating from it all round, so its outline is leaves from any side. Those sprays read as leaves at once. Between them, and on every head beyond 40 m where few sprays are drawn, your picture is what is seen, and there it reads as fur or moss on a stone: fine, even, soft-edged strokes with no leaf a player could point to, and folds that look like camouflage blotches rather than clumps of leaves. Side by side with the sprays it is plainly another plant at another scale. You flagged this yourself: the sprays' leaves are 8 to 12 cm, yours 3 to 5.

## What to make

Paint the heads with the sprays' leaves: the same narrow oval live oak leaves at **8 to 12 cm** (about 11 to 17 pixels long at your 138 pixels a metre), the same crisp painted edges and colours, in the same twig sprays, so a head reads as more of what radiates from it. The concept paints its oak's leaves at about this size too: look again at the clusters in `../../ref/concept/broadleaf/oak_lineup.png`. Each disc is a dense heap of such sprays seen from above (or, for the undersides, from below), shingled outward from the top, the upper ones overlying the lower.

Light and dark are what make it leaves at a distance: leaf faces clearly lighter than the dark between them, deep near-black green in the folds between sprays, so that at 25 pixels across a head shows a few bright clumps of leaves over dark, and at 12 pixels a bright top over a dark underside with a broken edge. Keep the folds as clumps of sprays, not as smooth blotches. Keep the leaves to the disc's edge and beyond into the dark corners, unblurred: the disc's edge is where a head turns under, not a fade.

From the ground a player mostly sees the heads from below, so the **undersides** are the cells seen most (`feedback/round1_game_20m_detail.jpg` is looking up at them): today they read as smooth dark stones between the sprays. They must read as leaves seen from beneath: the sprays' leaves turned over, their paler undersides in the head's shade, distinct against the dark between them, with the twigs that carry them.

Keep the row means within a few code values of what you delivered (so the crown's colour does not move), and keep everything that measured well. Update your checks for the new leaf scale, put your heads beside a crop of `feedback/` at the same size as one of the test's views, update `REPORT.md`, and remove what you supersede.
