# Horn study, round 1: sent back

Read `tex/studies/COMMON.md`, your `BRIEF.md` and your `REPORT.md` again, then this. The numbers are right (mean
0.500 in both regions, neutral, normal against height 0.99 and 0.97, seams near 1.1), `head_side` sits on the
concept's head exactly, its band is crisp and placed right, and the face's edge under the fuzz is a good idea. Keep all
of that. But the horn itself is still a blank: please do `horn` again, and carry it into `head_side`.

First, a fault of mine: until now `look.ts` drew tubes and eggs inside out, so the game-renderer pictures you judged
the horn by showed the inside of the blade. It is fixed; run it again. The attached picture is the fixed renderer on
your delivery.

- **There is no drawing at a viewer's distance.** In the game at 0.5 m, in the design's orange, the horn is one flat
  plastic colour. Your base is a level grey with faint horizontal streaks and a scatter of white specks: in the
  source comparison it reads as brushed aluminium or scuffed plastic, not horn. The concept's beak and crest
  (`ref/concept/head_side.png`, at 1,000 pixels a metre) carry a clear, fine stipple of small dark pits over the whole
  surface, denser and coarser on the crest, sparse toward the needle's tip, and soft broad mottling. That is what
  makes it read as living horn, and it must read in the game: on the animal the head has about 2,400 texels a metre, so
  the pits that read are 0.5 to 1 mm, and the mottling and growth bands that read are a few millimetres to a few
  centimetres. Put that value in the base (pits clearly darker than the horn round them, mottling a gentle 5 to 10
  percent either way), with the pits as real dimples in the height.
- **The growth lines are scratches.** Thin bright lines read as scratches on plastic. Horn's growth shows as long,
  soft, slightly darker and lighter bands running along the beak and up the crest, broken and fading, with here and
  there a fine ridge. Make them value bands first, lines second, and put the real scratches only where a beak is used:
  near the tip and along the cutting edges, few and fine.
- **Use the image tool for the horn itself.** Your generated original is the same blank; ask it for what the concept
  shows (old, stippled, satin keratin with growth bands, flat and evenly lit, our concept's head may be given to it as
  the example), and build from that.
- **`head_side`**: once `horn` has its drawing, carry it through, turned to run along the beak and up the crest as you
  did, sparse at the needle's tip and denser on the crest and cap, the tip and the cutting edges a little paler and
  smoother. The nostril is a narrow slit groove with a soft rim in the horn, not a hole: keep it opaque, region 2,
  with its groove in the height and a darker floor in the base. The gape between the jaws may stay transparent.

Keep the names, scale, means, the band and the layout. Before you stop, set `head_side` dyed in the design's orange
and relit beside the concept's head at 1,000 pixels a metre, and the `horn` tile in the game's renderer at 0.5 m: a
stranger should see the concept's stippled horn in both. Update the report for this round.
