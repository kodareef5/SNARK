# Paint the saddle

Read `tex/paint/BRIEF.md` first and follow it (it points you at `tex/studies/COMMON.md` and `ref/DESIGN.md`). Your
group is `saddle`: every piece of `pteranodon_saddle`, the worn saddle's own material, **1,024 square** (not 2,048 as
the animal's). Your folder is `tex/paint/saddle/`. Read `saddle.py` for what each part is and where it sits.

## What you paint on

The same tools as the animal's painters, for this material: `ref/bakes/pteranodon_saddle_layout.png` (the pieces,
named), `tex/paint/pteranodon_saddle_pieces.png` and `_pieces.json`, `_position_x/y/z.png`, `_texel_mm.png`, and
`ref/bakes/pteranodon_saddle_normal_object.png` and `_curvature.png`. The layout is the saddle's left side and middle;
the right side is its mirror. It is pinned (`saddle_layout.json`). About 0.8 to 1.3 mm a texel on the outer faces;
the inner faces that lie on the animal (`seat_under`, `girth_in`, `collar_in`, `strap_in`) are about 3 mm, being seldom
seen.

The pieces: `seat_top`, `seat_under` and `seat_edge` (the fitted hide pad and its rolled, stitched rim); `cantle` (a
bent-wood bow across the back of the seat) with `cantle_plate_out` and `cantle_plate_in` (the chitin plate on its
face); `grip` (a bent-wood loop wrapped in cord); `girth_out`, `girth_in`, `girth_edge`, `girth_edge2` and
`collar_out`, `collar_in`, `collar_edge`, `collar_edge2` (hide straps round the chest and the base of the neck, their
two edges); `strap_out` and `strap_in` (the crossed breast straps) and `boss` (a chitin boss where they cross); `rope`
and `peg` (the foot rests: a wooden peg on plaited rope); `halter` (rope rings round the beak and behind the eyes) and
`rein` (the plaited reins).

## What it is

The saddle study (`tex/studies/saddle/`) is accepted and is your material: its `hide`, `hide_edge`, `rope_plait`,
`rope_twist`, `rope_wrap`, `wood` and `chitin` sets, their originals and elements. Read its delivered layers each time
your script runs (if missing, run its `build.py`; never edit the study). On the saddle:

- **Hide** on the seat, girth, collar and straps: the study's oiled russet hide at its real scale, darker and smoother
  where the rider sits (the middle of `seat_top`, dished under the hips) and where hands and knees rub (the front of
  the seat by the grips, the sides by the knees); lighter scuffs on the edges. Every edge piece (`seat_edge`,
  `girth_edge*`, `collar_edge*`) is the study's `hide_edge`: the burnished, rolled edge with its row of pale slanted
  stitches set in from it, running the length of the piece; on the faces beside each edge, keep the stitch line where
  the concept shows it (`ref/concept/saddle_detail.png`), a few millimetres in.
- **Wood**: the cantle's bow and the grip's loop under its cord, and the peg, the study's honey bent wood with the
  grain running along each part, polished where hands go.
- **Chitin**: the cantle's plate and the boss, the study's waxy pale plate with growth layers following its edge.
- **Rope**: the foot-rest `rope` and the `rein` in the study's round plait, the `halter` in its twisted cord, the
  `grip` in its close wrap, each at its real thickness (the piece's texel size and the model's radius tell you the
  scale: a plait of about 12 mm, the halter's cord about 11 mm across, the rein's about 12, the grip's wrap of 4 mm cord
  round a 32 mm loop) and each laid so the strands run round the rope as they do on a real one, meeting at the cut
  without a visible step.
- **Contact.** Where the seat, the girth and the collar lie on the fuzz their inner faces are in shade, and the outer
  faces darken a little toward the fuzz: put that in your own occlusion, softly. (`compose.py` multiplies in the
  modeller's form occlusion when it is baked.)
- **Never dyed.** The saddle takes no dye: its region map is black everywhere, and its base is its own colours.

## What excellent looks like

`look.sh` draws the animal with its saddle (`saddled_rider`, `saddled_seat`, `saddled_side`, `saddled_front`). From the
rider's seat it is the concept's saddle: worn russet hide with crisp pale stitching along every edge, honey wood bent to
shape, straw-coloured rope that looks tied by hand, a cantle faced with something that grew; from the side at a few
metres the saddle sits on the ivory fuzz as one made thing of hide, wood and rope, the stitched edges reading as fine
pale lines. The same hand as the animal's maps and the studies.
