# The dodo hurt, and its corpse rotting

The game shows how hurt a creature is without ever showing its health: everyone sees a living creature at one of four
steps, unhurt down to near death, a step for each quarter of health lost. When it dies, its corpse lies where it fell
and is cut up for meat and hide; it goes through three more steps as it is harvested and ages. Today the dodo looks the
same at every one of them. Paint what it turns to, so that a player who sees a dodo knows at a glance how badly it is
hurt, and sees a carcass that has been worked over and left to rot for what it is.

The bird's look is accepted and is not to change. Unhurt, it must be exactly what it is today, which the engine already
guarantees: you paint only what shows at the later steps.

## What the game draws, and what it needs from you

Two pictures on the opaque material's layout, `tex/dodo_hurt.png` and `tex/dodo_decay.png`, RGBA, 8 bits a channel,
sRGB colour, 1024 pixels square (the layout of `ref/bakes/`, at half size). The two in `tex/` now are blobs I made to
test the engine; replace them.

- **Colour** is what that texel turns to. It takes the place of the bird's own dyed colour there and is never dyed: a
  blue-dyed dodo bleeds red like a grey one. A texel has one colour at every step.
- **Alpha** is how soon the texel shows, over its picture's three steps. 255 shows from the first moment, 0 never.
  A texel starts to show as the step passes 3 x (255 - alpha) / 255 and is whole a quarter of a step after. So a mark
  is whole by step 1 from alpha 191 up, by step 2 from 106, by step 3 from 21.
- **The hurt picture** covers the living bird's steps 1 to 3. **The decay picture** starts from the fresh corpse, which
  shows the whole hurt picture, and covers the corpse's steps 1 to 3 on top of it. Where the hurt picture has any
  alpha, the decay picture must have none there (the build refuses the pair otherwise): a decay mark that grows out of a
  wound grows around it.
- **Marks grow, they do not pop.** A creature moves between steps over a moment, and the threshold sweeps through
  alpha as it does; so does the decay. Give each mark alpha that falls from where it starts to its edge, through the
  steps it grows over, and a wound spreads and a tear opens instead of appearing.
- **What the engine adds on its own:** every mark that shows is glossy and wet on a living bird and a fresh corpse, and
  dries as the corpse decays; and decay dulls the whole corpse, plumage and marks together, toward a warm grey and
  darker, a third of the way at each decay step. Paint blood and flesh as they look, not wet or dried; the engine does
  that.
- **Storage.** The game holds the layer 256 pixels across (about 3 mm a texel on the body, 1.4 on the face): that is the
  dodo's texture budget. Paint at 1024; make anything that must read at least a few of the game's texels wide. The build
  averages colour by alpha and keeps each mark's earliest step from afar, so small marks hold their step at a distance.
- **The layout is half a bird.** Each texel is used on the left side and, mirrored, on the right, so every mark appears
  on both sides. Place marks where seeing both at once does not look like a pattern. `ref/bakes/dodo_covered.png` marks
  texels hidden under the folded wing and round the leg tops, which are seldom seen.
- **The feather cards** (`dodo_cards`, the fringes of hood, mane, flanks, trousers and tail, and the wing fingers) are a
  second material on a 512 atlas, where every card of a kind is drawn from one rectangle. They may take layers of their
  own the same way (`tex/dodo_cards_hurt.png` and `_decay.png`, 256 square, named in `asset.ts` under `dodo_cards`),
  knowing that whatever is painted on a rectangle shows on every card of that kind. Decide whether that helps; a bloody
  body under clean fringes, or rotting skin under fresh ones, would not convince.
- Only the near, textured levels of the bird show layers. Far off it is drawn flat, and on the lowest graphics tier
  never textured; nothing to do there.

## What to read

- `ref/DESIGN.md`, `ref/concept/` and `ref/world/` (the bird in the game today, knocked out and dead too): the look
  you are painting onto.
- `ref/bakes/bakes.json` and its pictures, and `tex/paint/BRIEF.md` with what it points at (`tex/paint/pieces.png` and
  `pieces.json`, the position maps, `texel_mm.png`, the feather direction): where every texel is on the bird, how big,
  which way its feathers lie. `tex/dodo_base.png`, `dodo_regions.png` and `dodo_height.png` are the accepted maps, and
  `tex/paint/*/paint.py` how they were painted.

## What excellent looks like

- **It reads.** At 2 m a player can tell step 1 from step 2 from step 3 at a glance; at 10 m step 3 still says "nearly
  dead", and a corpse at decay 3 says "picked over and rotting". `bun tex/layers/look.ts --out tex/layers/look` (from
  this folder, about 15 s) draws it in the game's own renderer at every step: three sides, the head, the back, the legs,
  and the sizes the bird is seen at from 2 m and 10 m. Judge it there, in all three dyes it draws.
- **It belongs on this bird.** Wounds where blows land on a ground bird: flanks, breast, neck, back, the head. On
  plumage: feathers matted and clumped with blood, lifted and broken to show pale down, torn out to bare skin. On the
  bare rose face: scratches and dark bruising. On the beak: scuffs, a chip, a crack. On the legs: scrapes and a gash
  through the scales. The corpse: hide torn where it was cut, flesh beneath, the keel and ribs, leg bone, plumage gone
  in patches, blood dried dark. Sized in millimetres on the bird, following its form and its feathers.
- **Our own look.** The painted, plush-but-real look of the accepted maps; believable, not a decal, not a horror piece.
  Grim enough to read from 10 m, no more.
- Nothing traced or taken from any game, and no game's pictures given to the image tool. Generated originals are fine;
  keep them with their prompts.

## What you deliver

In `tex/`: `dodo_hurt.png` and `dodo_decay.png` (and the cards' two if you make them). In `tex/layers/`: `paint.py`,
which writes those pictures from your sources and the bakes, the same bytes every run, reading the bakes each time;
`source/` with any generated originals and their prompts; and `REPORT.md`: what you painted where and why, the sizes on
the bird, which steps each mark comes in at, and where it still falls short. Work only in `tex/layers/`, those
pictures and the `dodo_cards` lines of `asset.ts`; leave everything else as it is. Keep your scripts in Python.
