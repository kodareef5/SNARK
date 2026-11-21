# Brief for artist: the Miami instruments after the 2026-11-20 round

For artist, the art agent, and for whoever looks next. The Tide Eye, the Sextant and the Louver Lantern were rebuilt in
this round against the concept book (second edition, pages 2 to 7): the models, the textures, how their metal is lit,
their own lights and the sky display over them. The decisions are D926 to D928.

## What changed

**Models** (`model.py`, `sextant.py`, `lantern.py` on `instrument.py`). Each prong is laid in lapped courses 4 m tall
with a cast belt at each station of its profile, so every course is a ledge the sun finds. The faces an instrument
turns inward are its dark works; on the Tide Eye's tall prong they open in storeys of galleries. Each has a finial
where its beam leaves (the profiles' `emitter`, which the client reads too), stays, and lights of its own: raceways,
beacons, gallery lamps, the deck's channels.

**Textures** (`paint.py`). Two atlases of 2,048, eight strips each: a strip is 32 m of a course 4 m tall at 64 pixels a
metre, tiles along its length and is shown whole from its top edge to its foot. `instrument` is porcelain, cast bronze,
dark steel, optical glass (dyed by the site), paving, a brass register, a vented underplate and weathered porcelain.
`livery` is carmine enamel, the same chipped, the keel's lozenges, the bow's scale blocks, and four of copper.
A face says which way its strip runs by the order of its points: read the head of `instrument.py` before adding one.

**The lights** (2026-11-21, D946). The objects named `glow...` carry the instrument atlas's strip coordinates and
normals like the rest, but the client never samples the atlas on them: the band says how a light is lit across (on
GLASS a round tube, by how it faces the eye; on STRIP, the paving's band, a band lit across its width; on WORN a dim
divider), and along a tube the strip is metres along its run, unbroken from one length to the next (`beam(..., start=)`).
Every light's tube is round, whatever its sides. Its coarsest level is flat, in the site's glass colour.

**The scans.** `tex/scan-a.png` and `tex/scan-b.png` are four flat-lit material scans each, generated for this asset
with an image model from the concept plates (no third party's pictures). `paint.py` takes a strip's weathering from
them and paints everything with a shape itself, in metres, with the height, roughness and metal. To change a
material's character, replace its quarter of a scan with another flat-lit one (no shadows, no highlights, no seams) and
run `paint.py`.

## Please look

At Bayfront (blue), Wynwood (red) and Miami Beach Golf Club (green), from the deck, from the air beside the crown, and
from about 1 km:

1. Do the courses and belts read from the deck, 300 m below, or only up close?
2. Is the ceramic's weathering enough? The weeps and the lap's shade are set in `ceramic()`.
3. Do brass, bronze and copper read as metal: a bright horizon, a darker zenith, their own colour?
4. At an ignition: does the beam leave the finial, and is its end hidden in the cell's knot from where you stand?
5. Over several cycles of one site: three different figures, none twice running, none running backwards.

## What still wants painting

**The travel console.** It wears the atlas's strips at 256 pixels a metre and more, which is enough to read, but it is
still the instrument's trim and not a picture of its own. A dial face for its top (512 pixels, the lens in region 0 so
each site's dye colours it) is the open item from the last round.

## How to check your work

```sh
python3 assets/source/core/structures/tide-eye/paint.py
bun run art -- core:tide-eye
```

The second builds the pack and prints what it measures; `--sheet` draws every piece from eight sides with and without
its pictures into `artifacts/art/core/tide-eye/`. For the game's own view, on a GPU:

```sh
bun tools/build-client.ts --quick --dist var/obelisk/client
bun tools/mapworld/gpu-views.ts var/maps/miami.snmap assets/source/maps/miami/look/tide-eye.json var/obelisk/shots --dist var/obelisk/client --tiers high --hide-hud --film
```

`assets/source/README.md`, "What the check passes and a player still pays for", lists what to read in the numbers.
