# Brief: the dodo's loose feathers

You are painting the feathers that come off the dodo in a survival game: when a player throws it and it hits the ground, when it is struck, when it is knocked out and falls over, when it dies, when it gets up and shakes itself. A handful of them burst off the bird, tumble and drift down like falling leaves, lie on the ground a few seconds and fade. The picture attached (`three_quarter.png`) is the bird's concept: soft, rounded, loose blue-grey body feathers in overlapping rows; narrow cream bars across the back and rump made of pale feather tips; four broad cream flight feathers fanning from the back of each small wing like fingers; a raised tail tuft of seven broad soft feathers curling forward, each crossed by two narrow cream bands at its tip; a plush umber hood of small feathers on the head.

## What excellent looks like

- A player who sees one land beside the bird believes it came off this bird. Same painting style as the concept: soft, slightly stylised, natural barbs, nothing plasticky or photographic.
- It reads as a feather at 3 m (where it is 20 to 60 pixels long on a phone) and as a pale fleck at 20 m (4 to 8 pixels). Its silhouette carries it: a soft rounded vane, a quill, a downy base. It is never a square, never a hard rim, never a blob.
- Seen from either side and lying flat on the ground, it still reads, since the engine shows the same picture on both faces of a small card and lights it itself.

## The pictures

All in this folder, each square, 1024 pixels across (512 at the least), RGBA, transparent all round with the feather centred and at least 6% of the side clear on every edge. The long axis is vertical, the quill end at the bottom, the feather filling about 90% of the height.

| File | What |
| --- | --- |
| `contour.png` | A body contour feather from the back: rounded tip, soft vane, downy lower third, with the pale cream tip bar |
| `contour_plain.png` | A breast feather: the same kind without the bar, a little broader and fluffier |
| `down.png` | A small plush tuft of hood or down feather, mostly fluff with a short quill |
| `flight.png` | One of the wing's broad cream flight-feather fingers: stiffer, longer, the vane a little asymmetric |
| `tail.png` | A tail feather: broad, soft, curling, body-coloured with two narrow cream bands near the tip |

Each comes as two files, as the bird's own textures do:

- **`<name>.png`, the base colour.** Light neutral grey wherever the feather takes the bird's colour, carrying only light and dark (barbs, the shaft, the downy base, gaps between barbs), no hue. The engine multiplies it by the bird's dye, so a grey picture becomes a blue-grey, brown or cream feather on birds of different colours. Light it evenly from the front, with no cast shadow and little baked shading. Alpha is coverage: solid in the vane, falling through the fine barb tips and the down to nothing.
- **`<name>_regions.png`, which of the bird's colours each part takes**, in flat colours on the same layout: red for region 0, the body colour; magenta for region 4, the head's hood; yellow for region 5, the cream of the wing fingers and the tip bars and bands; black for what is never dyed and keeps its own grey (a pale shaft, if you want one). Only pixels the base colour covers matter. A feather may use at most two regions besides black.

For checking your work, the bird's default dyes are region 0 `#6b737a`, region 4 `#433324` and region 5 `#e6e2d6`; others it may be dyed include `#874833`, `#bba27b`, `#403b37` (region 0) and `#ddc69c`, `#9d553a` (region 5).

## What to hand back

- The ten files above.
- `preview.png`: each feather dyed in the default colours, at full size, at 128 pixels (the size the engine keeps it at) and at 32, on mid grey and on sand (`#c9b48a`), so it can be judged at game size.
- `REPORT.md`: how you made them, what you checked, and anything you would change.
- Keep any scripts you write in this folder.

Choose your own method. The engine needs only the files and their layout as described; everything else is your judgement, aimed at the best feathers you can make.
