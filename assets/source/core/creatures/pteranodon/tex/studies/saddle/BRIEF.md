# Study: the saddle's hide, rope, wood and chitin

Read `tex/studies/COMMON.md` first and follow it. Your folder is `tex/studies/saddle/`.

## What it shows

The saddle is what a rider looks at most, from the seat at half a metre to a metre and a half, for as long as they
fly. In the design's words: a fitted hide seat with stitched edges, a bent-wood cantle faced with pale chitin, two
rope-wrapped loop grips, a girth in front of the wing roots, crossed breast straps and a collar round the base of the
neck, pegs on plaited rope for the feet, a thin halter and plaited reins. Natural materials only. See
`ref/concept/saddle_detail.png` (the saddle close up), `saddled_side.png`, `saddled_three_quarter.png` and
`saddled_top.png`. The saddle is never dyed: every region map is black, and every base colour is the material's own,
as the concept paints it.

- **Hide.** Thick, tanned hide, russet to chestnut as in the concept, oiled and worked by hand: a fine pebbled grain,
  soft creases where it bends, darker and smoother where the rider sits and holds, lighter scuffs on the edges. Natural
  and used, not new store leather, not plastic, not suede.
- **Stitched edges.** The pad and every strap have a creased, slightly rolled edge and a row of pale, waxed saddle
  stitches set in from it, each stitch about 5 mm long and slightly slanted, sunk a little into the hide.
- **Rope.** Pale straw-coloured plant fibre: the reins and the foot-rest ropes are round plaits about 10 to 14 mm
  thick; the grips are bent-wood loops tightly wrapped in a thinner cord, about 4 mm, laid in close turns; the
  lashings are the same cord. Dry, matte, a few loose fibres standing off it.
- **Bent wood.** Pale, honey-coloured wood bent along its grain: long straight fibres following the bend, fine pores,
  a soft polish where hands go, small dents. The foot-rest pegs are turned from the same wood.
- **Chitin.** The facing of the cantle: pale ivory to bone, the shed plate of some large arthropod cut to shape;
  smooth and waxy, faint growth layers, a few fine cracks, edges a little translucent and darker where they are worn.

## Sets

None is dyed; each is its own colour. Each tiles both ways. Undyed, so `look.ts` draws each once.

1. `hide`: the plain hide. 2,048 pixels for 0.5 m (4,100 pixels a metre). Form:
   `{"form": "ball", "radii": [0.25, 0.06, 0.2]}`.
2. `hide_edge`: a stitched edge: the hide's edge runs left to right near the top of the picture with its crease and
   stitches below it, the rest plain hide that matches `hide`; the picture tiles left to right, and top to bottom with
   no second edge visible as one (an edge strap's other edge is a mirrored use of the same picture). 2,048 for 0.25 m.
   Form: `{"form": "tube", "radius": 0.04, "flat": 0.15, "length": 1.2}`.
3. `rope_plait`: the round plait, the rope running left to right; the picture's height is twice round a rope 12 mm
   thick (2,048 for 0.0754 m), so it tiles both ways on the rope. Form:
   `{"form": "tube", "radius": 0.006, "length": 0.6, "turn": false}`; the span is 0.0754.
4. `rope_wrap`: the cord wound round a grip in close turns, the grip running left to right. 2,048 for 0.1 m. Form:
   `{"form": "tube", "radius": 0.016, "length": 0.4}`.
5. `wood`: the bent wood, the grain running left to right. 2,048 for 0.4 m. Form:
   `{"form": "tube", "radius": 0.02, "flat": 0.6, "length": 0.8}`.
6. `chitin`: the cantle's facing. 2,048 for 0.25 m. Form:
   `{"form": "tube", "radius": 0.06, "flat": 0.25, "length": 0.6}`.

## What excellent looks like

A rider looking down at the seat between their knees sees the concept's saddle: worn russet hide with crisp pale
stitching, honey wood bent to shape, straw-coloured rope that looks tied by hand, a cantle faced with something that
grew. At the saddle's own density on the animal (about 900 pixels a metre, `look.ts`'s 5 m column and finer) the
stitches still read as a dotted line, the plait as a plait and the wrapped grip as close turns.
