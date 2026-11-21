# Brief: the soul ball

For whoever looks at it next, and for an artist if it is ever given pictures of its own. What it is for and how it is
used are in [the note](../../../../../planning/workstreams/soul-ball.md).

## What it is

A thing of the Meridian programme's making, as the suit every survivor wakes in is: an ivory ceramic orb a hand closes
round, in two brass rings that cross at its poles as meridians do on a globe. A dark seam runs round its middle. At its
top a machined collar holds a lens; under it is a brass foot; and four small ports sit on the seam, one between each
pair of rings.

It keeps one tamed creature. Empty, its lens and ports are dark blue glass. With a tame in it they are lit, the suit's
lamp blue, and that is the whole difference between the two: one look across a camp says which balls are full.

It should read as precise and made to last, and as one family with the suit: the same ceramic with its fine printed
marks, the same brass, the same blue.

## What the engine needs

- `ball` and `ball_full` (`model.py`): held pieces, about the origin as the grenade is, the lens out of the fist along
  +Z. One shape, built twice.
- Two materials at most, and no picture of its own: both are the suit's finish
  (`../../humans/human-bodies/meridian/`), a sheet of sixteen tiles. Every face lies inside one tile, so nothing
  repeats. `lamp` is the same pictures drawn glowing, and only the full ball's lens and ports wear it.
- 1,188 triangles at its finest, within the held item's budget. It is seen in the hand at arm's length, and in its
  inventory picture.

## What to look at

```sh
bun run art -- core:soul-ball     # the model, its check and its sheet
bun tools/balls/review.ts         # a keep and a loose, as a player sees them
```

1. Side by side: is the full one told from the empty one at a glance, in daylight and at night?
2. In the hand in first person: do the rings and the lens show past the fingers?
3. In the inventory: do the two pictures differ enough at the size of a slot?
