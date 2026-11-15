# Building a second city: what Tampa needed

Tampa was built from the same kinds of public data by the pipeline that built Miami, to find what in that pipeline is
Miami's. The first agent took about 45 minutes from its start to its last commit (11:17 to 12:01 local, 2026-11-15),
10 of them downloading; the reset stopped it before this page. Its successor merged main, applied the proof tools' change
(finding 17) and checked everything again on the merged branch. Tampa was not tuned: Miami's third round of ruins lands first and
Tampa inherits it.

```sh
bun tools/mapdata/city.ts tampa              # frame, fetch, prepare, attributes, future, fine, bathymetry, labels, ways, build
bun tools/mapworld/build.ts tampa            # only the map file, from what is committed: 16 s
bun run build && bun server/main.ts --dev --map var/maps/tampa.snmap --port 8799 --db var/tampa.db
```

## Beside Miami

| | Miami | Tampa |
|---|---|---|
| Map file | 76.9 MB, 15.3 MB gzipped | 91.3 MB, 21.5 MB gzipped |
| Build | 9.7 s to the file, 3.9 GB peak | 12.7 s to the file, 4.8 GB peak (6.3 GB maximum resident by `time -l`) |
| Footprints | 11,919 | 31,688 |
| Labelled with a kind and a height | 76% | 90%, but most heights are wrong (finding 9) |
| Blocks; buildings built | 1,188,264; 11,845 | 2,091,633; 31,542 |
| Busiest chunk (cap 1,000) | 1,000 | 939 |
| Mapped ways built | 809 of 809 | 590 of 591 |
| Land; walkable | 30.1 km²; 99.9% | 54.4 km²; 99.9% |
| Resource nodes; spawn regions | 121,892; 333 | 245,853; 282 |
| Walks | spawns 10 of 10, bridges 1,303/0, approaches 2,700/0, stairs 1,613/0, escapes 1,172/0 | spawns 10 of 10, bridges 866/0, approaches 2,392/1, stairs 1,349/0, escapes 967/0 |
| Server host ready | | 0.8 s, 1.0 GB resident; a real server listens in 1.9 s |

The one approach that fails: building part 114992556 (unnamed, at 1124, 5316) stops 24 m short of its target. 32
building cores have no street approach, 8 of them named (the University of Tampa's Technology Building, the Tampa Museum
of Art and others): `reports/ruins2/access-test.json`.

## Findings, in the order met

1. **Every data tool was Miami's.** `tools/mapart/common.py` fixes the folder to Miami's at import; county 12086 is in
   the TIGER file names; the NOAA Miami-Dade elevation index is a URL in the code; the feet-to-metres scale, the road
   widths and Miami Beach's sand ribbon (`xs > 3000`) are inline in `prepare.py`; Miami's broken spans and wrecks are
   code in `future.py`; `blocks/labels.py` and `ways.overpassql` carry Miami's frame. Made general as `tools/mapdata/`:
   the same steps, reading the map's `city.json` and `map.json`, and `city.ts` to run them in order. Miami can move
   onto it with a `city.json` of its own.
2. **No tool makes a frame.** Miami's `map.json` was written by no kept tool. `frame.py` makes it from a centre and a
   size. Tampa's centre moved from the brief's 27.955 N, 82.475 W to 27.9445 N, 82.469 W so that the square holds both
   Davis Islands' airport in the south and Raymond James Stadium in the north-west.
3. **The newest elevation was a different kind of source.** Hillsborough's newest lidar is USGS 3DEP
   (FL_HillsboroughPinellas_B24, flown January 2025, published 2026-11-02), found through The National Map's product
   API, not a NOAA Digital Coast index as Miami's: two source kinds in `fetch.py` now, and the vertical scale is a
   setting. It is 548 MB in 42 tiles, not kept in `raw/` after `prepare`, so running `prepare` again fetches it again.
4. **The lidar is hydro-flattened**: every sample is valid, water included (Miami: 71%). Nothing broke, because the
   world build takes water heights from the coastal model, but `height_valid.png` no longer means surveyed ground.
5. **The coastal model's file name was Miami's** in `tools/mapworld/base.ts`; it now reads the one GeoTIFF in
   `base/bathymetry`. Miami's own coastal-model tool was a map-art round-three script (`round3_bathy.py`), outside the
   documented process; `bathy.py` is its general form.
6. **The Python setup is not in git and macOS's own Python fails.** Python 3.9 as macOS ships it is linked to LibreSSL,
   which the Overpass servers refuse. A 3.12 environment from `tools/mapart/requirements.txt` works; it takes six
   seconds to make (`tools/mapdata/README.md`).
7. **Overpass is busy and Miami's queries held Miami's box.** The queries are templates now; `fetch.py` asks one server
   at a time, waits longer after each refusal, and moves to the next of three named in `city.json`.
8. **`fetch-attributes.ts` does not record its download** in `downloads.json`; it was added by hand.
9. **OpenStreetMap's Tampa heights are feet with no unit.** 29,891 Tampa buildings in OpenStreetMap carry a height,
   25,829 of them an imported figure with two decimals, and Miami's join reads a bare number as metres and lets it
   beat USA Structures. On the 25,350 footprints with both, the OpenStreetMap figure is 7.2 m higher at the median and,
   divided by 3.2808, matches USA Structures within 1.0 m on average; the difference does not follow the ground, so it
   is not roof elevation. Towers mapped by hand are metres and right (100 North Tampa 177 m; USA Structures says
   134 m). So single-family houses stand about 11 m tall, and 27,547 of Tampa's 31,542 ruins take the apartment recipe
   against 1,905 houses (Miami: 3,722 and 5,949): `reports/world1/worst-hyde-park-bungalows.png`. Miami's houses are
   metres in OpenStreetMap (5.2 m at the median against USA Structures' 3.9 m), so the bug never showed there. Left as it is, by the owner's word. A fix: in `labels.py`, read a bare height
   as feet when it is 2.6 to 4.2 times USA Structures', or a `height-corrections.json` as Miami has.
10. **USA Structures' classes map coarsely.** "Residential" with no OpenStreetMap kind becomes an apartment block and
    "Assembly" a theatre: 729 theatres in Tampa (churches and halls) against Miami's 105. The same rule as Miami's.
11. **The stadium had no footprint of its own name.** OpenStreetMap maps Raymond James Stadium as a point, so its
    footprint took the name of the Pirate Ship inside the bowl. `ruins/places.json` names it by hand, and the
    convention centre, both on Miami's layouts.
12. **The future world is authored per city.** Three broken spans (named by road) and three wrecks (by position) are
    hand-set in `city.json`. The canopy is made by a rule, because Miami's was traced from its paintings and Tampa has
    none. The `*_fine` layers are rasterized from the vectors (Miami's came from its painting references). Drowned
    streets by Miami's rule: 625 samples against 21,476; Tampa stands higher.
13. **Miami's block budget builds half of Tampa.** The vocabulary's city cap of 1.5 M blocks built 18,159 of Tampa's
    31,693 buildings; Tampa's vocabulary raises it to 4 M. The chunk cap of 1,000 was enough.
14. **A broken span must take both carriageways.** OpenStreetMap maps the Selmon Expressway's two carriageways 30 m
    apart, so the first 40 m gap broke one and left a deck standing in it; the gap is 90 m now. It also takes West
    Brorein Street's bridge beside it: three of its ways lose decks, and one (563727759) loses all of them and is
    reported "budget rejected", which is the status the layer gives a way with no pieces, not a budget.
15. **Districts and spawn points are typed by hand, and the districts cover little.** Eleven lon/lat rectangles, ten
    spawn points, the vocabulary copied from Miami's with Tampa's districts (40 lines added, 70 removed), and the sea
    and height settings copied unchanged. 20,200 of 31,542 Tampa buildings stand in no district (Miami: 1,205 of
    11,845). Downtown's rectangle had to be widened after the pictures to take in the convention centre and arena.
16. **The container port is found by its name.** `ground.ts` and `ruins.ts` look for a district called "The Port", so
    Tampa's port district is called that, and gets 3,521 container stacks.
17. **The proof tools were Miami's.** `bridge-walk.ts`, `access-walk.ts`, `ruin-walk.ts` and `server-bench.ts` wrote
    into Miami's report folder and read Miami's broken spans. They take the city from the map file's id now. With finding 5's
    `base.ts`, these are the generator's only changes on this branch. `walk.ts` and `views.ts` were already general.
18. **The pictures tool does not draw the far city.** `views.ts` predates it; `tools/map/cityviews.ts` draws what a
    client sees but has no spawn-point views. On the medium tier the city reaches 2,048 m, so from the middle of
    Hillsborough Bay (2.6 km) downtown is not drawn; on high it is (`reports/world1/farcity/`).

What carried over unchanged: the ground, colour, nodes, spawn regions, bridges and piers from `ways.json`, campuses in
wings, stairs and roof escapes, the far city, and the map file and server, at 1.8 times Miami's blocks.

## Still Miami's in the generator

Not needed for Tampa, so left: `build.ts` and `fetch-attributes.ts` default to Miami; `survey.ts`, `ruin-report.ts` and
`labels.ts`'s import write Miami's folders; the ruin pieces live in `content/miami-ruins.ts`; the static layer is logged
as "Miami ruins"; `statics.ts`'s `siteOf` defaults to Miami's folder. The work on `r9/miami-ruins` changes several of
these. When it lands, Tampa needs the settings it reads: `bathymetry` in `map.json` (`bathymetry/tampa-navd88.tif`),
and in `world/world.json` `bridgeGapLayer: "bridge_gaps"` (without it Tampa's three broken spans silently close),
`containerDistrict: "The Port"` and `ruins: { report: "ruins2", yardDistricts: ["The Port"] }`.

## For a third city by one command and a settings file

1. Miami onto `tools/mapdata` with its own `city.json`, and the Miami-only copies retired.
2. The port, the coastal model and the report folder as settings (under way on `r9/miami-ruins`).
3. A unit check of OpenStreetMap heights against USA Structures in `labels.py`, reporting a city whose ratio sits
   near 3.28.
4. Districts from OpenStreetMap's neighbourhood places, or a default district, and spawn points proposed from
   `places.json` (parks, named squares) for a person to accept.
5. The vocabulary split into the city-neutral rules and the city's own district table, and the block budget scaled to
   the footprint count.
6. A span named by road broken across every carriageway of that road, and a way with no pieces reported as such.
7. `fetch-attributes` recording its download, and the elevation tiles kept or their absence stated.
