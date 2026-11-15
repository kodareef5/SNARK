# Membrane study, round 1: sent back

Read `tex/studies/COMMON.md`, your `BRIEF.md` and your `REPORT.md` again, then this. The numbers are right (means
0.400 and 0.600, neutral, seams under 0.8, normal against height 0.95 and 0.97, the under face an exact mirror), the
sources and `paths.json` are what the animal's painter needs, and the build is reproducible. But the set does not yet
read as the design's skin, so please do all three sets again. The attached pictures are the game's renderer
(`look.ts`) on your delivery: the upper face from above and the under face from below against the sky.

- **There is almost nothing to see.** The whole base spans sRGB 155 to 176. In the game, in the design's slate, the
  veins are gone at 0.5 m on the upper face and invisible on the under face; it reads as a plain plastic sheet. The
  concept's membrane (`ref/concept/saddle_detail.png`, lower right; `three_quarter.png`) shows its veins and creases
  plainly at a rider's distance. Give the drawing real value: the main vessels clearly darker than the skin beside
  them (on the order of a quarter to a third darker in linear light in the base, more on the under face, which is seen
  against the light), the finer ones fainter, and the skin's own soft thickness variation visible as gentle light and
  dark over 5 to 20 cm. Judge it in `look.ts` at 0.5 and 1.5 m in the design's slate on both faces: a rider must see
  the veins without looking for them; at 5 m they fall into the tone.
- **The vessels read as scratches or loose hairs, not a vascular tree.** In your contrast-stretched base the lines
  are thin, of nearly even width, run long and straight, cross one another at shallow angles and wander off. Blood
  vessels in one sheet of skin do not cross over each other: a few trunks taper steadily as they branch, each branch
  thinner than its parent, forking in Y's at 30 to 60 degrees, curving smoothly, some branches rejoining into loops,
  the finest twigs dying out in the skin. At 2,000 pixels a metre a 2.5 mm trunk is about 5 pixels wide with a soft
  edge; yours look 1 to 2. Fewer, bolder, properly branched; no crossings.
- **The skin is paper or concrete.** Stretched, the base shows blotchy mottling and short random scratches. Thin
  living skin has a fine, even net of tiny creases (a little like the back of a hand, finer: a fraction of a
  millimetre to a millimetre apart, mostly lying along the span), over soft, broad variation in thickness. Keep it
  quiet, but make it skin.
- **The generated original is nearly blank**, so the beauty has to come from somewhere else. Use the image tool for
  what it is good at: ask it for this membrane itself, thin taut skin with its branching vessels and fine creases, as
  a flat even-lit square (describe it in your own words; our concept pictures may be given to it), and build the
  layers from what it paints, the vessel field included, rather than drawing the vessels from curves alone. If the
  vessels it paints are good, keep their drawing; if you must trace them into a clean field, keep their character.
- **The creases are invisible** on `membrane_creased` in the game at 0.5 m. The gathered skin near the bones should
  show its fine creases and its few longer pleats plainly up close.
- **No TypeScript in the study folder.** `check_engine.ts` is type-checked with the game. Measure in Python, or run
  `look.ts`; delete `check_engine.ts`.

Keep the means (0.40 upper and creased, 0.60 under), the mirror, the direction, the scale and the names. Before you
stop, set your under face, dyed in the design's slate and lit as `look.ts` lights it from below, beside the concept's
`underside.png` membrane at the same pixels a metre: it should be the same kind of skin, veins and all. Update the
report for this round.
