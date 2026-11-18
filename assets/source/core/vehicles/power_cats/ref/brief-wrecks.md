# The Lagoon's wreck forms

You painted The Lagoon's surfaces and its hurt and decay layers in earlier jobs (`paint.py`, `wear.py` and the modules
beside them in `power_cats`; read `ref/SOURCES.md`). Now paint its two wreck forms, as the example for the rest of the
family. You may write in `power_cats`, `lagoon_damaged` and `lagoon_sunk` (all under
`/home/user/dev/SNARK/.claude/worktrees/marine-art/assets/source/core/vehicles`), and nowhere else.

## The wreck forms

Each vessel has two wreck forms, meshes of their own built from the vessel's on its own layout (`../marine/wreck.py`
from `content/vehicles/marine-wrecks.json`), so every texel of a vessel's own pictures is the same place on its wrecks:

- `<vessel>_damaged`: afloat and badly hurt, as a harbour holds it after a storm or a fight: heeled and trimmed a few
  degrees, its hull stove in where it was struck (the json's `dents`: a point in the vessel's frame, a radius and a
  depth), its rails bent, its cushions and canvas still there. It floats lower than it did whole.
- `<vessel>_sunk`: on the bottom of a harbour, lying in water to about its main deck, heeled and trimmed further, holed.
  Where the json says `burnt`, it burnt before it sank: its cushions, canvas and acrylic burnt away (gone from the
  mesh), its upper works slumped toward the deck, everything above the water blackened and blistered, gelcoat burnt off
  to the grey-brown glass mat, metal heat-blued and sooted, glass gone dark. Where it did not burn, it swamped: faded,
  fouled and silted, weed and barnacles to where the water stood, mud in the cockpit.

A sunk form is also what the game draws when a vessel is destroyed (it then sinks wherever it was), so it must read as
that vessel's wreck from any side.

The forms are drawn as a map's scenery, without hurt or decay layers: each own material's look is in its own pictures,
`../<vessel>_<form>/tex/<material>_{base,packed,mask}.png` at the vessel's sizes (base RGBA with alpha 255 except
where the vessel's picture is cut out; the mask as the vessel's: a damaged form keeps its colours where its paint is,
a burnt one has little paint left to dye). Its normal and height are the vessel's own. The family's shared tiled
material has two variants of its own, `tex/<name>_worn_{base,packed,mask}.png` for the damaged forms and
`tex/<name>_wrecked_{base,packed,mask}.png` for the sunk ones (its normal and height are the intact one's).

Paint each form as one event, not as every mark at once: a damaged form shows the hurt layer's marks where its dents
are and the decay of a few weeks adrift; its holes must lie where the mesh is stove in. To place things on the form as
it lies (its water line, what the sun reached), turn a texel's position `P` (the vessel's frame) the way the form lies:
burnt upper works first (`y > slump[0]` becomes `slump[0] + (y - slump[0]) * (1 - slump[1])`), then the heel `h`
(degrees, port down for +): `x' = x cos h + y sin h`, `y' = y cos h - x sin h`, then the trim `t` (bow down for +):
`y'' = y' cos t - z sin t`, `z' = y' sin t + z cos t`. A damaged form floats with its water at `y''` = its
`waterline` in `content/vehicles/marine-wrecks.ts` (the vessel's draft plus 30% of its freeboard); a sunk one has its
water at about its main deck's height above its lowest point.

## How you look

The forms' packs are built for these layouts. Draw them with the vessel's measures:

```
bun assets/source/core/vehicles/marine/look.ts --out /tmp/look --size 900 --asset core:lagoon_damaged core:lagoon   # add --water Y to hide what lies under height Y
bun assets/source/core/vehicles/marine/look.ts --out /tmp/look --size 900 --asset core:lagoon_sunk core:lagoon
bun tools/art.ts core:lagoon_damaged --check
bun tools/art.ts core:lagoon_sunk --check
```


## The job

Write `wrecks.py` in the family folder (the geometry is `../marine/wreck.py`'s; this is the pictures) so that
`python3 wrecks.py lagoon` paints, from the vessel's bakes and the fields your painter and your wear script work out
(import them):

1. `../lagoon_damaged/tex/{hull,house}_{base,packed,mask}.png` and `../lagoon_sunk/tex/{hull,house}_{base,packed,mask}.png`, at
   the Lagoon's sizes (hull 2048, house 4096).
2. `tex/teak_worn_{base,packed,mask}.png` and `tex/teak_wrecked_{base,packed,mask}.png`, 1024, tiling as the teak does: the
   decks of both boats' damaged forms (scuffed, stained, salt-grey) and sunk forms (charred and blistered where a fire
   ran, silt-grey and weed-green under water).

The Lagoon's forms, from `content/vehicles/marine-wrecks.json`:

- `lagoon_damaged`: heeled 3 degrees to starboard, down 1.0 degrees by the stern, stove in at (-3.6, 1.4, -5.5) within 1.4 m, 0.16 m deep.
- `lagoon_sunk`: heeled 10 degrees to port, down 1.5 degrees by the stern, stove in at (3.6, 1.2, 5.6) within 1.6 m, 0.26 m deep; at (3.5, 1.4, -3.0) within 1.2 m, 0.16 m deep, burnt: its upper works above y = 2.4 m slumped by 50%.

Make each form look like what happened to it: the damaged one is still a catamaran someone could tow home, the sunk one is
plainly lost. Both must read from a dock at 10 m and from 100 m, at noon and under a low sun, and the sunk one from any
side, since a destroyed vessel is drawn as it wherever it sinks.
