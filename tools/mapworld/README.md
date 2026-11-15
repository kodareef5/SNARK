# Building a city map

The builder reads `assets/source/maps/<name>/base/`, `map.json` and
`world/world.json`. It writes generated layers below `var/maps/<name>/` and
packs `var/maps/<name>.snmap`. Run one build or rasterizer batch at a time:

```sh
bun tools/mapworld/build.ts <name>
bun tools/mapworld/repeat-build.ts <name>
bun tools/mapworld/walk.ts var/maps/<name>.snmap
bun tools/mapworld/ruin-walk.ts var/maps/<name>.snmap --all
bun tools/mapworld/access-walk.ts var/maps/<name>.snmap
bun tools/mapworld/bridge-walk.ts var/maps/<name>.snmap
bun tools/mapworld/room-walk.ts var/maps/<name>.snmap
bun tools/mapworld/obelisk-walk.ts var/maps/<name>.snmap
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

## Lakes above the sea

`tools/mapdata/prepare.py` keeps a lake whose hydro-flattened lidar stands more
than 2 m over the city's sea out of the sea, in `base/perched_water.geojson`.
The builder (`lakes.ts`) makes each one water standing on its own surface, a
body of the map file's water layer (`water.json` and `water.png` among the
layers; [maps](../../planning/reference/maps.md)), and carves its bed:

- Its surface is the mode of its outline's lidar, to 10 cm, put on the heights'
  lattice. A sample of the outline more than `bank` (0.25 m) over it is bank and
  stays land, as does one under a footprint; past a misdrawn outline the water
  goes on up to `past` (10) samples where the lidar is flat at its surface.
- Its bed falls from `shoreDepth` (0.3 m) at the shore by `slope` (0.08) a metre
  out, to `deepest` (8 m), as a gentle sea shore does here. Its squares reach a
  sample over its shore, so the shore line is the ground meeting the surface.
- Flowing water (TIGER's H3 codes, a river's or a canal's channel) falls along
  its length: its lidar smoothed over 20 m is cut into reaches `reach` (0.25 m)
  apart, each a body.
- An outline the lidar did not flatten (under `flattened`, 30%, of it within
  `bank` of the surface) or that its ground does not hold in (more than `leaks`,
  20%, of its shore more than `bank` under the surface) is no lake: it stays the
  marsh it was, and the build says why.

`world.lakes` in `world.json` changes any of these numbers, and `false` leaves
every lake marsh. A city whose base has no `perched_water.geojson` (Miami,
Tampa) builds the same bytes as before. A mapped pier or breakwater over a lake
stands over its surface as one over the sea does over the sea. `stats.json`
lists each lake made and each left, with its reason.

## Obelisks

Where survivors leave for another server of the cluster. `world.json` lists
them as it lists spawn points:

```json
"obelisks": [{ "name": "Wynwood", "at": [-80.1990, 25.8040], "face": [-80.2000, 25.8015] }]
```

Each is set on the nearest ground to `at` that is open and dry, level to a
quarter metre under the obelisk and to half a metre round its terminal, with no
static piece within 10 m of its middle or 6 m of where its user stands. The
terminal turns toward `face`. The build adds each one's pieces
(`shared/world/obelisks.ts`) after every layer's, so the others keep their
slots, keeps plants 14 m off, and lists the places in `stats.json`.
`obelisk-walk.ts` finds a way on foot from the nearest spawn point to each
terminal's front and walks it with the survivor's capsule; move an obelisk it
cannot reach.

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

Every city inherits [the shared rule library](rules/README.md). Its
`ruins/vocabulary.json` extends shared objects by key and ordered choices by
id. Districts, recipes, budgets and named compositions stay in the map folder.
Do not copy the shared sections into a new city:

- `categories` and `recipes` settle broad building use and retained height.
- `forms` give plan, shell, interior, front, roof and window rhythm.
- `interiors` give divider, back wall and furnishing parts. Hotels use full
  partitions and beds; offices use low dividers; storage halls stay open.
- `choices` are ordered rules over kind, recipe, district, height, water
  distance, known construction year, trades and nearby footprint count.
  Each match can change form, finish or an initial collapse selection.
  Names can match a regular expression and floor area can bound a choice.
- `event` makes the final collapse selection from shoreline exposure,
  upstream shelter and a spatially shared seed. Travel direction belongs to
  the city; exposure bands and their failure families inherit shared defaults.
- `damage` gives collapse radius, retained top and pancake layer count.
- `assemblies` list shape, local x/y/z, finish and optional yaw. They carry a
  role and optional clearance note. Fronts, wrecks, signs and street remnants
  all use this interpreter. A street `passage` reserves a walkable gap;
  `roof identity` keeps a marker whole when clearance removes its support.
- `growth` supplies resource densities, canopy bounds, roof planting chance
  and low-growth radii around public place kinds. Listed nodes are filtered
  against their actual collision forms and reserved routes after construction.
- `sightlines` reserves view corridors towards named compositions, and
  `frontage` sets the tolerance for detecting neighbouring party walls.
- `compositions` combine regional stacks, towers, bowls, portals, ribs,
  rings and domes and explicit parts. `ruins/places.json` attaches a composition
  to a footprint. A `ring` sets pieces round a centre at listed heights, turned
  along it; a `dome` is a drum to its springing and stepped courses under a
  hemisphere, closed from above, over an optional `arc`. A named place with the
  layout `ground` is neither built on nor levelled: a hillside's seats.

Lettered signs (`signs.ts`): a line OpenStreetMap maps with an inscription of
capitals and a height (`blocks/signs.json`) stands up the content's letters
(`content/lettering.ts`, 13.7 m tall) along it, each on the lowest ground under
its foot and facing down the slope; on the level it reads from the line's first
point. A sign mapped more than 30% taller or shorter is left out and reported.

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
