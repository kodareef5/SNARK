# Second opinion 3: after the second round

artist was shown the sheets again after the changes of [artist_review_2.md](artist_review_2.md), with the brief in
[artist_review_3_brief.md](artist_review_3_brief.md). Its answer is [artist_review_3.last.txt](artist_review_3.last.txt),
unedited: fly, hover, glide, dive, walk and idle at the bar; fly_fast and take_off close; land short. No regressions
and nothing wrong for the rider. What was done (commit 6c711019), together with the notes of the engine's flight pose
(FL4) on the clips it plays:

**fly_fast**, close: its top stroke still looked like cruising. The shoulder now stops at 10 degrees at the top (was
18), the wrists stay more flexed (0.15), the elbow barely lifts; and it is 15 frames long, two strokes to fly's one,
so the two share a beat while the speed changes between them (FL4).

**take_off**, close: the first downstroke heaves the shoulders (the chest pitches up 6 degrees through it, the spine
half that) without more rise of the whole body. FL4 found the hand turning 62 degrees and the batten `web_2` 75 in
one frame where the wings began to open: the planted arm bends as the free arm does only while the wing is nearly
folded (5 degrees apart at nine tenths folded, 53 at half, measured), so the hands now let go of the ground's reach by
frame 10, at nine tenths folded, and the wings open at an even rate after; the clip is 42 frames. No bone turns more
than 29 degrees a frame.

**land**, short: it looked parked before the hands came down, and the dip after read as separate. The chest now
carries on down from frame 15 into the hands at 26, the chest bowing onto them and the elbows giving at 29, held by
33; the wings fold at an even rate to frame 22; 42 frames. No bone turns more than 26 degrees a frame (was 48).

**hover** is 30 frames, on fly's beat (FL4). **idle_stretch** folds and refolds at an even rate (30 degrees a frame
at most, was 41).

The folded membrane, which artist put second last time, is the model's (rig.py, "The membrane"; PA2).
