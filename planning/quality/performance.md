# Performance

What the engine costs, measured, for someone asking whether it can take a scene,
a player count or a device. How a frame is drawn is in
[rendering](../architecture/rendering.md).

The sizing target is one world with 100 players, an 8 km map, 500,000 structures
and 30,000 creatures, 3,000 awake (D15). `bun run bench` builds it, prints every
row with its budget, writes `artifacts/bench.json` and exits non-zero on a miss.

## Where the numbers come from

"This Mac" is an Apple M5, 10 cores, 24 GB, macOS 26.3.1, Bun 1.4.3, with headless
Chrome 157 on ANGLE's Metal renderer for browser rows. "The iPhone" runs Chrome for
iOS 157 (so WebKit) on iOS 27.2.0 on 2026-11-15 and 27.2.1 on 2026-11-16: 4 cores,
390 by 844 at 3 device pixels a CSS pixel, touch-first so each tier is drawn by its
touch rule, ASTC, 24-bit depth, 16 texture units, no timer queries.

| Code | Run | Date | Commit |
| --- | --- | --- | --- |
| E | `bun run bench`, three runs at the end of the cleanup round, load 3.3 to 4.3 on 10 cores. Medians are from runs 1 and 3; tails (99th percentile, worst) are ranges over all three. Run 2 overlapped a device server starting | 2026-11-16 | `b98944ce` |
| Start | `bun run bench` once at the start of the same round; its later rows ran as builders started, so times there are high, counts not | 2026-11-16 | `b9896d20` |
| M | once on main, on a busy machine (load 7 to 39 on 10 cores) | 2026-11-15 | `1ca2026` |
| C | counts and bytes on Miami as built that day (`187f1213`, map version 5, with the cruise ship), on a busy machine (load 6 to 25), so no times | 2026-11-17 | `d45f43da` |
| Dnnn | the measurement its decision records | | |
| iPhone | the device page's reports (D349), kept in `planning/reference/device-reports` and named by UTC time, the three soaks the governor's tests replay in `tests/fixtures/device-reports` | 2026-11-15, 16 | |

Rows without a code are E. Counts and bytes do not move with load; times from M are
high and marked "busy".

## In short

- **The server** ticks in 3.6 to 3.8 ms of its 33.3 ms step at the median. Every
  server budget held in both quiet runs; the crowd and combat are nearest, 7.4 and
  7.3 ms against 8.
- **Bandwidth** is nearest its budget where many bodies move in view: 31.9 to
  32.4 KB/s a client against 34 to 36.
- **The client's frame build** in Bun has a median under 0.7 ms in every scene but
  a whole view of 2,048 bodies: 1.5 ms on medium, 2.2 on ultra.
- **A first load** waits for 655 KB at Brotli, held to 1,024. Through a tunnel the
  iPhone drew its first frame in 1.6 s and had full detail in 7.3 s.
- **The iPhone** on main holds 2.1 M triangles on medium and 1.4 M on high where
  Saturday's build held 4.5 M and 2.7 M: the world-surface finish costs it about
  3 ms a frame on medium and 5 on high. A governed soak on high holds 17 ms.
- **This Mac's GPU** spends 0.13 ms a megapixel on LIT and 0.38 with the world
  finish; the iPhone 3.5 and 4.5 times as much.
- **A map as it comes** (the map trip, Miami): the first frame at 8.4 s over 5 Mbit/s
  and 3.0 over 20; the far city only once every part has come, at 28.5 and 8.8 s.

## The cleanup round in the bench

At the start (`b9896d20`) 366 budgets were met and 5 missed; at the end 386 met and
1 missed in runs 1 and 3, with 156 rows more, most of them the governor's ladder and
the bases of real pieces. Run 2 also missed the dormant tick (6.17 against 5.96 ms)
and the collapse's whole tick (18.2 against 16).

The one miss is thatch's base: 2.18 M triangles 60 m from 2,000 pieces against the
1.5 M every base is held to (wood 0.67 M, stone 0.81 M). Four of the five misses at
the start are met: the collapse's whole tick (23.9 ms then), the entity store's slot
and full store (334 bytes and 167 MB then), and the 180 ms, 2% link's clock jumps
(3.75 a minute then, 2.5 now, against 3). The fifth, a kept soak replayed through
the old ladder, is replayed through the new one and holds.

| Row | Start | End | Budget |
| --- | --- | --- | --- |
| Tick at the target, median | 3.99 ms | 3.64 to 3.80 | 8 |
| Siege's damage, sent a client | 26.3 KB/s | 9.46 | 30 |
| Far cells sent a session in its first 20 s | 27.9 KB | 18.4 | |
| Near chunks held on joining, 100 ms with 1% loss | 1,400 ms | 750 | |
| Walking the wood on medium, frame build crossing a chunk border; not crossing | 0.90; 0.81 ms | 0.32; 0.19 | |
| The young wood at the iPhone's view: triangles; draws | 2.10 M; 496 | 1.27 M; 305 | 2 M; 1,024 |
| The elder stand, whole: triangles; draws | 5.83 M; 561 | 4.38 M; 389 | |
| 2,048 bodies on ultra, frame build median | 3.22 ms | 2.24 | 6 |
| Siege on high, triangles cast by cascade, nearest first | 1.77, 2.04, 0.51 M | 0.35, 0.23, 0.31 | |
| Small details, forty dodos on medium, a frame median | 0.045 ms | 0.011 | 0.25 |
| This Mac's GPU, the bench base on medium, a frame | 6.28 ms | 2.52 to 2.80 | |
| Live objects gained over 900 ticks | 2,912 | 3,635 to 3,648 | 5,000 |
| Added by working nodes and items | 0.20 KB/s | 0.26 | 0.3 |
| Brawl; siege; breeding base; crowd: tick median | 4.94; 5.49; 8.06; 7.13 ms | 5.30 to 5.51; 5.80 to 6.03; 8.39 to 8.67; 7.42 to 7.48 | 8; 8; 12.4; 8 |
| Collapse work a tick, median | 0.56 ms | 0.78 to 0.80 | 1.5 |
| A blast in a 2,000-piece base, median; worst | 0.047; 0.58 ms | 0.10; 1.25 to 1.29 | 1; 4 |
| History: a tick with 5,000 awake among 300,000 | 0.025 ms | 0.044 | 0.3 |
| ASTC on one core, a megapixel | 0.78 s | 1.49 to 1.51 | 2.5 |
| This Mac's GPU, forty hurt and dead dodos on medium, a frame | 1.77 ms | 2.73 to 2.80 | |

The first eleven rows got better and the rest worse. The blast's base is real pieces
now (D638), and the ASTC encoder works blocks of 4 to 8 pixels (D656), so those two
measure more than they did. Bandwidth (the fight 19.3 KB/s, a quiet base 13.0, the
brawl 32.0, the crowd 31.9, voice 28.7), far bases' and far nodes' counts, terrain
pictures, voice relay, paths, collision and rays moved by a few percent or not at
all.

## The server

### Tick and memory

| Row | Result | Budget |
| --- | --- | --- |
| Tick, median, 99th percentile, worst of 900 | 3.64 to 3.80, 4.54 to 6.34, 4.97 to 7.27 ms | 8, 16, 33.3 |
| Creatures awake; stepped through collision a tick | 3,072; 2,145 | |
| Commit every 6 ticks, median; 99th percentile | 0.14 to 0.15; 0.86 to 1.31 ms | 4; 10 |
| A checkpoint between ticks, median; worst | 3.5 to 4.1; 27 to 41 ms | 10; none |
| Live objects gained over 900 ticks | 3,635 to 3,648 | 5,000 |
| Process memory, server and scripted clients | 461 to 470 MB | 2,048 |
| Entity store: a slot; full at 524,288 slots | 188 bytes; 94.0 MB | 200; 128 MB |

### What a client is sent

| Row | Result | Budget |
| --- | --- | --- |
| 40-player fight; quiet base; upstream | 19.3; 13.0; 0.53 KB/s | 34; 16; 2 |
| Added by working nodes and items | 0.26 KB/s | 0.3 |
| Used-up nodes told within 6 chunks, everyone working; per node used up | 104.9 B/s; 583 B | |
| A hundred dodos dying in view: added to that second | 7,407 B | |
| Used-up nodes told on joining at the fight; at most | 330 B; 27.9 KB | |
| Brawl: 100 survivors and 400 creatures in an 18 m square | 32.0 KB/s | 36 |
| Crowd: every survivor and 2,000 creatures | 31.9 KB/s | 36 |
| Crowd: bodies shown to a client that asked for 2,048; that never asked | 871 of 1,024; 468 of 512 | |
| Breeding base, each survivor there | 32.4 KB/s | 34 |
| Siege: 50 pieces of a 20,000-piece chunk damaged a tick | 9.46 KB/s | 30 |
| A 1,512-piece house collapsing, each watcher, all of it | 2,373 bytes | 3,024 |
| Voice, 100 talking, each listener | 28.7 KB/s | 31 |
| The map's feeds | 0.009 KB/s | 0.5 |
| Far feed: first 20 s, mean and most; after; a siege watched, mean and most | 18.4, 19.0 KB; 0.004 KB/s; 0.12, 0.14 KB/s | none; 0.2; 2 |
| 300 creatures standing still | 1.68 KB/s | 2 |
| Prediction corrections; undecodable snapshots | 0; 0 | 0 |

On a modelled WebSocket the far feed delays no near chunk at any of six links, 50 ms
clean to 180 ms with 2% loss and a 60 KB/s line (D256). Losses and freezes by link
are in [networking](../architecture/networking.md).

### Load on the tick

| Row | Result | Budget |
| --- | --- | --- |
| Everyone striking nodes and moving items, median, 99th | 3.87 to 3.95, 5.06 to 7.11 ms | 8, 16 |
| 600,000 stored stacks: tick median; commit 99th; audit | 3.85 to 3.90; 0.59 to 1.23; 3.2 to 3.4 ms | 8; 10; 1,000 |
| 300,000 creatures, dormant, tick median | 5.40 to 5.54 ms | 1.5 × the 30,000's + 0.5 |
| Combat, 100 players shooting twice a second, median, 99th | 7.28 to 7.36, 10.5 to 10.8 ms | 8, 16 |
| Fly 2,000 arrows, median, 99th; a blast in a 2,000-piece base, median, worst | 0.54, 1.40 to 1.44; 0.10, 1.25 to 1.29 ms | 2, 4; 1, 4 |
| Brawl, median, 99th; siege, added to the tick | 5.30 to 5.51, 6.61 to 6.89; 0.15 to 0.19 ms | 8, 16; none |
| Siege: chunk writes in 10 s; commit median; commit writing the chunk | 10; 0.08 to 0.09; 0.75 to 2.89 ms | 11; 4; 10 |
| Collapse of 1,512 pieces: ticks to the last; work a tick, median, worst | 29; 0.78 to 0.80, 0.96 to 1.01 ms | 60; 1.5, 3 |
| The same: whole tick, worst; ask whether a piece stands | 12.8 to 18.2; 0.031 ms | 16; 0.1 |
| Voice: relay for a second of 100 talking; who hears whom, median, worst | 3.9 to 4.1; 0.22, 0.28 to 0.31 ms | 20; 0.5, 2 |
| Breeding base: tick median before and with it; 99th; look for pairs, median, worst | 7.96 to 8.13, 8.39 to 8.67; 10.2 to 15.9; 0.12, 0.16 ms | 1.5 × before + 0.5; 16; 0.5, 2 |
| Breeding base, worst tick while 150 females lay | 11.4 to 16.4 ms | 33.3 |
| Crowd, median, 99th | 7.42 to 7.48, 10.7 to 12.3 ms | 8, 16 |
| Far feed's share of a tick, 100 sessions; map bake of a 20,000-piece chunk | 0.013; 0.08 ms | 0.05; 0.5 |
| Spawning 300,000 in 10,000 regions: most made a tick; spawner once held | 66; 0.41 to 0.50 µs | 66; 50 µs |
| 500 hunters round a wall: path cells in the busiest tick | 1,000 | 1,000 |
| A hundred dodos killed at once: bodies made and laid; their falls, a tick, median, worst; ticks until all lie still | 0.92 to 1.04; 0.56, 0.62 ms; 31 | 15; 3, 10; 300 |
| The hundred at rest, worst tick; a swing's search among them; a blow's yield | 0.021 to 0.022; 0.023; 0.002 ms | 0.5; 0.05; 0.05 |

### Saves and starts

| Row | Result | Budget |
| --- | --- | --- |
| Save: 519,017 structures, 313,216 records | 65.9 MB | |
| Open, check and load the structures; load the entity records | 72; 231 to 234 ms | 3,000; 3,000 |
| Start a host on the save; under other settings; of that, bringing over; first commit after | 660 to 661; 684 to 696; 23 to 35; 455 to 491 ms | none; 5,000; 2,000; 5,000 |

A rule is read where it is used, so a 50x server ticks as one at ARK's defaults
(`--config config/boosted-50x`).

## The client in Bun

Core's frame build on this Mac's CPU, before the shell draws, on medium unless said.

| Row | Result | Budget |
| --- | --- | --- |
| 60 m from a 2,000-piece base of wood, stone, thatch: frame build, median | 0.071, 0.057, 0.058 ms | 1 |
| The same, 99th | 0.18 to 0.19, 0.074 to 0.076, 0.068 to 0.071 ms | 2 |
| The same: draws within 256 m; triangles | 28, 19, 47; 0.67, 0.81, 2.18 M | 300; 1.5 M |
| The same: cast into the sun's maps, triangles and draws | 49,688 in 16, 34,684 in 8, 76,724 in 16 | |
| Terrain tiles at the base; every base to the horizon drawn as pieces | 121; 709 draws, 2.60 M triangles | 200; none |
| 50 damaged pieces a frame of a 20,000-piece chunk: median, 99th; bytes uploaded again | 0.165 to 0.167, 0.20 to 0.22 ms; 0 | 1, 2; 0 |
| A 1,512-piece house falling: take in, worst; build median, 99th | 0.29 to 0.30; 0.075, 0.10 to 0.12 ms | 1; 1.5, 3 |
| 300 survivors in view: posed; median, 99th | 282; 0.62, 1.23 to 1.27 ms | none; 4, 8 |
| A hundred dodos falling in view: their bodies' share, median, worst | 0.074 to 0.075, 0.41 to 0.43 ms | 3, 16 |
| Coming upon the hundred: frames to lay them to rest; worst frame | 3; 4.2 to 4.3 ms | 30; 16 |
| 512 bodies of a breeding base: median, 99th; bones; triangles | 0.52, 1.76 to 1.90 ms; 12,852; 1.29 M | 4, 8; 16,384; 1.5 M |
| 2,048 bodies on ultra: posed anew of 2,048; bones; triangles, cast; median, 99th | 483; 63,877; 6.64 M, 1.44 M; 2.23 to 2.24, 2.98 to 3.00 ms | none; 65,536; none; 6, 12 |
| 2,048 on medium: posed, of them anew, standing on one bone; triangles, cast; median, 99th | 479, 176, 1,569; 3.11 M, 0.95 M; 1.47 to 1.48, 1.72 to 1.92 ms | none; none; 6, 12 |
| 500 creatures with materials: all textured after; as wide as shown after; draws | 0.12 s; 2.7 s; 2 | 1.5 s; none; 60 |
| The same with a hurt and decay layer, none hurt: frame build median; draws with a layer | 0.20 ms; 0 | 1.2; 0 |
| Its 40 nearest hurt or dead: frame build median; draws added, of them with a layer | 0.21 ms; 12, 6 | 1.2; none |
| A synthetic stress set over 20 Mbit/s (64 rocks of five levels and a 263,169-vertex plate): its boot file; first usable detail; the detail wanted | 0.30 MB; 1.12 s; 4.05 s | 1 MB; 1.5 s; 6 s |
| The same flying at 25 m/s: fetched over drawn; given up; left out | 1.00; 0%; 0 | 1.3; 15%; 0 |
| A 4 MB card: most held over budget; left out | 1.00; 0 | 1.25; 0 |

The game's own first load is under [sizes](#sizes). The texture encoders' quality and
speed are in [encoders](encoders.md).

**Two depth ranges** (D252). The split at 384 m lists 0.24% of draws twice round the
bench bases, 0.39% in a city of 81 built-up chunks and 0.67% with every base held
(2.9%, 11.2% and 0.07% at 256 m), and adds at most 0.03 ms to frame build.

**Terrain pictures** (D253). 9.46 MB on the card for 8 km, against 50.4 MB for one
pair of every sample. A window fills in 7, 4, 2 and 1 frames by tier. Flying 3 km at
600 m/s draws no tile coarser; at 3,000 m/s, 20. After a teleport the window is in
within 4 frames.

### Far bases (D257)

| Row | 130 base chunks within 2 km | 480 |
| --- | --- | --- |
| Far draws a frame on medium, mean (most) | 27.9 (34) | 61.4 (70) |
| Far triangles a frame, mean | 15,317 | 64,579 |
| Frames until every tile is made | 22 | 43 |
| The blocks' share of frame build, median, worst | 0.013, 0.023 ms | 0.014, 0.021 ms |

At 480 chunks: 17.7, 56.3, 61.3 and 61.3 far draws by tier. A castle's blocks are
324 triangles, the 2,000-piece pile 716.

### The far city

Miami's ruins with the cruise ship (C): 1,242,693 statics of the core's kinds in 7,567
chunks (`bun tools/bench/city.ts var/maps/miami.snmap`); the ship's and Koru's 4,298
are left out, as the far city leaves a landmark's. The map's columns and the far
city's hold 42.9 MB. In the browser a tile's levels are made on up to three workers,
one level a job (D647). Making a busy chunk's levels (the 200 with most pieces) took,
median and worst, every box 1.51, 7.85 ms; the lattice 1.07, 6.17; the bare lattice
0.71, 1.77; mass in 4 m cells 1.37, 6.59; in 8 m cells 0.58, 1.90 on a machine under
a load of 8 to 20 (M); those times want a quiet run.

The eight cameras of `assets/source/maps/miami/reports/farcity/views.json` at 1,920
by 1,080, the near window held whole, draws and triangles as listed in the packet, a
run across the split counted in both ranges (C). Before the far city could give they
were 161, 231, 317 and 368 draws, 599 k, 830 k, 1.41 M and 1.88 M triangles and 19.6,
23.9, 39.2 and 54.5 MB:

| | Low poly | Medium | High | Ultra |
| --- | --- | --- | --- | --- |
| Reach; every box, lattice, bare lattice, mass 4 m to | 2,048 m; 340, 600, none, none | 2,048 m; 400, 900, none, none | 3,072 m; 500, 800, 1,300, 2,000 m | 4,096 m; 600, 900, 1,800, 2,800 m |
| Draws, the most in a view | 120 | 187 | 313 | 341 |
| Triangles, the most in a view | 525 k | 753 k | 1.15 M | 1.40 M |
| On the card, the most in a view | 19.3 MB | 25.8 MB | 37.7 MB | 45.6 MB |

The most triangles are from the air over downtown (`air-handover` on low poly and
medium, `air-wide` on high and ultra), the most draws from the bay (`skyline-bay`) but
on medium from the street (`street-300`), and the most bytes on the card from the
street. Frame build in the slowest view was 0.36, 0.35, 0.45 and 0.34 ms (M, a busy
machine). A jump into downtown (`--jump`), its levels made as three workers on free
cores would make them, has every tile in view drawn in 11, 10 and 9 frames on medium
at `street-300`, `air-handover` and `air-wide`, 9, 13 and 13 on high and 8, 14 and 14
on ultra, where one worker in tiles of 3 by 3 took 49, 22 and 20, 48, 51 and 42, and
39, 57 and 44 (M).

### A real city's census

What each view of downtown Miami draws on each tier, the near window of 7 by 7 chunks
held whole and the far city drawing the rest, at noon (`bun tools/bench/census.ts
var/maps/miami.snmap`, C): the near city's draws, its draws into the sun's maps (a
caster once a cascade), and the far city's draws and triangles. Medium with the touch
rule is at the iPhone's 390 by 669, the others at 1,920 by 1,080; trees and rocks are
left out. `tests/unit/census.slow.test.ts` pins the first three views on a slice of
these statics with grey boxes for meshes, whose near columns are the built map's.

| View | Low poly | Medium, touch | Medium | High | Ultra |
| --- | --- | --- | --- | --- | --- |
| `street-300`, eye height looking west | 40, 0; 107, 344 k | 16, 10; 68, 186 k | 40, 22; 182, 540 k | 42, 50; 240, 675 k | 48, 56; 205, 748 k |
| `roof-300`, a 42 m roof by it | 37, 0; 100, 335 k | 21, 7; 79, 187 k | 39, 22; 161, 518 k | 39, 44; 232, 717 k | 47, 53; 248, 900 k |
| `air-300`, 150 m over the street | 48, 0; 109, 339 k | 22, 2; 64, 187 k | 48, 7; 173, 538 k | 48, 44; 229, 676 k | 50, 50; 191, 753 k |
| `air-handover`, 140 m | 20, 0; 112, 480 k | 3, 0; 73, 275 k | 20, 3; 180, 708 k | 20, 15; 288, 1.00 M | 20, 23; 265, 1.08 M |
| `air-wide`, 320 m | 4, 0; 108, 424 k | 5, 0; 75, 227 k | 5, 0; 166, 702 k | 5, 2; 283, 1.14 M | 5, 4; 297, 1.39 M |

Before the far city could give (main at `d1ba7ca3`) its draws and triangles were, by
column: `street-300` 140, 404 k; 86, 273 k; 226, 580 k; 237, 844 k; 246, 1.09 M, and
`air-wide` 150, 450 k; 95, 353 k; 209, 801 k; 291, 1.39 M; 357, 1.86 M. Leaving
chunks out of a fade they keep nothing of took 9 to 15% on medium, the touch rule's
nearer levels 25 to 36% on the phone's view, the bare lattice 13 to 27% on high and
ultra, the fade between cell sizes put 0 to 7% back on, and tiles of 4 by 4 took a
fifth to a third of the draws for 0 to 6% more triangles.

The near city's triangles at `street-300` are 83 k, 36 k, 97 k, 117 k and 142 k by
tier; with grey boxes they are 68 k on every tier but the touch rule's 30 k, so what
grows with the tier is the art's levels.

The device page's terrain flight over Miami before the yacht was berthed (`bun run
device -- --self terrain --terrain --map var/maps/miami.snmap`, headless Chrome on
this Mac, main at `bba5a236`, run `b6f93f84`; 60 m up at 100 m/s with a jump of 2 km
or more every 10 s) held 16.7 ms on medium and low poly: the far city 47 and 40
draws and 77 k and 65 k triangles a frame (median), at most 1.4 and 1.6 ms of the
page's time in a frame, and after each jump 2 to 5 and 2 to 6 frames before no tile
in view was unmade.

### Far trees, rocks and bushes (D353, D354)

The bench map's wood, every slot filled, from its middle: `core:tree`, `core:rock`
and `core:bush`. Budgets in brackets (round 8 plan, "Budgets per tier").

| | Low poly | Medium | High | Ultra |
| --- | --- | --- | --- | --- |
| Reach of trees, rocks, bushes | 417, 0, 0 m | 1,092, 565, 151 m | 1,836, 867, 252 m | 2,763, 1,166, 302 m |
| Draws a frame, mean (most) | 8.3 (10) | 106.6 (145) | 160 (201) | 238 (279) |
| Triangles in view and reach (budget) | 37 k (39 k) | 314 k (315 k) | 881 k (900 k) | 1.97 M (2.0 M) |
| Tiles held | 30, 0.7 MB | 108, 2.9 MB | 252, 6.6 MB | 522, 13.0 MB |
| Share of frame build, median; worst crossing a chunk border | 0.016; 0.34 ms | 0.038; 0.72 ms | 0.066 ms | 0.090; 0.60 ms |

The border budget is 2 ms.

### Sun shadows (D313, D652)

Under a sun 10 degrees up, which stretches casters furthest.

| | Medium | High | Ultra |
| --- | --- | --- | --- |
| Bench base: caster entries, mean (most) | 25.6 (42) | 26.4 (49) | 29.0 (47) |
| Siege: caster entries, mean (most) | 440 (558) | 449 (560) | 509 (639) |
| Siege: caster draws over every cascade, mean | 489 | 788 | 1,075 |
| Siege: triangles by cascade, nearest first | 0.40, 0.26 M | 0.35, 0.23, 0.31 M | 0.41, 0.27, 0.25, 0.34 M |
| Siege: bodies posed for their shadows alone | 67.5 | 75.2 | 90.1 |
| Siege: what casters add to frame build | 0.13 ms | 0.16 ms | 0.18 ms |
| All 81 near chunks built up to 30 m, made up: entries | 1,850 | 3,412 | 4,295 |

The list holds 4,096 entries; no real scene has passed 639.

### Small details

Their own work (reading what bodies did, making bursts, moving particles, writing the
packet).

| | Medium: forty dodos landing 5 to 25 m off | Medium: a hundred going down within 40 m | Low poly: forty | Low poly: a hundred |
| --- | --- | --- | --- | --- |
| Median frame | 0.011 ms | 0.017 to 0.018 ms | 0.007 ms | 0.007 ms |
| Worst of 600 | 0.15 to 0.16 ms | 0.46 to 0.48 ms | 0.10 to 0.12 ms | 0.12 ms |
| Particles alive at most (pool), drawn at most | 311 (1,536), 254 | 729 (1,536), 608 | 154 (384), 125 | 319 (384), 264 |
| Bytes sent at most | 12.9 KB | 30.9 KB | 6.3 KB | 13.4 KB |
| See-through fill at most | 0.02 screens | 0.52 screens | 0.01 | 0.28 |

Two draws a frame at most, two triangles a particle.

### The frame's budget

Forty bodies, survivors swinging and their tames running, 4 to 34 m in front of the
camera, in the device page's young wood and elder stand on medium at the iPhone's
view (390 by 669 CSS pixels, 70 degrees), eight headings, each settled 150 frames;
levels taken as drawn with their materials. Medium allows 2 M triangles and 1,024
draws.

| | Young wood | Young, 40 bodies | Elder stand | Elder, 40 bodies |
| --- | --- | --- | --- | --- |
| Triangles a heading whole, mean (most) | 1.27 M (1.33) | 1.34 M (1.40) | 4.38 M (4.47) | 3.92 M (4.01) |
| As the budget draws it, mean (most) | 1.27 M (1.33) | 1.34 M (1.40) | 1.90 M (2.00) | 1.89 M (1.99) |
| Crowns near, whole and as drawn | 0.54, 0.54 M | 0.54, 0.54 M | 3.55, 1.05 M | 3.01, 1.00 M |
| The squeeze, mean | 0 | 0 | 2.03 | 2.27 |
| Bodies' triangles, whole and as drawn | | 69 k, 69 k | | 69 k, 69 k |
| Headings whose bodies' levels moved | | 0 of 8 | | 0 of 8 |
| Draws a heading, whole and as drawn | 305, 305 | 319, 319 | 389, 368 | 414, 369 |
| Cast into the sun's maps, as drawn | 0.28 M in 196 draws | 0.32 M in 234 | 1.61 M in 341 | 1.65 M in 379 |
| Frame build, median | 0.13 to 0.15 ms | 0.17 to 0.20 ms | 0.13 to 0.18 ms | 0.22 ms |

The rest of the elder's frame as drawn: ground and far 0.42 M, trunks 0.31, rocks
0.11, bushes 0.02.

### The governor (D659 to D661)

The bench counts what each level of the governor's ladder leaves with the touch rule
at the iPhone's view: the scenes of its two kept soaks as the device page stands them
(the core's rocks in the stress pack's places), and the budget's woods with forty
bodies; then what that frame would take the iPhone's GPU at full clock (`workMs` and
`PHONE_MS` in `governor.ts`: 6.5 ms a million drawn triangles, 1.8 or 3.8 a million
cast into 1,024 or 2,048 maps, 5.8 µs a draw; and 1.3 ms a megapixel with each tap of
the shadow filter's cost added). On high, triangles and cast in millions, then the
phone's ms:

| Level | 200 bodies, 1,024 pieces | 800 bodies, 64 rocks | Young wood | Elder stand |
| --- | --- | --- | --- | --- |
| The tier | 0.354, 0.164; 5.23 | 0.358, 0.153; 5.07 | 2.186, 0.724; 21.4 | 3.891, 5.021; 41.5 |
| 1 Levels, half again the error | 0.296, 0.164; 4.81 | 0.305, 0.152; 4.69 | 1.969, 0.724; 19.9 | 3.767, 5.021; 40.6 |
| 2 Leaves to 75% | passed by | passed by | as level 1 | 2.910, 5.021; 34.9 |
| 3 The farther cascade every other frame | 0.296, 0.138; 4.68 | 0.305, 0.113; 4.55 | 1.969, 0.620; 19.2 | 2.904, 4.840; 34.0 |
| 4 Levels, twice | 0.261, 0.137; 4.51 | 0.267, 0.110; 4.33 | 1.766, 0.620; 17.8 | 2.919, 4.840; 34.1 |
| 5 Far trees, rocks and bushes to 70% | as level 4 | as level 4 | 1.457, 0.620; 15.7 | as level 4 |
| 6 Leaves to 50% | passed by | passed by | as level 5 | 1.944, 4.840; 27.3 |
| 7 Levels, three times | 0.187, 0.136; 4.04 | 0.222, 0.109; 4.05 | 1.138, 0.620; 13.5 | as level 6 |
| 8 One cascade fewer | 0.187, 0.083; 3.78 | 0.222, 0.070; 3.85 | 1.138, 0.236; 12.2 | 1.943, 1.007; 19.5 |
| 9 Bodies a level coarser | 0.162, 0.078; 3.59 | 0.181, 0.065; 3.56 | 1.113, 0.232; 12.0 | 1.938, 1.003; 19.5 |
| 10, 11 85% and 70% of the pixels | 3.20, 2.87 | 3.16, 2.83 | 11.6, 11.3 | 19.1, 18.7 |
| 13 No sun shadows | 0.162, 0; 2.43 | 0.181, 0; 2.51 | 1.113, 0; 9.78 | 1.938, 0; 15.5 |

On medium the tier's 3.86, 3.73, 13.3 and 20.9 ms come to 1.93, 1.94, 6.58 and 8.10
at the last level. Level 12, the small details halved, changes nothing here: none of
these scenes has a burst. The iPhone's kept soaks replayed through the governor, each
level leaving the share it leaves in the soak's scene:

| Soak, high | Minute 10 without the governor | With it: minute 1, minute 10, the level at minute 10 |
| --- | --- | --- |
| `07-47`, 200 bodies, 1,024 pieces | 27 ms | 16.7, 16.7, 10 (0.61 of the GPU's time) |
| `08-23`, 800 bodies | 24 ms | 16.7, 16.8, 9 (0.70) |
| `08-03`, the wood | 22 ms | 20.5, 16.7, 8 (0.56) |

None stepped back up while it warmed. The phone's own governed soak is under
[the iPhone](#the-iphone).

## The GPU, by pass

The device page's quick look times each program full screen by the slope of time
against passes drawn, and each kind of draw through the renderer's executor, k of the
frame's draws by turns. The iPhone's is `2026-11-16T20-11` (canvas 585 by 1,003); this
Mac's is `bun run device -- --self` on main, run `bd71dda8` (750 by 1,267), by the
same slope. Milliseconds a megapixel unless said:

| Pass | iPhone | This Mac |
| --- | --- | --- |
| FLAT | 0.144 | 0.048 |
| LIT; hazed at 500 m; at 3.5 km | 0.469; 0.607; 0.778 | 0.134; 0.166; 0.212 |
| LIT with the world finish, near; in its fade band | 1.704; 1.704 | 0.381; 0.395 |
| LIT shadowed; on the sea; far | 0.852; 0.597; 0.565 | 0.211; 0.166; 0.151 |
| SURFACE undyed: never drops; drops | 0.639; 0.639 | 0.184; 0.202 |
| SURFACE dyed: never drops; drops; with a hurt layer | 0.788; 0.778; 0.852 | 0.204; 0.212; 0.241 |
| Dome: table; sun, moon, stars; one cloud layer; two | 0.357; 0.458; 0.714; 0.98 | 0.088; 0.116; 0.182; 0.235 |
| Sea, calm and with waves | 0.98, 1.065 | 0.246, 0.27 |
| Compared taps: 1, 4, 9 | 0.063, 0.186, 0.458 | 0.020, 0.069, 0.145 |
| Depth, a 100,000 triangles: rigid and skinned at 1,024; at 2,048 | 0.181, 0.187; 0.349, 0.355 | 0.060, 0.061; 0.104, 0.108 |
| µs of main thread a draw: textured, skinned, far, flat, caster | 0.39 ± 0.14, 0.29 ± 0.17, 0.29 ± 0.17, 0.29 ± 0.17, 0.39 ± 0.14 | 0.29 ± 0, 0.19 ± 0.03, 0.18 ± 0.04, 0.20 ± 0, 0.23 ± 0.01 |

The phone's page clock counts whole milliseconds, so its five kinds of draw agree
within their errors: 0.3 to 0.4 µs of main thread a draw. The young wood on medium is
3,359 GL calls a frame (D668). The probes whose programs did not change read the
same on both days and both iOS versions, within 6%: FLAT 0.152 and 0.144, and LIT
0.469, far 0.565, the dome's table 0.357 and depth at 1,024 0.181 on both
(`2026-11-15T07-35` and `2026-11-16T20-11`), so neither the phone nor its update
moved the ladder.

On this Mac, by timer query in the bench (a GPU shared with the desktop, so a scene
can read up to twice as much run to run), the game's frame takes 2.5 to 2.8 ms at the
bench base on medium and 3.4 to 3.8 on high; 3.8 to 3.9 in the wood on medium and 5.2
to 5.7 on high; 2.7 to 2.8 ms round forty hurt and dead dodos on medium and 4.7 to
5.1 on ultra. The device page's crowd casts sun shadows for 1.2 ms of GPU on medium,
1.5 on high and 1.8 on ultra (run `bd71dda8`). The far fade keeps 50.0% of a wall
halfway through it, as its rule says, on both devices.

### What a timer query reads on this Mac

Through ANGLE's Metal renderer a timer query counts the time of the card's work that overlaps the frame's, not the
frame's own: a frame of many render passes, or one the card starts while the last is still drawing, reads long. A
page of its own (one full-screen pass drawn n times, then the same split over render targets), each frame waiting for
the card by reading a pixel back, showed it on 2026-11-18: one pass of 4.7 ms by query, four of them 42 ms by query and
22 to 27 ms on the page's clock at 21.8 to 27.5 ms a frame, and forty small passes over two targets 34 ms by query
against 19 ms on the clock and 19.5 ms a frame. A frame's time cannot pass the time between frames that the clock
shows, so the query over-read by up to twice. In the game the light target's frame (high and ultra, its resolve,
bloom's nine passes and the finish) read 13.7 ms by query on high at Miami's street and 11.4 to 11.8 ms on the page's
clock, which counts the browser's encoding as well; bloom, five ms by query, cost 0.1 to 0.2 ms on the clock. Every
figure taken by query before that day, of the light target above all, is the query's and reads high.

`bun tools/bench/gpu.ts` therefore gives each city row on the page's clock as well (`?sync=1`: the frame from its
first mark until a pixel of the canvas comes back, which waits for the card), and an effect's cost by turning it off
every other frame (`?ab=`) and taking each such frame against the frames either side, which other work on the card and
the turning view move little: two runs a minute apart on a shared machine read the same within 0.1 to 0.3 ms this way,
and up to 15 ms apart by whole runs on ultra. A pass cannot be timed on the clock where it draws into a target of the
shell's: the read waits only for what the canvas depends on.

On the card on any device: terrain on 8 km 9.46 MB; the sky table 256 KB; the sun's
shadow maps 16, 24 and 32 MB on medium, high and ultra, 4 and 6 MB on medium and high
by the touch rule (`shadowBytes` in `shadowtext.ts`).

## The iPhone

`bun run device -- --tunnel`, the reports in `planning/reference/device-reports` and the soaks in `tests/fixtures/device-reports`.
D271's GPU questions hold on both days: `depthRange` is honoured; a 16-bit depth array
renders and compared lookups filter; an RGBA8 3D texture filters. D1's seam leaves no
clear pixel over 60 turning frames (87 with the far range starting at the split
itself).

**The ladder** (D246): a rung holds while its median frame is within 1.12 times the
display's 17 ms and its 95th percentile within 1.5 times. The most each run held,
triangles as drawn at that rung:

| Build, run | Medium triangles | Medium draws | High triangles | High draws | High bodies | Ultra bodies | Ultra triangles |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Saturday, iOS 27.2.0 (`2026-11-15T07-43`, `08-19`) | 4.53 M | 1,024; 2,048 | 2.69 M | 1,024 | 2,048 | 800 | 1.59 M; 0.93 M |
| The round's start, `b9896d20` (`2026-11-16T20-38`) | 3.21 M | 1,024 | 0.94 M | 512 | 800 | 200 | none |
| Main, `b98944ce` (`2026-11-16T20-14`) | 2.11 M | 1,024 | 1.44 M | 512 | 1,600 | 50 | none |
| Main with the world finish off (`2026-11-16T22-10`) | 4.41 M | 1,024 | 2.70 M | 1,024 | 2,048 | 400 | 1.70 M |
| The light finish under the touch rule, `cdb10415` (`2026-11-16T23-08`) | 3.19 M | 2,048 | 2.70 M | 1,024 | 2,048 | 100 | 0.55 M |

The world finish landed on the evening of the 15th, after Saturday's runs. At the
same rungs, main's frames took 20 ms on medium (3.15 M triangles) and 22 on high
(2.70 M) where with the finish off they held 17: the finish costs this phone about
3 ms a frame on medium and 5 on high, and the quick look puts LIT with it at 3.6 times
LIT without it (1.704 against 0.469 ms a megapixel). Low poly held on main what it
held on Saturday: every rung of bodies, triangles (2.67 M) and pieces, and 2,048
draws. In the round's start and finish-off runs a few rungs of low poly, and
medium's first body rung with the finish off, broke on a 95th percentile of 36 to
99 ms with their median at the display's rate.

With the light finish (D687) high is back at Saturday's on every axis. Medium holds
3.19 M triangles where main broke, and at 4.41 M takes 20 ms where the finish off
held 17 and Saturday held 4.53 M at 18: the light finish still costs about 3 ms at
that rung, which is past the tier's 2 M budget. The quick look (`2026-11-16T23-06`)
puts LIT with the full finish at 1.363 ms a megapixel near (it was 1.704) and with
the light finish at 0.852, against LIT at 0.469.

Pieces hold far more than on Saturday: on main medium and high held all 4,096 (0.87
and 1.47 M triangles) where Saturday's high never settled, and ultra 256. The rungs
added or changed since Saturday (D638), on main:

| Rung | Low poly | Medium | High | Ultra |
| --- | --- | --- | --- | --- |
| A box base 10 m off of thatch, wood and stone rooms, 409, 673, 937 pieces | 937 held | 937 held | 937 held, 1.36 M triangles | 409 held, 673 broke |
| Parked cars, helicopters and boats: 3, 12, 48, 192 | 192 held | 192 held | 192 held, 1.22 M triangles | 12 held, 48 broke |
| Bodies, now copies of the crowd dressed and some riding | 2,048 held | 2,048 held, 1.81 M triangles | 1,600 held, 2,048 broke | 50 held, 100 broke |

**Memory.** The ladder's last step holds the device page's own ASTC textures, made up
for the test, with none of the game's (the report's `gameMB` is 0), and raises them
until the tab goes. On main it held 1,536 MB and the browser reloaded the page at
2,048, as on both of Saturday's runs; the round's start and the finish-off run held
2,048 MB and were reloaded at 3,072; on 2026-11-14 (`23-37`) the same phone held all
4,096 MB beside the game's 144. So the step says how much this phone's browser let a
tab hold that hour, not what the game holds. The game's ASTC at every texture's top
step is at most 507 MB on high and 152 on medium (D655), and high on a touch-first
device has a 1 GB card (D612).

**First load.** The quick look through the tunnel (`2026-11-16T20-11`, a request 97 ms
there and back) drew its first frame at 1.6 s and had full detail at 7.3 s, fetching
3.0 MB of page and 2.65 MB of assets and reading 0.8 MB from the asset cache.

**The governed soak** (`2026-11-16T20-19`, the first on a phone): ten minutes on high
with three cascades, 800 bodies, 2,048 pieces, 32 rocks near and 256 far, the scene
turning once a minute. Minute 10 held 17 ms with its 95th at 18 and the governor at
the tier. Its steps, minutes and seconds in:

| At | To | The frame then |
| --- | --- | --- |
| 0:17, 0:20 | 1 levels half again the error; 3 the farther cascade every other frame | 19 ms |
| 0:45, 0:48 | 4 levels twice; 5 far trees, rocks and bushes to 70% | 19 ms |
| 0:58, 1:03, 1:18 | 7 levels three times; 8 one cascade fewer; 9 bodies a level coarser | 20, 19, 18 ms |
| 1:49 | 10 85% of the pixels a side | 18 ms |
| 3:01 to 4:43 | back a level at a time to 0, each "a lighter scene" | 17 ms |

In each of its first two minutes 60 and 57 frames took three display intervals or
more, the 99th percentile 102 ms; from minute 3 none did, and from minute 5 every
minute's median was 17 ms and its 95th 18.

**Soaks without the governor**, ten minutes on high with three cascades on Saturday:
with 200 bodies and 1,024 pieces the median frame climbs from 17 to 27 ms and the 95th
from 21 to 36 (`2026-11-15T07-47`); with 800 bodies, 17 to 24 ms (`08-23`).

**Terrain flight** on the 8 km map (`2026-11-15T07-57`): a window's refill frames are
1.18 times a plain frame on medium and 1.06 on low poly; 480 far base chunks hold.

## Sizes

`bun run build` ends with the census (`tools/sizes.ts`); here on `46f0ca4b`, 2026-11-16.
A build fails only on a row with a budget: what every player waits for before the first
frame (D681), and waste the build can always avoid. The files streamed when wanted grow
with the catalogue and are printed, not held; each asset is held to its own budget by
`bun run art -- --check`.

| Row | Size, Brotli unless said | Budget |
| --- | --- | --- |
| The page's script; the content; the manifest (raw) | 316 KB; 23 KB; 9.8 KB (65 KB) | |
| The boot pack | 174 KB | |
| Everything before the first frame | 636 KB | 1,088 KB |
| The same on Miami, with the yacht's manifest and boot file (15 KB) | 651 KB | 1,088 KB |
| The page file; the mesh file; the clip file | 538 KB; 19.6 MB; 118 KB | |
| Textures to 1,024, ASTC and BC; to 2,048 | 124.8, 229.5 MB; 337.8, 572.4 MB | |
| The world's finishes to 1,024, ASTC and BC | 1,498, 3,039 KB | |
| The RGBA texture file; textures with a 2,048 step | 335.8 MB; 139 | |
| The sound file; its rate | 3,503 KB; 39.0 kbit/s | ; 42 kbit/s |
| Music | 39.5 MB | |
| Sound takes and ASTC texture steps stored twice; mesh parts stored twice | 0, 0; 394 | 0, 0; none |

The wiki (`bun run wiki`: 717 files, 3.6 MB) holds its front page, its heaviest page
and a list page to 300 KB each before they scroll: 193, 286 and 251 KB.

## A built city on this Mac's GPU

`CLIENT_DIR=client/dist bun tools/bench/gpu.ts 1 city` on 2026-11-17, main at `89dcb425`
(the near city as a mesh a chunk, D743, and the far city of D745 to D747), Miami
`e14fd066`: the game's own page in headless Chrome on ANGLE's Metal renderer, the
survivor held at the census's street and 140 m over downtown, the view turning. One
pass at load 4 to 8, so a tail is not quoted; counts do not move with load.

| View, tier | Device pixels a CSS pixel | GPU, ms a frame | GL draws | Triangles |
| --- | --- | --- | --- | --- |
| Street, medium | 1; 1.5 | 4.6; 4.2 | 770 | 1.19 M |
| Street, high | 1; 2 | 5.6; 6.9 | 1,521 | 1.90 M |
| Street, ultra | 1; 2 | 5.1; 7.5 | 2,372 | 2.97 M |
| Air, medium | 1; 1.5 | 5.5; 6.3 | 262 | 0.90 M |
| Air, high | 1; 2 | 4.9; 9.3 | 875 | 1.50 M |
| Air, ultra | 1; 2 | 5.5; 10.2 | 1,460 | 2.24 M |

With the sun's shadows off the street on medium is 4.3 ms and 508 draws, and with the
far layers off 3.9 ms, 543 draws and 0.56 M triangles; on ultra at two device pixels
6.3 ms and 1,308 draws, and 6.1 ms, 1,891 draws and 1.35 M triangles. From the air on
ultra at two device pixels: 8.8 ms and 803 draws without shadows; 7.3 ms, 1,005 draws
and 0.56 M triangles without the far layers. Before D743 and D745 the street made
1,592, 2,506 and 3,513 GL draws on medium, high and ultra (the review's runs,
`planning/reference/review-maps-2026-11-17.md`).

Again on 2026-11-17 at main `ff083a5c`, after the lit ground (D749, D750), the far sun shadow (D754), anisotropic
filtering and ultra's canvas (D759), on Miami `0f4341ce` (map version 8): three passes, of which the first ran at
load 6 to 8 and is given; the street's rows stayed at that load through all three and their spread follows in
brackets, and the air's later passes ran at load 22 to 32 and are left out. On a window of one device pixel ultra
now draws 3,840 by 1,986, the canvas its second column had before.

| View, tier | Device pixels a CSS pixel | GPU, ms a frame | GL draws |
| --- | --- | --- | --- |
| Street, medium | 1; 1.5 | 6.7 (3.7 to 6.7); 5.3 (4.9 to 6.9) | 770 |
| Street, high | 1; 2 | 7.0 (5.0 to 7.0); 7.8 (7.3 to 7.8) | 1,519 |
| Street, ultra | 1; 2 | 8.1 (8.1 to 8.7); 8.2 (8.2 to 8.5) | 2,410 |
| Air, medium | 1; 1.5 | 6.2; 6.4 | 234 |
| Air, high | 1; 2 | 5.8; 10.2 | 929 |
| Air, ultra | 1; 2 | 11.7; 11.9 | 1,464 |

One pass of the page's GPU timer swings by 2 ms on this machine when another browser is drawing, so only the rows at
two device pixels say anything against the table above: from the air they are 0.9 ms higher on high and 1.7 on
ultra, at four times the pixels. GL draws are as they were but for the air on medium (234 where 262) and on high
(929 where 875). A change is judged by alternating runs with and without it, four each way (D754 was).

## A map as it comes

`bun tools/map/trip.ts --map var/maps/miami.snmap` on 2026-11-17: the built Miami, an everyday build at version 8,
from a server of the tool's own behind a link of its own held to 5 or 20 Mbit/s with 100 ms there and back, shared by
every connection a slice at a time and pushing back on the server as TCP does; headless Chrome 157, muted, from an
empty cache, at `?trip`, which only watches. The body joins on the map's thickest street (6944, 2976, downtown); goes
300 m up once the street is drawn or a third of the map has come; jumps, once the far city is drawn or two thirds have
come, to the thickest street 4 km away (6176, 6880), whose sector's ground is answered 503 at its first ask. Seconds by
the page's clock, one run each on a busy machine (load 4 to 30 on 10 cores). "Main" is `ebd2b240` with the trip's
probe; "now" is the loader that asks again, of the maps round's step 3G. Pictures of each moment are in `var/maps-round/3g-trip`.

| Moment | 5 Mbit/s: main | 5 Mbit/s: now | 20 Mbit/s: main | 20 Mbit/s: now |
| --- | --- | --- | --- | --- |
| First frame | 8.60 | 8.32 | 3.15 | 3.04 |
| Before it: the map's files, as the build's rule names them there | 8, 3.37 MB | 8, 3.37 MB | 8, 3.37 MB | 8, 3.37 MB |
| Up 300 m (share of the map come) | 11.77 (35%) | 11.21 (34%) | 3.98 (36%) | 3.86 (34%) |
| The jump: made by the server (share come); drawn by the page | 19.57 (67%); 25.66 | 18.93 (67%); 21.35 | 6.13 (68%); 6.19 | 6.00 (67%); 6.13 |
| Last part | never | 28.03 | never | 8.39 |
| Statics handed over | never | 28.09 | never | 8.46 |
| Far city drawn | never | 28.47 | never | 8.76 |
| After the jump: predicted again; ground exact | never; never | at once; at once | never; never | at once; at once |
| After the jump: the street there drawn with its materials | 12.03 | 30.83 | 8.72 | 17.67 |
| The failed part | asked once, never came | came at its second ask | asked once, never came | came at its second ask |
| At the end | 126 of 127 parts; no far city | whole; far city of 1,246,991 pieces | 126 of 127; no far city | whole |

The street the body joined on is drawn with its pieces and materials only after the map has come: with the body kept
there (an earlier run of the trip that went up only then), at 50.6 s on main and 49.9 now at 5 Mbit/s, 25.4 and 22.9 at
20. Without the failure at 20 Mbit/s main hands the statics over at 8.52 s and draws the far city at 8.87.

At 5 Mbit/s the page draws the jump 2.4 to 6.7 s after the server makes it (three runs of this loader, one of main's):
the game's socket has a thirteenth of a line that twelve requests of the map and the assets share, so its rows and
snapshots wait. By then the ground there has come, so prediction does not stop. On main the sector whose ground failed stays the overview's for good: prediction never
runs there, and the statics are never handed over, so the far city never comes. Now the failed part is asked for
again 0.5 s later and comes. The street there is drawn later now than on main, where no far city was made to compete
with its assets.

The page's map memory at the statics' hand-over, after a full collection, at 20 Mbit/s with no failure: 56.0 MB of
heap and 198.5 MB of arrays on main, 54.5 and 132.3 now. Counted in Bun on the same parts, what the loader and the
handed statics hold falls from 140.7 MB to 74.7: each sector's decoded ground (49.7 MB on Miami) is let go once copied,
and the statics' bytes (16.2 MB) once read, where main's resolved promise kept them for the page's life.

The build's figure is the page's: at the trip's street 8 files and 3.37 MB on Miami, and on Los Angeles (`--map
var/maps/los-angeles.snmap`, at 7136, 352) 7 and 2.75 MB, as the rule says there; the heaviest place is 3.69 MB on
Miami and 3.36 on Los Angeles.

## Cast's people (2026-11-21, Linux, i9-13980HX x32)

`bun tools/bench/cast.ts`: four survivors on flat ground, a beach crowd of Cast's people walked in from out of sight
(240 s), then 60 s measured, against the same world with Cast off; then a shot in the middle of the beach and the
stampede's first 20 s.

| Row | Cast off | Cast on | Budget |
| --- | --- | --- | --- |
| Tick, median; 99th | 0.05; 0.16 ms | 0.42; 0.79 ms | 8; 16 |
| Sent to each survivor | 1.7 KB/s | 4.5 KB/s | 34 to 36 |
| Cast's bodies in the world, most; lying or sitting; moving | 0 | 211; 187; 17 | 200 a crowd (CastCrowdMax) |
| The stampede: tick median; 99th; sent to each | | 0.61; 1.18 ms; 32.3 KB/s | 8; 16; 34 to 36 |

The first run of this bench (0.26 ms, 21.3 KB/s) flattered: a review found most of the crowd still moving, its walks
cut short by a step limit too short for the walk in, and those standing wandering. With both mended the crowd lies
about, and a crowd that all runs is now measured too: within the bandwidth budget, but near it.

On Miami's built map (16.3 km a side) with one survivor at the spawn, Cast enabled at activity 1.5: a region's spots read
in under a millisecond, 298 stories planned over three minutes, 15 bodies at once, and the tick at 0.80 ms median, 3.74
ms 99th, 7.3 ms at worst. Most of the crowd lies or sits (an emote held), which is what keeps it this cheap; a crowd that
all walked would cost more and has not been measured.

## Where the limits are

Reasoned from the rows, in the order a growing world meets them.

| Limit | Today | What would move it |
| --- | --- | --- |
| A phone's GPU | On main 2.1 M triangles on medium and 1.4 M on high at 60 Hz, the world finish taking about 3 and 5 ms a frame; 1,024 draws on medium | A cheaper world finish; the governor |
| One thread runs the tick | 3.6 to 3.8 ms of 33.3, 7.3 in combat | Snapshot encoding in workers over the typed-array entity store |
| Bandwidth where bodies crowd | 31.9 to 32.4 KB/s of 34 to 36 | Velocity in snapshots |
| Draws | 4,096 in the packet; the iPhone held 1,024 on medium and 512 on high | Texture arrays before multi-draw (D210) |
| Shadow casters | 639 of 4,096 entries in the siege on ultra | Merged casters cached by shape (D267) |
| Garbage collection | A worst tick of 5.0 to 7.3 ms in 900 | Less garbage a tick; the simulation in a worker |
| Textures on a phone | The game's ASTC at most 507 MB on high, held to a 1 GB card | A smaller card budget on a phone |

## Not measured

- An Android phone or an older iPhone.
- GPU time per pass in a real frame on a phone, which has no timer queries.
- On the iPhone: the ladder on the cheaper world finish; a soak on medium, the default
  tier (`bun run device -- --tunnel --soak-tier medium`); a cold start on Miami, its
  terrain flight and the tree order since cells (`--terrain --map
  var/maps/miami.snmap`); forty hurt and dead creatures in view (`--flock`); small
  details, a hundred dust rings near the camera.
- Real network congestion, past the map trip's link of its own; WebSocket send cost under load; Firefox.
- This Mac's GPU on a built city in the bench, over three quiet runs: the Miami rows
  below are one pass.

## The interface

`bun run bench` lays out the HUD on this Mac's CPU (E).

| Row | Result | Budget |
| --- | --- | --- |
| Play, driving, menu layout, median / p99 | 0.004 / 0.006, 0.003 / 0.005, 0.000 / 0.001 ms | 0.25 / 1 ms |
| Settings, audio, controls, controller layout, median / p99 | 0.001 / 0.002, 0.001 / 0.003, 0.005 / 0.009, 0.003 / 0.005 ms | 0.25 / 1 ms |
| Nodes: play, driving, menu, settings, audio, controls, controller | 165, 182, 18, 37, 81, 263, 65; none added after warm-up | 500; 0 |
| Shared sheet decoded; sheet and Brotli font sent | 917,504 B; 64,523 B | 1,048,576 B; 98,304 B |
| Stand-in pixels made at boot | 11.2 to 11.9 ms | none |

See the [review evidence](../reference/ui-hud-review.md) for input and layout
coverage, asset provenance, browser findings and the remaining device work.

## Recording a result

Run `bun run bench` three times on an idle machine; quote tails as ranges. Record
the commit and the machine line, and replace rows here rather than appending a
section. A budget changes in the same commit as its reason. Quote a device by its
report's file name.
