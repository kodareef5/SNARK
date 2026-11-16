You are looking at the second creature of a browser survival game, and its first flyer: a pteranodon, as fan art of the game's pteranodon would draw it (familiar at a glance, our own on a second look). The pictures attached are frames of the clips of it being knocked out, lying out cold, eating while out, waking, and dying, on the ground and in the air. They are rendered on the untextured model, plain grey and plainly lit; how the wing's skin folds and pleats is the model's job, not the clips'. Do not change any file; write only your answer.

**Who the animal is.** A lean coastal flyer with a big head: a 7 m span of skin on a small, deep-chested body, a long needle beak and one swept crest, on a short stout neck. Skittish, light for its size. On the ground it crouches on its folded wings, hands planted in front, the folded wing fingers pointing up and back, head carried level and high. In the air it rows with long slow strokes and glides a great deal.

**What the game does with each clip.** Players knock it out to tame it, then stand over it feeding it for minutes, so the lie is the pose they look at longest.
1. `torpor_in` (60 frames): knocked out on the ground, from its crouch into the lie.
2. `torpor_idle` (300 frames, a 10 s loop): lying out cold while it is tamed; every 15th frame is shown.
3. `torpor_eat` (30 frames): played over the lie each time it eats while out. The sheet shows it over the lie.
4. `torpor_out` (75 frames): waking, from the lie back up into the crouch.
5. `torpor_fall` (40-frame loop): knocked out in flight. The game fades into it from flight and plays it until the body lands, then switches straight to the lie (frame 0 of `torpor_idle`) with no blend, so it is shaped like the lie.
6. `death` (48 frames): killed on the ground, from the crouch. At frame 24 a physics ragdoll takes the body over and finishes its fall on whatever ground is there; the frames after 24 are seen only without a ragdoll.
7. `death_air` (40 frames): killed while gliding. Limp at frame 24, held so while the body falls, and the ragdoll is laid from that pose where it lands.

**What the pictures are.** For each clip a contact sheet `<clip>.jpg`: a column a frame, a tick under each (longer every tenth frame), 30 frames a second. Rows on the ground: from the side (the animal faces left), from above (it faces up), from the front, and as a survivor standing three metres off sees it; then the animal far off, about 100 and 40 pixels tall. Rows in the air: side, from below against a sky colour, front, three-quarter, then far off. The ground's lines are 25 cm apart. The `strip_<clip>_<view>.jpg` pictures are the same clips larger, from close in front and to the left (every second or third frame, read left to right, top to bottom).

**What I want from you.** Look as a stranger who plays the game would, at the sizes a player sees it and close, and as someone who knows how large birds, bats and pterosaurs move, fall, collapse and lie.
- In a sentence each: what does each clip read as? Does the lie read as "out cold", and the end of `death` as "dead", at a glance, and are they told apart?
- What would make a stranger wince: a pose that looks broken or placed, a wing or neck bent wrongly, a part that floats or sinks, a frame that pops against its neighbours, a motion too quick or too slow to read. Name the clip and the frames.
- What is missing for weight, limpness and character: which part, which frames, more or less of what.
- Anything about how a large flyer collapses, lies, gets up or falls limp that these get wrong.

Be blunt and specific; I will act on it. A short numbered list per clip is best. The most important are the lie (`torpor_idle`), `torpor_in`, `torpor_out` and `death`.
