# Paint the wing

Read `tex/paint/BRIEF.md` first and follow it (it points you at `tex/studies/COMMON.md` and `ref/DESIGN.md`). Your
group is `wing`: every piece of `pteranodon_wing`, which is `membrane_upper`, `membrane_under`, `arm` and `finger`.
Your folder is `tex/paint/wing/`.

## What it is

Most of what anyone sees of this animal is its wing, and most often from below against a bright sky. In the design's
words: a slate membrane of bare, matte, thin skin with fine branching veins, taut on a long finger: darker on its upper
face, a clear slate blue-grey on its under face, a warm ash wash by the body, charcoal on the outer fifth to the tip on
both faces. The arm rises from the shoulder to the bend of the wing; from there the wing finger runs out to a point
swept back like a scythe. The trailing edge is one long concave curve from the tip to the ankle. A narrow front
membrane fills the angle before the arm.

- **The membrane** is the membrane study's skin (`tex/studies/membrane/`): its veins, its fine skin, its creases where
  the skin gathers (`membrane_creased` near the arm, the finger and the body, blending into `membrane_upper` where the
  wing is always taut). On the animal it has about 600 texels a metre, a third of the study's: draw the vessels bolder
  here so a trunk stays two texels wide or more, and lay the network to the wing: trunks coming in from the arm and
  the body, running back toward the trailing edge, swept toward the tip, along `pteranodon_wing_flow.png`, branching
  as they go. The front membrane before the arm has its own small vessels.
- **Two faces of one skin.** Each point of the membrane appears twice in the layout, once in each band, at the same
  position on the animal (`pteranodon_wing_position_*.png`). Draw the veins in the animal's space so they lie in the
  same places on both faces. The upper face's mean grey is about 0.40, the under face's about 0.60, as in the study
  (the game lights the under face only by the sky below, so its paleness is what keeps it a clear slate from the
  ground), the veins reading a little more clearly on the under face.
- **The regions, with soft edges.** Deliver the masks, not a region map (`tex/paint/BRIEF.md`). On both faces:
  region 4 (Wing Membrane) over most of the membrane and the front membrane; region 1 (Wing Base), the warm ash wash on
  the inner membrane by the body, full at the flank and fading out over about 0.4 m from it, a soft, slightly uneven
  edge following the vessels rather than a ruled line (see `underside.png` and `top.png`); region 0 (Patterning), the
  dark tips, the outer fifth of the span, its edge crossing the membrane a little soft (a few centimetres), as in the
  concept. The arm is region 5 (Body), the fuzz of the upper limb; the finger is region 5, its bony leading edge, out to
  where the dark tip begins, then region 0 to its point, the change matching the membrane's tip edge beside it.
- **The arm and the finger.** The arm is covered in the body's velvet fuzz (`tex/studies/fuzz/`, at the fuzz's own
  scale, lying out along the arm as the flow says), thinning toward the knuckle where the skin of the bend shows
  through. The finger is a long bony spar under thin skin: short, sparse fuzz near the knuckle giving way to bare,
  finely wrinkled skin along its length (the skin study's pebbled skin, finer, may serve), the dark tip bare. Where the
  membrane goes in along the back of the arm and finger, both sides meet without a line: a slight crease, no step in
  value.
- **The trailing edge** is the membrane's own edge, thin and taut: no hem, but the skin there a touch darker and
  smoother.

## What excellent looks like

From below against the sky at 20 to 150 m (`sizes_*.png`) it is the concept's M: slate with dark tips and the ash
wash by the body, no blotch, no seam where the bands are cut, no repeat. From the saddle (`inner_wing_*`,
`rider_*`) the inner wing is living skin with its veins and creases, the arm a soft fuzzed limb. Dyed loud or dark it
is still a wing of skin.
