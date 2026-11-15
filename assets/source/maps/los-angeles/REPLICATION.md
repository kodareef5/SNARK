# Building a fourth city: what Los Angeles needed

Los Angeles was chosen to break mountains: 500 m from the flats to Cahuenga Peak, canyons with houses in them, a
reservoir 216 m over the sea and no sea in the frame. It took one agent about two hours (14:10 to 16:15 local,
2026-11-15), 10 minutes of it downloading 1.3 GB. It was built on round three, then moved onto round four's shared
rule library (`r9/ruins4-land`, merged before it reached main) and onto steep ground that slides (D499 to D501). The
ruins were not tuned.

```sh
bun tools/mapdata/city.ts los-angeles                   # frame, fetch, prepare, attributes, split, future, fine,
                                                        # bathymetry (none), labels, ways, world, vocabulary, build
bun tools/mapworld/build.ts los-angeles                 # only the map file, from what is committed: 113 to 158 s
bun tools/mapworld/verify.ts var/maps/los-angeles.snmap
bun tools/mapworld/obelisk-walk.ts var/maps/los-angeles.snmap
bun tools/mapdata/steep.ts var/maps/los-angeles.snmap 15 [--no-plants | --ground-only]
bun run build && bun server/main.ts --dev --map var/maps/los-angeles.snmap --port 8796 --db var/los-angeles.db
```

## Beside Miami, Tampa and San Francisco

Miami's and Tampa's columns are from Tampa's page (round two), San Francisco's from its own (round three). Los
Angeles's are round four with slides.

| | Miami | Tampa | San Francisco | Los Angeles |
|---|---|---|---|---|
| Map file | 76.9 MB, 15.3 MB gzipped | 91.3 MB, 21.5 MB | 104.1 MB, 28.1 MB | 99.1 MB, 37.0 MB (every plant listed, as round four does) |
| Build | 9.7 s, 3.9 GB peak | 12.7 s, 4.8 GB | 62 to 140 s; 5.0 to 7.8 GB | 113 to 158 s; 7.1 to 7.8 GB peak (round three: 87 to 144 s, 4.2 to 6.0 GB) |
| Footprints | 11,919 | 31,688 | 44,269 | 53,967: 44,697 from USA Structures as they are, 2,165 split into 5,496 OpenStreetMap buildings and 65 remainders, and 3,709 buildings it lacks added |
| Labelled with a kind and a height | 76% | 90% | 84% | 96% (a kind 99%, a height 97%) |
| Blocks; buildings built | 1,188,264; 11,845 | 2,091,633; 31,542 | 2,889,065; 43,654 | 2,729,433; 53,112 of 54,021 parts (267 over budget or bounds, 641 too small for a tile) |
| Busiest chunk (cap) | 1,000 | 939 | 1,000 | 987 of 999, at Universal City |
| Mapped ways built | 809 of 809 | 590 of 591 | 1,281 and the Golden Gate | 217 of 217; the Hollywood Sign's 9 letters; 4 named compositions |
| Ground | | -16 to 24 m | -110.7 to 173.9 m | 46.4 to 553.6 m over the sea (47.1 to 554.6 m NAVD88); no water |
| Land; walkable | 30.1 km²; 99.9% at 50° | 54.4 km²; 99.9% at 50° | 40.4 km²; 98.71% at 44.8° | 66.1 km²; 98.03% at 44.8° |
| Resource nodes; spawn regions | 121,892; 333 | 245,853; 282 | 145,083; 281 | 823,370 listed; 382 (1,827 creatures at 1x, 178 in easy zones) |
| Walks | spawns 10/10 ... | spawns 10/10 ... | at 44.8°: spawns 10/10, obelisks 3/3, bridges 2,067/3, approaches 22,957/5, stairs 2,630/3, escapes 1,704/1, rooms 16,690/13 | with slides: spawns 10/10, obelisks 3/3, bridges 216/1, approaches 41,205/4, stairs 2,368/2, escapes 1,262/0, rooms 13,939/0 |
| Server | | host 0.8 s, 1.0 GB | 1.2 GB | bench 1.3 GB; listening on 8796 at 1.1 GB |

Figures are `passed/failed`. The failures are the generator's, listed in `reports/ruins4/*-walk.log`.

## Findings, in the order met

1. **The frame needs no shift, and the newest lidar covers all of it.** `CA_LosAngeles_B23` (published 2025-06-13):
   90 tiles of 1 km at 0.5 m, 1.16 GB, every sample of the square; no `dem.fill`. The Hollywood Sign is 0.9 km inside
   the north edge, and the frame also takes in Universal City and a stretch of the Los Angeles River at its north-west
   corner. Cost: minutes.
2. **No sea, and the tools assumed one.** The coastal-model step, `Base.bathymetry()`, the succession's coast distance
   (scipy's distance transform with no water measures from a corner) and the flooded streets all needed one. Now a city
   leaves `bathymetry` out of `city.json`, `world.sea: false` writes a map file with no water (its sea level is
   -Infinity, which the engine already draws as no sea), and heights stand over Santa Monica's mean sea level, 16 km
   away. `content/maps.ts` gives the map no `seaLevel`. Cost: 20 minutes.
3. **The ground nearly overflowed `height.png`.** It held centimetres over -100 m, so 555.35 m at most; Cahuenga Peak
   is 554.6 m. `height_zero_m` (city.json, carried into map.json) sets the zero; Los Angeles uses 0, and `prepare.py`
   now refuses ground that does not fit. Las Vegas stands 600 to 700 m up and must set it.
4. **All of TIGER's water stands above the sea.** Ten polygons, all perched (`base/perched_water.geojson`): the
   Hollywood Reservoir at 217.2 m NAVD88, the river's concrete channel at 158 m and Universal's lake at 168 m on the
   north-west edge, and seven ponds. They are marsh at their surfaces, as San Francisco's lakes are. **The map has no
   water at all**: a survivor fills a vessel standing in water (`server/use.ts`), so the only drink is what food
   carries. `reports/world1/worst-the-reservoir-as-marsh.png`.
5. **USA Structures traces whole blocks as one footprint, and OpenStreetMap draws only parts of them.** Ovation
   Hollywood is one footprint of 27,416 m² holding the TCL Chinese Theatre (18.1 m) and the Loews Hotel (70.1 m), which
   cover a fifth of it: the label took the hotel's height for the whole block, a 70 m slab called the Chinese Theatre.
   The Camden's 13,369 m² took its 85.5 m tower's. `footprints.split_remainder_m2` (2,000 here) cuts a footprint that
   large into its OpenStreetMap buildings and the remainder, opened by 1.5 m so no sliver is kept: 42 footprints into
   their buildings and 65 remainders, which keep the survey's height. Then 3,709 OpenStreetMap buildings USA Structures
   lacks are added (San Francisco's rule).
6. **OpenStreetMap's heights here are Los Angeles County's import (`lacounty:bld_id`).** Metres (median ratio 1.30 to
   USA Structures', not converted). On the hills some are measured from the foot of the slope: 42 houses over 20 m, four
   of them at 48 to 55 m in the hills west of Runyon Canyon (footprints 13291675, 500007582, 15596798 and 15043796).
   Not corrected: no rule tells a tall hillside house from a wrong one, and a hand correction would be
   modelling. Ask: a plausibility rule by kind, or the import's own `ele` against the lidar.
7. **A spawn point's name over 24 bytes lost the whole respawn list.** "Paramount Pictures Studio Tour" (30 bytes)
   made every respawn `RESULT_STALE`, and San Francisco's "Golden Gate Bridge Vista Point" did the same on main. Fixed
   on main (D495, 48 bytes); `world.py` refuses longer names.
8. **No beach, so no easy zones.** Every one of the 398 creature regions was the jungle's (parasaurs and raptors), and
   a survivor arriving at Dante's View was killed by raptors in 25 s. ARK's spawn points stand in easy zones, so
   `world.easy_around_spawns_m` (400 here) gives the jungle regions round a spawn point with no beach in reach the
   beach's table: 178 creatures at 1x. And barren land (NLCD 31) was beach anywhere, a Miami assumption that put a
   dodo beach in Hollywood; it is beach only within 500 m of the sea now.
9. **The Hollywood Sign is mapped letter by letter.** Relation 1706337 (`man_made=sign`, `inscription=HOLLYWOOD`)
   holds nine two-node ways, each a letter's foot with its `inscription` and `height` 13.7. `ways.py` writes lines
   with an inscription of capitals and a height to `blocks/signs.json`; `signs.ts` stands up the letters of
   `content/lettering.ts` along each (a stroke alphabet A to Z, one convex-part piece a letter, 13.7 m tall, white sheet
   metal; ids `core:ztype_*`, which sort after every other id so no index moves). The ways are drawn either way (the
   first L east to west), so a letter on a slope faces down it. The sign's label node had a plinth built in the middle
   of the word; public places within 60 m of a sign are left to it. Any city's mapped lettering now stands. Cost: an
   hour with the alphabet and the pictures.
10. **Domes and round towers are general operations.** `ring` (pieces round a centre at listed heights, turned along
    it) and `dome` (a drum and stepped courses under a hemisphere, closed from above, over an optional arc) in
    `ruin-layouts.ts` make four compositions: Griffith Observatory from OpenStreetMap's three mapped domes (radii 12.9,
    5.1 and 5.1 m), Capitol Records' round tower with a sunshade on every floor and its spire, the Cinerama Dome, and
    the Hollywood Bowl's shell as a quarter-sphere open to the seats. Las Vegas's sphere is a `dome` without the drum.
11. **The Bowl's seats are a hillside, and a footprint.** USA Structures traced the seating as 7,604 m²; levelled at
    its median it would have flattened 45 m of slope into one floor. A named place with layout `ground` is neither
    built on nor levelled, and keeps only low growth.
12. **Obelisks.** Hollywood and Highland's first place, in Ovation's courtyard, was cut off by the block's ruin; it
    stands on the boulevard now. The Observatory's, on its lawn, put a 70 m column over the planetarium dome from the
    city; it stands on the parking 150 m north. All three are walked to from spawn points in 15 to 32 s.
13. **Mountains: the ground past 44.8°** (`reports/steep*.json`). In the lidar 115.5 ha of the 6,606 ha are past the
    walkable angle (1.75%): the Cahuenga Peak and Mount Lee ridge (30% of its steepest 256 m square, round the Hugh
    Hefner Overlook), Mount Hollywood (16 to 17%), the hills round Runyon Canyon and Yamashiro (16%), the sign's own
    square (14%). In the map it is 130 ha: **levelling footprints on the hills adds 16 ha of cliffs** at the edges of
    house pads (3.3 ha on footprints in the lidar, 19.6 ha in the map). Streets: 152 of 1,415 TIGER lines cross a cliff
    (San Francisco: 56), the hillside roads cut into the slopes (Mulholland, Laurel Canyon, the Beachwood and Whitley
    Heights streets). Of the 15 steepest stretches over 30 m (up to 31.2°, and N Fuller Ave's 136 m climb into Runyon
    Canyon) 4 are walked on bare ground, 1 with the ruins; of the 15 tallest of 262 mapped stairs (the Bowl's at 31.5 m,
    the Hollywoodland stairs: Hollyridge, Beachwood, Belden, Durand, Saroyan, Westshire; Whitley Terrace; the Paramount
    Stairway) 5 on bare ground, 4 with ruins and plants. The rest stop at a 2 m step of 29 to 83° in the lidar: risers,
    road cuts, retaining walls.
    - **What a survivor does there today, with slides (D499):** on foot, ground past 44.8° is a wall: it stops at the
      foot of the ridge to the sign, of a canyon side and of a house pad's edge. Falling onto it, it slides down to
      standing ground. Spawn points are not put on it (D501); all ten stand on level ground and walk away four ways.
    - **What it means for the map:** the ridge is climbed by its roads and trails, not up its faces; and every
      levelled house pad on a hill now has a wall on its uphill side and a slide off its downhill side. The ask: grade
      between a pad and its hillside (a retaining wall piece, or the street's approach carried round), and lay
      one-piece flights along `blocks/stairs.json` (San Francisco's step 5, still not made).
14. **The plants are Miami's, and so was its canopy share.** The hills, Griffith Park and Hollywood Forever grew
    banyans, figs, palmettos and mangroves (the reservoir's marsh). Round four lets a city's `growth.zones` set the
    kinds by zone; Los Angeles's: chaparral as bushes with live oaks on the hills, oaks, hardwoods and planted palms in
    the parks, palms on the streets, low scrub on the reservoir, and no banyan, fig, mangrove, palmetto or sea grape.
    `canopy.share_of_vegetation` drops from Miami's 0.59 to 0.25 and `share_of_open` from 0.15 to 0.08: Hollywood's
    tree cover is about a fifth, and chaparral under summer drought and fire stays shrubland. Parks and the cemetery
    still read as woods, and the oak is Miami's live oak hung with Spanish moss: Lake Hollywood Park, laid out to view
    the sign, is a grove in front of it (`worst-oaks-at-lake-hollywood.png`).
15. **The far city draws a letter as a slab.** From 300 m the letters are solid white rectangles
    (`hollywood-sign-from-the-air.png`); from 110 m they read HOLLYWOOD (`hollywood-sign-close.png`). San Francisco's
    cables did the same.
16. **The busiest chunks are full only at Universal City.** 987 blocks of the cap of 999; 267 parts refused for the
    budget or the bounds, 641 too small for a tile.
17. **Round four's library is a merge, not a copy.** The city's vocabulary keeps its districts, recipes, budgets,
    compositions, plant zones and sight corridors (to Capitol Records, the Observatory and the Cinerama Dome from the
    south, and to the Bowl's shell from its seats). It has no surge of its own: with no sea, each building's exposure
    is its age alone, so the library's direction changes nothing. Round four lists every plant: 823,370 nodes, and the
    map file is 37 MB gzipped against round three's 31 MB.

What carried over unchanged: TIGER, NLCD, USA Structures and its split, labels, ways and bridges, the perched lakes,
districts and spawn points by settings, the composed vocabulary, the map file and server.

## Engine asks, with what was measured

- **Water above the sea, first.** The map has no water a survivor can fill a vessel in or swim: the Hollywood
  Reservoir (217 m), the river's channel (158 m), Universal's lake (168 m) and seven ponds, 37.5 ha, are marsh.
- **A creature table for dry hills.** Every region is the jungle's or, round spawn points, the beach's; Los Angeles
  needs a chaparral and grassland table.
- **A temperate and Mediterranean flora, kind by kind, for the art team:** coast live oak (wide, evergreen, no moss);
  California sycamore (white bark, in the canyon bottoms and at Ferndell); chaparral shrubs (chamise, toyon,
  manzanita, laurel sumac: dense, 1 to 4 m, grey-green); coastal sage scrub (sagebrush, buckwheat: low and grey);
  California black walnut on the north slopes; the planted Mexican fan palm (tall, thin, the boulevards' palm) and
  Canary Island date palm (Hollywood Forever, the parks); jacaranda and eucalyptus (planted streets and parks); dry
  grassland (gold in summer) for the open slopes. Today: `core:bush` stands for the chaparral, `core:oak` for the live
  oak, `core:palm` for the planted palms.
- **The far city's thin shapes.** Letters and cables fill into solid cells past the near reach.
- **Ground that slides is in; the generator's pads are the open question.** 16 ha of the map's 130 ha past 44.8° are
  the generator's own, at levelled footprints on the hills.

## For the fifth city (Las Vegas)

Done here: a frame with no sea (`world.sea`, no `bathymetry`), `height_zero_m`, remainders in the split, places to
`drop` and spawn points at a given `at`, names checked at 48 bytes, easy zones round spawn points
(`easy_around_spawns_m`), barren land as beach only by the water, lettered signs, rings and domes, layout `ground`,
the steep-ground measure, a vocabulary extending round four's library with the city's own growth zones. First:

1. Set `height_zero_m` before `prepare` (the Strip stands at about 620 m; 500 gives room to 1,155 m), `world.sea:
   false`, `minY` near the ground (the map file's 1/64 m steps reach 1,024 m over it), and no `bathymetry`.
2. Copy this `city.json` and check `blocks/signs.json` at once: "Welcome to Fabulous Las Vegas" is south of the frame,
   but any lettering mapped with an inscription and a height will stand at 13.7 m only if it is mapped within 30% of
   that; a casino's rooftop letters are not.
3. The sphere is a `dome` with `drum` 0 springing at its centre's height below the ground line, or a new `sphere`
   op if the lower half must show; the tall tower's pod is two `ring`s and a `dome`.
4. Set `easy_around_spawns_m`: the desert has no beach either, and the jungle's raptors are its only regions.
5. Keep `canopy` shares low or zero: almost nothing grows there, and NLCD's barren land is now bare ground.
