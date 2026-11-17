# Koru

A landmark: a full-scale three-masted schooner, 125 m with its bowsprit and 17.2 m in the beam, moored and walked.
Its proportions follow Oceanco's Koru as published (`ref/REFERENCES.md`, `ref/sources.json`); hull stations, rig
heights and deck heights are inferred from the photographs in `ref/photos/`, and the four decks of rooms, stairs and
furniture are an original interpretation. No photograph's pixels are in the pack.

## How it is made

- `author_layout.py`, with `layout_details.py`, writes `content/landmarks/koru-layout.json`, the one authority for
  collision, placement and the art's layout (`ref/LAYOUT.md`). It rebuilds byte for byte.
- `model.py` and `parts.py` build the pieces in Blender from that layout: eight cells, each one mesh of every module
  whose origin lies in its 16 m of the ship, in its anchor's frame; the three doors, each with its open form; and the
  sail parts, five sheets and three gaffs. The modules themselves are collision alone.
- `tex/paint.ts` paints the one atlas every textured face is drawn from (`tex/PROVENANCE.md`); `materials.json` says
  where each finish lies in it, how it is lit, and `far`, the palette colour it is drawn in flat.
- `asset.ts` is the pack: `landmarks:koru`, `koru.snpk`, which ships only with the maps that place it. It states the
  cells' errors and what a cell may draw from each distance (`CELLS`, in place of the shared landmark rule).

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
| 0 | with the atlas | everything: rooms, stairs, furniture, plaques, ports with brass bores, rails with posts |
| 1 | with the atlas | what is seen from outside: hull, decks, deckhouse walls with flush windows and shut doorways, open decks and their furniture, stairs whose wells open on an open deck, rig |
| 2 | flat | level 1 without wires, rails or the cove line, ports as octagons, furniture as blocks, flights as ramps |
| 3 | flat | level 2 with square ports, no face to the cap rail, and masts no thinner than 80 cm |
| 4 | flat | a stand-in: per deck a deckhouse block and a deck slab, the hull without ports, masts, booms and bowsprit |

The rules the levels keep:

- Every stay, shroud and rail is drawn on levels 0 and 1 and none on 2 and 3: the wires are there while the yacht is
  drawn with its atlas and gone past it, where they are a third of a pixel and less. The stays and shrouds are dark
  against the sky, as photographed; the rails are bright steel.
- Masts, booms with their sail covers, the bowsprit, spreaders, radomes and the flag are on every level, and the struck
  headsails, which are sail parts, are drawn as far as the far mesh. On level 3 no length of mast is under 80 cm across,
  so on a card with four samples a pixel it is a line to 3 km and not dashes.
- The deckhouse's windows are their own faces on every level, and the hull's ports and its 25 cm red boot stripe too.
- A flat face is drawn in its finish's `far` colour: the palette colour whose plain lit look (fully rough, no
  reflection, as a landmark's flat draw is lit) is nearest the finish's lit look with its atlas, at 14:00 on the
  course map, by the least sum of squared OKLab distances over side faces seen square on and from 45 degrees from both
  sides, or upward faces from 5 and 30 degrees up. A glossy finish mirrors the sky and no flat colour can follow it on
  both sides at once: flat, the navy hull is about 8 levels of 255 darker than with its atlas on its shaded side and 10
  lighter on its sunlit side, which is the step where a near cell with the atlas meets the far mesh.

The hull is straight between the layout's stations and shaded smooth across them. Below the sheer the art shears it
back from the plumb stem and stern the layout gives, into a raked clipper bow (5 m at the waterline) and an overhanging
canoe stern (3 m), as photographed; the decks, rails and collision keep the layout's ends.

The sails: near, each row of a sheet is a panel of sailcloth from the atlas, a gaff sail's sixth rows carrying battens,
smooth over its camber; then two flat levels. Struck, a gaff sail and its gaff lie inside the cover on the boom, as an
in-boom furling sail does, and a headsail rolls on its stay. The sail parts are drawn as far as the far mesh.

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
