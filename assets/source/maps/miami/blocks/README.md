# Direct building labels

`labels.json` is the primary input, keyed by the original footprint ID in
`../base/buildings.geojson`. `places.json` holds the positioned nonbuilding
features. These are a frozen copy of the join supplied for round one, made by
`labels.py` in the Miami data worktree on 2026-11-15. Sources are OpenStreetMap
contributors (ODbL) and USA Structures; see the base layer provenance in
`../base/VALUES.md`. Labels are joined evidence, not a cadastral survey.

Import a newer complete join with:

```sh
bun tools/mapworld/labels.ts /path/to/blocks
bun tools/mapworld/build.ts miami
```

No build reaches outside this repository or fetches the network. The two input
files and all effective research are hashed in `reports/ruins1/labels.json`.
The build records every inferred value and its neighbour IDs there. A supplied
positive `height_m` always wins over storeys, neighbourhoods and research.
Ruin retention and the 4 m construction module act on that height afterwards.

`research.json` is ready for the smaller named-place research pass. Add an
object keyed by footprint ID, following `research.schema.json`. Style,
materials, year and character tags select vocabulary modifiers. Lore, sources,
features and the desired ruin identity are editorial evidence for a hand rule.
No research field silently moves a building or replaces its measured height.

The stopped 59-square survey in `out/` is historical research only. The reader
matches a place's normalized name against `name` and `also`; an ambiguous or
absent name has no effect. Only style, materials, year, lore, fame and their
uncertainty/source fields survive. The old footprint letters, guessed heights,
positions and neighbourhood fabric are never used to generate a building.
The other 539 squares are unavailable, not an awaited dependency.
