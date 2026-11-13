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

## What the results say

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

**Bandwidth at a quiet base is still the largest line.** 11.3 KB/s against a
16 KB/s budget, almost all of it creatures walking. The two changes that would
cut it (update distant entities less often; send velocity so clients
extrapolate) are planned, not built.

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

**The check stays fast.** 327 tests run in 7.7 s against a 20 s budget.

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
