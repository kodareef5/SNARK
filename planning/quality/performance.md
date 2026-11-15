# Performance

What the engine costs, measured, for someone asking whether it can take a scene,
a player count or a device. How a frame is drawn is in
[rendering](../architecture/rendering.md).

The sizing target is one world with 100 players, an 8 km map, 500,000 structures
and 30,000 creatures, 3,000 awake (D15). `bun run bench` builds it, prints every
row with its budget, writes `artifacts/bench.json` and exits non-zero on a miss.

## Where the numbers come from

"This Mac" is an Apple M5, 10 cores, 24 GB, macOS 26.3.1, Bun 1.4.3, with headless
Chrome 157 on ANGLE's Metal renderer for browser rows. "The iPhone" runs iOS 27.2
(Chrome for iOS, so WebKit): 4 cores, 390 by 844 at 3 device pixels a CSS pixel,
ASTC, 24-bit depth, 16 texture units, no timer queries.

| Code | Run | Date | Commit |
| --- | --- | --- | --- |
| R4 | `bun run bench`, once | 2026-11-13 | `b3eb3e5` |
| R5 | the bench and the settings restart, once | 2026-11-13 | `4966993` |
| Q | three or four quiet runs, ranges | 2026-11-13 | `5bf4d63` |
| S | three quiet runs, ranges | 2026-11-14 | `95a19af` |
| M | once on main, on a busy machine (load 7 to 39 on 10 cores) | 2026-11-15 | `1ca2026` |
| P2 | `bun tools/bench/corpses.ts`, three runs on a busy machine, ranges | 2026-11-15 | branch `r9/p2-corpses` |
| P10 | the hurt and decay layers' rows, once each on a busy machine (load 9 to 14) | 2026-11-15 | `r9/p10-layers` |
| Dnnn | the measurement its decision records | | |
| iPhone | the device page's reports (D349), kept in `planning/reference/device-reports`, named by UTC time | 2026-11-15 | |

Counts, bytes and frames from M stand: load does not move them. Times from M are
high and are given only where no quiet run has the row, marked "busy".

## In short

- **The server** ticks in 2.0 to 2.3 ms of its 33.3 ms step at the median (Q).
  Every server budget held in the last quiet runs but one collapse row, once in
  three (S). The crowd (every survivor and 2,000 creatures in one place) has never
  had a quiet run and missed its tick budgets busy.
- **Bandwidth** is nearest its budget where many bodies move in view: 31.6 to
  32.3 KB/s a client against 34 to 36.
- **The client's frame build** in Bun has a median under 1 ms in every scene but a
  whole view of 2,048 bodies (1.8 ms on medium, 3.5 on ultra, busy).
- **The iPhone** holds 60 Hz on every tier in light scenes, and on medium 2,048
  bodies, 1,024 to 2,048 draws, 4.5 million triangles or 2,048 to 4,096 textured
  pieces. A dense wood broke medium before far nodes were drawn by the tile
  (D353). On high a ten-minute soak climbs from 17 to 27 ms a frame as it warms.
- **This Mac's GPU** spends 0.13 to 0.35 ms a megapixel on the lit tiers'
  full-screen programs and 0.7 to 1.4 ms a frame on shadows at 1080p (D266, D268,
  D330); the iPhone 3.3 to 4 times as much a megapixel.

## The server

### Tick and memory

| Row | Result | Budget | Source |
| --- | --- | --- | --- |
| Tick, median, 99th percentile, worst of 900 | 2.0 to 2.3, 2.9 to 5.9, 11.4 to 19.9 ms | 8, 16, 33.3 | Q |
| Creatures awake; stepped through collision a tick | 3,336; 2,298 | | M |
| Commit every 6 ticks, median; 99th percentile | 0.16; 0.7 to 1.0 ms | 4; 10 | R4; S |
| A checkpoint between ticks; after the bench's bulk writes | 4.5 to 4.8; 29 ms | 10 | S; Q |
| Live objects gained over 900 ticks | 2,834 | 5,000 | M |
| Process memory, server and scripted clients | 374 to 385 MB | 2,048 | Q |
| Entity store: a slot; full at 524,288 slots | 195 bytes; 97.5 MB | 200; 128 MB | M |

The worst tick lands on a tick with no commit, a different one each run: the
garbage collector, and noise at this sample size (Q).

### What a client is sent

| Row | Result | Budget | Source |
| --- | --- | --- | --- |
| 40-player fight; quiet base; upstream | 17.4; 12.6; 0.53 KB/s | 34; 16; 2 | M |
| Added by working nodes and items | 0.06 KB/s | 0.3 | M |
| Used-up nodes told within 6 chunks, everyone working; per node used up | 93.5 B/s; 500 B | | D356 |
| A hundred dodos dying in view: added to that second | 7,373 B | | P2 |
| Used-up nodes told on joining at the fight; at most | 328 B; 27.9 KB | | D356 |
| Brawl: 100 survivors and 400 creatures in an 18 m square | 31.8 KB/s | 36 | M |
| Crowd: every survivor and 2,000 creatures | 31.6 KB/s | 36 | M |
| Crowd: bodies shown to a client that asked for 2,048; that never asked | 982 of 1,024; 452 of 512 | | M |
| Breeding base, each survivor there | 32.3 KB/s | 34 | M |
| Siege: 50 pieces of a 20,000-piece chunk damaged a tick | 26.0 KB/s | 30 | M |
| A 1,512-piece house collapsing, each watcher, all of it | 2,843 bytes | 3,024 | M |
| Voice, 100 talking, each listener | 28.7 KB/s | 31 | M |
| The map's feeds | 0.008 KB/s | 0.5 | M |
| Far feed: first 20 s, mean and most; after; a siege watched | 27.9, 29.1 KB; 0.006 KB/s; 0.28 KB/s | none; 0.2; 2 | M |
| 300 creatures standing still | 1.56 KB/s | 2 | M |
| Prediction corrections; undecodable snapshots | 0; 0 | 0 | M |

A snapshot carries 1,100 bytes of changes, players first (Q); velocity is not
sent, so walking creatures fill a quiet base's bytes. On a modelled WebSocket
the far feed delays no near chunk at any of six links, 50 ms clean to 180 ms with
2% loss and a 60 KB/s line (D256, M). Losses and freezes by link are in
[networking](../architecture/networking.md).

### Load on the tick

| Row | Result | Budget | Source |
| --- | --- | --- | --- |
| Everyone striking nodes and moving items, median, 99th | 2.1 to 2.2, 3.4 to 3.7 ms | 8, 16 | Q |
| 600,000 stored stacks: tick median; commit 99th; audit | 3.00; 1.7; 3.3 ms | 8; 10; 1,000 | R4 |
| 300,000 creatures, dormant, tick median | 2.8 to 3.0 ms | 1.5 × before + 0.5 | Q |
| Combat, 100 players shooting twice a second, median, 99th | 3.5, 4.9 to 5.7 ms | 8, 16 | Q |
| Fly 2,000 arrows, median, 99th; a blast in a 2,000-piece base, median, worst | 0.82, 1.50; 0.05, 0.45 ms | 2, 4; 1, 4 | R4 |
| Brawl, median; siege, added to the tick | 2.0; 0.25 ms | 8; none | Q |
| Siege: chunk writes in 10 s; commit median; commit writing the chunk | 10; 0.10 to 0.11; 4.9 to 5.1 ms (0.71 busy on M) | 11; 4; 10 | S, M |
| Collapse of 1,512 pieces: ticks to the last; work a tick, median, worst | 32; 0.57, 1.6 to 4.3 ms | 60; 1.5, 3 | M; R4, S |
| The same: whole tick, worst; ask whether a piece stands | 7.5 to 8.5; 0.047 ms | 16; 0.1 | Q; R4 |
| Voice: relay for a second of 100 talking; who hears whom, median, worst | 4.2; 0.19, 0.29 ms | 20; 0.5, 2 | R4 |
| Breeding base: tick median before and with it; 99th; look for pairs, median, worst | 3.78, 4.13; 11.7; 0.11, 0.14 ms | 1.5 × before + 0.5; 16; 0.5, 2 | R4 |
| Breeding base, worst tick while 150 females lay | 7 to 16 ms over four runs | 33.3 | R4 |
| Crowd, median, 99th | 12.5, 49.7 ms busy, missed | 8, 16 | M |
| Far feed's share of a tick, 100 sessions; map bake of a 20,000-piece chunk | 0.020; 0.065 ms busy | 0.05; 0.5 | M |
| Spawning 300,000 in 10,000 regions: most made a tick; spawner once held | 66; 0.39 µs | 66; 50 µs | M |
| 500 hunters round a wall: path cells in the busiest tick | 1,000 | 1,000 | M |
| A hundred dodos killed at once: bodies made and laid; their falls, a tick, median, worst; ticks until all lie still | 3.3 to 5.2; 0.58 to 0.63, 2.9 to 3.2 ms; 31 | 15; 3, 10; 300 | P2 |
| The hundred at rest, worst tick; a swing's search among them; a blow's yield | 0.012 to 0.025; 0.030 to 0.037; 0.003 to 0.004 ms | 0.5; 0.05; 0.05 | P2 |

### Saves and starts

| Row | Result | Budget | Source |
| --- | --- | --- | --- |
| Save: 519,164 structures, 313,220 records | 65.2 MB | | M |
| Open, check and load the structures; load the entity records | 260 to 283; 385 ms | 3,000 | S; R4 |
| Start a host on the save; under other settings; of that, bringing over; first commit after | 374; 506; 132; 552 ms | none; 5,000; 2,000; 5,000 | R5 |

A rule is read where it is used, so a 50x server ticks as one at ARK's defaults
(R5, `--config config/boosted-50x`).

## The client in Bun

Core's frame build on this Mac's CPU, before the shell draws.

| Row | Result | Budget | Source |
| --- | --- | --- | --- |
| 60 m from a 2,000-piece base: frame build, median, 99th | 0.05, 0.25 ms | 1, 2 | R4 |
| The same: tiles; draws within 256 m; triangles | 142; 24; 551,984 | 200; 300; 1.5 M | M |
| Every base to the horizon drawn as pieces | 1,026 draws, 2.05 M triangles | | M |
| 50 damaged pieces a frame of a 20,000-piece chunk: median; bytes uploaded again | 0.05 ms; 0 | 1; 0 | Q; M |
| A 1,512-piece house falling: take in, worst; build median, 99th | 0.33; 0.05, 0.07 ms | 1; 1.5, 3 | R4 |
| 300 survivors posed: median, 99th | 0.50, 1.04 ms | 4, 8 | R4 |
| A hundred dodos falling in view: their bodies' share, median, worst | 0.03 to 0.12, 0.77 to 3.9 ms | 3, 16 | P2 |
| Coming upon the hundred: frames to lay them to rest; worst frame | 3; 3.4 to 4.7 ms | 30; 16 | P2 |
| 512 bodies of a breeding base: median, 99th; bones; triangles | 0.49, 1.63 ms; 12,768; 1.07 M | 4, 8; 16,384; 1.5 M | R4; M |
| 2,048 bodies on ultra: bones; triangles; median, 99th | 57,344; 3.31 M; 3.5, 6.3 ms busy | 65,536; none; 6, 12 | M |
| 2,048 on medium: posed, rigid; triangles; median, 99th | 530, 1,518; 2.39 M; 1.8, 15.0 ms busy, missed | none; none; 6, 12 | M |
| 500 creatures with materials: all textured after; as wide as shown after; draws | 0.12 s; 2.7 s; 2 | 1.5 s; none; 60 | M |
| The same with a hurt and decay layer, none hurt: frame build median; draws with a layer, layer fetched | 0.21 ms; 0, no | 1.2; 0 | P10 |
| Its 40 nearest hurt or dead: frame build median; draws added, of them with a layer | 0.23 ms; 12, 6 | 1.2; none | P10 |
| Stress meshes over 20 Mbit/s: boot file; first usable detail; the detail wanted | 0.30 MB; 1.1 s; 3.9 s | 1 MB; 1.5 s; 6 s | M |
| The same flying at 25 m/s: fetched over drawn; given up; left out | 1.00; 0%; 0 | 1.3; 15%; 0 | M |
| A 4 MB card: most held over budget; left out | 1.00; 0 | 1.25; 0 | M |

The texture encoders' quality and speed are in [encoders](encoders.md).

**Two depth ranges** (D252). The split at 384 m lists 0.9% of draws twice round
the bench bases, 1.5% in a city of 81 built-up chunks and 0.2% with every base
held (6.5% and 25.5% at 256 m), and adds under 0.01 ms to frame build (M).

**Terrain pictures** (D253). 9.46 MB on the card for 8 km, against 50.4 MB for one
pair of every sample. A window fills in 7, 4, 2 and 1 frames by tier. Flying 3 km
at 600 m/s draws no tile coarser; at 3,000 m/s, 20. After a teleport the window is
in within 4 frames (M).

### Far bases (D257)

| Row | 130 base chunks within 2 km | 480 |
| --- | --- | --- |
| Far draws a frame on medium, mean (most) | 27.9 (34) | 61.4 (70) |
| Far triangles a frame, mean | 15,300 | 64,600 |
| Frames until every tile is made | 22 | 43 |
| The blocks' share of frame build, median, worst | 0.05, 0.34 ms busy | 0.03, 0.07 ms busy |

At 480 chunks: 17.7, 56.3, 61.3 and 61.3 far draws by tier (plan: 9 to 17, then
35 to 70). A castle's blocks are 324 triangles, the 2,000-piece pile 716 (M).
1.7 MB on the card at 480 chunks (D257).

### Far trees, rocks and bushes (D353, D354)

The bench map's wood, every slot filled, from its middle (M): `core:tree`,
`core:rock` and `core:bush`, now the young hardwoods (D357), the limestones with
their 8-triangle far level (D361) and the berry bush (D291), on 2026-11-15. Plan figures in
brackets (round 8 plan, "Budgets per tier").

| | Low poly | Medium | High | Ultra |
| --- | --- | --- | --- | --- |
| Reach of trees, rocks, bushes | 417, 0, 0 m | 1,092, 565, 151 m | 1,836, 867, 252 m | 2,763, 1,166, 302 m |
| Draws a frame, mean (most) | 8.3 (10) [5 to 15] | 106 (145) [35 to 100] | 160 (201) [90 to 270] | 238 (279) [190 to 570] |
| Triangles in view and reach (budget) | 37 k (39 k) | 314 k (315 k) | 881 k (900 k) | 1.97 M (2.0 M) |
| Tiles held | 30, 0.7 MB | 108, 2.9 MB | 252, 6.5 MB | 522, 13.0 MB |
| Share of frame build, median; worst crossing a chunk border | 0.02; 0.74 ms | 0.05; 1.23 ms | 0.10 ms | 0.15; 1.74 ms |

The border budget is 2 ms. In the trees' review wood, far draws on medium fell
from 531 to 905 to 57 to 73 when a tile became a few draws (D353). The stones'
far level is a group of its own and reaches further, which took medium's bench
draws from 71 (91) to 106 (145).

### Sun shadows (D313)

Under a sun 10 degrees up, which stretches casters furthest (M).

| | Medium | High | Ultra |
| --- | --- | --- | --- |
| Bench base: caster entries, mean (most) | 19 (36) | 24 (84) | 25 (84) |
| Siege: caster entries, mean (most) | 531 (680) | 678 (862) | 762 (933) |
| Siege: caster draws over every cascade, mean [plan's worst] | 606 [900] | 982 [2,800] | 1,357 [3,300] |
| Siege: triangles by cascade, nearest first | 1.64, 0.93 M | 1.75, 2.10, 0.54 M | 1.89, 2.29, 1.72, 0.50 M |
| Siege: bodies posed for their shadows alone | 66 | 74 | 85 |
| Siege: what casters add to frame build | 0.28 ms busy | 0.39 ms busy | 0.43 ms busy |
| All 81 near chunks built up to 30 m, made up: entries | 1,850 | 3,412 | 4,845 |

The list holds 4,096 entries; no real scene has passed 933.

## The GPU on this Mac

| Row | Result | Source |
| --- | --- | --- |
| LIT full screen, a megapixel: no haze, hazed at 500 m, at 3.5 km | 0.13, 0.17, 0.21 ms | D266 |
| The dome, a megapixel: table alone, with sun, moon and stars, with two cloud layers | 0.09, 0.20, 0.32 to 0.35 ms | D330 |
| The sea, a megapixel | 0.26 to 0.30 ms | D270 |
| Sun shadows at 1080p, a frame | 0.7 to 1.4 ms | D268 |
| Shadows on the device page's crowd | 0.8 ms on medium and high, 1.2 on ultra | D329 |
| The far fade's kept share, 1,950 m off | 50.0% (rasterizer 49.9%) | D258 |
| SURFACE and surfaceLayer, a megapixel, by slope (the device page, headless) | 0.30 ± 0.04, 0.34 ± 0.03 ms | P10 |
| Forty hurt and dead dodos round the camera (the GPU bench's flock, 750 by 873, a GPU shared with other jobs): the frame on medium, ultra; what the layers add, each run | 4.7, 21.2 ms; -0.6 to +0.6 ms on medium, -1.0 to -0.3 on ultra | P10 |
| Node pixels changed stepping over a chunk border, medium | 0 of 39,171 | D355 |
| On the card on any device: terrain on 8 km; sky table; shadow maps by lit tier | 9.5 MB; 256 KB; 16, 24, 32 MB | M; computed; D268 |

The lit probe's timing page read the dome at 0.023 ms because it blends alpha as
colour and ANGLE drops the stacked opaque draws; it is still to be corrected
(D330).

## The iPhone

`bun run device` through a tunnel, 2026-11-15 (D349). The reports are in
`planning/reference/device-reports`; the quick look is `2026-11-15T07-35`.

**GPU questions** (D271). `depthRange` is honoured; a 16-bit depth array renders
and compared lookups filter; an RGBA8 3D texture filters. D1's seam leaves no
clear pixel over 60 turning frames (87 with the far range starting at the split
itself). The far edge keeps the 50% its rule says.

**Pass costs**, by the slope of time against passes drawn:

| Pass, ms a megapixel | iPhone | This Mac |
| --- | --- | --- |
| FLAT | 0.15 | |
| LIT; hazed at 500 m; at 3.5 km | 0.47; 0.64; 0.79 | 0.13; 0.17; 0.21 |
| LIT shadowed; far; SURFACE | 0.79; 0.57; 0.85 | |
| Dome: table; sun, moon, stars; one layer; two | 0.36; 0.85; 1.07; 1.30 | 0.09; 0.20; not recorded; 0.32 to 0.35 |
| Sea, calm and with waves | 1.00, 1.07 | 0.26 to 0.30 |
| Compared taps: 1, 4, 9 | 0.06, 0.19, 0.49 | |

Depth passes cost 0.18 ms a 100,000 triangles at 1,024 and 0.38 at 2,048, rigid
or skinned; a draw costs 0.44 µs of main thread.

**The ladder** (D246): a rung holds while its median frame is within 1.12 times
the display's 17 ms and its 95th percentile within 1.5 times. Two runs, `07-43`
and `08-19` UTC:

| Tier | Bodies | Draws | Triangles | Textured pieces |
| --- | --- | --- | --- | --- |
| Low poly | 2,048 held | 2,048 held, 3,600 broke | 2.7 M held, the top rung | 4,096 held |
| Medium | 2,048 held | 1,024 or 2,048 held | 4.5 M held, 6.3 M broke | 2,048 or 4,096 held |
| High | 2,048 held | 1,024 held, 2,048 broke | 2.7 M held, 4.7 M broke | never settled |
| Ultra | 800 held, 1,600 broke | 256 held, then broke | 0.9 to 1.6 M held | broke or never settled |

High's pieces need about 100 MB at 4.3 MB/s through the tunnel (D348). Textures
held 1.5 GB of ASTC; the tab was dropped at 2 GB, twice.

**Soaks**, ten minutes on high with three cascades: with 200 bodies and 1,024
pieces the median frame climbs from 17 to 27 ms and the 95th from 21 to 36
(`07-47`); with 800 bodies, 17 to 24 ms (`08-23`).

**Terrain flight** on the 8 km map (`07-57`): a window's refill frames are 1.18
times a plain frame on medium and 1.06 on low poly; 480 far base chunks hold. The
wood, before D353, held on low poly and broke on medium (25 ms), high (43) and
ultra (35).

## Where the limits are

Reasoned from the rows, in the order a growing world meets them.

| Limit | Today | What would move it |
| --- | --- | --- |
| A phone's GPU | 4.5 M triangles or 1,024 to 2,048 draws at 60 Hz on medium; heat over minutes | A governor; the touch rule's shadows; far stand-ins |
| One thread runs the tick | 2.0 to 2.3 ms of 33.3, 3.5 in combat; the crowd asks first | Snapshot encoding in workers over the typed-array entity store |
| Bandwidth where bodies crowd | 31.6 to 32.3 KB/s of 34 to 36 | Velocity in snapshots |
| Draws | 4,096 in the packet; the iPhone held 256 to 2,048 on lit tiers | Far stand-ins (F4); texture arrays before multi-draw (D210) |
| Shadow casters | 933 of 4,096 in the siege on ultra | Merged casters cached by shape (D267) |
| Garbage collection | A worst tick of 7 to 20 ms once in some hundreds | Less garbage a tick; the simulation in a worker |
| Textures on a phone | 1.5 GB held, the tab dropped at 2 GB | A smaller card budget on a phone |

## Not measured

- A quiet `bun run bench` of every row on main. Rounds 7 and 8's rows have only
  busy times, and four missed busy: the crowd, combat's 99th percentile, the
  breeding base's 99th, medium's 2,048-body frame build.
- An Android phone or an older iPhone (M1 asked for a second phone).
- GPU time per pass in a real frame; the iPhone has no timer queries.
- The wood with D353's pulled draws, far stones and the broadleaf trees on a phone.
- A soak on medium, the default tier.
- Hurt and dead creatures on a phone: `bun run device -- --tunnel --flock` stands forty round the spawn point, and the
  quick look times `surface layered` beside `surface`. On this Mac the layer adds about 13% to a pixel of SURFACE; at
  the iPhone's 0.85 ms a megapixel that is 0.11 ms for each megapixel of hurt bodies, under 0.1 ms with the whole of
  medium's screen covered.
- Real network congestion; WebSocket send cost under load; Firefox.

## Still moving

**A roof overhead** (`r8/l8-roof`, D344, D345). Nothing measured. The lighting
design estimated 0.1 MB for a 256-square roof map on medium and 0.5 MB for 512.

**Per-pass timers, a governor, the touch rule** (`r8/m2-governor`). Settled: the
soaks above and `touchShadows` unset. Its timer rows, steps and touch values go
here.

**Broadleaf crowns** (art, `r8/n-trees-4`). The trees' third round and the
stones' far level are in the rows above (D357, D361). The crowns' surface has a
round of its own, which may move the trees' counts, far levels and reaches again.

## Recording a result

Run `bun run bench` three times on an idle machine; quote tails as ranges. Record
the commit and the machine line, and replace rows here rather than appending a
section. A budget changes in the same commit as its reason. Quote a device by its
report's file name.
