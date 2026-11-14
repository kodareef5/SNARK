# Performance

Budgets are held by `bun run bench`, which builds the sizing target and exits
non-zero if a measurement exceeds its budget. The target is one world with 100
players, an 8 km square map, 500,000 structures, and 30,000 creatures
([decisions](../decisions.md) D15).

A browser frame rate on a named mid-range device has not been measured yet. The
numbers below are server and headless-client costs, and one headless browser
run on the development machine.

## Measured results

Recorded 2026-11-13 on top of commit `b3eb3e5` (round 4, with breeding). Apple
M5, 10 cores, 24 GB, macOS 26.3.1, Bun 1.4.3. The benchmark world has 250 bases
of 2,000 pieces, 2.6 million resource nodes, 40 players in one fight and 60 in
pairs at other bases, and creatures spread evenly. Players are scripted clients
sending inputs every tick; two of the hundred are full clients.

| Measurement | Result | Budget |
| --- | --- | --- |
| Server tick, median | 2.91 ms | 8 ms |
| Server tick, 99th percentile | 4.20 ms | 16 ms |
| Server tick, worst of 900 | 7.1 ms | 33.3 ms |
| Creatures awake / stepped through collision per tick | 3,342 / 2,271 | |
| Commit, median (every 6 ticks) | 0.16 ms | 4 ms |
| Commit, 99th percentile | 4.0 ms | 10 ms |
| Downstream per client in a 40-player fight | 12.3 KB/s | 34 KB/s |
| Downstream per client at a quiet base | 11.6 KB/s | 16 KB/s |
| Upstream per client | 0.53 KB/s | 2 KB/s |
| Prediction corrections on the two full clients | 0 | |
| Snapshots a full client could not decode | 0 | 0 |
| Live objects gained over 900 ticks, after collection | 2,421 | 5,000 |
| Resident memory, server plus all scripted clients | 462 MB | 2,048 MB |
| Resource nodes on the map | 2,621,440 | |
| Node rows held in memory near 100 players | 279,040 (9 MB) | 40 MB |
| Fill one chunk of nodes | 0.022 ms | 0.2 ms |
| 100 players striking nodes and moving items: tick, median / 99th percentile | 3.00 ms / 7.47 ms | 8 ms / 16 ms |
| The same: commit, 99th percentile | 4.7 ms | 10 ms |
| The same: bytes added per client by working | 0.23 KB/s | 0.3 KB/s |
| 600,000 stored stacks in 10,000 containers: tick, median | 3.00 ms | 8 ms |
| The same: commit, 99th percentile | 1.7 ms | 10 ms |
| Audit every stack in the world against the ledger | 3.3 ms | 1,000 ms |
| Server tick, median, after adding 270,000 dormant creatures | 3.87 ms | 4.86 ms |
| 100 players shooting twice a second, with 300,000 creatures in the world: tick, median / 99th percentile | 4.83 ms / 7.05 ms | 8 ms / 16 ms |
| Fly 2,000 arrows one tick, median / 99th percentile | 0.82 ms / 1.50 ms | 2 ms / 4 ms |
| One grenade blast in a 2,000-piece base, median / worst of 20 | 0.05 ms / 0.45 ms | 1 ms / 4 ms |
| A 1,512-piece house losing all 144 foundations at once, 39 players watching: ticks until the last piece is down | 32 | 60 |
| The same: collapse work in a tick, median / worst | 0.57 ms / 1.61 ms | 1.5 ms / 3 ms |
| The same: whole server tick, worst | 10.1 ms | 16 ms |
| The same: sent to each watcher for all of it (its rows would be 6,048 bytes at least) | 2,540 bytes | 3,024 bytes |
| Ask whether one piece of that house stands | 0.047 ms | 0.1 ms |
| Voice, 100 survivors in one crowd all talking: frames relayed for each packet taken | 8 | 8 |
| The same: relay work for one second of everyone talking | 4.2 ms | 20 ms |
| The same: working out who hears whom, median / worst | 0.19 ms / 0.29 ms | 0.5 ms / 2 ms |
| The same: sent to each listener | 28.7 KB/s | 31 KB/s |
| The same: packets refused or dropped | 0 | 0 |
| A breeding base (300 tames told to mate, 150 young, 100 eggs, ten survivors among them): pairs a second after they were told | 150 | |
| The same: tick, median, before the base / with it awake and mating | 3.78 ms / 4.13 ms | 6.17 ms |
| The same: tick, 99th percentile | 11.7 ms | 16 ms |
| The same: downstream per survivor there | 20.6 KB/s | 34 KB/s |
| The same: survivors there that a full client is not shown, of the other nine | 0 | 0 |
| The same: the look for pairs (one tick in thirty), median / worst | 0.11 ms / 0.14 ms | 0.5 ms / 2 ms |
| The same: worst tick while 150 females laid 176 eggs at once | 6.8 ms | 33.3 ms |
| Save size: 499,764 structures, 310,826 records | 59.3 MB | |
| Load the structures and rebuild the collision grid | 90 ms | 3,000 ms |
| Load 310,826 entity records | 385 ms | 3,000 ms |
| Client frame build, median (8 km map, 4 km view) | 0.05 ms | 1 ms |
| Client frame build, 99th percentile | 0.25 ms | 2 ms |
| Terrain tiles selected | 142 | 200 |
| Structure draw calls within 256 m of a 2,000-piece base | 24 | 300 |
| Triangles submitted | 311,984 | 1,500,000 |
| Client frame build with 300 survivors posed in view, median / 99th percentile | 0.50 ms / 1.04 ms | 4 ms / 8 ms |
| Client frame build with all a view holds (512 bodies: ten survivors, 450 creatures of every age, eggs), median / 99th percentile | 0.49 ms / 1.63 ms | 4 ms / 8 ms |
| The same: bones used, of the 16,384 a frame has | 12,628 | 16,384 |
| Client: take in the 1,512 falling pieces and move the 256 shown, worst frame | 0.33 ms | 1 ms |
| Client frame build while they fall, median / 99th percentile | 0.05 ms / 0.07 ms | 1.5 ms / 3 ms |

The benchmark holds 73 budgets, and all are met. The 99th percentile tick uses
13% of the 33.3 ms step.

Notes on what changed, and why:

- The bytes budget for a collapse is half of what its rows would cost. The
  first run missed it at 3,262 bytes with each run of slots sent as a 16-bit
  slot and a length; sending each run as a gap from the one before met it.
- The two full clients among the hundred had been without bodies since round 3
  gave survivors a look to choose: the benchmark did not give them one, so they
  waited in the creator and the "prediction corrections" row measured nothing.
  They are given a look now. The row is still 0, and is now a measurement.
- "Bytes added per client by working" was 0.04 KB/s when first recorded in
  round 2 and is 0.23 KB/s now, against 0.3. It was already 0.23 before round
  4's last phases; what grew it has not been looked into. It is the row nearest
  its budget, and one run in about ten on this machine has reported one missed
  budget that the next run did not.
- The breeding base's tick budget is the tick there before the base, times
  one and a half, plus half a millisecond: the same form as the dormancy row.
  The worst tick while every female lays at once varied between 7 and 16 ms
  over four runs.

### Round 5: settings

Recorded 2026-11-13 on the commit that closes round 5, on the same machine. The
whole benchmark was run twice: at ARK's defaults, and as a 50x server
(`bun run bench -- --config config/boosted-50x`: experience, taming and
harvesting at 50, stacks at ten times their size, hatching and growing up at
50). Both runs met all 77 budgets.

| Measurement | ARK's defaults | 50x | Budget |
| --- | --- | --- | --- |
| Server tick, median | 2.83 ms | 2.78 ms | 8 ms |
| Server tick, 99th percentile | 3.82 ms | 4.89 ms | 16 ms |
| Tick with everyone working, median | 2.96 ms | 2.99 ms | 8 ms |
| Commit, 99th percentile | 4.2 ms | 4.6 ms | 10 ms |
| Downstream per client in a 40-player fight | 12.3 KB/s | 12.3 KB/s | 34 KB/s |
| Downstream per client at a quiet base | 11.6 KB/s | 11.6 KB/s | 16 KB/s |
| Prediction corrections on the two full clients | 0 | 0 | |
| Process memory | 460 MB | 467 MB | 2,048 MB |

A second section starts a host on the benchmark's own save (64 MB: 500,000
structures, 310,826 records, 600,000 stored stacks) under settings that move
everything a setting can move at a load: hatching, growing up, the wait to
mate, spoiling, fuel, node regrowth, how long bags and caches lie, and the
hunger of every creature and survivor.

| Measurement | Result | Budget |
| --- | --- | --- |
| Start a host on the save, same settings | 374 ms | |
| Start a host on it under other settings | 506 ms | 5,000 ms |
| Of that, the bringing over | 132 ms | 2,000 ms |
| Bodies rated again | 300,550 | |
| The first commit after it | 552 ms | 5,000 ms |
| Item ledger after it | balances | must balance |

The three budgets were set after the first run and are loose: bringing a world
over happens once, at a start, and the requirement is that a full server
restarted under new files is back within seconds, not that it is quick. They
are a guard against the pass becoming quadratic, not a target.

### After the review of round 5

Recorded 2026-11-13 on commit `ee802ed`, on the same machine, with the round 5
commit `4966993` run back to back for the "before" column. The review changed
no feature. It changed how snapshots are built, how a body is tested against
structures, when the database checkpoints, and what a damaged chunk costs.
89 budgets are held, 12 of them new.

| Measurement | Before | After | Budget |
| --- | --- | --- | --- |
| Server tick, median | 2.81 ms | 2.03 ms | 8 ms |
| Server tick, 99th percentile | 3.8 ms | 2.8 ms | 16 ms |
| Server tick, worst of 900 | 11.7 ms | 3.2 ms | 33.3 ms |
| Commit, 99th percentile | 4.9 ms | 0.9 ms | 10 ms |
| Tick with everyone working, median | 2.94 ms | 2.14 ms | 8 ms |
| Tick with 300,000 creatures, median | 3.91 ms | 3.03 ms | |
| Tick in combat, median | 4.72 ms | 3.63 ms | 8 ms |
| Worst tick while a 1,500-piece house fell | 12.7 ms | 8.0 ms | 16 ms |
| Downstream per client in a 40-player fight | 12.3 KB/s | 17.9 KB/s | 34 KB/s |
| Downstream per client at a quiet base | 11.6 KB/s | 12.5 KB/s | 16 KB/s |
| Process memory | 467 MB | 374 MB | 2,048 MB |

Three sections are new. The "before" figures for them were measured with the
same scenes run by hand against the round 5 commit.

| Measurement | Before | After | Budget |
| --- | --- | --- | --- |
| Brawl: all 100 survivors in an 18 m square with 400 creatures, tick median | 3.3 ms | 2.0 ms | 8 ms |
| Brawl: downstream per client | 17.5 KB/s | 31.9 KB/s | 36 KB/s |
| Siege: 100 clients beside a 20,000-piece chunk, 50 pieces damaged a tick, added to the tick | 1.3 ms | 0.25 ms | |
| Siege: sent to each client for the damage | the same | 26.3 KB/s | 30 KB/s |
| Client frame while told of that damage, median | not measured | 0.05 ms | 1 ms |
| Client instance bytes uploaded again for that damage | 420 KB a frame | 0 | 0 |
| A database checkpoint, between ticks | inside a commit | 3 ms | 10 ms |

Downstream went up because the byte budget of a snapshot is now spent. See
below.

## What the results say

**Settings cost nothing per tick.** A rule is read where it is used, as one
lookup in a map; a server at 50x ticks as a server at ARK's defaults does.
Settings that change content are applied to the definitions once, before the
world is built, so the tables the tick reads are the same tables whatever the
settings. Bringing 300,000 bodies and 600,000 stacks over to other settings is
an eighth of a second, and what it changed is written in one commit of half a
second.

**The tick more than doubled between rounds, and is still an eighth of the
step.** Round 1 measured a 1.15 ms median. Round 2 measures 2.60 ms with the
same players and creatures. Every stepped creature now also tests the node
store, and there are nodes everywhere. This is the cost of trees that stop
bodies. It scales with stepped creatures, not with nodes on the map.

**Nodes cost what players are near, not what the map holds.** 2.6 million nodes
are a function, not rows. About a tenth are in memory at once, 9 MB, around 100
players spread over 31 places. Only touched nodes are saved.

**Owner state is close to free.** With every player striking a node and moving
a stack twice a second, a client receives 0.04 KB/s more than when idle. Vitals
cost nothing between changes because clients evaluate them.

**Stored things do not run.** 600,000 stacks, half of them food with spoil
clocks, changed neither the tick nor the commit.

**A crowd costs what it sends, once.** A snapshot used to gather, sort and
quantise the entities around each client, and copy each one's name, colours,
look and gear into a ring of 32 views. A hundred players in one place did that
a hundred times a tick. Now the entities around a chunk are gathered once a
tick for every client centred on it, and the server keeps only the nine fields
a delta compares. What is left grows with clients times entities in view: the
compare and the write, under a millisecond a tick at 100 by 500.

**The byte budget is now spent, on players first.** A snapshot may carry 1,100
bytes of changes. The encoder counted every update at its worst case of 142
bits. A walking body takes 41. In a crowd a snapshot left 60% of its budget
unused and carried a third of the updates it could: every moving body, players
included, was refreshed about three times a second. Updates are now counted
exactly, and players and the mounts they drive go before everything else,
which keeps a quarter of the budget. In the brawl a client is sent every player every tick and each creature about six
times a second, for 31.9 KB/s. A server that wants less sets `snapshotBytes`
lower.

**The slowest tick was the database's.** SQLite checkpointed inside whichever
commit took its log past 1,000 pages, and a commit runs inside a tick: 3 to 6 ms
normally, about 20 ms after a large write. The loop now checkpoints after a
tick that started on time, in the 30 ms the tick leaves. The worst tick of 900
fell from 11.7 ms to 3.2 ms.

**Saving positions was most of a quiet commit.** Each position saved rewrites a
whole record and a database page. The slice of positions saved per commit now
walks only the bodies that can move and gets round them once a minute: 12
records a commit at the sizing target, where it was 30, and no longer four
minutes behind in a world of 300,000 creatures.

**Damage to a big base costs its changes, not its size.** One damaged piece
made the server look at every slot of the chunk for every client watching, and
made each of those clients rebuild and upload the chunk's instances. A chunk
now keeps a log of its last 256 changes, and a client rebuilds only when a
piece is added, removed or replaced.

**A walking body asks the grid half as often.** A structure query takes a
height band, a structure too far off sideways is rejected before any
trigonometry, and a body found clear is not tested a second time. The movement
hashes are unchanged.

**Bandwidth at a quiet base is still the largest line.** 12.5 KB/s against a
16 KB/s budget, almost all of it creatures walking. Sending velocity so that
clients extrapolate would cut it and is not built.

**Instancing every base to the horizon is too much.** With no distance limit the
bench view is 1,026 draw calls and 1.8 million triangles. Distant bases and
distant forests need merged stand-ins. Nodes are drawn within three chunks of
the viewer today, so a forest ends 200 m away.

**Dormancy holds.** Ten times the creatures raised the tick by 1.0 ms, from the
awake count rising from 3,490 to 4,594 as players wandered into denser ground.

**A breeding base costs what its watchers are sent.** 550 creatures and eggs
standing in one place added 0.35 ms to the median tick, and the look for pairs
among them is a tenth of a millisecond once a second. Eggs and growing up are
deadlines and cost nothing between. What grew is the downstream of the ten
survivors walking among them, 20.6 KB/s each, as bodies enter and leave view.

**The check stays fast.** 398 tests run in 9.0 s against a 20 s budget.

## Where the limits are

These are the costs that grow, in the order they would be met. The figures in
the third column are extrapolated from the measurements, not measured.

| Limit | Today | What meets it | What would move it |
| --- | --- | --- | --- |
| One thread runs the tick | 2 ms of 33 at the sizing target, 3.6 ms in combat | About five times the target's awake creatures, or about 400 players in one fight | Snapshot encoding in workers. The entity store is typed arrays, which workers can share without copying |
| Snapshot compare and write | 0.6 ms for 100 clients with 500 entities each | Grows with clients times entities in view | The same, or a per-entity "changed since" stamp so unchanged entities are skipped |
| A damaged chunk is saved whole | 570 KB a commit for a 20,000-piece chunk under fire, 6 to 8 ms at the 99th percentile | Several such chunks under fire at once | Save health apart from shape, or at most once a second |
| The checkpoint is on the tick thread | 3 ms, between ticks | A disk whose sync takes longer than a tick | A second connection in a worker |
| Draw calls on the client | 40 to 80 a frame | One per mesh per visible chunk, so it grows with the variety of pieces and creatures: about 1,500 with 50 kinds in 30 chunks | Merged stand-ins for far chunks, then a WebGPU backend. The renderer backend is `client/shell/gl.ts`, under 400 lines, fed by a packet the core builds |
| Textures and download size | None: every mesh is flat-coloured from a 256-colour palette | The first textured art | Compressed textures (KTX2), arrays or atlases so a chunk stays one draw per mesh, and streaming by distance |

## Browser result so far

`bun run probe -- --bench` on the same machine, headless Chrome 157, ANGLE Metal
renderer, 1280 by 633: all five pixel probes pass, every interface element sits
where the layout put it (19 nodes, 0 misplaced), and over 900 frames of a camera
flying itself the frame interval is 16.7 ms at the median and 16.8 ms at the
99th percentile, with 0.3 ms of main-thread work per frame.

That says the shell works and does not stutter on this machine. It does not say
how much room there is: the interval is the display's, and headless mode on a
fast laptop is not a player's device. `?bench=1` on a real device against
`bun run dev` prints the same report.

## Not measured yet

| Area | Why it matters |
| --- | --- |
| Frame time on a named mid-range desktop, and on a phone | The 60 and 30 FPS goals; `?bench=1` is the tool |
| The 8 km sizing scene in a browser | The client cannot yet be given a map other than the proving ground |
| A client frame with 3,000 awake creatures in view | Per-frame instance upload cost |
| Mobile devices | The 30 FPS goal, memory, thermal behavior |
| Real network conditions | The loopback injects latency, jitter, and loss, but not congestion |
| WebSocket send cost under load | The benchmark uses the in-memory transport |
| A map file larger than the proving ground on a client | Terrain download and upload size |

## Recording a result

Run `bun run bench` on an idle machine. Record the commit, the machine line the
tool prints, and the rows that changed. Replace the table above when the numbers
move; keep the note explaining any budget that was changed and why. A budget is
changed in the same commit as its explanation here.

For browser frame rate, record the device, OS, browser version, renderer string
from the self-check, viewport, pixel ratio, camera route, and duration.
