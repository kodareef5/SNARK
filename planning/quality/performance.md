# Performance

The initial goals are 60 FPS on a defined midrange desktop and 30 FPS on supported
constrained devices. These are provisional goals, not measured capabilities.
No device baseline or final numeric asset budget has been accepted yet.

## Record a reproducible workload

For each result, record the commit, Bun/browser version, OS, CPU/GPU, memory,
viewport, pixel ratio, renderer backend, scene seed, camera route, player count,
active/dormant entity counts, content set, network conditions, warm-up, and run
duration. Use the same workload when comparing changes.

## Measure costs independently

| Area | Evidence |
| --- | --- |
| Client | Frame-time distribution and stalls, CPU/GPU cost where available, draw calls, visible geometry, memory |
| Loading | Bytes to join, time to first playable frame, regional asset traffic, cache behavior |
| Server | Tick-time distribution, missed deadlines, active work, scheduled work, memory |
| Network | Bytes per client, update frequency, queue growth, latency and correction behavior |
| Persistence | Transaction/save latency, checkpoint effects, recovery time, backup size |
| Mobile | Sustained frame behavior, memory pressure, touch response, thermal degradation |

Use frustum/spatial culling, instancing, LOD, and bounded scheduling where they
reduce measured work. Compare growing dormant populations with a fixed active
scene to catch accidental full-world ticking. Also measure growing active load;
bounded dormant work alone does not prove PvP capacity.

## Budget decisions

With the first measured scene, select named baseline devices and agree on triangle,
material, texture, animation, draw-call, initial-download, and memory budgets with
art/content. Record accepted numbers and scenario thresholds here. Define server
tick and bandwidth budgets from the multiplayer workload, not from empty scenes.

CI may detect gross regressions under a fixed environment. Headless or shared
CI hardware does not establish the game's hardware FPS guarantee. Run hardware
benchmarks for performance claims and include results with performance-sensitive PRs.
