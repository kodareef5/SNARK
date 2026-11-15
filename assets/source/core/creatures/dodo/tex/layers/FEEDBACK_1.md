# Round 1: what works, and what falls short

Judged in the game's renderer: your `look/` sheets, and the bird in the world (attached, and drawn by
`bun ref/world/snap.ts hurt_2m hurt_10m decay_2m decay_10m --tier medium --out tex/layers/world` from this folder,
about a minute: four birds side on, unhurt and hurt 1 to 3, and four corpses lying belly to you, fresh and decay 1 to 3,
from 2 and 10 m, each also enlarged).

## Keep

The placement and the timing: the stages are told apart at 2 m, hurt 3 still says "nearly dead" at 10 m, the late
breast drag carries the front view, mirroring is hidden well, the cards are stained without repeating a wound, nothing
overlaps, and the unhurt bird is untouched. The sources, the marks file and the arrival maps are a good base. Change
what the marks look like, not where or when they come.

## Falls short

1. **A wound reads as a patch, not a wound.** Each mark is one mid red-brown field with an even speckle of clumps: from
   2 m it looks like a rust-coloured decal or a dapple of camouflage. A wound has a focus. Where it is deepest it is
   open and near black-red and wet; a rim of brighter torn flesh round that; then blood matting the plumage, densest and
   darkest next to the opening and thinning outward into the bird's own colour, run down by gravity as the bird stands
   (down the breast, down the flank, off the lower edge of the wing) and combed along the way the feathers lie; at the
   ragged edge, lifted and broken feathers with pale down showing. The values should go: opening darkest, matting
   middle, clean plumage beyond. Hurt 1 can be just one or two such marks; that is enough to read.
2. **The corpse reads as camouflage.** The olive and umber fields over the whole body are what the eye takes in at
   decay 3, and at 10 m the default bird is brown nearly everywhere. A worked-over carcass reads by a few large, clear
   openings with cut edges: a dark lip of hide rolled back, a cream band of fat and fascia under it, deep red-brown meat
   with a grain inside, ivory bone in the deepest part with dark gaps between ribs, and blood dried to near-black brown
   round the edges. Plucked skin on a bird is pale pinkish grey and pimpled, not olive. Rot, if any, is late and local:
   a grey-green bloom at the edges of the openings, not a field.
3. **Put the openings where a corpse shows them.** In the game it lies on its side (the pictures): the flank, the
   belly and the breast face up and to the viewer, the back much less. Open the flank and belly properly, ribs inside the
   flank opening and the keel in the breast one; leave the back and the cap mostly as they were, with plucking at most.
4. **It should stay a dodo.** The engine already dulls and darkens the whole corpse by a third at each decay step. Let
   your paint be the openings and their surroundings, so that at decay 3 there is still slate plumage between them and
   the bird's colours show through the dulling.

The bar is unchanged: readable at 2 m, telling at 10 m, in our own painted look, believable rather than gory. Same
files, same rules. Add `FEEDBACK_1` notes to `REPORT.md` saying what changed.
