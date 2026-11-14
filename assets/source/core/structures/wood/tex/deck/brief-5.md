This is the fifth pass on the `deck` material, and a small one. Work only in this folder; no git commands that write. Only the base colour changes: the layout, height, normal and packed map stay exactly as they are.

The concept artist has now written the tier's unlit palette in `/home/user/dev/SNARK/.claude/worktrees/agent-ae515c340350f410b/assets/source/core/structures/wood/ref/concept/DESIGN.md` (read its "Material palette" section). Pass 4 took its colours from the paintings, which include their warm sunlight, so it is too saturated as a base colour. The targets, 8-bit sRGB base colour:

- worn horizontal deck and roof boards D (167, 138, 101), with restrained wear toward the boards' B (172, 128, 82) and exposed end grain E (186, 149, 107);
- gentle variation within one species; no alternating pale and dark boards.

Move the base colour so its mean is about D, keeping the foot-worn, weathered character, the board-to-board variety (quieter than now), the quiet end joints and the dark nail heads. Do it inside your build so it rebuilds the same, rerun your checks, add a before/after to the contact sheet, and note the change in `REPORT.md`.
