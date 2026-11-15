# Fuzz study, round 3: between the last two

Read `tex/studies/COMMON.md`, your `BRIEF.md`, `FEEDBACK_1.md`, `FEEDBACK_2.md` and your `REPORT.md` again, then this.
This round fixed what was asked: the pile is calm at 1.5 m, sleek, and the mantle's spikes are gone. But it went past
the mark, and the attached pictures (the game's renderer and a full-size crop of this round's base) show it:

- **The fur has gone.** At 0.5 m in the game the egg reads as fine scratched plaster or brushed fabric; up close the
  base is a field of faint wavy hairlines of one value. Round 2 had the right drawing inside each lock (pale strand
  tips catching the light over darker roots); this round has the right calm at 1.5 m. Put them together: strands that
  read at 0.5 m as fur, with real light and dark between strand and gap, inside locks that are only gently marked, so
  that the strand contrast is fine-grained and averages away by 1.5 m. The concept's neck at 2,000 pixels a metre is
  the measure: you see the strands.
- **It still waves.** The strands snake side to side with a regular period, which reads as crimp. The concept's
  strands are straight or gently curved, all lying one way, crossing a little where locks overlap.
- **Columns.** In the full-size crop the pattern stands in vertical bands about 170 pixels apart. Break them.
- **`mantle_edge`** is much better; the fringe along it is now an even comb of equal hairs. Let the dark locks reach
  over the pale by differing lengths, a centimetre here, two or three there, and a few pale locks over the dark.

Keep the means, names, scale and direction; `fuzz_face` the same drawing at its scale. Before you stop, look at `fuzz`
in the game at 0.5 and 1.5 m beside rounds 2 and 3 (you have them in your checks) and beside the concept's neck.
Update the report for this round.
