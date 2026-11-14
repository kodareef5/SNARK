This is the fourth pass on the `boards` material in this folder, and a small one. Read `brief-3.md` and your `REPORT.md`. Work only in this folder; no git commands that write. Everything else stands: layout, height, normal and packed map stay as they are; only the base colour changes.

Pass 3 is right in kind: the figure, knots, fibre contrast, nail rims and weathering by height are what was wanted. On the modelled walls in daylight, though, the board-to-board spread is now too wide: the sun-bleached boards (4 and 7) read almost white-grey beside saturated orange ones, the dark boards (6 and 9) read almost brown-black, and a wall reads as stripes rather than as one wall of boards. Measured board means (HLS lightness L and saturation S):

    board 4  L 0.50 S 0.21     board 7  L 0.49 S 0.22
    board 6  L 0.34 S 0.41     board 9  L 0.34 S 0.39
    boards 10, 11  S 0.23      the rest L 0.39 to 0.44, S 0.37 to 0.42

Bring the boards closer together, about half the spread they have now, while keeping each board's own grain, figure and fibre contrast untouched:
- every board's mean L between about 0.37 and 0.45, and mean S between about 0.30 and 0.40;
- the bleached boards still the palest and greyest, but as weathered honey wood, not grey;
- the two lowest boards still a little greyer and darker than the rest, gently;
- overall mean still about sRGB (140, 102, 70).

Do it inside your build so it rebuilds the same. Rerun the checks, add a small before/after of the base colour to the contact sheet, and note the change in `REPORT.md`.
