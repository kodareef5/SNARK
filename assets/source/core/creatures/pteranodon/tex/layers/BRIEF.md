# The pteranodon hurt, and its corpse rotting

The game shows how hurt a creature is without ever showing its health: everyone sees a living creature at one of four
steps, unhurt down to near death, a step for each quarter of health lost. When it dies, its body lies where it fell
and is cut up for meat, hide and keratin; it goes through three more steps as it is harvested and ages. Paint what the
pteranodon turns to, so that a player who sees one overhead or on the beach knows at a glance how badly it is hurt, and
sees a carcass that has been worked over and left to rot for what it is.

The animal's look is painted and is not to change. Unhurt, it must be exactly what it is, which the engine already
guarantees: you paint only what shows at the later steps.

## What the game draws, and what it needs from you

Four pictures on the two materials' layouts, RGBA, 8 bits a channel, sRGB colour, 1,024 pixels square (the layouts of
`ref/bakes/`, at half size): `tex/pteranodon_hurt.png` and `tex/pteranodon_decay.png` for the body,
`tex/pteranodon_wing_hurt.png` and `tex/pteranodon_wing_decay.png` for the wing.

- **Colour** is what that texel turns to. It takes the place of the animal's own dyed colour there and is never dyed:
  a blue-dyed pteranodon bleeds red like an ivory one. A texel has one colour at every step.
- **Alpha** is how soon the texel shows, over its picture's three steps. 255 shows from the first moment, 0 never.
  A texel starts to show as the step passes 3 x (255 - alpha) / 255 and is whole a quarter of a step after. So a mark
  is whole by step 1 from alpha 191 up, by step 2 from 106, by step 3 from 21.
- **The hurt picture** covers the living animal's steps 1 to 3. **The decay picture** starts from the fresh corpse,
  which shows the whole hurt picture, and covers the corpse's steps 1 to 3 on top of it. Where the hurt picture has any
  alpha, the decay picture must have none there (the build refuses the pair otherwise): a decay mark that grows out of
  a wound grows around it.
- **Marks grow, they do not pop.** A creature moves between steps over a moment, and the threshold sweeps through
  alpha as it does; so does the decay. Give each mark alpha that falls from where it starts to its edge, through the
  steps it grows over, so a wound spreads and a tear opens instead of appearing.
- **What the engine adds on its own:** every mark that shows is glossy and wet on a living animal and a fresh corpse,
  and dries as the corpse decays; and decay dulls the whole corpse, fuzz, skin, horn and marks together, toward a warm
  grey and darker, a third of the way at each decay step. Paint blood and flesh as they look, not wet or dried; the
  engine does that.
- **Storage.** The game holds each layer far smaller than you paint it, 256 or 512 pixels across (the asset's
  budget decides; plan for 256): at 256 a layer texel is about 8 mm on the torso, 4 mm on the head and 14 mm on the
  membrane. Paint at 1,024; make anything that must read at least three of the game's texels wide. The build averages
  colour by alpha and keeps each mark's earliest step from afar, so small marks hold their step at a distance.
- **Half an animal.** The body's layout is its left side, mirrored onto the right; the wing's is the left wing,
  mirrored onto the right. Every mark appears on both sides. Place marks where seeing both at once does not look like a
  pattern: off the midline, not at the same place on both wings where the two are seen together from below.
- **Two faces of one skin.** Each point of the membrane is in the wing's layout twice, once in the upper band and once
  in the under band (`tex/paint/pteranodon_wing_position_*.png` says where each texel is on the animal). A tear, a
  puncture or a bruise in the membrane goes through it: draw it on both faces at the same place.
- Only the near, textured levels show layers. Far off it is drawn flat; nothing to do there.

## What to read

- `ref/DESIGN.md`, `ref/concept/` and `ref/FUNCTIONS.md` (what it does: what bites and claws it, how it falls, how it
  is harvested): the animal you are painting onto.
- `tex/paint/BRIEF.md`, the pieces and position maps it points at, and `tex/pteranodon_*.png` and
  `tex/pteranodon_wing_*.png`, the painted maps (composed by `tex/paint/compose.py`; if they are missing, run
  `python3 tex/paint/compose.py`).
- The dodo did this first: `../dodo/tex/layers/BRIEF.md`, `REPORT.md` and its `FEEDBACK_*.md` (what was sent back and
  why: blood that reads at 10 m, tears that are one-sided, not paired banks). Read them as lessons, not as a look to
  copy.

## What excellent looks like

- **It reads.** At 20 m overhead a player can tell step 1 from step 2 from step 3 at a glance; from below at 60 m
  step 3 still says "nearly dead" (the torn and bloodied membrane against the sky); a corpse at decay 3 says "picked
  over and rotting". `zsh tex/paint/look.sh <a folder of yours> --maps --stages` (from the pteranodon's folder, about a
  minute, no Blender) draws it in the game's own renderer at every stage from several sides, close and far, in three
  dyes; judge it there.
- **It belongs on this animal.** Wounds where a flyer is struck: the neck, the chest and flanks, the leading edge of
  the arm, the membrane (punctures and rips, most near the trailing edge and between the vessels, with dark blood at
  their lips and bruising spreading through the thin skin), the head (scuffs, a chip and a crack in the horn of the
  beak and crest), the legs. On the fuzz: tufts matted and clumped with blood, torn to the grey skin. The corpse: hide
  cut away over the breast and back where it was harvested, flesh and ribs beneath; the membrane drying to dark,
  shrunken, leathery skin that splits between the vessels; fuzz gone in patches; the horn dull and cracked; blood
  dried dark. Sized in millimetres on the animal, following its form, its fuzz and its veins.
- **Our own look.** The painted, plush-but-real look of the maps; believable, not a decal, not a horror piece. Grim
  enough to read from 20 m, no more.
- Nothing traced or taken from any game, and no game's pictures given to the image tool. Generated originals are fine;
  keep them with their prompts.

## What you deliver

In `tex/`: the four pictures. In `tex/layers/`: `paint.py`, which writes those pictures from your sources, the maps and
the position maps, the same bytes every run, reading them each time; `source/` with any generated originals and their
prompts; and `REPORT.md`: what you painted where and why, the sizes on the animal, which steps each mark comes in at,
and where it still falls short. Work only in `tex/layers/` and those four pictures; leave everything else as it is.
Keep your scripts in Python.
