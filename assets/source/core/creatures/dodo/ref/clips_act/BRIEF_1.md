# A second opinion on the dodo's acting clips

You are looking at five animation clips of a game creature, a dodo, as frame strips. They are rendered on the real model before it has feathers or textures, so judge the motion and the poses, not the surface. The design and its character are in `ref/DESIGN.md` and `ref/concept/three_quarter.png` (attached): a fat, slate ground bird, vacant, sleepy, faintly grumpy, that does not know it is in danger. The game is modelled on ARK: Survival Evolved; the art is its own.

What each clip is for (`ref/FUNCTIONS.md` has the whole list):

- `peck.png`: its only attack, 15 frames at 30 a second. The server lands the blow on frame 6, so the beak must arrive on the red marker on frame 6. Side view above, three-quarter below.
- `flinch.png` and `flinch_over_walk.png`: taking a hit. It is laid on top of whatever else the bird is doing; the second strip shows it over the walk. It is meant to arrive a beat late, as befits a dim bird.
- `held.png`: held in a player's arms (the two tan bars stand in for the arms), a 4 second loop. The lower row is roughly what the player holding it sees.
- `carried.png`: hanging from a flying creature's grip on its back (the post stands in for it), a 4 second loop.
- `torpor_eat_over_torpor_idle.png`: knocked out on its side, it is fed; a small lift of the head, a gape and a gulp, laid over the knocked-out pose.
- `small_sizes.png`: key frames at 200, 100, 48 and 20 pixels tall, the sizes players mostly see it at.

The bar is the best creature animation in games you know of, not a first pass. What I want from you, plainly:

1. What a stranger would see in each clip, in a sentence: does the peck read as a strike, the flinch as being hit, held as a calm bird in someone's arms, carried as a bird dangling from a grip, the eating as a sleeping bird swallowing?
2. Anything a viewer would wince at: a pop, a broken-looking neck, a limb through the body, a pose that looks wrong for a bird of this build, a moment that reads as a different emotion than intended.
3. Where the character could come through more strongly, within what each clip is for. Concrete, by clip and frame.

Do not write or change any file; answer in your last message only. Keep it short and specific.
