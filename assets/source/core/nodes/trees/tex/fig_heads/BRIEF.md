# The strangler fig's and the banyan's crowns: heads of leaves

This folder, `tex/fig_heads/`, is yours. Write nothing outside it. Do not run git.

## What it is for

A browser survival game draws a ruined, overgrown subtropical city whose canopy is live oaks, figs and banyans, its trees built by scripts and drawn by its own renderer. Their crowns are being rebuilt. A crown is now made of heads of leaves: rounded opaque cores, 2 to 3 m across on the fig, each with a dozen cut-out sprays of leaves radiating from it all round, so its outline is leaves from any side; the heads overlap over the crown's lobes, lit on their tops and dark beneath. Between the sprays, and on every head beyond 40 m, the head's own picture is what is seen, and it decides whether the crown reads as leaves or as green stones.

The live oak's heads were made this way first, and the second round is the one to learn from: `../oak_crown/` (its `BRIEF.md`, `BRIEF_ROUND2.md`, `REPORT.md`, and `feedback/`). Its first round painted fine, even, soft strokes, and in the game the heads read as fur on stones; its second painted the same leaves as the cut-out sprays, crisp, at their size, in clumps with dark between, and the heads read as leaves. Do as that second round did, for the fig.

The fig's cut-out sprays are `../fig_leaves/fig_leaves_base.png` cells 0 to 3 (its top-left quarter, 512 pixels for 1.2 m). Its leaves are the strangler fig's of `../../ref/concept/broadleaf/leaves.png` and `DESIGN.md`: alternate, leathery, smooth oval blades with a short point, 10 to 14 cm by 5 to 7 cm; upper leaf `#2E4C2C`, mature variation `#425D32`, underside `#647447`, young growth `#9AA448`. Look at the fig and the banyans in `fig_lineup.png`, `banyan_lineup.png`, `banyan_hall.png` and `hammock_near.png`: a broad dark dome of glossy leaves in clumps, lit on top.

## The picture

What you make is the upper half of the fig's crown picture, 2048 by 1024 pixels, eight cells of 512 in two rows of four; the lower half holds what the figs swallowed and is not yours.

- **Six cells: a head's top**, each a disc centred in its cell, its radius 0.94 of the cell's half-width (241 pixels). The disc's middle is the top of the head; its edge a ring a little below its widest, where it curls under. Distance from the middle is distance along the head from its top, and the disc's radius stands for about 2.2 m of surface: about 110 pixels a metre, so a leaf is 11 to 15 pixels long. Seen from outside the picture lies on the head as seen from above; a head may be turned any way about its top and drawn from 0.7 to 1.3 times that size. Row 1, cells 1 and 2: **sun heads** (top and outside of the crown: lighter, yellower, glossier); row 1, cells 3 and 4: **middle heads**; row 2, cells 1 and 2: **shade heads** (low and inside: darker, bluer).
- **Row 2, cell 3: a head's underside**, a disc of the same size seen from below, the edge the same ring: leaf undersides in the head's shade, distinct against the dark between them, with the twigs that carry them.
- **Row 2, cell 4: the crown's dark interior**, deep shaded leaves as a seamless periodic tile 2.4 m square.
- Outside the discs, more leaves darkening to the cells' edges, unblurred.

Rows of heads averaged should sit near: sun about (96, 112, 58), middle (74, 92, 52), shade (56, 74, 46), undersides (78, 90, 64), interior (36, 50, 36), the brightest young growth no more than about (160, 165, 80).

## The bar

A head is drawn about 60 pixels across at 20 m and 15 at 80 m, from a copy half this size on the phone tier. At 25 pixels it must still show a few bright clumps of leaves over dark folds, and at 12 a bright top over a dark underside with a broken edge; at 60 it must read as fig leaves, the same leaves as the sprays standing out of it. Paint no sun direction and no highlight from one side (the engine lights each head from wherever the sun is, through your normal map); do paint sun and shade leaves, the occlusion of folds, and the darkening toward a disc's edge where the leaves turn under.

## What to deliver

`fig_heads_base.png` (2048 by 1024, 8-bit sRGB, opaque), `fig_heads_normal.png` (2048 by 1024, tangent space as `../fig_leaves/` has it, `(-dH/dx, +dH/drow, 1)`, normalised), `fig_heads_height.png` (2048 by 1024, 16-bit, its range in millimetres stated), `fig_heads_orm.png` (1024 by 512: occlusion, roughness, zero metal; fig leaves are glossy above). One relief makes the height and the normals. The script that builds the layers from your generated pictures, the originals in `source/`, checks of your own (a head at 60, 25 and 12 pixels lit from above and the side, beside the concept), and a `REPORT.md`. All imagery from words and this project's own pictures; no other game's pictures, no photographs, no web images.
