# Fuzz study, round 1: sent back

Read `tex/studies/COMMON.md`, your `BRIEF.md` and your `REPORT.md` again, then this. The numbers are right (means
0.500, neutral, normal against height 1.00, seams near 1.0), the aligned patch library is what the animal's painter
needs, and the mantle's region map follows strands, as asked. But the fuzz is not yet the concept's, so please do all
three sets again. First, a fault of mine: until now `look.ts` drew eggs and tubes inside out, so the game-renderer
pictures you judged by were of the inside of the egg. It is fixed; run it again. The attached pictures are the fixed
renderer on your delivery and your own `checks/concept_at_scale.png`.

- **It is crimped wool, not a lying pile.** Your strands wave side to side in an even rhythm and stand in vertical
  ripples, so at 0.5 m in the game it reads as a sheepskin or knitted wool, and stretched it is a field of identical
  squiggles. Your own concept comparison shows the difference: the concept's neck is fine, nearly straight strands
  lying smoothly one way, gathered into soft overlapping locks, each lock's paler tips lying over the darker roots of
  the next, with soft dark gaps between the locks. That layering is what gives it its plush depth and its velvet. Make
  the pile lie flat along its direction, strands gently curved, not waved, the locks overlapping like that.
- **The locks are too long and too even.** In the crop at full size the wavy runs are 2.5 to 5 cm long and nearly all
  alike. The concept's strands read as about 1 to 2 cm at 1,000 pixels a metre (it is a painting); a real animal's
  fuzz is shorter. Aim between: individual strands of about 6 to 12 mm, gathered into locks of 1 to 3 cm, varied in
  size and slightly in angle, a parting here and a crowded lock there.
- **It repeats in columns.** The full-size crop shows the same motif standing in vertical columns at a regular step
  across the picture. Break that up so nothing a viewer can find repeats inside the tile or across a 3 by 3.
- **It must say plush at 1.5 m.** At 1.5 m in the game the egg is a smooth matte egg. The concept's neck at that
  distance still shows a soft, lumpy plush from the locks' light tips and dark gaps. Put that value in the base (the
  gaps clearly darker, the tips lighter) and its soft relief in the height, without losing the calm tone at 5 m.
- **`fuzz_face`** may stay the same drawing at its shorter scale, as you chose, once `fuzz` is right; the face's fuzz
  in `head_side.png` is denser and shorter-looking still, so check it beside the concept's face.
- **`mantle_edge` reads as a torn or combed edge.** In the game the dark and pale meet in a nearly straight line with
  a short, even fringe of dark hairs, like the edge of a torn sheet of fur. In the concept (`head_side.png` along the
  nape, `saddle_detail.png` on the flank) dark locks lie over the pale and pale locks over the dark across a soft band
  of one to two centimetres that wanders in and out by a few centimetres along the edge. Overlapping locks, not a
  comb.

Keep the means, names, scale and direction. Before you stop, set `fuzz`, dyed ivory and relit as the game lights it,
beside the concept's neck at 1,000 and 2,000 pixels a metre (from `head_side.png` and `saddle_detail.png`), and look
at it in the game at 0.5 and 1.5 m: a stranger should see the concept's fuzz. Update the report for this round.
