# Building a fifth city: what Las Vegas needed

Las Vegas was chosen to break the desert and the very large: no water in the census's layers, almost no trees,
resorts whose footprints are districts, a tower 350 m tall and an airport. It took one agent about an hour and a half
(15:51 to 17:30 local, 2026-11-15), 6 minutes of it downloading 2.4 GB. It was built on Los Angeles and round four's
rule library, and merged main twice: before its compositions, and after water above the sea landed (D539 to D545).
The ruins were not tuned.

```sh
bun tools/mapdata/city.ts las-vegas                    # frame, fetch, prepare, attributes, split, future, fine,
                                                       # bathymetry (none), labels, ways, world, vocabulary, build
bun tools/mapworld/build.ts las-vegas                  # only the map file, from what is committed: 88 to 136 s
bun tools/mapworld/verify.ts var/maps/las-vegas.snmap
bun tools/mapworld/obelisk-walk.ts var/maps/las-vegas.snmap
bun tools/mapdata/steep.ts var/maps/las-vegas.snmap 15 [--ground-only]
bun tools/mapworld/views.ts var/maps/las-vegas.snmap assets/source/maps/las-vegas/reports/world1/views.json assets/source/maps/las-vegas/reports/world1 medium
bun run build && bun server/main.ts --dev --map var/maps/las-vegas.snmap --port 8795 --db var/las-vegas.db
```

## Beside the other four

Miami's and Tampa's columns are from Tampa's page (round two), San Francisco's from its own (round three), Los
Angeles's from its own (round four with slides). Las Vegas's are round four with slides and water above the sea.

| | Miami | Tampa | San Francisco | Los Angeles | Las Vegas |
|---|---|---|---|---|---|
| Map file | 76.9 MB, 15.3 MB gzipped | 91.3 MB, 21.5 MB | 104.1 MB, 28.1 MB | 99.1 MB, 37.0 MB | 84.4 MB, 24.2 MB |
| Build | 9.7 s, 3.9 GB peak | 12.7 s, 4.8 GB | 62 to 140 s; 5.0 to 7.8 GB | 113 to 158 s; 7.1 to 7.8 GB | 88 to 136 s; 4.8 to 7.3 GB peak |
| Footprints | 11,919 | 31,688 | 44,269 | 53,967 | 25,802: 23,969 from USA Structures as they are, 474 split into 1,335 OpenStreetMap buildings and 57 remainders, 28 resorts cut into 101 building parts and 47 podiums, and 293 buildings it lacks added |
| Labelled with a kind and a height | 76% | 90% | 84% | 96% | 90% (a kind 97%, a height 91%) |
| Blocks; buildings built | 1,188,264; 11,845 | 2,091,633; 31,542 | 2,889,065; 43,654 | 2,729,433; 53,112 | 1,971,692; 25,590 of 25,808 parts (147 over budget or bounds, 71 too small for a tile; 28 at reduced detail, 13 of them cut to 8 m) |
| Busiest chunk (cap) | 1,000 | 939 | 1,000 | 987 of 999 | 999 of 999, by the Strat; the next 997 by the stadium and 996 at Excalibur |
| Mapped ways built | 809 of 809 | 590 of 591 | 1,281 and the Golden Gate | 217 of 217; the sign's 9 letters | 661 of 661 (575 road bridges, 82 rail, the monorail's among them); no lettered sign; the Welcome sign's board; 8 named places in 7 compositions |
| Ground | | -16 to 24 m | -110.7 to 173.9 m | 46.4 to 553.6 m | 586.2 to 713.1 m NAVD88; 501 bodies of water from 591.1 to 697.8 m |
| Land; walkable | 30.1 km²; 99.9% at 50° | 54.4 km²; 99.9% at 50° | 40.4 km²; 98.71% at 44.8° | 66.1 km²; 98.03% at 44.8° | 65.7 km²; 99.84% at 44.8° |
| Resource nodes; spawn regions | 121,892; 333 | 245,853; 282 | 145,083; 281 | 823,370; 382 | 214,751 listed; 155 (472 creatures after 391 s of the bench) |
| Walks | | | at 44.8°: spawns 10/10 ... | spawns 10/10, obelisks 3/3, approaches 41,205/4 ... | spawns 10/10, obelisks 3/3, bridges 663/6, approaches 33,616/12, stairs 5,750/11, escapes 3,451/2, rooms 19,683/3 |
| Server | | host 0.8 s, 1.0 GB | 1.2 GB | 1.3 GB; 1.1 GB listening | bench host 1.8 s, 1.4 GB; listening on 8795 at 0.96 GB |

Figures are `passed/failed`. The failures are the generator's, listed in `reports/ruins4/*-walk.log`.

## Findings, in the order met

1. **The frame needs no shift, and the newest lidar covers it.** `NV_ClarkCounty_B22` (published 2023-06-14): 36 tiles
   of a mile at 1 ft, 2.33 GB, every sample. Its heights are NAVD88 in **US survey feet** (`z_to_m` 0.3048006), which
   the tile's own compound CRS says and the TNM listing does not: read one tile's header before the first fetch. The
   Welcome to Fabulous Las Vegas sign is in the frame, 400 m inside its south edge (Los Angeles's page put it outside).
2. **`height_zero_m` 500 before prepare**, as Los Angeles advised: the ground is 586 to 713 m. `minY` 500. No sea within
   350 km, so heights are NAVD88 as surveyed (`seaNavd88` 0). Cost: none.
3. **TIGER has no water in the square; all the Strip's is OpenStreetMap's.** A new query, `features.overpassql`, takes
   building parts, water outlines, pools, fountains, runways and wheels with their shapes. Prepare adds OpenStreetMap's
   water standing on the ground (none on a roof or deck, indoors or an upper level, or mostly inside TIGER's) to the
   perched layer with its `kind`, area and lidar surface, 574 outlines; the six mapped intermittent (the Tropicana
   detention basins, 25 ha, and the Flamingo Wash) are listed and not burnt, and the lakes step now leaves them ground.
   With water above the sea: **501 bodies** (453 pools, 28 ponds, 17 fountains, two basins, a lagoon), 25 ha, 73 left
   (55 pools, 6 fountains, 4 ponds and 2 basins the lidar does not show flat or whose shore stands under them, and the 6
   intermittent). The list is under "Water" below. Cost: 40 minutes, half of it waiting for the landing.
4. **A desert read green.** 61% of the square is open developed ground, whose tint is half grass; NLCD's desert classes
   (barren, shrub) cover 1.4%. `succession.dry_classes` makes those biome 10, `S.DESERT` (tan gravel, natural stone,
   the open ground's plants), and the world `dryGround`, which tints open ground and courts gravel and paving and weeds
   dry. Golf courses and parks (NLCD 21) stay green. `reports/world1/aerial-overhead.png`. Cost: an hour with the
   pictures.
5. **A resort is one building carrying its tallest tower's height.** Planet Hollywood was a 10.4 ha footprint at 183 m,
   Aria 9.1 ha at 183 m, Caesars Palace 9.3 ha at 133 m; Paris took its Eiffel Tower's 165 m, the MGM Grand and New
   York-New York stood at 23 to 26 m with their towers missing. Los Angeles's `split_remainder_m2` does not help: here
   OpenStreetMap draws the whole. Four causes, four general rules, each behind a setting:
   - Buildings overlap inside one survey footprint (the Eiffel Tower across the casino, Aria's towers within its
     podium). `split_taller_first`: the taller is cut first.
   - `labels.py` joined OpenStreetMap's buildings to footprints by their centre point, so the Eiffel Tower's centre named
     and raised the casino. Under the same setting each piece is labelled by its own building alone, and a tower drawn
     within a larger building takes that host's name.
   - Towers mapped only as building parts (the MGM Grand's wings, New York-New York's skyline, Westgate, Treasure
     Island). `split_by_parts`: a footprint whose ground-standing parts stand a quarter over its known height is cut into
     them and its podium, which keeps the survey's height.
   - Multipolygon buildings (Elara, 183 m; Palms Place, 157 m) never reached the split: `buildings.overpassql` now takes
     relations with `out body geom` (`out tags` drops their members) and `split.py` assembles their rings.

   Now 76 footprints of 60 m or more stand at their own places, and no district-sized footprint carries a tower's
   height but the three that are one (the Luxor, the stadium, the Sphere). Cost: an hour and a half; the largest
   piece of work.
6. **Split ids move whenever the split does.** `ruins/places.json` named 500000057 for the Eiffel Tower; adding
   relations made it another building. A place may now name its OpenStreetMap building (`osm_way`) and `vocabulary.py`
   writes the footprint cut from it. Los Angeles's places name split ids and would move the same way.
7. **The chunk cap on the Strip.** At eight playable floors, 151 footprints were refused for the budget and 18 cut to
   8 m, among them the Fontainebleau's 224 m tower (unnamed, placed after its named podium had spent the chunk) and the
   Sphere. Named places go first; a host's name puts the Fontainebleau's tower among the named by height; and a city may
   now set its own budgets (`ruins.budgets`, which `vocabulary.py` always took from Miami's): Las Vegas keeps four
   playable floors, 147 refused and 13 cut. Still short: an MGM Grand wing (72 m of 89), and small tall pieces refused
   in full chunks (a 155 m part of the Bellagio's crown, the Venetian's Campanile, the Paris Balloon, Rio's VooDoo).
8. **Casinos are `nightlife`**, which Miami's table builds as a shop front. Las Vegas's own categories send it to `hall`.
9. **The places a visitor looks for are compositions of general operations** (`ruin-layouts.ts`, `ruins/compositions.json`):
   - The Strat: three radial legs, a round shaft (`ring` of tall panels), the pod (`dome` with a drum, a flattened top by
     `rise`, a bowl under it by `below`), a glazed band and the mast, to 350 m. `the-strat-from-the-south.png`,
     `the-strat-pod.png`.
   - The Sphere: a `dome` of 8 m blocks with `below` 40 m, so it stands on the ground as a sphere, 157 m across.
     `sphere-from-its-parking.png`.
   - Allegiant Stadium: the `arena` bowl, an elliptical glazed wall (`ring` with `radii`) open to the north-east where its
     doors face the Strip, and a roof of plates under a shallow dome (`vault`). `allegiant-stadium-roof.png`.
   - The convention centre and its West Hall: each one open hall to its edges. `convention-center.png`.
   - The Luxor: a stepped `pyramid` hollow round its atrium, a passage through its foot (`portal`). `luxor-from-the-strip.png`.
   - The High Roller: a `wheel` in its north-south plane over its boarding building, 28 cabins. `high-roller-from-the-strip.png`.
   - The Eiffel Tower: a `lattice` narrowing up a curve, two decks. `eiffel-tower-from-bellagio.png`.
   - The Welcome sign: a point with words and `information=board` is now a board on two posts facing its mapped
     direction, in its median. `welcome-sign.png`.
10. **The dome skipped its widest courses.** A course laid rings only while it stood a quarter piece outside the next,
    so near a large dome's springing whole courses were missing (the Sphere floated over a tub). Every course now lays
    its own ring. Los Angeles's Cinerama Dome had lost its lowest course the same way: rebuilt, it gains those 30 crowns
    and nothing else changes (its reports are updated; its picture is a ring short).
11. **A piece in a finish its shape lacks built a map nothing could load.** Floor plates come only in concrete; a deck
    asked in rust wrote `core:zruin_floor8_rust`, which only the picture tool found. `Mason.put` now falls back to
    concrete, and the build refuses a kind the content does not have.
12. **The airport.** Runways and aprons paved as highway took the street's wrecks: buses on the runways. They are their
    own surface, `S.PAVED` (roads.png 6), with no wrecks or approaches. `airport-north-end.png`.
13. **A spawn point can open inside a ruin.** `placeSpawns` checks the ground's surface, not the pieces on it: the xeric
    garden's point stood inside a building's walls, and its replacement faced a wall 10 m off. The university's spawn
    now stands on its west lawn, facing across it.
14. **Steep ground: the Strip is flat** (`reports/steep*.json`). 6.7 ha of 6,606 ha are past 44.8° in the lidar, 10.5 ha
    in the map (3.9 ha at levelled footprints' edges). The steepest streets are bridge approaches: Russell Road,
    Tropicana and Flamingo at the freeway, and the airport's ramps to Terminal 1, where the bare-earth lidar has no deck.
    On bare ground 7 of the 15 walk and 8 stop at the abutments (46 to 81°); with the pieces none do: each meets a wreck
    left in its lane on level ground or the end of its deck. `worst-a-wreck-in-the-lane-of-russell-road.png`.
15. **The plants are Miami's.** Las Vegas's growth zones take the creosote and bursage as sparse bushes on the desert and
    lots, palms on the boulevards and plazas, shade trees and palms on the watered parks and golf courses, almost no
    canopy (shares 0.10 and 0.02), and none of Miami's subtropical kinds. What an art round should make is under "Asks".
16. **The far city from overhead** draws 1,147 of the medium tier's 1,024 draws (none dropped); every other view is within.

What carried over unchanged: TIGER, NLCD, USA Structures and its split, the remainders, labels, ways and bridges,
districts and spawn points by settings, `easy_around_spawns_m`, the composed vocabulary, the steep measure, the map file
and server, and main's water above the sea, which made the Strip's fountains and pools water by itself.

## Water

Every body kept, by name where OpenStreetMap names it, with the surface the build gave it (metres NAVD88):

- Kept: the Fountains of Bellagio (641.0, 3.4 ha), the Lake of Dreams at Wynn (635.5), Mandalay Bay's Wave Pool
  (654.6), East and West Lagoon (654.5, 655.1) and Landshark Lagoon (659.8), Caesars' Temple, Neptune, Venus, Jupiter,
  Fortuna and Apollo pools (641.8, 642.7, 642.7, 643.4, 642.5, 643.3), Go Pool Day Club (639.2), Blu Pool (636.7), Beach
  Club Pool (641.9 and 639.2), Baker Pool (612.2), Hilton Grand Vacations Club Pool (621.1), (Blue Moon) (633.0), the
  Planet Hollywood Globe's basin (642.5); 27 unnamed ponds from 611.8 to 664.1 m, a lagoon, two basins that hold
  water, 17 fountains in all and 453 pools in all, most of them unnamed in backyards.
- Left as marsh: Villa Soleil Pool (658.5, its shore stands under it), Elation Pool (621.3, its outline is not flat in
  the lidar), two unnamed ponds of 2,252 and 5,421 m² whose lidar is not flat, and 63 small pools, fountains, ponds and
  basins likewise.
- Left as ground, mapped intermittent: the Tropicana Detention Basin (693.8, 23.4 ha), the Tropicana North Branch
  Detention Basin (673.6), two unnamed basins, the Flamingo Wash (689.5).

`stats.json`'s `lakes` lists all 574 with their reasons; `drinking-at-the-fountains-of-bellagio.png` is a survivor who
drank 10 water standing in the lake.

## Asks, with what was measured

- **The chunk cap with district-sized footprints.** 147 footprints refused and 13 cut to 8 m along the Strip at four
  playable floors; the busiest chunks stand at 999, 997 and 996.
- **A desert creature table.** Desert regions take the jungle's, as Los Angeles's chaparral does.
- **Spawn points that see the pieces**: `placeSpawns` places on a surface inside a ruin's walls (finding 13).
- **A desert flora, kind by kind, for the art team:** creosote bush (open, 1 to 3 m, olive, the commonest plant of the
  valley); white bursage (low grey mounds between it); Mojave yucca and banana yucca (a trunk with a spray of blades);
  the Joshua tree (on the valley's edges, none in the square); barrel and cholla cactus; desert willow and honey
  mesquite (the washes' small trees); palo verde (green bark, planted); the Mexican fan palm and the date palm (the
  Strip's and the resorts' palms, tall and thin); Aleppo pine (the city's commonest planted tree); oleander hedges;
  dry grass (gold) and gravel landscaping. Today: `core:bush` stands for the creosote and bursage, `core:palm` for the
  palms, `core:tree` for the planted shade trees.
- **The far city from above** is over the draw budget (finding 16).

## For the sixth city

Done here, each a setting or an absent file for the cities before: `features.overpassql`, OpenStreetMap water on the
ground with its kind, `succession.dry_classes` and `dryGround`, an airfield's paving, building relations in the split,
`split_taller_first`, `split_by_parts`, places by `osm_way`, `ruins.budgets`, a host's name, a board on posts, the
`dome` (`radii`, `rise`, `below`, every course laid), `ring` ellipses, `pyramid`, `lattice`, `wheel`, `vault`, a finish
falling back to concrete, the build refusing unknown kinds, intermittent water left ground. First:

1. Read one lidar tile's header for its units before `prepare`, and set `height_zero_m` and `minY` from it.
2. Set `split_taller_first` and `split_by_parts` from the start where resorts, malls or campuses stand: then `labels`
   and look at the tallest list and the largest footprints for a tower's height on a district.
3. Name places by `osm_way`, never by split id.
4. Look at the aerial picture first: its colour says whether `dry_classes` is needed.
5. Check the budget report for towers cut to 8 m before composing anything; a city of towers needs `ruins.budgets`.
