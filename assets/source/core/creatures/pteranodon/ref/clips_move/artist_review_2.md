# Second opinion 2: after the first round of changes

artist was shown the sheets again after the changes of [artist_review_1.md](artist_review_1.md), with the brief in
[artist_review_2_brief.md](artist_review_2_brief.md). Its answer is [artist_review_2.last.txt](artist_review_2.last.txt),
unedited. What was done (commits c52cd38a and 137cabf7):

**Its three next changes, in its order.**
1. *The take-off's rise.* Re-timed: the body gains its speed while the arms still push (the pelvis from 0.36 m to
   0.72 m in four frames, the arms released at 0.97 of their reach), slows from 1.0 m to 1.6 m while the wings open
   (frames 8 to 16), and the first downstroke lifts it again, to 2.56 m by frame 27, before it settles into the hover.
   The wings now spread out before they rise, so from the front they widen all the way open rather than narrowing at
   frame 10.
2. *The folded membrane.* Not the clips' to fix: the block-out's membrane is a slab weighted by distance, and the
   folded wing's skin is gathered by the model's weights and, if it needs them, more battens (rig.py, "The membrane";
   PA2). Passed on with this review. The hands and feet are where STANCE puts them, under that skin.
3. *The hover's recovery.* It folds less (0.24, was 0.32), sweeps back less (1.4 times its forward sweep, was 1.8)
   and twists less (10 degrees, was 14), so the wing keeps its area from below on the way back; the take-off's last
   frames take the same.

**The rest.** fly: the shoulders drive each stroke (`drive`: the chest loads as the downstroke begins and heaves up
through it, the spine with it), rather than the whole body bobbing more. fly_fast: the neck streams out along the
body, flat (lean 64 degrees), the head carried ahead of the chest. hover: the same shoulder drive, and the body answers
the push a beat after the shoulders. dive: the neck streams out along the line of the dive with the wings (lean 70),
the beak leading. land: the chest carries on further forward over the feet in the first six frames; the arms catch
the body at frame 21, give (the pelvis 6 cm lower, the chest 5 degrees down) and hold by 28. idle: the shrug leans
the body onto the right arm as the left shoulder hunches. glide: left alone, as it advised.
