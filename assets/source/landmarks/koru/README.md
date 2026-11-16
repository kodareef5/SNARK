# Koru

A landmark: a full-scale three-masted schooner, 125 m with its bowsprit and 17.2 m in the beam, moored and walked.
Its proportions follow Oceanco's Koru as published (`ref/REFERENCES.md`, `ref/sources.json`); hull stations, rig
heights and deck heights are inferred from the photographs in `ref/photos/`, and the four decks of rooms, stairs and
furniture are an original interpretation. No photograph's pixels are in the pack.

## How it is made

- `author_layout.py`, with `layout_details.py`, writes `content/landmarks/koru-layout.json`, the one authority for
  collision, art and placement (`ref/LAYOUT.md`). It rebuilds byte for byte.
- `model.py` and `parts.py` build the pieces in Blender from that layout: eight cells, each one mesh of every module
  whose origin lies in its 16 m of the ship, in its anchor's frame; the three doors, each with its open form; and the
  sail parts, five sheets and three gaffs. The modules themselves are collision alone.
- `tex/paint.ts` paints the one atlas every textured face is drawn from (`tex/PROVENANCE.md`); `materials.json` says
  where each finish lies in it and what colour it is drawn far off.
- `asset.ts` is the pack: `landmarks:koru`, `koru.snpk`, which ships only with the maps that place it.

A cell's finest level is drawn with the atlas and is under 10,000 triangles. Its three far levels, flat, are made in
`model.py` and show only what is seen from outside, since the rooms are behind white walls and glass that is dark
from outside; `asset.ts` states their errors and why. The sails are flat colours, a sheet two faces back to back.

```sh
python3 assets/source/landmarks/koru/author_layout.py
bun assets/source/landmarks/koru/tex/paint.ts
bun run art -- landmarks:koru
bun run art -- landmarks:koru --check
```

`ref/pictures/` holds the accepted pictures, drawn by the software rasterizer on medium at its Miami berth
(`bun tools/map/cityviews.ts var/maps/miami.snmap <views.json> <folder>`, `--moved 1` for the sails set): from the quay,
on the sun deck, from 1 km off and 150 m up (its far form: the hull and three masts), and with its sails set.

