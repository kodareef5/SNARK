# Performance

What the engine costs, measured, for someone asking whether it can take a
scene, a player count or a device. Each row says where it was measured and
when. How the frame is drawn is in [rendering](../architecture/rendering.md).

The sizing target is one world with 100 players, an 8 km map, 500,000
structures and 30,000 creatures, 3,000 of them awake (D15). `bun run bench`
builds it, prints every row with its budget, writes `artifacts/bench.json`, and
exits non-zero if a budgeted row misses.

## Where the numbers come from

"This Mac" is an Apple M5, 10 cores, 24 GB, macOS 26.3.1, Bun 1.4.3; browser rows
there are headless Chrome 157 on ANGLE's Metal renderer. "The iPhone" is an iPhone
on iOS 27.2 (Chrome for iOS, so WebKit), 4 cores, a 390 by 844 screen at 3 device
pixels a CSS pixel, Apple GPU, ASTC textures, a 24-bit depth buffer, 16 texture
units and no timer queries.

| Code | What | Date | Commit |
| --- | --- | --- | --- |
| R4 | `bun run bench`, one run | 2026-11-13 | `b3eb3e5` |
| R5 | `bun run bench` and the settings restart, one run | 2026-11-13 | `4966993` |
| Q | three or four quiet runs back to back, ranges | 2026-11-13 | `5bf4d63` |
| S | three quiet runs, ranges | 2026-11-14 | `95a19af` |
| M | one run on main, on a busy machine (load 7 to 39 on 10 cores) | 2026-11-15 | `1ca2026` |
| Dnnn | the measurement its decision records | the decision's | |
| iPhone | the device page's reports, kept in `.cache/device` on the development machine, not committed (D349) | 2026-11-15 | |

Counts, bytes and frames from M stand as they are: load does not move them. Times
from M are high, and are quoted only where no quiet run has the row, marked
"busy". A quiet run of every row on main has not been made since round 6 began;
see "Not measured".

## In short

- **The server** at the sizing target ticks in 2.0 to 2.3 ms of its 33.3 ms step
  at the median (Q). Every server budget was met in the last quiet runs, but for
  one collapse row once in three (S). The crowd row (2,000 creatures and every
  survivor in one place) has never had a quiet run, and missed its tick budgets
  on the busy machine.
- **Bandwidth** is closest to its budget where many bodies move in view: 31.6 to
  32.3 KB/s a client against 34 to 36 in the brawl, the crowd and the breeding
  base.
- **The client's frame build** in Bun has a median under a millisecond in every
  scene but a whole view of 2,048 bodies (1.8 ms on medium, 3.5 on ultra, busy).
- **The iPhone** holds 60 Hz on every tier in light scenes. On medium it holds
  2,048 bodies, 1,024 to 2,048 draws, about 4.5 million triangles and 2,048 to
  4,096 textured pieces. A dense wood broke medium, high and ultra before far
  nodes were drawn by the tile (D353), and a ten-minute soak on high climbs from
  17 to 27 ms a frame as the phone warms (D349).
- **On this Mac's GPU** the lit tiers' full-screen programs cost 0.13 to 0.35 ms a
  megapixel, and shadows 0.7 to 1.4 ms a frame at 1080p (D266, D268, D330). The
  iPhone runs the same programs 3.3 to 4 times slower a megapixel.

## The server

### Tick, commit and memory

| Row | Result | Budget | Source |
| --- | --- | --- | --- |
| Tick, median | 2.0 to 2.3 ms | 8 ms | Q |
| Tick, 99th percentile | 2.9 to 5.9 ms | 16 ms | Q |
| Tick, worst of 900 | 11.4 to 19.9 ms | 33.3 ms | Q |
| Creatures awake, and stepped through collision a tick | 3,336 and 2,298 | | M |
| Commit (every 6 ticks), median | 0.16 ms | 4 ms | R4 |
| Commit, 99th percentile | 0.7 to 1.0 ms | 10 ms | S |
| A checkpoint, between ticks, median | 4.5 to 4.8 ms | 10 ms | S |
| A checkpoint after the bench's bulk writes | 29 ms | | Q |
| Live objects gained over 900 ticks, after collection | 2,834 | 5,000 | M |
| Process memory, server and every scripted client | 374 to 385 MB | 2,048 MB | Q |
| Entity store: a slot, with its columns | 195 bytes | 200 | M |
| Entity store full at 524,288 slots | 97.5 MB | 128 MB | M |

The worst tick lands on a tick with no commit in it, a different one each run,
which points at the garbage collector (Q). At this sample size it is noise.

### What a client is sent

| Row | Result | Budget | Source |
| --- | --- | --- | --- |
| Downstream, a 40-player fight | 17.4 KB/s | 34 | M |
| Downstream, a quiet base | 12.6 KB/s | 16 | M |
| Upstream | 0.53 KB/s | 2 | M |
| Added by working nodes and items | 0.06 KB/s | 0.3 | M |
| Used-up nodes told within 6 chunks, everyone working | 93.5 B/s a client; 500 B a node used up, to everyone told | | D356 |
| Used-up nodes told on joining at the fight; at most, every node round it used up | 328 B; 27.9 KB | | D356 |
| Brawl: 100 survivors in an 18 m square with 400 creatures | 31.8 KB/s | 36 | M |
| Crowd: every survivor and 2,000 creatures in one place | 31.6 KB/s | 36 | M |
| Crowd: bodies shown to a client that asked for 2,048, and to one that never asked | 982 of 1,024, 452 of 512 | 1,024, 512 | M |
| Breeding base, each survivor there | 32.3 KB/s | 34 | M |
| Siege: 50 pieces of a 20,000-piece chunk damaged a tick | 26.0 KB/s | 30 | M |
| A 1,512-piece house collapsing, each watcher for all of it | 2,843 bytes | 3,024 | M |
| Voice, 100 survivors talking, each listener | 28.7 KB/s | 31 | M |
| The map's two feeds | 0.008 KB/s | 0.5 | M |
| Far feed on joining, first 20 s, mean and most | 27.9 and 29.1 KB | | M |
| Far feed after joining | 0.006 KB/s | 0.2 | M |
| Far feed, a siege watched from afar | 0.26 to 0.28 KB/s | 2 | M |
| 16 survivors among 300 creatures standing still | 1.56 KB/s | 2 | M |
| Prediction corrections on the two full clients; snapshots they could not decode | 0; 0 | 0 | M |

A snapshot carries 1,100 bytes of changes, counted exactly, players and what they
drive first (Q). Velocity is not sent, so walking creatures are most of a quiet
base's bytes. Over a modelled WebSocket the far feed delays no near chunk on a
join at any of six links, from 50 ms clean to 180 ms with 2% loss and to a 60 KB/s
line (D256, M). Losses, freezes and corrections by link are in
[networking](../architecture/networking.md).

### Load on the tick

| Row | Result | Budget | Source |
| --- | --- | --- | --- |
| Everyone striking nodes and moving items, median and 99th percentile | 2.1 to 2.2, 3.4 to 3.7 ms | 8, 16 | Q |
| 600,000 stored stacks: tick median, commit 99th percentile | 3.00, 1.7 ms | 8, 10 | R4 |
| Audit every stack against the ledger | 3.3 ms | 1,000 | R4 |
| 300,000 creatures (ten times the target, dormant), tick median | 2.8 to 3.0 ms | 1.5 × the tick before + 0.5 | Q |
| Combat, 100 players shooting twice a second, median and 99th percentile | 3.5, 4.9 to 5.7 ms | 8, 16 | Q |
| Fly 2,000 arrows one tick, median and 99th percentile | 0.82, 1.50 ms | 2, 4 | R4 |
| One grenade blast in a 2,000-piece base, median and worst of 20 | 0.05, 0.45 ms | 1, 4 | R4 |
| Brawl, tick median | 2.0 ms | 8 | Q |
| Siege, added to the tick | 0.25 ms | | Q |
| Siege, times the chunk is written in ten seconds | 10 | 11 | M |
| Siege, commit median | 0.10 to 0.11 ms | 4 | S |
| Siege, commit that writes the chunk | 4.9 to 5.1 ms; 0.71 busy | 10 | S; M |
| Collapse of 1,512 pieces: ticks until the last is down | 32 | 60 | M |
| Collapse work in a tick, median and worst | 0.57, 1.6 to 4.3 ms | 1.5, 3 | R4, S |
| Whole tick while it falls, worst | 7.5 to 8.5 ms | 16 | Q |
| Ask whether a piece stands | 0.047 ms | 0.1 | R4 |
| Voice: relay work for a second of 100 talking; who hears whom, median and worst | 4.2; 0.19, 0.29 ms | 20; 0.5, 2 | R4 |
| Breeding base, tick median before it and with it awake and mating | 3.78, 4.13 ms | 1.5 × before + 0.5 | R4 |
| Breeding base, tick 99th percentile | 11.7 ms | 16 | R4 |
| Breeding base, the look for pairs, median and worst | 0.11, 0.14 ms | 0.5, 2 | R4 |
| Breeding base, worst tick while 150 females lay at once | 7 to 16 ms over four runs | 33.3 | R4 |
| Crowd, tick median and 99th percentile | 12.5, 49.7 ms busy (missed) | 8, 16 | M |
| Far feed's share of a tick for 100 sessions, mean | 0.020 ms busy | 0.05 | M |
| Map bake of a 20,000-piece chunk, median | 0.065 ms busy | 0.5 | M |
| Spawning 300,000 creatures in 10,000 regions: most made in a tick; the spawner's share once held | 66; 0.39 µs | 66; 50 µs | M |
| 500 hunters round a 36 m wall: path cells in the busiest tick | 1,000 | 1,000 | M |

The collapse work missed its 3 ms once in three runs at 4.3 ms, with nothing in
the change touching collapse (S). The breeding base's tick budget is the tick
there before the base, times one and a half, plus half a millisecond.

### Saves and starts

| Row | Result | Budget | Source |
| --- | --- | --- | --- |
| Save on disk: 519,164 structures and 313,220 records | 65.2 MB | | M |
| Open the save, check it, load its structures and rebuild the collision grid | 260 to 283 ms | 3,000 | S |
| Load the entity records | 385 ms | 3,000 | R4 |
| Start a host on the save, same settings, and under other settings | 374, 506 ms | none, 5,000 | R5 |
| Of that, bringing 300,000 bodies and 600,000 stacks over | 132 ms | 2,000 | R5 |
| The first commit after it | 552 ms | 5,000 | R5 |

Opening checks the file before it is trusted, which costs about 0.16 s (S).
Bringing a world over to other settings happens once, at a start; its budgets
guard against a pass turning quadratic. A rule is read where it is used, so a 50x
server ticks as one at ARK's defaults (R5, `--config config/boosted-50x`).

## The client in Bun

Core's frame build on this Mac's CPU, without a browser. This is main-thread time
before the shell draws.

### Near scenes

| Row | Result | Budget | Source |
| --- | --- | --- | --- |
| 60 m from a 2,000-piece base: frame build, median and 99th percentile | 0.05, 0.25 ms | 1, 2 | R4 |
| The same: terrain tiles, structure draws within 256 m, triangles | 142, 24, 551,984 | 200, 300, 1.5 M | M |
| The same with every base to the horizon drawn as pieces | 1,026 draws, 2.05 M triangles | | M |
| A 20,000-piece chunk told of 50 damaged pieces a frame: frame build median; instance bytes uploaded again | 0.05 ms; 0 | 1; 0 | Q; M |
| A 1,512-piece house falling 60 m off: take them in, worst frame; frame build median and 99th | 0.33; 0.05, 0.07 ms | 1; 1.5, 3 | R4 |
| 300 survivors posed in view: frame build median and 99th | 0.50, 1.04 ms | 4, 8 | R4 |
| A breeding base, 512 bodies: frame build median and 99th | 0.49, 1.63 ms | 4, 8 | R4 |
| The same: bones of 16,384, triangles on medium | 12,768; 1,069,070 | 16,384; 1.5 M | M |
| 2,048 bodies on ultra: bones used of 65,536; triangles | 57,344; 3.31 M | 65,536 | M |
| The same: frame build, median and 99th | 3.5, 6.3 ms busy | 6, 12 | M |
| 2,048 bodies on medium: posed, and rigid for want of bones; triangles | 530, 1,518; 2.39 M | | M |
| The same: frame build, median and 99th | 1.8, 15.0 ms busy (missed) | 6, 12 | M |
| 500 creatures drawn with materials: every body textured after; textures as wide as shown after | 0.12 s; 2.7 s | 1.5 s | M |
| The same: draws, triangles, texture bytes held | 2; 264,192; 6 MB | 60; 850,000; 6 MB | M |

### Two depth ranges (D252, `tools/bench/depth.ts`)

| Scene | Draws a frame | Doubled by the split at 384 m | At 256 m | What the split adds to frame build | Source |
| --- | --- | --- | --- | --- | --- |
| 20 bench bases from 60 m, turning | 12 | 0.9% | 6.5% | under 0.01 ms | M |
| A city: 81 chunks of 1,000 pieces | 181 | 1.5% | 25.5% | under 0.01 ms | M |
| Every bench base held | 891 | 0.2% | 0.15% | under 0.01 ms | M |

Budget: 0.1 ms added. D252 records 0.9 to 1.5% and at most 0.012 ms.

### Far bases (D257, `tools/bench/far.ts`)

| Row | 130 base chunks within 2 km | 480 | Source |
| --- | --- | --- | --- |
| Far draws a frame, mean (most), medium | 27.9 (34) | 61.4 (70) | M |
| Far triangles a frame, mean | 15,300 | 64,600 | M |
| Frames until every tile is made | 22 | 43 | M |
| The blocks' share of frame build, median and worst | 0.05, 0.34 ms busy | 0.03, 0.07 ms busy | M |

By tier, at 480 chunks: 17.7, 56.3, 61.3 and 61.3 far draws a frame on low poly,
medium, high and ultra (M). One chunk's blocks: a castle 324 triangles, the
2,000-piece pile 716, ten huts 244, each made in under 0.06 ms (M). D257 records
1.7 MB on the card at 480 chunks.

### Far trees, rocks and bushes (D353, D354, `tools/bench/far.ts`)

The 8 km map's wood with every slot filled, from its middle (M). Its kinds are
`core:tree`, `core:rock` and `core:bush`, which carry the art since round 8 (D291):
the young live oak with its far level, the limestone with none of its own, the
berry bush.

| | Low poly | Medium | High | Ultra |
| --- | --- | --- | --- | --- |
| Reach of trees, rocks, bushes | 383, 0, 0 m | 1,019, 321, 151 m | 1,715, 515, 252 m | 2,583, 705, 302 m |
| Far node draws a frame, mean (most) | 8.3 (10) | 71 (91) | 135 (174) | 207 (249) |
| Triangles in view and reach, mean; budget | 34 k; 39 k | 302 k; 315 k | 861 k; 900 k | 1.94 M; 2.0 M |
| Triangles sent a frame, mean | 83 k | 498 k | 1.15 M | 2.37 M |
| Tiles held, bytes | 30, 0.6 MB | 108, 2.6 MB | 252, 5.5 MB | 522, 10.8 MB |
| Far nodes' share of frame build, median | 0.04 ms | 0.05 ms | 0.11 ms | 0.15 ms |
| Walking across chunk borders: far nodes' worst share of a frame | 0.72 ms | 1.46 ms | | 1.11 ms |

Budget for the walk: 2 ms. A tile made from nothing is 0.26 ms on medium (M,
busy). In the trees' review wood, far draws on medium fell from 531 to 905 to 57
to 73 when a tile became a few draws (D353).

### Sun shadows (D313, `tools/bench/shadow.ts`)

Under a sun 10 degrees up, which stretches casters furthest (M).

| | Medium | High | Ultra |
| --- | --- | --- | --- |
| Bench base: caster entries a frame, mean (most) | 19 (36) | 24 (84) | 25 (84) |
| Bench base: what casters add to frame build | 0.016 ms busy | 0.025 ms busy | 0.032 ms busy |
| Siege, inside the fight: caster entries, mean (most) | 531 (680) | 678 (862) | 762 (933) |
| Siege: triangles by cascade, nearest first | 1.64 M, 0.93 M | 1.75, 2.10, 0.54 M | 1.89, 2.29, 1.72, 0.50 M |
| Siege: bodies posed for their shadows alone | 66 | 74 | 85 |
| Siege: what casters add to frame build | 0.28 ms busy | 0.39 ms busy | 0.43 ms busy |
| 50 kinds in each of 30 chunks: caster entries | 1,400 | 2,426 | 3,166 |
| All 81 chunks of the near store built up to 30 m | 1,850 | 3,412 | 4,845 |

The list holds 4,096 entries; no real scene has passed 933. Only the made-up full
store passes it, on ultra. D313 records 0.26 to 0.58 ms for posing out of view in
the siege on a loaded machine.

### Terrain pictures (D253, `tools/bench/terrain.ts`)

| Row | Result | Source |
| --- | --- | --- |
| On the card, 8 km map: the whole map's pair and two windows | 9.46 MB (one pair of every sample: 50.4 MB) | M |
| Frames to fill a window, low poly, medium, high, ultra | 7, 4, 2, 1 | M |
| Tiles drawn a level coarser flying 3 km at 60 and 600 m/s | 0 | M |
| The same at 3,000 m/s | 20 in all, at most 4 a frame | M |
| After a teleport: frames until the new window is in, at most; tiles a level coarser in the frame after | 4; 11.8 | M |

### Assets and textures

| Row | Result | Budget | Source |
| --- | --- | --- | --- |
| Stress meshes (28 MB) over 20 Mbit/s and 50 ms: the boot file | 0.30 MB | 1 MB | M |
| The same: until nothing that wants finer is drawn from the boot file alone, and until all is as wanted | 1.1, 3.9 s | 1.5, 6 s | M |
| The same flying across at 25 m/s: bytes fetched over drawn, requests given up, draws left out | 1.00, 0%, 0 | 1.3, 15%, 0 | M |
| A card with a 4 MB budget: most held over budget, draws left out | 1.00, 0 | 1.25, 0 | M |
| 2,000 things choosing, wanting and drawing a level, median and 99th | 0.08, 0.14 ms | 0.15, 0.5 | R4 |
| Our encoders on the test set at 1,024, every map, block variants | 46.7 to 60.1 dB; masks exact | 40 dB | M |
| One core, a megapixel: BC7, BC5, ASTC | 1.25, 1.01, 1.00 s busy | 3, 1.5, 1.5 s | M |

How our encoders compare with the reference ones is in [encoders](encoders.md).

## The GPU on this Mac

Headless Chrome 157, ANGLE on Metal, Apple M5.

| Row | Result | Source |
| --- | --- | --- |
| LIT full screen, a megapixel: no haze, hazed at 500 m, at 3.5 km | 0.13, 0.17, 0.21 ms | D266 |
| The dome, a megapixel: the table alone, with sun, moon and stars, with two cloud layers | 0.09, 0.20, 0.32 to 0.35 ms | D330 |
| The sea from above, a megapixel | 0.26 to 0.30 ms | D270 |
| Sun shadows at 1080p, added a frame | 0.7 to 1.4 ms | D268 |
| Shadows on the device page's crowd, by turns | 0.8 ms on medium and high, 1.2 on ultra | D329 |
| The far fade's kept share, a castle 1,950 m off | 50.0% (the rasterizer: 49.9%) | D258 |
| Node pixels that change as the body steps over a chunk border, medium | 0 of 39,171 | D352, D355 |
| Ground pixels darker than the rasterizer's, long lenses | 8 of 201,860 at worst | D322 |

Two dome readings disagree: the lit probe's timing page blends alpha as colour, and
ANGLE takes the constant-alpha dome as opaque, so it read 0.023 ms; the device
page, which blends `ONE, ONE`, reads 0.32 to 0.35 (D330). The lit probe's page is
still to be corrected.

## The iPhone

Measured on 2026-11-15 by `bun run device` through a tunnel (D349). Reports are
kept on the development machine: the quick look in
`.cache/device/2026-11-15T07-35-24-622Z-78dfa8651efed6c3.json`, and the ladders,
soaks and terrain flight in the `w-phone` and `w-phone2` worktrees' `.cache/device`.
A report's file name starts with its time in UTC; below they are named by hour and
minute.

**GPU questions** (D271). `depthRange` is honoured; a 16-bit depth array renders
and compared lookups filter; an RGBA8 3D texture filters; depth is 24 bits. D1's
seam, over 60 turning frames, leaves no pixel of the clear colour with the far
range from 98% of the split, and 87 with it from the split itself. The far edge
keeps 50% where the rule says 50%.

**Pass costs.** The slope of time against passes drawn, read back, since the
iPhone has no timer queries.

| Pass | ms a megapixel | This Mac (D266, D270, D330) |
| --- | --- | --- |
| FLAT | 0.15 | |
| LIT; hazed at 500 m; at 3.5 km | 0.47; 0.64; 0.79 | 0.13; 0.17; 0.21 |
| LIT shadowed (2,048 array) | 0.79 | |
| Far (LIT with the fade) | 0.57 | |
| SURFACE | 0.85 | |
| The dome: table alone; sun, moon and stars; one layer; two | 0.36; 0.85; 1.07; 1.30 | 0.09; 0.20; not recorded; 0.32 to 0.35 |
| The sea, calm and with waves | 1.00, 1.07 | 0.26 to 0.30 |
| Compared taps: 1, 4, 9 | 0.06, 0.19, 0.49 | |

Depth passes cost 0.18 ms a 100,000 triangles at 1,024 and 0.38 at 2,048, rigid or
four-bone skinned alike. A draw costs 0.44 µs of main thread.

**The ladder** (D246). A rung holds while its median frame is within 1.12 times
the display's 17 ms and its 95th percentile within 1.5 times. Two ladders on the
same day, `07-43` and `08-19`:

| Tier | Bodies | Draws | Triangles | Textured pieces |
| --- | --- | --- | --- | --- |
| Low poly | 2,048 held | 2,048 held, 3,600 broke | 2.7 M held at the top rung | 4,096 held |
| Medium | 2,048 held | 1,024 or 2,048 held, the next broke | 4.5 M held, 6.3 M broke | 2,048 or 4,096 held |
| High | 2,048 held | 1,024 held, 2,048 broke | 2.7 M held, 4.7 M broke | never settled |
| Ultra | 800 held, 1,600 broke | 256 held, then broke | 0.9 to 1.6 M held | 64 broke, or never settled |

High's textured rungs never settled: their pieces need about 100 MB at 4.3 MB/s
through the tunnel (D348). Textures held 1.5 GB of ASTC, and the tab was dropped
at 2 GB, twice (D349).

**Soaks.** Ten minutes on high with three cascades, 200 bodies and 1,024 pieces:
the median frame climbs from 17 to 27 ms and the 95th percentile from 21 to 36 as
the phone warms (`07-47`). With 800 bodies, from 17 to 24 ms (`08-23`). Through
the wood and 480 far base chunks, before D353, 28 ms easing to 22 (`08-03`).

**The terrain flight** on the 8 km map (`07-57`). Frames while a window refills
are 1.18 times a plain frame on medium and 1.06 on low poly (D253 holds under 2).
480 far base chunks hold on medium. The wood of the delivered trees, before D353's
pulled draws, held on low poly and broke on medium (25 ms), high (43) and ultra
(35).

## Round 8 by tier

What the far layer, light and sky add to a frame, against the plan's estimates
(`planning/reference/round8-plan.md`, "Budgets per tier"), on the bench's 8 km
map. Measured rows are M unless named.

| | Low poly | Medium | High | Ultra |
| --- | --- | --- | --- | --- |
| Far base draws, 480 chunks (plan: 9 to 17; 35 to 70) | 17.7 | 56.3 | 61.3 | 61.3 |
| Far node draws, mean (plan: 5 to 15; 35 to 100; 90 to 270; 190 to 570) | 8.3 | 71 | 135 | 207 |
| Far node triangles in view (plan: 39 k; 315 k; 0.9 M; 2.0 M) | 34 k | 302 k | 861 k | 1.94 M |
| Caster draws in the siege, every cascade, mean (plan, worst: 900; 2,800; 3,300) | none | 606 | 982 | 1,357 |
| Card: terrain on 8 km | 9.5 MB | 9.5 MB | 9.5 MB | 9.5 MB |
| Card: shadow maps (D268) | none | 16 MB | 24 MB | 32 MB |
| Card: sky table | none | 256 KB | 256 KB | 256 KB |
| Card: far node tiles | 0.6 MB | 2.6 MB | 5.5 MB | 10.8 MB |
| Card: far blocks, 480 chunks (D257) | | 1.7 MB | | |
| Wire on joining: far cells within 2 km | not measured | 28 to 29 KB | 28 to 29 KB | 28 to 29 KB |
| GPU, this Mac: shadows at 1080p (D268) | none | 0.7 to 1.4 ms | | |
| Frame build: casters in the siege | none | 0.28 ms busy | 0.39 ms busy | 0.43 ms busy |

The plan's GPU rows for a mid-range phone (2 to 4 ms on medium) are replaced by
the iPhone's pass costs above. Cloud pictures and the sea's waves are materials,
in the texture share.

## Where the limits are

In the order a growing world would meet them. "What meets it" is reasoned from the
rows, not measured.

| Limit | Today | What meets it | What would move it |
| --- | --- | --- | --- |
| A phone's GPU on medium | 4.5 M triangles or 1,024 to 2,048 draws a frame at 60 Hz on the iPhone; a dense wood broke it before D353 | Woods, bases and crowds in one view, and heat over minutes | A governor that steps a warm phone down; the touch rule's shadows; far stand-ins |
| One thread runs the tick | 2.0 to 2.3 ms of 33.3 at the target; 3.5 in combat (Q) | About five times the awake creatures, or 400 players in one fight; the crowd row asks first | Snapshot encoding in workers over the typed-array entity store |
| Bandwidth where bodies crowd | 31.6 to 32.3 KB/s of 34 to 36 | More moving bodies in view than a snapshot carries | Velocity in snapshots so clients extrapolate |
| Draws a frame | 4,096 in the packet; the iPhone held 2,048 on low poly and 256 to 2,048 on the lit tiers | Many kinds of piece in many chunks | Merged far stand-ins (F4), texture arrays before multi-draw (D210) |
| Shadow casters | 933 of 4,096 entries in the siege on ultra | A full near store on ultra (4,845, made up) | Merged caster meshes cached by shape (D267) |
| Garbage collection | A worst tick of 7 to 20 ms once in some hundreds | A larger heap or a shorter step | Less garbage a tick; the simulation in a worker |
| A damaged chunk is saved whole | 10 writes in ten seconds of siege | Many chunks under fire at once | Health saved apart from shape |
| Textures on a phone | 1.5 GB of ASTC held; the tab dropped at 2 GB | High and ultra on a phone | A phone's tier with a smaller card budget |

## Not measured

| What | Why it matters |
| --- | --- |
| A quiet `bun run bench` of every row on main | Rows from rounds 7 and 8 have only busy times; the crowd, combat 99th percentile, the breeding base's 99th and medium's 2,048-body frame build missed on the busy run |
| An Android phone, an older iPhone | M1 asked for a second phone; one device decides the touch rule |
| GPU time per pass in a real frame | `?bench=1` has no timer queries per pass yet; the iPhone has none at all |
| The wood with D353's pulled draws on the iPhone | It broke medium before; far draws in the review wood fell from 531 to 905 to 57 to 73 since |
| Far stones and the broadleaf trees' far levels on a phone | Their counts are still moving |
| A soak on medium, the default tier, on a phone | Only high was soaked |
| The governor | Not built |
| Real network congestion and WebSocket send cost under load | The bench uses a modelled link and an in-memory transport |
| Firefox | D07 names it; no run |

## Still moving

### A roof overhead

`r8/l8-roof` (D344, D345). Nothing is measured yet. The lighting design estimated
0.1 MB on the card for a 256-square top-down map on medium and 0.5 MB for 512 on
high and ultra, redrawn when the camera moves 12 m.

### Per-pass timers, a governor and the touch rule

`r8/m2-governor`. Settled: what the soaks show (17 to 27 ms over ten minutes on
high) and that `touchShadows` is unset on every tier. Its timer rows, the
governor's steps and the touch values go here with their runs.

### Broadleaf trees and the stones' far level

Art in progress. The far-node rows above are the bench map's live oaks,
limestones and berry bushes. The delivered trees' far levels took medium's tree
reach from 232 to 641 m to 1,039 to 1,200 m before the band's cut (D342, D354).
Stones reach 321, 515 and 705 m on medium, high and ultra until they have a far
level (D351, cut by the band). Counts and reaches move with the art.

## Recording a result

Run `bun run bench` on an idle machine, three times, and quote the tails as ranges.
Record the commit, the machine line the tool prints and the rows that moved, and
replace the rows here; do not append a section. A budget changes in the same
commit as its reason, here or in a decision.

For a device, run `bun run device` and keep the report: device, OS, browser,
renderer, viewport and pixel ratio are in it. Quote it by its file name and date.
