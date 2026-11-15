You made the `steel` trim sheet in this folder (read `brief.md`, `REPORT.md` and your scripts first). Thank you: the bands, the file marks and the layers are right. Work only in the current folder. Do not run git commands that write.

## What must change

The game's asset check refuses the base colour, because the picture does not wrap down its height:

> core:weapons/steel: its base picture does not wrap: it jumps 0.96 and 5.07 times as hard across its edge, across and down, as inside it

The check compares the colour step between the picture's last row and its first (and last column and first) with the typical step between neighbouring rows inside the picture, and fails a tiling picture whose edge step is more than 4 times as hard. Across (x) is fine. Down, the bottom of the dark face meets the top of the brass in one hard step, harder than anything inside the picture.

The brief asked for that transition to be as soft as the others. Make the bottom of the face fade into the brass over about 3 to 4 mm (30 to 40 rows at 2,048), the brass's top darkening a little with tarnish and the face's last rows warming and lightening a little toward it, so that the step across the wrap is no harder than the steps between the other bands inside the picture. Check the same of the height, normal and packed maps. Keep everything else as it is: the bands' positions and widths (the meshes are mapped to them), the colours, the height range, the file marks.

Measure it as the check does: for each axis, the mean absolute difference of the colour between the last and first rows (or columns), over the mean absolute difference between neighbouring rows (or columns) inside the picture; both under 3. Rebuild the 2,048 and 1,024 sets and the checks, and add a section to `REPORT.md` for this round: what you changed, what you measured, how long it took.
