# Study: the down of the trousers

Read `tex/studies/COMMON.md` first and follow it. Your folder is `tex/studies/trousers/`.

## What it shows

In the design's words, the plumage is longer and shaggier on the flanks, where the feathers hang as loose trousers over the thighs to the top of the scaly legs; the belly's lower edge is soft and ragged. See the lower body in `ref/concept/side.png`, `front.png` and `three_quarter.png`.

- **The feathers** are the same family as the body's rounded contour feathers (the `body` study is being painted beside you in `tex/studies/body/`; look at it when it appears), but longer (6 to 9 cm), narrower toward the tip, and much looser: the barbs are long, soft and downy, barely held together, so each feather's lower half parts into wisps and strands. They hang down and overlap loosely in a shaggy fall, with a few strands crossing their neighbours. Plain, no bars. Region 0.
- **Not fur, not hair.** Each shaggy feather still has a shaft you can find near its root and a vane that spreads from it. The wisps are barbs, gathered into soft locks, not single hairs.

## Sets

1. `trousers`: the shaggy fall over the thighs and flanks. 2,048 pixels for 0.427 m, tiling both ways, feathers hanging down the picture.
2. `trousers_fringe`: a sheet of about 12 single long shaggy feathers, cut out (RGBA), for the cards that hang below the trousers and the belly's edge and break the outline there. 2,048 pixels for 0.341 m. Give each element's box, root and tip in `study.json`. The cut-out edge at the bird's size is a fringe of wisps, not a blur.

Keep each generated feather's own layers (cut-out, height, shaft) in `source/` so the bird's painter can place them again.

## What excellent looks like

Up close it is soft, deep and touchable: long downy feathers in a loose fall, with wisps you could separate with a finger, still clearly feathers. Shrunk to the bird it is the soft ragged lower edge of `ref/concept/side.png`, a little shaggier than the body above it and of the same kind, so the two can blend into each other on the flank without a line. Dyed near-white it looks like a white bird's downy thighs, and dyed near-black the wisps still read.
