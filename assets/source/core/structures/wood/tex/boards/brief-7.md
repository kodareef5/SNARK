This is the seventh pass on the `boards` material, and a mechanical one. Work only in this folder; no git commands that write. Nothing about the look changes.

The game's asset check now measures how hard each tiling picture jumps across its wrap edge against inside it, and faults a picture over 4. This picture's wrap edges fall exactly on a lap line (down: height 13.3, packed 22.9) and on the nail column at x = 0 (across: packed 5.4), so it fails, though it tiles correctly.

Move the wrap off them: as the last step of `build_material.py`, roll all four maps (base, height, normal, packed) by exactly 512 pixels to the right and 85 pixels down, with wrap-around, so the edges fall mid-board and between the nail columns. Afterwards the board lines are at rows k * 2048 / 12 + 85 and the nail columns at x = 512 and 1536. Every pixel keeps its value; the normal map stays agreeing with the height because both move together.

Update your layout checks and `construction.json` to the new positions, rerun your checks (including a half-offset seam view, which should now show the lap line and nail column that used to be on the edge), and note the roll in `REPORT.md`. Report the wrap measure (the jump across the edge against the 95th percentile of jumps inside) for all four maps, across and down.
