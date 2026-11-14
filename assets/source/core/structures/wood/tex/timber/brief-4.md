This is the fourth pass on the `timber` material, and a small one. Work only in this folder; no git commands that write. Only the base colour changes: the layout, height, normal and packed map stay exactly as they are.

The concept artist has now written the tier's unlit palette in `/home/user/dev/SNARK/.claude/worktrees/agent-ae515c340350f410b/assets/source/core/structures/wood/ref/concept/DESIGN.md` (read its "Material palette" section). Pass 3 took its colours from the paintings, which include their warm sunlight, so it is too red and too saturated as a base colour. The targets, 8-bit sRGB base colour:

- hewn structural timber T (98, 67, 45); rubbed timber arrises T+ (118, 82, 55);
- the boards it holds are B (172, 128, 82), so the frame still supplies most of the value contrast.

Move the base colour so its mean is about T, keeping the band-to-band variety (within roughly T to T+), the weathered bands' slight greying, and the hewing marks, kerfs and checks readable in the colour; let the softened arrises at each band's edges lean toward T+. Do it inside your build so it rebuilds the same, rerun your checks, add a before/after to the contact sheet, and note the change in `REPORT.md`.
