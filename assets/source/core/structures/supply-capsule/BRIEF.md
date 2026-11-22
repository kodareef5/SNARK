# Brief for artist: the supply capsule, first round (2026-11-21)

For the artist, the art agent, and whoever looks next. This is the thing a supply drop lands as
(`planning/workstreams/supply.md`): the travel console's kin, made to fall. It was modelled and painted in one round
against the concept plates (the drop book of plates is kept outside this repository, beside the obelisks' book).

## What it is

A round drum of salt-weathered porcelain between two cast bronze belts, on a vented underplate with three nozzle
bells; three bronze legs; a dark steel register that carries a brass collar for each step of its tier; a lantern of
three bays of optical glass between the legs' ribs, behind louvres; a porcelain cap; a mast with its lamp and the
top-mark of its class. A ringed drop wears a tilted brass hoop. About 2.6 m to the top of its mark and 2.4 m across
its feet.

How it is read: the glass and every light are the tier's colour, the collars count the tier, the top-mark is the
class. Seven marks, each turned on the mast's axis or crossed in two planes so that it reads the same from any side:
bar, saltire, buckler, hourglass, cross, cone down, cone up.

## How it is made

**The model** (`model.py` on `kit.py`). Everything is built to `shared/world/supply-capsule.json`, which the client
poses the moving pieces by (`client/core/render/supply.ts`). What moves is a piece of its own, modelled about its
hinge: `leg` (about its knuckle, +X out from the drum), `shutter` (one slat about its axle, hanging shut), `hatch`
(about the pin at its edge), `hoop` (about the capsule's axis). What is counted is a piece drawn that many times:
`collar`. Four levels a piece, the last flat; the hull is 2,018, 698, 266 and 88 triangles.

**The atlas** (`paint.py`). One of 2,048, eight strips: a strip is 2 m of a course 0.25 m tall at 1,024 pixels a
metre. It is painted by the instruments' painter (`../tide-eye/paint.py`) sixteen times nearer, from the instruments'
scans, so it needs the tide-eye asset's `tex/scan-*.png` installed. Porcelain, cast bronze, dark steel, optical glass
(colour region 0, which takes the tier's colour), scorched steel, the brass register, the vented underplate, and
salt-weathered porcelain. The scorched strip is this asset's own: heat-tinted from straw through brown, purple and
blue to soot, for the bells and the skirt over them.

**The lights.** `lights` is the capsule's lit strips and `shaft`, `sheath`, `halo`, `figure_*`, `jet` and `foot` its
light with no surface. They wear the materials `light` and `glow`, which have no picture: the client works each out
from the strip's row and the point on it (`client/core/render/supply-light.ts`, where the rows are named), and draws
`glow` blended. `kit.py` says which band is which light. A shaft is a metre in radius and 600 m tall, a jet a metre
long, a figure three metres tall: the client sizes each with its bone.

## Please look

1. The silhouette from 30 m: does it read as an instrument, or as a stove? The cap is the first thing to change.
2. The cap and the mast are plain. A finial, and a rim to the cap, are open.
3. The hatch has a handle and no frame. Its doorway is a dark inlay on the drum, not a recess.
4. The legs have no damper strut.
5. The top-marks at 60, 18 and 8 pixels, against plate 05b of the concept book.

## How to check your work

```sh
python3 assets/source/core/structures/supply-capsule/paint.py
bun run art -- core:supply-capsule
bun tools/supply/review.ts
```

The second builds the pack and prints what it measures; `--sheet` draws every piece from eight sides into
`artifacts/art/core/supply-capsule/`. The third drives the real client through a whole drop on the software renderer
and writes pictures to `var/supply/review/`.
