# Building a third city: what San Francisco needed

San Francisco was chosen to break relief and great bridges. It took one agent about three hours and a half
(12:41 to about 16:15 local, 2026-11-15), 25 minutes of it downloading 2.6 GB of lidar. Miami's third round of ruins,
then server clusters and true slopes, landed on main while it worked; the city was moved onto each, and its two
generator changes, first written as patches, were made in place. The ruins were not tuned.

```sh
bun tools/mapdata/city.ts san-francisco                 # frame, fetch, prepare, attributes, split, future, fine,
                                                        # bathymetry, labels, ways, world, vocabulary, build
bun tools/mapworld/build.ts san-francisco               # only the map file, from what is committed: 62 to 140 s
bun tools/mapworld/verify.ts var/maps/san-francisco.snmap
bun tools/mapworld/obelisk-walk.ts var/maps/san-francisco.snmap
bun tools/mapdata/steep.ts var/maps/san-francisco.snmap 15 [--no-plants | --ground-only]
bun run build && bun server/main.ts --dev --map var/maps/san-francisco.snmap --port 8799 --db var/san-francisco.db
```

## Beside Miami and Tampa

Miami's and Tampa's columns are from Tampa's page (round two); Tampa on round three passes all but 1 of 48,527 street
approaches and 3 of 9,276 room routes. San Francisco's are round three.

| | Miami | Tampa | San Francisco |
|---|---|---|---|
| Map file | 76.9 MB, 15.3 MB gzipped | 91.3 MB, 21.5 MB | 104.1 MB, 28.1 MB |
| Build | 9.7 s, 3.9 GB peak | 12.7 s, 4.8 GB | 62 to 140 s by the machine's load, most of it round three's ruins; 5.0 to 7.8 GB peak, 7.1 GB maximum resident; 19 to 34 s on round two |
| Footprints | 11,919 | 31,688 | 44,269: 10,638 from USA Structures, 4,817 of them split into 37,167 OpenStreetMap buildings, and 1,281 buildings it lacks added |
| Labelled with a kind and a height | 76% | 90% (heights wrong, Tampa's finding 9) | 84% (a kind 88%, a height 94%) |
| Blocks; buildings built | 1,188,264; 11,845 | 2,091,633; 31,542 | 2,889,065; 43,654 of 44,287 parts (455 over budget, 178 too small for a tile) |
| Busiest chunk (cap 1,000) | 1,000 | 939 | 1,000 |
| Mapped ways built | 809 of 809 | 590 of 591 | 1,281 of 1,281, and the Golden Gate's 2 towers and 8 cable spans |
| Ground | | -16 to 24 m | -110.7 to 173.9 m |
| Land; walkable | 30.1 km²; 99.9% at 50° | 54.4 km²; 99.9% at 50° | 40.4 km²; 98.71% at 44.8° (99.14% at 50°) |
| Resource nodes; spawn regions | 121,892; 333 | 245,853; 282 | 145,083; 281 |
| Walks | spawns 10/10, bridges 1,303/0, approaches 2,700/0, stairs 1,613/0, escapes 1,172/0 | spawns 10/10, bridges 866/0, approaches 2,392/1, stairs 1,349/0, escapes 967/0 | at 44.8°: spawns 10/10, obelisks 3/3, bridges 2,067/3, approaches 22,957/5, stairs 2,630/3, escapes 1,704/1, rooms 16,690/13 |
| Server | | host 0.8 s, 1.0 GB; listening 1.9 s | host 1.5 s, 1.2 GB; listening in about 3 s at 1.2 GB |

Figures are `passed/failed`. 27 building cores have no street approach, 9 of them named (Alcatraz's Main Prison, the
Four Fifty Sutter Building, Pier 2's Herbst Pavilion among them): `reports/ruins3/access-test.json`.

## Findings, in the order met

1. **The frame spans two counties.** North of the strait is Marin County (06041): TIGER's roads and water are one file
   a county, and `city.json` named one. `tiger.counties` takes a list; a line on the boundary is kept once. Cost: minutes.
2. **The project's metadata address is an index page.** The National Map gives `CA_SanFrancisco_B23` an S3 listing as
   its vendor metadata, which `fetch.py` saved as `.xml`. It keeps only `.xml` addresses now. And a file fetched again
   kept its old record in `downloads.json`; a fresh download records itself again.
3. **The newest lidar is four times Tampa's and stops at the county line.** 228 tiles at 0.25 m, 2.4 GB, downloading at
   2 to 10 tiles a minute (25 minutes). It leaves Marin's corner above the bridge's north end and a strip down the west
   coast bare (61,244 land samples), which fell back to the 2010 coastal model at 10 m. `dem.fill` names older projects
   used only where the newest has no ground (two 2018 USGS surveys, 185 MB); no land sample lacks lidar now. The tiles
   are not kept in `raw/`, as Tampa's were not: `fetch` gets them again.
4. **USA Structures merges attached houses.** 10,638 footprints against OpenStreetMap's 45,862 buildings: 4,817
   footprints hold two or more OpenStreetMap buildings, up to 53 (a Richmond block face); the Painted Ladies are inside one
   6,075 m² footprint with 29 others. Levelled as one floor on a 20% street, such a footprint would stand 10 m over its
   low end. `split.py` cuts a footprint into the OpenStreetMap outlines inside it when two or more cover 60% of it (`footprints.split_by_osm`,
   `split_cover`), with the parent's attributes and a `PARENT` field. The biggest change to the city; cost about half an hour.
5. **The city's tallest building is not in USA Structures.** Salesforce Tower (326 m, 2018) and the Transbay towers fall
   on no footprint, with 546 other OpenStreetMap buildings. `split.py` adds an OpenStreetMap building of 40 m² or more on
   land that USA Structures overlaps by less than a fifth: 1,281 of them.
6. **A merged footprint's class is its block's.** The first split gave 2,401 schools: one school in a row made every
   house split from it "Education" (and 597 theatres from "Assembly"). A piece now keeps its parent's class only when
   that is Residential, Commercial or Industrial: 846 schools, 107 theatres, 88% of footprints still with a kind.
7. **OpenStreetMap's heights here are metres.** The unit check now in `labels.py` compares bare heights with USA
   Structures': median ratio 1.09 over 29,303 footprints, so none is converted (`blocks/height-units.json`). Tampa's
   would read near 3.28 and convert its imported feet when its labels are made again; they were not, here.
8. **The sea is not at Miami's height.** San Francisco's mean sea level is 0.97 m NAVD88 (gauge 9414290, 1983-2001);
   Miami's 0.3 m copied would have put the sea 0.67 m low. And `prepare.py` held Miami's succession heights as absolute
   NAVD88 figures (6 m and 0.75 m); they are now heights over the city's sea, the same for Miami and Tampa. The sea is
   `world.seaNavd88` in `city.json`; drowned streets use 1.22 m, 0.25 m over it, as Miami's 0.55 m is over its 0.3 m.
9. **The Golden Gate under the class rule was a sagging viaduct with no towers.** OpenStreetMap maps the deck ways as
   `bridge:structure=suspension` and the towers in three dimensions: 36 parts (`man_made=tower`, `tower:type=bridge`,
   `min_height` and `height`, colour #bf4e3b). The generator's rule gave a motorway deck 8 m over the water, rising at
   10% to its 65 m ends, on piers every 31 m down to a 100 m bed (and a piece below -64 m rejects the whole way).
   `suspension.ts` (in the generator, any city) fills the mapped parts with 8 m and 4 m solids, the lowest down to the
   bed; hangs two cables from the tower tops, a parabola across the main span to 3 m over the deck and side spans to the
   deck at three tenths of the main span; and drops hangers every 16 m. A suspended deck keeps the height it left the
   land at (grade 0.5% for 10%) and has no piers over the water. The deck stands at 54 to 59 m (in life about 67 m: the
   lidar puts its ends there). A tower 227 m tall in 4 m solids is about 850 blocks, so `content/ruins.ts` gains
   `zmass8` (8 m, every finish): 250 and 262 blocks a tower. Cost: an hour with the pictures.
10. **Lakes above the sea became pits.** TIGER's lakes are all water and the engine's water is one sea level, so Stow
    Lake, whose surface is 87 m up, was cut to the sea as a pit with 90 m walls, found when a "stair" rose 110 m in
    13 m. Ten lakes stand 41 to 114 m up (Golden Gate Park's, Mountain Lake) and one 3.7 m up. `prepare.py` now leaves a
    lake out of the sea when its hydro-flattened lidar stands more than `perched_above_sea_m` (2 m) over it, as a flat
    marsh at its surface, in its own `perched_water.*` layers. Los Angeles' reservoir will need the same.
11. **Districts and spawn points from the data.** `world.py` proposes districts as the cells round OpenStreetMap's named
    suburbs, quarters, neighbourhoods and inhabited islands (39 here, every building in one), styled by their
    footprints, and spawn points on named parks. Its farthest-first picks were small parks at the edges ("Noe & Beaver
    Mini Park Community Garden"); the Presidio is a park, not a place. A person accepts with settings, not edits:
    `world.places` adds a seed, `world.styles` restyles, `world.spawn_places` names the spawn points and what each faces,
    and `world.py --accept` writes `world.json`. It also writes the settings round three reads: `bridgeGapLayer`,
    `ruins.report`, `ruins.yardDistricts`, and `containerDistrict` only when a city names one (San Francisco has no
    container port in its frame). `frame.py` writes `map.json`'s `bathymetry`.
12. **The vocabulary is composed, not copied.** `vocabulary.py` takes the reference map's rule sections (Miami's version
    4: forms, choices, assemblies, street, damage, interiors and the rest) and keeps the city's own districts, recipes,
    compositions (`ruins/compositions.json`) and budgets: a city cap of 130 blocks a footprint (5.75 M; 2.89 M used) and
    a height cap above the tallest label (336 m). San Francisco's six named places are compositions: the Transamerica
    Pyramid narrowing in three steps to a spire, Coit Tower's column and gallery, the Ferry Building's hall and clock
    tower, the Palace of Fine Arts' rotunda of eight piers and a stepped dome, Alcatraz's cellhouse and lighthouse. A
    composition needs a footprint of a whole tile: a smaller one takes no layout at all (178 such parts).
13. **The ground falls under the footprints.** Even split, 12,377 footprints stand on ground falling more than 2 m, 3,377
    more than 4 m and 438 more than 8 m (Tampa: 87, 7 and 2); each is levelled at its median, so rows of houses step
    down a hill in terraces with walls at their ends. The street is left as surveyed between them.
14. **The steepest streets and stairs** (`reports/steep*.json`, at ARK's 44.8° since D483, a step of 0.5 m). On the
    built ground 0.52 km² of the land (1.3%) and 0.47% of the street surface (2.7 ha) stand past 44.8°. A survivor
    meeting such ground stops at its foot, or stands on it where it already is; nothing slides yet.
    - 56 of 1,413 TIGER street lines cross a cliff (a 4 m stretch over 45°): paper streets drawn up Telegraph Hill's
      quarried face (Alta, Union, Greenwich, Chestnut), lines beside retaining walls (Harrison and Beale on Rincon Hill),
      the Presidio's bluffs. They are counted apart, not walked.
    - The steepest stretches over 30 m are 25.4° on Filbert Street, 24.6° on Vallejo Street, 23.8° on Farnsworth Lane
      and 22.7° to 17.8° on twelve more (TIGER puts its lines up the Filbert and Vallejo steps; the city's own steepest
      blocks are 31.5%, 17.5°). On the bare ground 4 of these 15 are walked up and down (Joice St, Flint St, Marion Pl,
      Arbol Ln; 6 were at 50°); the other 11 stop where a 2 m cell of the line rises 28 to 81°: stair risers (Filbert,
      Vallejo, Vulcan, Monument Way, Priest St), retaining walls, a levelled ruin's edge. With the ruins and plants in
      place 3 are walked: round three's wrecked cars and buses stand in the lanes, and trees on some.
    - Of 758 mapped stairs, the tallest rise 49 m (the Sand Ladder, 14.8°), 38 m (Vulcan, 14.4°), 33 m (Greenwich
      Steps, 23.3°, 35° at its steepest 6 m), 28 m (Vallejo Street, 19.9°) and 22 m (Lyon Street, 29.1°). On the bare
      ground 7 of the 15 tallest are walked (8 at 50°); the others stop at risers of 28 to 83° (Greenwich Steps,
      Filbert Steps, the Peter Macchiarini Steps, Baker Street, Farnsworth Lane, Vallejo Street, Vulcan). The lidar sees
      a flight as a ramp broken by steps of a 2 m cell. Every such stair is mapped (`blocks/stairs.json`, with its
      points, rise and step count), so a generator rule laying the new one-piece flights (under 40°) along mapped
      stairs, and ramps along the street stretches the lidar steps, would carry all of them; it is not made here.
15. **The busiest chunks are full.** 455 footprint parts were refused for the chunk budget of 1,000 blocks or the map's
    bounds (Tampa: 75); of those in a district, most are downtown (Chinatown 42, Union Square 35, the Financial District
    24), where small buildings stand among towers.
16. **The plants are Miami's.** The node zones plant banyans, palms, mangroves and sea grape: Alamo Square is a banyan
    grove in front of the Painted Ladies (`reports/world1/worst-banyans-in-alamo-square.png`). San Francisco's cypress,
    eucalyptus and Monterey pine are not in the content.
17. **The far city fills a lattice.** From Crissy Field, 1.5 km off, the bridge's cables and hangers draw as one solid
    red sail and the far tower is lost (`golden-gate-from-crissy-field.png`); within a few hundred metres both towers,
    cables and hangers read (`golden-gate-south-tower.png`, `golden-gate-deck.png`).
18. **`minY` is a setting that matters here.** Tampa's -32 m would have floored the strait at -32 m; San Francisco
    sets -128 m (`world.minY`) for its 110 m channel. The map file's 1/64 m steps reach 896 m over that.
19. **The overhead picture holds what the medium tier draws.** From 3,600 m the ground is a 4 km square in a flat sea;
    `mapscreen-z0.png` (`tools/mapworld/pictures.ts`) is the whole map from above.

What carried over unchanged: frame, NLCD, the fine layers, the coastal model step, labels and places, ways and
bridges, the far city, the round-three generator with its walks, and the map file and server, at 1.4 times Tampa's
blocks.

## Engine asks, with what was measured

- **Water above the sea.** Ten lakes stand 41 to 114 m over San Francisco's sea and are marsh here; Los Angeles has a
  reservoir far above its.
- **A chunk budget for dense blocks.** 455 parts refused at 1,000 blocks a chunk or the bounds, most downtown; the engine's file holds 65,535 a chunk.
- **A temperate flora.** Every plant zone is subtropical.
- **The far city's lattices.** Cables and hangers of 0.3 to 1 m pieces fill into solid cells past the near reach.
- **Pieces below -64 m.** The admission test in `ruins.ts` refuses a whole way if any piece is below -64 m; the
  Golden Gate's channel is 110 m deep (the suspension rule stops its supports at -60 m).

## For the fourth city by one command and a settings file

Done here: counties, lidar fill, footprint split and added buildings, the unit check, perched lakes, the city's sea for
the succession, district and spawn proposals accepted by settings, the composed vocabulary with scaled budgets, a span
across every carriageway (`future.py`), the attributes download recorded (`city.ts`), "no pieces" reported as such.
Still to do:

1. Miami onto `tools/mapdata`: its canopy and fine layers come from its paintings, so a `city.json` for it waits on a
   way to name painted layers as inputs.
2. A height for a part mapped in three dimensions anywhere, not only bridge towers: Salesforce Tower and the
   Transamerica Pyramid have parts in OpenStreetMap that the tower recipe does not read.
3. A taper or setback rule for towers whose `roof:shape` is pyramidal, so the pyramid needs no composition.
4. The generator's kind for `man_made=lighthouse` (it labels as a utility and would build a ring of tanks).
5. Flights along `blocks/stairs.json` and ramps where a street's lidar steps (finding 14), now that sloped pieces exist.

## Obelisks and the walkable count

San Francisco's three obelisks (`world.obelisks` in `city.json`, written into `world.json` by `world.py`) stand at Marina
Green, by the Embarcadero beside the Ferry Building, and in the Panhandle, each walked to from its spawn point in 41 to
48 s. A first one at Civic Center Plaza was 1.4 km from the nearest spawn point and the walk stuck downtown, so it
moved. `tools/mapworld/build.ts` counted walkable land at a fixed 50°; it now reads the survivor's own limit from the
content, the one generator line changed for the slopes.
