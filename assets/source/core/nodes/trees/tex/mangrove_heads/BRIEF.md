# The red mangrove's crown: heads of leaves

This folder, `tex/mangrove_heads/`, is yours. Write nothing outside it. Do not run git.

## What it is for

A browser survival game draws a ruined, overgrown subtropical city by a bay; red mangroves stand at the water's edge on their curved prop roots. Its trees are built by scripts and drawn by its own renderer, and their crowns are now made of heads of leaves: rounded opaque cores 1.1 to 1.7 m across on the mangrove, each with cut-out sprays of leaves radiating from it, overlapping into a low, rounded, dark crown. Between the sprays, and on every head beyond 40 m, the head's own picture is what is seen.

The live oak's and the fig's heads were made this way first; learn from them: `../oak_crown/` and `../fig_heads/` (their briefs, reports and `feedback/`). Fine soft strokes read in the game as fur on stones; the same leaves as the cut-out sprays, crisp, at their size, in clumps with dark between, read as leaves. In the game the sky fills a crown's shade with blue, so paint warmer and more saturated than you would for white light.

The mangrove's cut-out sprays are `../mangrove_leaves/mangrove_leaves_base.png` cells 0 to 3 (its top-left quarter, 512 pixels for 0.8 m). Its leaves are the red mangrove's of `../../ref/concept/broadleaf/leaves.png` and `DESIGN.md`: opposite pairs of thick elliptic blades 9 to 13 cm by 4 to 6 cm, a pale midrib, a subtly rolled margin, glossy; upper leaf `#244A33`, variation `#365D3B`, underside `#708454`, fresh growth `#A4AF50`, a few brown leaves. Look at `mangrove_lineup.png`: a low, rounded, dark crown of glossy leaves, lit on top.

## The picture

The upper half of the mangrove's crown picture, 2048 by 1024 pixels, eight cells of 512 in two rows of four; the lower half holds the prop roots and is not yours.

- **Six cells: a head's top**, each a disc centred in its cell, radius 0.94 of the cell's half-width (241 pixels). The disc's middle is the top of the head, its edge a ring a little below its widest, where it curls under. Distance from the middle is distance along the head from its top; the disc's radius stands for about 1.1 m of surface, about 220 pixels a metre, so a leaf is 20 to 28 pixels long. Seen from outside, the picture lies on the head as seen from above; a head may be turned any way about its top and drawn 0.7 to 1.3 times that size. Row 1, cells 1 and 2: **sun heads** (top of the crown: lighter, yellower, glossy); row 1, cells 3 and 4: **middle heads**; row 2, cells 1 and 2: **shade heads** (low and inside: darker).
- **Row 2, cell 3: a head's underside**, a disc of the same size seen from below: leaf undersides in the head's shade, paler and duller, distinct against the dark between them, with the twigs carrying them.
- **Row 2, cell 4: the crown's dark interior**, deep shaded leaves as a seamless periodic tile 2.4 m square.
- Outside the discs, more leaves darkening to the cells' edges, unblurred.

Rows averaged should sit near: sun (92, 116, 50), middle (68, 92, 44), shade (48, 70, 40), undersides (80, 94, 56), interior (28, 44, 30); fresh growth no more than about (170, 176, 76); brown leaves 1 to 3 percent.

## The bar

A head is drawn about 35 pixels across at 20 m and 9 at 80 m, from a copy half this size on the phone tier. At 20 pixels it must still show a few bright clumps of leaves over dark folds, and at 9 a bright top over a dark underside; at 35 it must read as mangrove leaves, the same leaves as the sprays standing out of it. Paint no sun direction and no highlight from one side; do paint sun and shade leaves, the occlusion of folds, and the darkening toward a disc's edge.

## What to deliver

`mangrove_heads_base.png` (2048 by 1024, 8-bit sRGB, opaque), `mangrove_heads_normal.png` (2048 by 1024, tangent space as `../mangrove_leaves/` has it, normalised), `mangrove_heads_height.png` (2048 by 1024, 16-bit, range in millimetres stated), `mangrove_heads_orm.png` (1024 by 512: occlusion, roughness, zero metal; glossy above). One relief makes the height and the normals. The building script, the originals in `source/`, your own checks (a head at 35, 20 and 9 pixels lit from above and the side, beside the concept), and a `REPORT.md`. All imagery from words and this project's own pictures; no other game's pictures, no photographs, no web images.
