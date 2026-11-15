# Building a city map

The builder reads `assets/source/maps/<name>/base/`, `map.json` and
`world/world.json`. It writes generated layers below `var/maps/<name>/` and
packs `var/maps/<name>.snmap`. Run one build or rasterizer batch at a time:

```sh
bun tools/mapworld/build.ts <name>
bun tools/mapworld/walk.ts var/maps/<name>.snmap
bun tools/mapworld/ruin-walk.ts var/maps/<name>.snmap --all
bun tools/mapworld/access-walk.ts var/maps/<name>.snmap
bun tools/mapworld/bridge-walk.ts var/maps/<name>.snmap
bun tools/mapworld/room-walk.ts var/maps/<name>.snmap
bun tools/mapworld/server-bench.ts var/maps/<name>.snmap
bun tools/mapworld/verify.ts var/maps/<name>.snmap
bun tools/mapworld/proof-views.ts var/maps/<name>.snmap
bun tools/mapworld/views.ts var/maps/<name>.snmap <views.json> <output-folder> medium
bun tools/mapworld/ruin-report.ts var/maps/<name>.snmap
bun test ./tools/mapworld/ruins.test.ts
bun run check
```

`world.ruins.report` chooses the report folder. `world.ruins.yardDistricts`
chooses working container yards. `world.bridgeGapLayer` names the authored
break mask, and `map.bathymetry` names the coastal raster relative to `base/`
(left out, the one GeoTIFF in `base/bathymetry` is used).
CLI tools require a map argument. No city names or named compositions live in
these modules.

`statics.ts` is the seam. A `StaticLayer.make(site)` returns kind, centre and yaw
for each box. The site exposes footprints, district data, ground samples and
plant clearing masks. The ground builder leaves the footprints bare when
`world.heaps` is false. Resource nodes are placed after all static layers.

The first input for each footprint is `blocks/labels.json`. Supplied heights
win over levels and research. Missing values use supplied neighbours, then the
map's district and area rules. `blocks/research.json` accepts era, style,
materials and lore keyed by footprint id. Historical square surveys enrich by
unambiguous name only. `blocks/ways.json` supplies bridge and pier geometry.
A way OpenStreetMap marks `bridge:structure=suspension` or `cable-stayed` keeps
the deck height it left the land at and stands on no piers over the water;
`suspension.ts` fills its towers from `blocks/supports.json` (parts mapped with
`min_height` and `height`, in `zmass8` and `crown` solids) and hangs two cables
and their hangers from the tower tops.

The shared box kit is `content/ruins.ts`. Dimensions are full metres. Add a
shape there, its palette/material variants, then use its name in an assembly.
Existing kinds keep their ids; new shape names sort after the original kit.
The compatibility content module remains so the core pack needs no new import.

`ruins/vocabulary.json` is the per-map grammar:

- `categories` and `recipes` settle broad building use and retained height.
- `forms` give plan, shell, interior, front, roof and window rhythm.
- `interiors` give divider, back wall and furnishing parts. Hotels use full
  partitions and beds; offices use low dividers; storage halls stay open.
- `choices` are ordered rules over kind, recipe, district, height, water
  distance, known construction year, trades and nearby footprint count.
  Each match can change form or the seeded distribution of collapse modes.
  Names can match a regular expression and floor area can bound a choice.
- `damage` gives collapse radius, retained top and pancake layer count.
- `assemblies` list shape, local x/y/z, finish and optional yaw. They carry a
  role and optional clearance note. Fronts, wrecks, signs and street remnants
  all use this interpreter.
- `compositions` combine regional stacks, towers, bowls, portals, ribs and
  explicit parts. `ruins/places.json` attaches a composition to a footprint.

To add a rule, append one readable choice. To add a named place, add a
composition and one footprint entry. No generator branch is needed. A new
structural method belongs in `ruin-layouts.ts`; it can then serve any map.

Floors merge only complete equal-height rectangles. Facade panels merge only
collinear adjacent spans. Stair and escape holes stay open. Upper tower masses
use tall panels above a playable lookout level. Rooms have two openings onto
reserved corridors. Optional caps and fins yield to circulation. The street
assembly pass checks every certified street approach and bridge corridor.
Atomic building admission enforces both chunk and city piece budgets.

After admission, circulation removes conflicting overhangs from neighbouring
buildings. Street grading reserves enough width for its slopes and rejects
crossings with incompatible levels. Bridge decks constrain the final ground.
`verify.ts` runs all six proofs in sequence and exits; it opens no server socket.

Large inventories are generated, not committed. Keep counts, test summaries,
cameras, selection records and the rasterizer images. The report tool makes a
comparison gallery using `ruins/proof.json` and optional `ruins/captions.json`.
Line-ups isolate exact packed pieces by their recorded range, with one camera,
light and ground plane. They are diagnostic views, not replacements for the
required city streets and interiors.
