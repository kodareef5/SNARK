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
bun tools/mapworld/dock-walk.ts var/maps/<name>.snmap
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

To refresh several maps without changing an existing world, build a new directory:

```sh
bun tools/mapworld/build-set.ts var/maps/road-deck-3 <map-name> <another-map-name> --release
bun tools/mapworld/bridge-entrances.ts var/maps/road-deck-3/<map-name>.snmap
bun tools/mapworld/bridge-drive.ts var/maps/road-deck-3/san-francisco.snmap 1489.6 1155
bun server/main.ts --map var/maps/road-deck-3/<map-name>.snmap --db var/worlds/<new-world>.db
```

`build-set.ts` builds each map serially and refuses an existing output directory.
It verifies every raw, Brotli and gzip part against the packed map, then writes
`release.json` with producer revision, map IDs, hashes and SHA-256 digests. Copy
both `<name>.snmap` and `<name>.parts/` together when distributing a release;
the normal server `/map.json` and `/map/` routes serve this package.
Keep `<name>.entrances.json` with the release for reproducible geometry checks.
It records actual emitted road ends and their continuing source-road runouts,
not inferred clusters of structures. The entrance audit samples three tracks;
the native car course continues beyond the first slab before declaring a
crossing complete. Check mapped turns and structure-to-structure junctions separately.

Use a fresh database for changed map bytes. An existing save still requires its
original map ID and hash; startup refuses a mismatch. Keep the old map package
with that save. This command does not switch a running server, rewrite a live
map, or migrate a save. Run the ordinary map verification and driving courses
above before choosing a release for a new world.

`--release` after the name writes the copies for the wire of the map's parts as
tightly as they go, as a map that ships has: about 25 s on Miami where an
everyday build takes a few (`tools/map/pack.ts`).

A map is any rectangle of whole chunks, up to 256 a side. Its `map.json` says
how wide and deep it is (`size_m`, `chunks` and `grid_samples`, west to east then
south to north), its `bounds` in metres from its projection's centre, and the
lattice column and row of its south-east corner (`frame`, `shared/coords.ts`).
The build works in lattice metres, x west and z north of the lattice's middle
corner (`Grid` in `base.ts`), so a map cut from another or widened grows the same
city where the two overlap, worked out with the same numbers; it turns places
into the map's own metres as it writes the layers. Its reports stay in lattice
metres, and the walks read them into the map's (`readReport`). A rectangle of a
city's work folder can be cut out and built from its own folder, with `--out` so
its map stays out of var/maps, the walks given `--source`:

```sh
bun tools/mapworld/cut.ts miami var/cuts/miami-west/miami 2080 2048 95 127   # its corner's column and row, chunks west and north
bun tools/mapworld/build.ts var/cuts/miami-west/miami --out var/cuts/miami-west/out
bun tools/mapworld/walk.ts var/cuts/miami-west/out/miami.snmap --source var/cuts/miami-west/miami
```

`--no-streets` builds a map as before the streets' lines (planning/workstreams/streets.md), to compare.

`world.ruins.report` chooses the report folder. `world.ruins.yardDistricts`
chooses working container yards. `world.bridgeGapLayer` names the authored
break mask, and `map.bathymetry` names the coastal raster relative to `base/`
(left out, the one GeoTIFF in `base/bathymetry` is used).
CLI tools require a map argument. No city names or named compositions live in
these modules.

`statics.ts` is the seam. A `StaticLayer.make(site, placed)` returns kind, centre
and yaw for each box, given the pieces the layers before it set down: the ruins,
then the street furniture (`street-furniture.ts`, planning/reference/maps.md).
Where two streets meet, `corners.ts` rounds the corner by `street.walks.returns`
(rules/README.md): the walks set a curb return there and begin their runs at
its ends, and the furniture stands behind it. Before the ground, the streets
are fitted, typed by their rules (`rules/streets.json`) and the city's overlay,
and carried in the map as lines (`streets/`, planning/workstreams/streets.md);
the ground's street, verge and walk samples, round every corner's arc too, are
painted from them before the surfaces are worked out. The
site exposes footprints, district data, ground samples and plant clearing masks. The ground builder leaves the footprints bare when
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

## Shores

The ground's samples are each land or water, so a waterline across them steps
from sample to sample. The build rounds it in two passes at the end of the
ground (`ground.ts`):

- A sandy sea shore is graded as a beach (`shared/world/beach.ts`): a 12 m
  filter finds the line between the surveyed sand and the sea bed and slopes
  the foreshore through it. The bed it reaches is tinted sand.
- Every other low soft bank of the sea or of a lake (grass, open ground,
  canopy, mangrove, marsh, desert) is graded too (`shared/world/banks.ts`): an
  8 m filter finds the line, and the ground slopes up to the bank's top over
  3 m inland and down to its foot (15 to 80 cm deep) over 5 m out. A sample
  the grading takes out of the water is tinted mud, and the bed at the bank's
  foot silt, as is the sea's bed within 5 m of any shore more than 40 m from a
  beach (a quay's or a wall's too). A bank more than 1 m over its water, a road, a footprint, a
  bridge's gap and the beach's bed count for the line but are never moved.

Both run on every city with a sea; the banks' pass runs on lakes without one.
The heights they move are the collision bed too.

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

An obelisk with a `color` (and a `form`: `sextant`, `lantern`, or none for the
Tide Eye) is one of the instruments, and stands over a transfer deck with its
terminal at the deck's middle. The deck is the largest disc within 750 m of
`at`, up to 70 m across or the `deck` the entry names (its most radius in
metres), and of the largest the nearest: open ground (no street, lot, path or
water) with no piece within 6 m of its edge, whose ground rises no more than
4 m over a square round it and those 6 m (`DECK_RELIEF`, `places.ts`). On a
slope it is smaller, or found where the ground is more level. The build grades
it flat at the height of its middle and blends its edge back into the ground
over 4 m, or as wide as a bank of 1 in 1.5 needs, up to the 6 m, so a deck on a
hillside is cut into it and built out from it by a bank a survivor walks up.
On level ground, as Miami's three are, this places and grades them as before.

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
`verify.ts` runs all nine proofs in sequence and exits; it opens no server socket.

Large inventories are generated, not committed. Keep counts, test summaries,
cameras, selection records and the rasterizer images. The report tool makes a
comparison gallery using `ruins/proof.json` and optional `ruins/captions.json`.
Line-ups isolate exact packed pieces by their recorded range, with one camera,
light and ground plane. They are diagnostic views, not replacements for the
required city streets and interiors.

## Cars: wrecks and parked ones

A street's cars are the road fleet's own meshes: statics of the kinds
`content/vehicles/wrecks.ts` makes, one piece each, standing on the ground with
their yaw. A kind is a body, a look and a paint. The looks are posed meshes, since
a piece has only a yaw. The compact's: abandoned (dusty, faded, a few knocks, on
soft tyres), stripped (no wheels, steering wheel or driver's door, down on its
sills), on its roof, burnt out, and burnt out on its side
(`assets/source/core/vehicles/compact_abandoned/` and `compact_wreck/`). Every
other body of the fleet but the tanker is abandoned where it stopped, and the
fastback, the caravan and the panel van stripped too, the fastback on its roof
as well: each the live vehicle's own model posed at rest as one piece, its first
knocks and rust showing (`assets/source/core/vehicles/<vehicle>_abandoned/`,
`parked_common/`). The tanker stands as its salvage (`tanker-wrecks.ts`). A
painted look comes in the paints of its body, the static's colour dyeing its
paint as the species' colour dyes the drivable car's; the taxi, the patrol cars,
the muscle car, the monster truck, the bus and the semi keep their liveries, a
kind each. A kind's `shape` is its collider in the car's frame (origin on the
ground under its middle, nose along +z), fitted to the mesh
(`parked_common/bounds.ts`, `abandoned-bounds.json`), so the far city draws its
boxes and the prop checks take its size from it (`ruin-obstacles.ts`). The kinds
added after the compact's first 38 have ids that sort after every other core id
(`core:zzzzroad_...`), so no index moves.

An assembly part `["car", u, 0, v, family, yaw]` is one car. Which kind it is
comes from where it stands (`street-cars.ts`): a body by the weights of
`street.cars.bodies[family]`, changed by its district's style in `styles` (vans
and trucks among works, taxis and buses downtown, caravans and pickups among
homes, sports cars few and most by the beaches) and near a public place a rule
of `near` lists (patrol cars by a police station, buses by a school or a
station); a look of that body by `street.cars.looks[family]`; and a paint by
`paints`, or by the body's own in `bodyPaints`, each by a hash of where it
stands. The families: `any` at a kerb, `upright` and `thrown` in a pile-up, and
`big` in a bus's place, which may hold a van, a semi or the tanker's salvage
too. In a cell where a fire went through, a share `burnt` of the cars of any
family but `big` take the looks of `fire`. Two rules bound and spread the mix: a chunk holds the meshes
of at most `perChunk` looks, a car that would be one more being one of the looks
its chunk holds (each mesh in a chunk is a draw and a set of casters); and no car
is the kind of one within `apart` metres where another paint, or another look
its family may be, will do. The street pass (`makeStreetPieces` in `ruins.ts`)
keeps its 8 m grid and its hashes. Along a street an assembly faces
the way traffic on its side runs, by the nearest centreline of
`base/roads.geojson`, and a car or a bus is set in from the kerb, a few cars
slewed out of line. On a verge a car has run off the road; in a yard it is parked
in a row or left at any angle. A pile-up turns along its street, its cars nosed
into each other either side of the gap left through it. Every piece stands clear
of the pieces already set down, and a car on its own ground, level enough under
every corner.

Cars a survivor can drive away go in `vehicles.json`
(`[{ "kind": "core:compact", "x": 240, "z": 270, "yaw": 90 }]`, through the
layers folder into the file's `VHCL`). The server parks each, owned by nobody,
once in a new world; the save keeps it from then on. `parkCars` in
`street-cars.ts` chooses them from the road fleet (`content/vehicles/road-fleet.ts`)
by `street.cars.parked`:

- Each place's kind is drawn by a hash from the weights of `kinds`, changed by the
  district's style in `styles` (vans where there are shops and works, and the
  tanker, the semi and the monster pickup among the works; caravans among homes;
  buses among homes and where the blocks are concrete or terracotta, and taxis
  and patrol sedans where they are concrete; sports cars few, most by the
  beaches), then by the district's name in `districts`, which a city's
  vocabulary may add, then near a public place a rule of `near` lists (patrol
  cars by a police station, a bus by a school); a weight of 0 takes a kind out.
  The place is then tested for that kind alone.
- At the kerb on the right of travel of a centreline of the listed classes (local
  and secondary streets), or of a car park's road (`lots.classes`), turned along
  it, on street ground, its room inside the map.
- At least 15 m from a junction (a point two lines share, or a line's end).
- Clear of every static's boxes, the wrecks' too, and of every reserved route, by
  the kind's envelope plus 1 m and plus the door room its seats need (the
  compact's X ±0.9, Y 0 to 1.5, Z ±2.0 with entries at X ±1.25; the panel van's
  X ±1.08, Y 0 to 2.52, Z ±2.82 with entries at X ±1.42); nothing grows on it.
  Neither of two parked cars' rooms meets the other's body.
- On dry ground, the heights across all its axles giving a ground normal no steeper than
  the kind's `minGroundNormal` (0.85 for the road fleet), with margin enough to
  drive off.
- A marked stall draws only from vehicles whose bumpers can fit within half a metre of its ends. The full body and door clearances still apply. Buses and freight tractors use long kerbs. Detached trailers may stand on level industrial lots and yards.
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
  how hurt each is, and how much fuel each has, is the world's. A place whose
  car has gone gets another some days later (`server/car-return.ts`,
  `FoundCarReturnDays`).

The kinds and their sizes come from the compiled content: a vehicle's
`spec` (half width, half length, height, wheelbase, track, ground limit) and its
`seats`, so a truck or a bus needs no new code.

## Boats: found ones and wrecks

Vessels a survivor can take go in `vehicles.json` beside the cars, after the found
aircraft and clear of both. `boatSites` in `tools/boat/sites.ts` chooses them by
`harbours` in the rules file, at the marinas, piers and beaches of
`blocks/places.json` and the police, fire and Coast Guard stations of
`blocks/labels.json`:

- A beach or a fire or Coast Guard station holds one rescue launch, a police
  station one police launch, up to four of each, before any civilian site.
- A marina laid out with docks (below, "Marinas") has its vessels in the slips
  the layout held for them, `marina.least` to `marina.most`, each tested there for
  its draught and hull and 16 m from any car or aircraft; its dock is its way
  aboard, so no bank is asked for.
- A marina with no docks holds `marina.least` to `marina.most` vessels within 120 m of its point;
  then a share `pier.share` of piers hold one, of `pier.longest` metres or less,
  within 48 m. Which vessel each berth gets is drawn by a hash from the weights of
  `kinds.marina` or `kinds.pier`, changed by the style of the district its water
  looks onto (the nearest within 200 m) in `styles` (launches and jon boats by the
  port, yachts and offshore boats by the beaches and the towers, day boats and
  catamarans among homes) and then by its name in `districts`; a weight of 0 takes
  a kind out. A kind that finds no berth gives way to the civilian launch.
- A berth is tested for its own vessel where it lies, nearest the place's point
  first: water deeper than its draught by 0.2 m, a bank a swimmer can reach within
  64 m, its hull clear of every static at one of four headings, its hull and
  `room` metres round it clear of every other found vessel's hull, `apart` metres
  from any other site's vessels and 16 m from any car or aircraft.
- Every berth gives the ranges its condition and its fuel are rolled in, one band
  each of `condition` and `fuel` by their weights and a hash of the berth: a share
  hurt (a hull of 0.5 or more takes no water, so it floats and makes way), a share
  nearly whole, the rest between, and fuel mostly low. The server rolls both once a
  world (`foundVehicle`). A berth whose vessel has gone, sunk or sailed off, gets
  another of its kind, rolled again, `FoundBoatReturnDays` later, as a car's place
  does (`server/car-return.ts`), once its wreck has gone and only while the berth
  still has water 0.2 m deeper than the vessel's draught.
- `reports/<ruins>/harbours.json` lists each vessel with its site, district and
  ranges.

A harbour's wrecks are statics of `content/vehicles/harbour-wrecks.ts`, set down
before the found vessels, which keep clear of them (`tools/boat/wrecks.ts`, by
`harbours.wrecks`). `marina` and `pier` give for each the share of such sites with a
wreck among their berths and the share with one in the water `out` metres off; a
marina laid out with docks has its wrecks in its slips instead (below) and only the
one off it from here.
Its vessel is drawn from the site's own weights (of the ten, the launch's wreck
being its corpse's), and it is sunk at the share `sunk` and otherwise damaged.
A damaged one rides low, its keel 1.25 times its draught under the water, where
the water is deeper than its draught by 0.2 m; a sunk one sits with its keel on
the bottom where the water is deeper than its draught by 0.3 m and no deeper than
0.7 of its height, so its upperworks show. Each is clear of every piece by a metre
round its hull, `apart` metres from any other wreck, in a chunk with room. Its
static is its form's, `core:hulk_<vessel>_damaged` or `_sunk`, which draws the
vessel's form `core:<vessel>_damaged` or `core:<vessel>_sunk`, where the art under
`assets/source/core/vehicles` has that mesh; until then it is `core:hulk_<vessel>`,
the intact hull. A destroyed vessel's corpse draws its `wreck`, its sunk form, and
its intact hull until the pack has that. `harbours.json` lists the wrecks too.

## Marinas

A marina of `blocks/places.json` is laid out as a place (`tools/boat/marinas.ts`,
by `harbours.docks` and `harbours.moored`), after the landmarks and before the
harbours' wrecks, on the ground as it is: nothing moves the bank or the water
(planning/workstreams/marinas.md).

- Its docks: each pier way OpenStreetMap maps whose middle is within `docks.reach`
  of the marina's point, nearer it than any other marina's, no longer than
  `longest`, over the water for `wet` of its length, and no wider than `widest`
  unless it is an area no building stands in (a dock and its slips outlined as
  one), is the marina's, and the bridge layer leaves it alone. A marina that has
  none, and whose point is not in a building, gets one walkway from the bank
  nearest its point out along the bearing with most open water.
- A dock is the kit of `content/docks.ts`: a fixed timber dock on piles in
  modules 3 m long, its deck `DOCK.height` (0.7 m) over the water and at least
  0.1 m over the ground, never more than a ramp's 0.25 m fall from one module's end
  to the next, so it comes down from the bank on ramp modules. A main walkway
  mapped to stop short of the bank reaches back to it, and the street's furniture
  where it comes ashore gives way to it; a run that reaches neither the land nor
  another run is joined to the nearest within 30 m, or else taken up.
- Off each side of a walkway's level stretch over the water, slips of one class
  (`docks.classes`, drawn by the weights of the vessels in each): a finger of the
  class's length every slip's pitch (its widest boat's beam, `gap` either side and
  a finger), a mooring pile at each tip, and between two fingers a boat of the
  class, bow-in, `moored.sternTo` of them stern-to, where `fairway` of its row's
  longest stays clear past the slip's mouth. The big ones (`alongside`) lie along a
  walkway end to end; a walkway's outer end over deep water gets a T-head with a
  big one across its face. A mapped finger holds a boat alongside each side.
- `moored.fill` of the slips hold a boat, in its vessel's paints by
  `MOORED_PAINTS`. Of those on docks a survivor walks to, `found` are held for found
  vessels (at least `marina.least`, at most `marina.most`; `tools/boat/sites.ts`
  sets them there), `wrecked` are wrecks, damaged or sunk in their slip, and the
  rest are statics of the vessels' own hulls (`core:zzzzhull_<vessel>_<paint>`). A
  chunk holds at most `perChunk.boats` of them, of at most `perChunk.meshes` meshes.
- Beside the other piers, `piers.share` hold up to `piers.most` boats alongside, of
  at most `piers.longest` metres; off `anchored.share` of the marinas a few lie at
  anchor in water `anchored.depth` deep, heading into the wind.
- `reports/<ruins>/marinas.json` lists each run of dock and each slip, with the
  place on its dock a survivor boards from, and `tools/mapworld/dock-walk.ts`
  walks every run from the land and boards every found vessel from its dock.
