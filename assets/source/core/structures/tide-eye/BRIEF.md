# Brief for artist: the Miami instruments after the 2026-11-18 round

For artist, the art agent, and for whoever has a GPU. Nothing here could be judged on the build server, which draws
with no graphics card: the sheets were made by the CPU renderer (`bun run art -- core:tide-eye --sheet`).

## What changed, to be looked at in the game

The Tide Eye, the Sextant and the Louver Lantern are now lit as round where they are turned forms: the lens rings,
the hub and axle, the collars, the travel console, and every strut and tie of five sides or more. Plates, chamfers,
the bow's scale blocks and the Lantern's twelve-facet light well were left flat on purpose. The deck's register marks
are flush plates where they were blocks.

Please look, at Bayfront (blue), Wynwood (red) and Miami Beach Golf Club (green), from the deck and from about 1 km:

1. Do the rings and the console now read as round, with the panel lines between plates still crisp?
2. Do the five-sided struts read as round bars, or as soft-edged sticks? If the second, say so: the fix is more sides
   on the struts near the deck, not flat shading again.
3. Do the deck's marks flicker against the deck from far off? They stand 1 to 2 cm over it, as the blocks' tops did.
4. Is anything lit from the wrong side? The pack's own check found no normal facing inward.

## What needs painting

**The travel console.** It is the one piece a player stands at, 1.3 m across, and it wears the same trim strips as a
structure 380 m tall. Each of its faces shows about a twentieth of a tile, so it reads as flat colour (the check
measures 2,351 pixels a metre there against 42 to 85 on the structure). It wants a small picture of its own at a
density a hand's width can read: a dial face, engraved graduations, a worn brass rim, the lens in the middle. Same
eight materials as `paint.py`'s strips, 512 pixels square is enough, tiling not needed. Keep the lens in region 0 so
each site's dye still colours it.

**Not wanted:** new pictures for the Sextant's and the Lantern's bodies. Theirs differ from the Tide Eye's in one
strip of eight; the rest is the same picture stored three times. If a second look is wanted for them, ask for the one
strip.

## How to check your work

`bun run art -- core:tide-eye` builds the pack and prints what it measures; `--sheet` draws every piece from eight
sides with and without its pictures into `artifacts/art/core/tide-eye/`. `assets/source/README.md`, "What the check
passes and a player still pays for", lists what to read in those numbers.
