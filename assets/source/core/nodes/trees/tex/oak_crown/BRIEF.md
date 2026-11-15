# The live oak's crown: heads of leaves

This folder, `tex/oak_crown/`, is yours. Write nothing outside it. Do not run git.

## What it is for

A browser survival game draws a ruined, overgrown subtropical city whose canopy is live oaks, figs and banyans. Its trees are built by scripts and drawn by its own renderer. The trees' limbs and trunks are accepted; their crowns are being rebuilt, because from 20 to 80 m (where a player looks at trees most) they read as faceted green lumps and not as leaves.

The new crown is made of heads of leaves: about 120 rounded, closed, opaque puffs on the elder oak, each 1.6 to 2.8 m across, overlapping like shingles over the crown's lobes, with a dark core behind them, cut-out sprays of leaves standing out of their rims, and their own light (each head lit on its top and dark beneath, the whole crown lit toward the sun). Every head wears one cell of the picture you are making. The picture is what makes a head read as leaves rather than as green clay.

Look at the concept paintings in `../../ref/concept/broadleaf/`: `oak_lineup.png` (the elder live oak, middle), `hammock_near.png` (the oak behind the fig), `leaves.png` (the live oak twig, 24 cm, leaves 3 to 5 cm by 1.2 to 2 cm, narrow ovals, entire slightly recurved margins, pale undersides), and `DESIGN.md` (its colours: upper leaf `#344A35`, variation `#4C6241`, pale underside `#89917A`, new growth `#89934B`). The crowns in the oak concept are exactly what each head should be: a rounded mass of leaf sprays, its leaves visible as small strokes at its edges and in its folds, darker crevices between its sprays. The cut-out sprays that stand out of the heads are `../oak_leaves/oak_leaves_base.png`, cells 0 to 3 (its top-left quarter, 512 pixels for 0.9 m): match their leaves' shape, size in metres and colours, so a spray and the head it stands from are one plant.

## How a head wears its cell

The picture is 2048 pixels square, sixteen cells of 512 in four rows of four.

- **Rows 1 to 3: a head's top.** A disc centred in the cell, its radius 0.94 of the cell's half-width (241 pixels). The disc's centre is the top of the head; its edge is a ring a little below the head's widest, where it curls under. Distance from the centre is distance along the head's surface from its top, and the disc's radius stands for about 1.75 m of surface: about 138 pixels a metre, so a leaf is 4 to 7 pixels long and a spray (a twig's end with its leaves, 15 to 30 cm) 20 to 40 pixels. Seen from outside, the picture lies on the head as the head is seen from straight above, not mirrored. A head may be turned to any angle about its top and is drawn from 0.7 to 1.3 times that size, so nothing in a cell may say which way is north.
- **Row 1: sun heads**, the top and outside of the crown: sun leaves, smaller, lighter, yellower, a little glossy. **Row 2: middle heads.** **Row 3: shade heads**, low in the crown and inside it: shade leaves, larger, darker, bluer. Four different heads in each row, so neighbours never repeat. The same plant throughout.
- **Row 4, cells 1 and 2: a head's underside**, seen from below: a disc of the same size, its centre the bottom of the head, its edge the same ring where the top's disc ends. Leaves seen from beneath (the live oak's pale grey-green undersides, in the head's own shade) and the twigs carrying them radiating from near the middle, gaps between them dark.
- **Row 4, cells 3 and 4 together (1024 by 512): the crown's dark interior**, seen in the gaps between heads: deep shaded leaves as a seamless periodic tile, 4.8 m across and 2.4 m tall.
- **Outside the discs**, to the cells' edges: more leaves, darkening, so nothing bright bleeds into a disc as the picture is filtered and shrunk.

## The bar

The game draws a head at 20 m about 50 pixels across and at 80 m about 12, and on the phone tier from a copy of this picture at half its size, so most of what you paint is seen at a quarter to a sixteenth of its pixels. A head must still read at those sizes as a rounded mass made of several clumps of leaf sprays with darker folds between them, and at 20 m as leaves. A slack, even green noise, a pattern of identical dots, blotches with no leaves in them, or a flat wash of colour all fail at once. Under the tree, a player chopping the trunk looks up into the undersides: they must read as leaves and twigs, not as a green ceiling.

The engine lights each head from wherever the sun is, through your normal map, so paint no sun direction and no highlight from one side. Do paint what is the plant's and the head's own: sun and shade leaves, the occlusion of folds and crevices (in the occlusion channel, and gently in the colour), and the darkening of the leaves toward the disc's edge where they curl under into the head's shade. Heads of one row averaged together should sit near these means, so the crown keeps its green as it turns into flat colours far away: row 1 about (118, 126, 66), row 2 about (96, 108, 62), row 3 about (76, 90, 58), the undersides about (82, 92, 70), the interior about (48, 60, 42). The brightest new growth no more than about (165, 160, 85), and brown leaves at most 1 to 3 percent.

## What to deliver

`oak_crown_base.png` (2048, 8-bit sRGB, opaque), `oak_crown_normal.png` (2048, tangent space as `../oak_leaves/` has it: `(-dH/dx, +dH/drow, 1)`, normalised), `oak_crown_height.png` (2048, 16-bit, with its range in millimetres stated), `oak_crown_orm.png` (1024: occlusion, roughness, zero metal; live oak leaves are somewhat glossy above and rougher beneath). One set of relief makes the height and the normals, so they agree. The script that builds the layers from your generated pictures, the generated originals in `source/`, checks of your own (a head drawn at 50, 25 and 12 pixels across lit from above and from the side, beside the oak concept, is the test that matters), and a `REPORT.md` saying what you made and how it measures. Remove what you supersede.

All imagery from words and from this project's own pictures named above; no other game's pictures, no photographs, no web images.
