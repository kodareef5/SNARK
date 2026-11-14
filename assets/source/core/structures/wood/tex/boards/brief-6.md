This is the sixth pass on the `boards` material, and a small one. Work only in this folder; no git commands that write. Only the base colour changes: the layout, height, normal and packed map stay exactly as they are.

The concept artist has now written the tier's unlit palette in `/home/user/dev/SNARK/.claude/worktrees/agent-ae515c340350f410b/assets/source/core/structures/wood/ref/concept/DESIGN.md` (read its "Material palette" section). Pass 5 took its colours from the paintings, which include their warm sunlight, so it is too orange and too saturated as a base colour. The targets, 8-bit sRGB base colour:

- main sawn boards B (172, 128, 82); quiet darker variation B− (160, 117, 75); quiet lighter variation B+ (184, 141, 96);
- "use gentle variation within one timber species; do not alternate pale and dark boards";
- dark lap shadows and sunny highlights belong to lighting, not to the base colour.

Move the base colour so its mean is about B, its board-to-board spread stays within B− to B+ (a little less spread than pass 4 had), keeping the fibre contrast, figure, knots, gentle weathering by height and the dark iron nail heads. Do it inside your build so it rebuilds the same, rerun your checks, add a before/after to the contact sheet, and note the change in `REPORT.md`.
