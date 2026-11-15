# Study: the body feathers and the cream bars

Read `tex/studies/COMMON.md` first and follow it. Your folder is `tex/studies/body/`.

## What it shows

The plumage that covers most of the bird: breast, back, rump, flanks, neck and the covering feathers of the folded wing. In the design's words: rounded, soft feathers in loose overlapping rows, neat on breast and back. Five rows of narrow cream bars, each the pale tips of a row of feathers, cross the back and rump in chevrons; breast and belly are plain.

- **Each feather** is a broad, rounded, soft contour feather, about 3.5 to 4.5 cm long and 3 to 4 cm wide on breast and back (smaller on the neck), with a fine pale shaft running down its middle and fading before the tip, and soft vanes of fine barbs that curve out from the shaft. Its free edge is not a smooth line: it breaks up into a soft fringe of separate barb tips. It is soft and a little fluffy, the way a large plump ground bird's body feathers are, not stiff, not glossy.
- **The rows** overlap like roof tiles: each row hides the roots of the next by about half, so what shows of each feather is its rounded free end. The rows are loose: feathers vary in size, in angle (a few degrees either way), in how far they overlap and in how they sit against their neighbours; a row waves and sometimes two feathers crowd. It must not be a regular scale grid, a pinecone, or knitting. It must not be fur either: each feather is clearly a feather.
- **The bars.** A barred row is the same feathers with the outermost 4 to 6 mm of each visible free end in region 5 instead of region 0, so the row's tips together make a narrow scalloped band. The band follows each feather's real ragged tip, fringe and all, on the region map. In the base colour the tip is the same neutral grey as the rest (the dye makes it cream); keep its mean at 0.50 linear like every region. On the back, consecutive rows are barred, about 3 cm apart (see `ref/concept/top.png` and `back.png`).
- **The value drawing.** In the concept the rows read at a distance because each feather's free end is a little lighter than the part tucked under the row above, and the gaps between rows are dark. Part of that is relief and occlusion (yours to give in height and the packed map), part is the feather's own pigment. Find the balance that keeps the rows readable in the default slate, in hot pink and in near-black, without baking light into the base.

## Sets

1. `body_plain`: breast, belly, neck. 2,048 pixels for 0.427 m, tiling both ways. Feathers grow from the top of the picture and point down it.
2. `body_barred`: the back and rump, the same feathers with every row barred. Same scale, tiling both ways.
3. `body_tips`: a sheet of about 16 single loose feathers, cut out (RGBA), for the cards that break the bird's outline along back, breast and flanks: varied in size and shape, some plain and some with their tip barred (region 5 on the barred part). 2,048 pixels for 0.341 m (6,000 a metre, four times what the cards get on the bird). Give each element's box, root and tip in `study.json`.

For each generated feather, keep beside it in `source/` the layers the bird's painter will need to place it again: its cut-out, height, shaft, and how far each pixel lies from its free edge (so a bar of any width can be cut along the real tip).

## What excellent looks like

Up close, every visible feather is a real feather: a shaft, barbs you can follow, a soft broken edge, the slight lift of a feather lying over the one below. Shrunk to the bird, it is the soft slate plumage of `ref/concept/side.png`, with rows that read across the breast and cream chevrons that read across the back at middle distance, and the outline feathers break the silhouette with tips, not blur. No two neighbouring feathers look like copies. Dyed hot pink it is a hot pink bird with feathers, not a pink pattern.
