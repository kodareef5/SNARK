# Study: the wing fingers and the tail feathers

Read `tex/studies/COMMON.md` first and follow it. Your folder is `tex/studies/quills/`.

## What it shows

The bird's largest single feathers, which on the bird are cut-out cards, two-sided. In the design's words: the wing is a small rounded stub folded on the middle of the flank, with four broad cream flight feathers fanning out of its back edge like fingers. The tail is a raised tuft of seven broad, soft feathers, a central one and three pairs, rising from the top of the rump and curling forward over the back, each crossed by two narrow cream bands at its tip. See `ref/concept/side.png`, `back.png`, `top.png` and `three_quarter.png`.

- **The wing fingers** are region 5 (yellow), cream by default: broad, soft flight feathers about 5 cm long and 1.8 cm wide, rounded at the tip, with a clear shaft and a soft vane whose edge separates into barb tips toward the end. Not claws, not petals: real broad, soft primaries of a flightless bird.
- **The tail feathers** are region 0 (red) with the two bands in region 5: broad, soft feathers about 11 cm long and 2.5 to 3 cm wide, a strong shaft, soft vanes, a rounded tip. Near the tip, two narrow cream bands cross the vane, each about 4 to 5 mm wide, with a band of body colour between them and at the very tip, as in the concept. The band edges follow the barbs (a band's edge is a little ragged where the barbs carry it), and on the region map they follow them too. The central feather is symmetric; the three pairs are slightly asymmetric and curved, one of each pair being the other mirrored on the bird.

## Sets

1. `quills`: one sheet of cut-out elements (RGBA): four wing fingers, slightly different, and the tail's central feather and three side feathers. 2,048 pixels for 0.341 m. Give each element's box, root and tip in `study.json`.

Keep each generated feather's own layers (cut-out, height, shaft, and where the bands are) in `source/`.

## What excellent looks like

On the bird these cards get about 1,500 texels a metre, so a tail feather is about 165 pixels long and a finger about 75. They must hold there: shrink your sheet to a quarter and look. The bands still read as two crisp cream bands, the fingers as four separate feathers, and the cut-out edge is a fringe of feather tips, not a blur or a smooth outline. Up close they are real, soft feathers with a shaft and barbs. Dyed with a near-black body and white bands, or a hot pink body and lime bands, they still look like feathers.
