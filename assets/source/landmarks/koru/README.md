# Koru

A landmark: a full-scale three-masted schooner, 125 m with its bowsprit and 17.2 m in the beam, moored and walked.
Its proportions follow Oceanco's Koru as published (`ref/REFERENCES.md`, `ref/sources.json`); hull stations, rig
heights and deck heights are inferred from the photographs in `ref/photos/`, and the four decks of rooms, stairs and
furniture are an original interpretation. No photograph's pixels are in the pack.

## How it is made

- `author_layout.py`, with `layout_details.py`, writes `content/landmarks/koru-layout.json`, the one authority for
  collision, placement and the art's layout (`ref/LAYOUT.md`), the hull's rake among it. It rebuilds byte for byte.
- `model.py` and `parts.py` build the pieces in Blender from that layout: eight cells, each one mesh of every module
  whose origin lies in its 16 m of the ship, in its anchor's frame; the three doors, each with its open form; and the
  sail parts, five sheets and three gaffs. The modules themselves are collision alone.
- `tex/paint.ts` paints the three pictures every textured face is drawn from (`tex/PROVENANCE.md`): `surfaces`, the
  atlas of the yacht's finishes; `sails`, its sailcloth; and `signs`, its brass plaques and its name, a picture of
  1,024 that medium shows whole, so that they are as sharp on medium as they were on high in the atlas. `materials.json` says which picture each
  finish is in, where, and how it is painted and lit.
- `asset.ts` is the pack: `landmarks:koru`, `koru.snpk`, which ships only with the maps that place it. It states the
  cells' errors, what a cell may draw from each distance (`CELLS`, in place of the shared landmark rule), and that every
  finish of the pictures is one of the yacht's finishes (shared/pack/finish.ts): the build reads each finish's colour,
  occlusion, roughness and metalness off its part of the pictures as a textured draw shows them from afar, gives it a
  palette colour of its own, and a lit tier draws its flat faces lit as it is.

```sh
python3 assets/source/landmarks/koru/author_layout.py
bun assets/source/landmarks/koru/tex/paint.ts
bun run art -- landmarks:koru
bun run art -- landmarks:koru --check
```

## The levels

A cell has five levels, all made in `model.py`. On medium at 1,080 rows a level takes over at 88, 210 and 456 m from
the cell's bounding sphere, on high at 138, 331 and 716 m. Past the structures a client holds (190 to 250 m) the yacht
is drawn from its far mesh, which is every cell at level 2 and then at level 3; so levels 2 and 3 are the yacht from
the hand-over to the horizon. Level 4 is a stand-in of blocks, the level the landmark's boot file holds, drawn only
until the others have come, so the yacht adds no more than its old coarsest level did to the wait for the first frame.

| level | drawn | holds |
|---|---|---|
| 0 | with the pictures | everything: rooms and their furniture as made pieces, stairs, plaques, ports of dark glass in a stainless flange and bore, rails with posts, every wire of the rig |
| 1 | with the pictures | what is seen from outside: hull, decks, deckhouse walls with flush windows and shut doorways, open decks and their furniture as blocks, stairs whose wells open on an open deck, ports as glass in a rim, the rig but its diamonds, 18 cm across and paler |
| 2 | flat | level 1 without rails or the cove line, ports as bright octagons, flights as ramps, and of the rig the forestays and the mizzen backstays alone, 56 cm across and paler still |
| 3 | flat | level 2 with square ports, no face to the cap rail, no rig, and masts no thinner than 80 cm |
| 4 | flat | a stand-in: per deck a deckhouse block and a deck slab, the hull without ports, masts, booms and bowsprit |

The rules the levels keep:

- The rig thins and pales as it goes off, and is gone by level 3, with no step: on each level a wire is about two
  thirds of a pixel across where that level is last drawn on high (on level 0 no wire is under 6 cm), which no wire
  below a pixel's width is at four samples a pixel without breaking into dashes, and as much paler as it is wider than
  the wire, so that it shows about as much as the wire would. Near it is dark against the sky, as photographed. The
  diamonds go first, then the shrouds, toppings and interstays; the forestays and the mizzen backstays, the long
  diagonals of the schooner, go last. The rails are bright steel on levels 0 and 1.
- Masts, booms with their sail covers, the bowsprit, spreaders, radomes and the flag are on every level. On level 3 no
  length of mast is under 80 cm across, so on a card with four samples a pixel it is a line to 3 km and not dashes.
- The deckhouse's windows are their own faces on every level, and the hull's ports and its 25 cm red boot stripe too.
- A flat face is drawn in its finish: on a lit tier with the finish's own colour, occlusion, roughness and metalness,
  mirroring the sky as the pictures' draw does, so a flat level is its textured level without the picture at every
  hour and from both sides. Between level 1 and level 2 at 150 m on high, the hull, the deckhouse and the boot stripe
  differ by at most 1.3 in OKLab (times 100) at 08:00, 14:00, 18:15 and 22:00 from either side. Low poly draws each
  finish's palette colour, which is the nearest to its own that no other finish has.
- The hull is a dark gloss that mirrors the sky: near, it is lighter where it is seen along and darker where it is seen
  square on, and that moves as one walks. Its ports are dark glass in a bright rim, and far off bright dots.
- Sailcloth passes light: a sail's face away from the sun shows 70% of what its other face takes (a sheet, PackMaterial
  `sheet`), on the pictures' levels and the flat ones alike.

The hull is straight between the layout's stations and shaded smooth across them. Below the sheer it is sheared back
from the plumb stem and stern into a raked clipper bow (5 m at the waterline) and an overhanging canoe stern (3 m), as
photographed: the layout's `rakes`, by which its collision and the art are sheared alike, so a swimmer or a boat meets
the stem where it is drawn. The decks and rails keep the plumb ends.

The sails: near, each row of a sheet is a panel of sailcloth from its picture, a gaff sail's sixth rows carrying battens,
smooth over its camber; then two flat levels. Struck, a gaff sail and its gaff lie inside the cover on the boom, as an
in-boom furling sail does, and a headsail rolls on its stay. Set, the sail parts are drawn as far as the far mesh;
struck, while the client holds the yacht's structures near, and past that the far mesh's forestays stand for the
headsails rolled on them, so no sliver of sail is left to break into dots far off.

## Pictures

`ref/pictures/` holds the accepted pictures, drawn by the software rasterizer on medium at its Miami berth
(`bun tools/map/cityviews.ts var/maps/miami.snmap <views.json> <folder>`, `--moved 1` for the sails set): from the quay,
on the sun deck, from 1 km off and 150 m up, and with its sails set. Their views, with the yacht's origin at x 5942,
z 3384 and its bow to +z:

```json
[
  { "name": "dock", "x": 5975, "z": 3360, "y": 5.4, "yaw": -90, "pitch": 9 },
  { "name": "deck", "x": 5945, "z": 3366, "y": 11.4, "yaw": 2, "pitch": 6 },
  { "name": "far-1km", "x": 4942, "z": 3384, "y": 150, "yaw": 90, "pitch": -8.5 },
  { "name": "sails-set", "x": 5880, "z": 3290, "y": 8, "yaw": 32, "pitch": 6 }
]
```

`distances.png` and `distances-sails.png` are the
yacht on the course map at each distance where a level or an owner takes over, on medium and on high, beside every cell
drawn at level 0: the software rasterizer's frame drawn four times, each shifted to one of a card's four samples a
pixel, and averaged, as a browser's antialiasing shows it.
