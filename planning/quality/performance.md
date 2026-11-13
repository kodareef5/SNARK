# Performance

Budgets are held by `bun run bench`, which builds the sizing target and exits
non-zero if a measurement exceeds its budget. The target is one world with 100
players, an 8 km square map, 500,000 structures, and 30,000 creatures
([decisions](../decisions.md) D15).

A browser frame rate on named hardware has not been measured yet. The numbers
below are server and headless-client costs.

## Measured results

Recorded 2026-11-12 at commit `551cd8b`. Apple M5, 10 cores, 24 GB, macOS 26.3.1,
Bun 1.4.3. The benchmark world has 250 bases of 2,000 pieces, 40 players in one
fight and 60 in pairs at other bases, and creatures spread evenly. Players are
scripted clients sending inputs every tick; two of the hundred are full clients.

| Measurement | Result | Budget |
| --- | --- | --- |
| Server tick, median | 1.15 ms | 8 ms |
| Server tick, 99th percentile | 1.45 ms | 16 ms |
| Server tick, worst of 900 | 4.9 ms | 33.3 ms |
| Creatures awake / stepped through collision per tick | 3,206 / 2,192 | |
| Commit, median (every 6 ticks) | 0.12 ms | 4 ms |
| Commit, 99th percentile | 1.5 ms | 10 ms |
| First commit of 500,000 structures | 49 ms | 3,000 ms |
| Load 500,000 structures and rebuild the collision grid | 45 ms | 3,000 ms |
| Load 300,100 entity records | 159 ms | 3,000 ms |
| Save size with 500,000 structures and 300,100 creatures | 50.6 MB | |
| Downstream per client in a 40-player fight | 13.6 KB/s | 34 KB/s |
| Downstream per client at a quiet base | 11.7 KB/s | 16 KB/s |
| Upstream per client | 0.47 KB/s | 2 KB/s |
| Prediction corrections on the two full clients | 0 | |
| Snapshots a full client could not decode | 0 | 0 |
| Live objects gained over 900 ticks, after collection | -84 | 5,000 |
| Resident memory, server plus all scripted clients | 224 MB | 2,048 MB |
| Server tick, median, after adding 270,000 dormant creatures | 1.49 ms | 2.22 ms |
| Client frame build, median (8 km map, 4 km view) | 0.05 ms | 1 ms |
| Client frame build, 99th percentile | 0.25 ms | 2 ms |
| Terrain tiles selected | 142 | 200 |
| Structure draw calls within 256 m of a 2,000-piece base | 24 | 300 |
| Triangles submitted | 314,816 | 1,500,000 |

The 99th percentile tick uses 4% of the 33.3 ms step. The simulation in
TypeScript on typed arrays has room to spare at this scale, so there is no
present case for moving it to WebAssembly or to worker threads.

## What the results say about open risks

**Bandwidth at a quiet base missed the first budget.** The first guess was
8 KB/s; the measurement is 11.7 KB/s. About 90 creatures are within interest of
each player, two thirds of them walking, and each moving creature is sent every
tick at about 46 bits. The budget was raised to 16 KB/s, which is 12.5 Mbit/s of
egress for a full server. The per-snapshot byte budget caps any client at
33 KB/s regardless of scene. Two changes would cut this several times over and
are planned, not built: update distant entities less often, and send velocity so
clients extrapolate creatures that walk in a straight line.

**Instancing every base to the horizon is too much.** With no distance limit the
same view is 1,026 draw calls and 1.8 million triangles. Structures are
replicated only within three chunks today, so this does not occur, but it means
a distant base cannot simply be drawn. It needs a merged, simplified stand-in per
chunk.

**Dormancy holds.** Ten times the creatures raised the tick by 0.34 ms, and that
came from the awake count rising from 3,228 to 4,837 as players wandered into
ground that was now denser. Dormant creatures cost memory only.

**The check stays fast.** 51 tests run in 0.7 s against a 20 s budget.

## Browser result so far

`bun run probe` on the same machine, headless Chrome 157, ANGLE Metal renderer:
all five pixel probes pass (sky, plaza, a block face, a point on the 50 degree
slope, a creature), 16 draw calls for the proving ground, and 0.2 ms to build
and submit a frame on the main thread. This shows the WebGL2 shell works.
It is not a frame-rate measurement: the page was not timed over a camera route
and headless mode does not present frames.

## Not measured yet

| Area | Why it matters |
| --- | --- |
| Frame time in a visible browser on a named mid-range desktop | The 60 FPS goal |
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
