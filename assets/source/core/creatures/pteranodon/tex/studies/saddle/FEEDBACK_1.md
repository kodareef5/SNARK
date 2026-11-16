# Saddle study, round 1: sent back for four sets

Read `tex/studies/COMMON.md`, your `BRIEF.md` and your `REPORT.md` again, then this. Good work: the numbers are right
(normals 1.00 against height, seams far under the limit, every set rebuilt byte for byte), `rope_wrap` is right (close
turns of cord, reading in the game at 0.5 and 1.5 m), the hide's colour and the wood's are the concept's, and you were
right about `look.ts`: it drew tubes and eggs inside out until now. It is fixed; run it again. The attached pictures are
the fixed renderer on your delivery, and crops of `hide_edge` and `rope_plait` at full size.

- **`rope_plait` is a woven mat, not a round plait.** Its base is a flat lattice of rectangular blocks, like wicker
  or parquet. A round four-strand plait, seen from outside, shows along its length a chain of chevrons: on each side a
  strand comes round at about 45 degrees and meets its neighbour at the middle line, each strand a rounded bundle of
  twisted fibres with dark gaps between, the crossings offset step by step. Look at the foot-rest ropes in
  `ref/concept/saddle_detail.png`. Make it that, at the same scale (twice round a 12 mm rope).
- **Add `rope_twist`**: the reins and the halter in the concept are thinner twisted cord, three strands laid in a
  steady spiral, about 6 mm thick. Same conventions as `rope_plait`, the picture's height twice round the cord
  (2,048 pixels for 0.0377 m), form `{"form": "tube", "radius": 0.003, "length": 0.6}`.
- **`hide_edge`'s stitches are painted dashes.** At full size each stitch is a flat cream dash of one width with
  round ends, laid on the hide like paint, and there is no edge to see: no rolled or burnished edge, no crease line.
  In the concept the pad and straps have a dark, burnished, slightly rolled edge, a creased line a few millimetres in,
  and a row of real stitches: each a slanted bead of twisted waxed thread, rounded and a little raised, entering and
  leaving the hide through small pricked holes, the row sunk slightly in its own groove. Draw that, with the edge at
  the top of the picture as you have it.
- **`hide`'s grain is cracked old leather.** At full size the grain is a network of crackled cells like dried mud,
  the look of a worn sofa. The concept's hide is smooth, oiled and supple: a fine, even grain, a few soft wrinkles
  where it bends, gentle mottling, scuffs. Keep the colour and the mottling; make the grain finer and quieter, the
  cells gone.
- **`chitin` reads as marble or paper.** Its wavy blotches look like stone veining. A plate of chitin is smooth and
  waxy, with faint, nearly parallel growth layers following its edge, fine pits, and a slightly deeper, translucent
  tone toward its worn edges, as in the cantle's facing in `saddle_detail.png`. Fewer blotches, more layers.
- `wood` is accepted as it is; if you have time, give its grain a little more life (a few darker late-wood lines and
  fine pores), keeping it calm.

Keep the names, scales and forms. Update the report for this round, and look at every set in the game's renderer at
0.5 and 1.5 m before you stop.
