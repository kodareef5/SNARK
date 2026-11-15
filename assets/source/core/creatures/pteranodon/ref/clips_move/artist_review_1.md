# Second opinion 1: the movement clips on the block-out

artist (gpt-6-artist, xhigh, read-only) was shown the contact sheets of fly, fly_fast, hover, glide, dive, take_off, land,
walk and idle as `preview.py` drew them at commit e8bebe13, with the brief in
[artist_review_1_brief.md](artist_review_1_brief.md). Its answer is [artist_review_1.last.txt](artist_review_1.last.txt),
unedited. What was done with each point follows (commits d5243311 to e58c7536); the sheets beside this file are drawn
after it.

## What was done

**fly.** 1: the body rises 5.5 cm on each downstroke (was 2.8) and nods 3 degrees; the head still holds. 2: the
forearm's lift peaks earlier in the upstroke (`elbow_at` 0.86) and the finger trails it further on the way up
(`upcurl`), so the elbow leads and the finger follows. 3: the stroke is not enlarged.

**fly_fast.** 1: the neck stretched forward and flatter, the head 16 cm further forward and lower, the body 5 degrees
nose down. 2: the upstroke stops lower (shoulder 18 degrees, was 26), the wrists stay aft and flexed through the cycle
(`swept` -14, `flexed` 0.12) and the elbow barely lifts. 3: a longer push (`down` 0.55), the same release.

**hover.** 1: the wrist begins to fold before the bottom of the stroke (`lead`). 2: the recovery folds further (0.32)
and sweeps back nearly twice as far as the push sweeps forward (`back`), so it returns back and in. 3: the body rises
6 cm on each push and the hanging feet lag it twice as much.

**glide.** 1: kept. 2: the continuous sway is replaced by one gust that rolls it 4 degrees at frames 14 to 26, answered
by the wings' twist and the low tip's lift, then a quiet interval. 3: at 58 to 79 it looks down to its left (24
degrees, 12 down), holding the look; the head turns, the neck barely.

**dive.** 1 and 2: the wings are no longer raised; the elbows and wrists swing back (`wing_extra`: forearm and hand)
so the span draws in and the tips trail behind the body like an arrow's fletching, judged with the body level. 3:
from below, a beak and two trailing points.

**take_off.** 1: true. The engine lifts the body from its first tick and rig.py's check refused any joint under the
clip's ground, so the push happened in the air. rig.py now knows the engine's lift (`take_off_lift`) and measures a
"lifted" clip against the ground it leaves; the hands and feet hold that ground for the push. 2: the feet leave
first (frame 3) and the arms deliver the last push (frame 6), straight, before they fold. 3: the wings no longer
open, close and open again: on the ground they open and fold through a raised V that leaves TUCK out (`OPEN`), from
frame 6 to 16. 4: the first downstroke is the deepest of all (shoulder -40) and the body's overshoot dies away into
the hover's first frame.

**land.** 1: the legs take the weight deeper (the pelvis drops 20 cm in 6 frames) while the chest carries on forward,
then recovers a little. 2: the same `OPEN` path; the fingers rise and fold without reopening. 3: as the hands take
the ground the shoulders settle onto the arms, the elbows give, and they hold (`settle`). 4: the head follows the
body's drop a beat late (a spring).

**walk.** 1: the body drops onto each hand as it lands and is pushed up off it, bobs 2.2 cm over the feet (was 1.2)
and rolls 4 degrees over each (was 2.5); the head stays steadier than the chest. 2: the hands lift 20 cm (was 15) and
leave and land in a frame. 3: no change. 4: the engine plays a gait by distance over its stride.

**idle.** 1: kept. 2: the shrug is one shoulder, the left, its folded finger following; the right barely moves. 3:
kept.
