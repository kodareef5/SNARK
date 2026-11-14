# Roof, round 3: the top and bottom edges

Round 2 is accepted: the golden reeds, the cut butts, the twisted bindings and the relief are right. One thing fails the engine's asset check, which judges whether a tiling picture wraps. It compares, for each layer, the mean absolute difference between the last row and the first row (and the last and first column) with the mean difference between neighbouring rows (columns) inside the picture:

```
edge_x = sum |p[y][w-1] - p[y][0]|        over all rows and channels
inner_x = sum |p[y][x] - p[y][x+1]|        over all rows, channels and x < w-1
seam_x = edge_x * (w - 1) / inner_x        and the same down the picture for seam_y
```

A seam over 4 fails the build and over 2 is remarked on. Round 2 measures across / down: base 0.75 / 4.32, normal 0.97 / 6.66, height 0.76 / 8.73, packed 1.12 / 7.37. The cause is the binding on row 0: the last row is reed and the first row is cord, so the picture jumps there.

Fix it without moving anything else: the bindings and course lines stay where they are, row 0's binding included, and the panel joint stays on the edges. Make the binding that lies on the edge straddle it, half its thickness below row 0 at the bottom of the picture and half above, as one cord crossing the edge would, so the rows either side of the edge are alike. Bring every layer's `seam_y` and `seam_x` under 2. Add this measure to your checks exactly as written above, for all four layers, and update `REPORT.md`.
