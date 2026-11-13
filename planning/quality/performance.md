# Performance

Budgets are held by `bun run bench`, which builds the sizing target and exits
non-zero if a measurement exceeds its budget. The target is one world with 100
players, an 8 km square map, 500,000 structures, and 30,000 creatures
([decisions](../decisions.md) D15).

A browser frame rate on a named mid-range device has not been measured yet. The
numbers below are server and headless-client costs, and one headless browser
run on the development machine.

## Measured results

Recorded 2026-11-13 at commit `084fc44`. Apple M5, 10 cores, 24 GB, macOS 26.3.1,
Bun 1.4.3. The benchmark world has 250 bases of 2,000 pieces, 2.6 million
resource nodes, 40 players in one fight and 60 in pairs at other bases, and
creatures spread evenly. Players are scripted clients sending inputs every tick;
two of the hundred are full clients.

| Measurement | Result | Budget |
| --- | --- | --- |
| Server tick, median | 2.60 ms | 8 ms |
| Server tick, 99th percentile | 3.97 ms | 16 ms |
| Server tick, worst of 900 | 9.2 ms | 33.3 ms |
| Creatures awake / stepped through collision per tick | 3,343 / 2,257 | |
| Commit, median (every 6 ticks) | 0.16 ms | 4 ms |
| Commit, 99th percentile | 1.0 ms | 10 ms |
| Downstream per client in a 40-player fight | 13.6 KB/s | 34 KB/s |
| Downstream per client at a quiet base | 11.3 KB/s | 16 KB/s |
| Upstream per client | 0.47 KB/s | 2 KB/s |
| Prediction corrections on the two full clients | 0 | |
| Snapshots a full client could not decode | 0 | 0 |
| Live objects gained over 900 ticks, after collection | 2,089 | 5,000 |
| Resident memory, server plus all scripted clients | 344 MB | 2,048 MB |
| Resource nodes on the map | 2,621,440 | |
| Node rows held in memory near 100 players | 279,040 (9 MB) | 40 MB |
| Fill one chunk of nodes | 0.023 ms | 0.2 ms |
| 100 players striking nodes and moving items: tick, median / 99th percentile | 2.97 ms / 8.33 ms | 8 ms / 16 ms |
| The same: commit, 99th percentile | 4.4 ms | 10 ms |
| The same: bytes added per client by owner state | 0.04 KB/s | 0.3 KB/s |
| 600,000 stored stacks in 10,000 containers: tick, median | 2.80 ms | 8 ms |
| The same: commit, 99th percentile | 3.0 ms | 10 ms |
| Audit every stack in the world against the ledger | 2.6 ms | 1,000 ms |
| Server tick, median, after adding 270,000 dormant creatures | 3.60 ms | 4.4 ms |
| Save size: 500,000 structures, 300,100 creatures, 10,000 containers | 55.9 MB | |
| Load 500,000 structures and rebuild the collision grid | 104 ms | 3,000 ms |
| Load 310,100 entity records | 277 ms | 3,000 ms |
| Client frame build, median (8 km map, 4 km view) | 0.05 ms | 1 ms |
| Client frame build, 99th percentile | 0.27 ms | 2 ms |
| Terrain tiles selected | 142 | 200 |
| Structure draw calls within 256 m of a 2,000-piece base | 24 | 300 |
| Triangles submitted | 314,816 | 1,500,000 |
| 100 players shooting twice a second (arrows and rifle rounds), with 300,000 creatures in the world: tick, median / 99th percentile | 4.41 ms / 9.55 ms | 8 ms / 16 ms |
| Fly 2,000 arrows one tick, median / 99th percentile | 0.83 ms / 3.82 ms | 2 ms / 4 ms |
| One grenade blast in a 2,000-piece base, median / worst of 20 | 0.07 ms / 0.35 ms | 1 ms / 4 ms |
| Client frame build with 300 survivors posed in view, median / 99th percentile | 0.47 ms / 0.92 ms | 4 ms / 8 ms |

| A 1,512-piece house losing all 144 foundations at once, 38 players watching: ticks until the last piece is down | 32 | 60 |
| The same: collapse work in a tick, median / worst | 0.56 ms / 1.60 ms | 1.5 ms / 3 ms |
| The same: whole server tick, worst | 9.3 ms | 16 ms |
| The same: sent to each watcher for all of it (its rows would be 6,048 bytes at least) | 2,540 bytes | 3,024 bytes |
| Ask whether one piece of that house stands | 0.045 ms | 0.1 ms |
| Client: take in the 1,512 pieces and move the 256 shown, worst frame | 0.35 ms | 1 ms |
| Client frame build while they fall, median / 99th percentile | 0.05 ms / 0.08 ms | 1.5 ms / 3 ms |

The four rows before these were added with round 3's combat, on the same
machine and day. The collapse rows were added with round 4's building on
2026-11-13, same machine; the benchmark now holds 62 budgets (voice has ten of
them, reported by the tool and in [voice](../architecture/voice.md)). All are
met. The 99th percentile tick uses 12% of the 33.3 ms step.

The bytes budget for a collapse is half of what its rows would cost. The first
run missed it at 3,262 bytes with each run of slots sent as a 16-bit slot and a
length; sending each run as a gap from the one before met it.

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

**The check stays fast.** 133 tests run in 2.7 s against a 20 s budget.

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
