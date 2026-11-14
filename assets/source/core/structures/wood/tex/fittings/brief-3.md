This is the third pass on the `fittings` material, and a small one. Work only in this folder; no git commands that write. Only the base colour changes: the layout, height, normal and packed map stay exactly as they are.

The concept artist has now written the tier's unlit palette in `/home/user/dev/SNARK/.claude/worktrees/agent-ae515c340350f410b/assets/source/core/structures/wood/ref/concept/DESIGN.md` (read its "Material palette" section, and look at `details.png` beside it: the end grain of the foundation's corner and the pillar's crown, and the pegs). The targets, 8-bit sRGB base colour:

- exposed end grain E (186, 149, 107): sawn ends read light and warm against the dark hewn faces T (98, 67, 45), the way fresh-cut ends do, with darker latewood rings, checks and a darker worn arris at each cell's edge;
- hardwood peg ends P (177, 142, 96), for the two or three peg circles in the cells;
- forged iron I (48, 45, 41), small polished iron edges I+ (90, 85, 75); keep rust to restrained seams and round the heads, as now.

Move the end grain half to about E (it is much darker now), the pegs to P, and keep the iron where it is or nudge it toward I. Do it inside your build so it rebuilds the same, rerun your checks, add a before/after to the contact sheet, and note the change in `REPORT.md`.
