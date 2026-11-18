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

`--release` after the name writes the copies for the wire of the map's parts as
tightly as they go, as a map that ships has: about 25 s on Miami where an
everyday build takes a few (`tools/map/pack.ts`).

`world.ruins.report` chooses the report folder. `world.ruins.yardDistricts`
chooses working container yards. `world.bridgeGapLayer` names the authored
break mask, and `map.bathymetry` names the coastal raster relative to `base/`
(left out, the one GeoTIFF in `base/bathymetry` is used).
CLI tools require a map argument. No city names or named compositions live in
these modules.

`statics.ts` is the seam. A `StaticLayer.make(site)` returns kind, centre and yaw
for each box. The site exposes footprints, district data, ground samples and
plant clearing masks. The ground builder leaves the footprints bare when
`world.heaps` is false. Resource nodes are placed after all static layers:
whether each slot's node stands, and as what, is decided once on the finished
ground (`resolveNodes`), then the growth takes out what would stand in a
structure's, a route's or a canopy's way, and the file says both; `stats.json`
counts the slots the ground took (`nodeSlotsTaken`). The far feed's cells of
every chunk are baked from the statics into the overviews' tops (`mapTops`).
A ruin's ground colour is drawn from its footprint's id and the statics'
kinds are numbered in the order of their ids, so a footprint added or taken
away changes only the parts near it.

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
  hemisphere, closed from above, over an optional `arc`; `radii` makes either an
  ellipse, `rise` flattens a dome and `below` carries its sphere down into the
  ground (a sphere standing on it). A `pyramid` steps in courses to its top
  round a hollow inside; a `lattice` is a tapering square tower of beam rings,
  corner legs and decks; a `wheel` stands in a vertical plane with its cabins
  and legs; a `vault` roofs the chosen tiles with plates under a shallow dome.
  A piece asked for in a finish its shape lacks is concrete, and the build
  refuses a kind the content does not have. A named place with the
  layout `ground` is neither built on nor levelled: a hillside's seats.

Lettered signs (`signs.ts`): a line OpenStreetMap maps with an inscription of
capitals and a height (`blocks/signs.json`) stands up the content's letters
(`content/lettering.ts`, 13.7 m tall) along it, each on the lowest ground under
its foot and facing down the slope; on the level it reads from the line's first
point. A sign mapped more than 30% taller or shorter is left out and reported.
A board mapped as a point with its words (`information=board` and an
inscription, such as a welcome sign) stands on two posts facing its mapped
direction, in a median if that is where it is.

A desert's ground: biome 10 is `S.DESERT` (tan gravel, the open ground's plants,
natural stone, the jungle's creature regions until a dry table exists), and a
world with `dryGround` tints its open ground and courts as gravel and paving
and its weeds dry. An airfield (roads.png 6) is `S.PAVED`: no street's wrecks
or approaches. Water mapped intermittent stays ground in the lakes step.

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

## Cars: wrecks and parked ones

A street's cars are the compact's own meshes: statics of the kinds
`content/vehicles/wrecks.ts` makes, one piece each, standing on the ground with
their yaw. A kind is a look and a paint. The looks are posed meshes, since a
piece has only a yaw: abandoned (dusty, faded, a few knocks, on soft tyres),
stripped (no wheels, steering wheel or driver's door, down on its sills), on its
roof, burnt out, and burnt out on its side
(`assets/source/core/vehicles/compact_abandoned/` and `compact_wreck/`). A
painted look comes in the car's twelve paints, the static's colour dyeing its
paint as the species' colour dyes the drivable car's. A kind's `shape` is its
collider in the car's frame (origin on the ground under its middle, nose along
+z), so the far city draws its boxes and the prop checks take its size from it
(`ruin-obstacles.ts`).

An assembly part `["car", u, 0, v, family, yaw]` is one car. Which kind it is
comes from a hash of where it stands (`street-cars.ts`): a look by the weights of
`street.cars.looks[family]` and a paint by `street.cars.paints`; in a cell where
a fire went through, the family is `fire`. The street pass (`makeStreetPieces` in
`ruins.ts`) keeps its 8 m grid and its hashes. Along a street an assembly faces
the way traffic on its side runs, by the nearest centreline of
`base/roads.geojson`, and a car or a bus is set in from the kerb, a few cars
slewed out of line. On a verge a car has run off the road; in a yard it is parked
in a row or left at any angle. A pile-up turns along its street, its cars nosed
into each other either side of the gap left through it. Every piece stands clear
of the pieces already set down, and a car on its own ground, level enough under
every corner. Buses and trucks stay boxes until they have models.

Cars a survivor can drive away go in `vehicles.json`
(`[{ "kind": "core:compact", "x": 240, "z": 270, "yaw": 90 }]`, through the
layers folder into the file's `VHCL`). The server parks each, owned by nobody,
once in a new world; the save keeps it from then on. `parkCars` in
`street-cars.ts` chooses them from the road fleet (`content/vehicles/road-fleet.ts`)
by `street.cars.parked`:

- Each place's kind is drawn by a hash from the weights of `kinds`, changed by the
  district's style in `styles` (vans where there are shops and works, caravans
  among homes, sports cars few, most by the beaches) and then by the district's
  name in `districts`, which a city's vocabulary may add; a weight of 0 takes a
  kind out. The place is then tested for that kind alone.
- At the kerb on the right of travel of a centreline of the listed classes (local
  and secondary streets), or of a car park's road (`lots.classes`), turned along
  it, on street ground, its room inside the map.
- At least 15 m from a junction (a point two lines share, or a line's end).
- Clear of every static's boxes, the wrecks' too, and of every reserved route, by
  the kind's envelope plus 1 m and plus the door room its seats need (the
  compact's X ±0.9, Y 0 to 1.5, Z ±2.0 with entries at X ±1.25; the panel van's
  X ±1.08, Y 0 to 2.52, Z ±2.82 with entries at X ±1.42); nothing grows on it.
  Neither of two parked cars' rooms meets the other's body.
- On dry ground, its four wheels' heights giving a ground normal no steeper than
  the kind's `minGroundNormal` (0.85 for the road fleet), with margin enough to
  drive off.
- A district takes its car parks first: up to `lots.perDistrict` of its car
  parks' roads, in an order by a hash, each holding `lots.least` to `lots.most`
  cars together along it, `lots.apart` metres from each other and `apart`
  metres from any car outside it. Then its streets: a density per
  kilometre of such street, clamped to a few per district, the quietest streets
  first and then by a hash of the map's seed, and spread apart. The build drops
  one within 40 m of a spawn point or an obelisk.
- A share `hurt.share` of them, by a hash of where each stands, are hurt: its row
  in `vehicles.json` gives `hurt.condition` as the range its condition is rolled
  in, one that leaves it able to drive (an engine stops at 0.08). The rest are
  whole. Every row gives the range its fuel is rolled in, one of the bands of
  `fuel` by their weights, most of them low. The server rolls both once, when it
  parks the car in a new world, from the world's seed and where the car stands
  (`foundVehicle`, `server/vehicle-service.ts`), as it does for found aircraft
  and boats; the save keeps what was rolled. Which cars are hurt is the map's;
  how hurt each is, and how much fuel each has, is the world's.

The kinds and their sizes come from the compiled content: a vehicle's
`spec` (half width, half length, height, wheelbase, track, ground limit) and its
`seats`, so a truck or a bus needs no new code.
