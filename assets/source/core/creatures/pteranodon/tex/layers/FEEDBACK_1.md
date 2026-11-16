# Hurt and decay, round 1: sent back

Read `tex/layers/BRIEF.md` and your `REPORT.md` again, then this. The structure is right: marks arrive step by step
and grow rather than pop, the wing's marks go through both faces, the decay dries the membrane dark and dulls the horn,
the corpse reads as dead, the pair has no overlap and rebuilds byte for byte. The attached sheets are the game's
renderer at every stage (`look.sh --maps --stages`): three quarters from below, side, under the wing, above; then the
inner wing, the head, the rider's view and the dark dye. What is not yet right is how the marks look.

- **The blood is pink.** On the membrane and the fuzz the marks read hot pink to coral, with lighter pink rims: from
  20 m against the sky and from above they read as a painted pattern of pink bands, not blood. Blood on this animal is
  dark crimson where fresh and thick, maroon to near-black-red at the core of a wound and in a hole, brownish where it
  thins at its edges; never lighter at the rim than at the core. Check it in all three dyes: it must read as blood on a
  slate wing, an ivory neck and a black-dyed body alike.
- **The membrane wounds are stripes, and mirrored.** They are long bands along the trailing edge, the same on both
  wings, so from above and below the two wings carry a symmetric row of stripes. A flyer's membrane is punctured and
  torn: a few marks of very different size and kind, each one shaped by the thin skin. A tear runs in from the trailing
  edge between two vessels, ragged, its lips dark with blood and the skin round it bruised dark through its thinness; a
  puncture is a small dark hole with a bruise halo and a short run of blood back along the flow; a graze along the
  leading edge of the arm. Place them so the left and right wings, seen together from above or below, do not repeat
  each other: since the layout is mirrored, put each mark where its mirror lands on a different-looking part of the
  other wing (or keep the big tear near enough to the body that its twin reads as damage to the other side, not a
  pattern). Fewer, bigger, different.
- **The body wounds are decals.** On the neck and chest the marks are round rosettes with a pale rim, the same shape
  each time, like stickers; from the saddle the back of the neck shows red rectangles at steps 2 and 3, like straps.
  On fuzz a wound is the fuzz matted and clumped with blood around an opening: irregular, longer along the lie of the
  fuzz than across it, darker at its middle, with dark streaks running back with the fuzz, the clumps' edges ragged
  locks, never a ring. Nothing with a straight edge.
- **Edges.** Stored at 256, a texel is 4 to 14 mm on the animal; the marks' edges show as stair steps. Give each mark's
  alpha a ragged, organic falloff that does not follow the texel grid, so the edge as stored reads as a torn or soaked
  edge, not a staircase. (I am also asking whether the wing's layer can be stored at 512; paint at 1,024 as now.)

Keep the stepping, the both-faces rule, the decay's drying and dulling, the files and the rebuild. Update the report
for this round, and look at every stage in all three dyes before you stop.
