# Cruise prototype gate

This is the first authored prototype, not the finished cruise ship. It proves the full-height repeated-module approach before expanding the public neighborhoods. The native pack has 416 prototypes and six authored LODs; the map places all 4,962 ship instances plus 992 port/Koru instances, with no rejected placements. The busiest 64 m chunk contains 675 rows.

All evidence here uses pack `7829a30e`, registry `1eccfcee`, and map `8091cc76` (art commit `35b942ce`, preview runner `1e61b2d3`). Later source fixes and port improvements intentionally do not overwrite this baseline.

## Actual native views

The runner uses the authoritative Harness, ordinary App, production mesh/texture streaming, native frame packets and the software Rasterizer. The initial arrival uses the real spawn and authored facing. Interior views use one documented setup placement, then ordinary grounded prediction and camera collision; full walking routes are tested separately. No view is an artist renderer.

- [Arrival and complete ship scale](01-authentic-arrival-scene.png)
- [Deck 9 furnished cabin](interior-cabin_9-medium-scene.png)
- [Clear framed dome aperture](interior-dome_inside-high-scene.png)
- [Dry room beneath the decorative elevated basin](interior-pool_under-high-scene.png)

Review found overlapping bed/sofa faces, an incorrect basin-colored ceiling underside, and a blocked rear dome entrance. Source checkpoint `9537ef69` fixes these; they are visible in this deliberately retained first-pass evidence. The dome still needs finished gallery edges and framing, and the shore approach needs native terminal detail. Elevated basin water is decorative and never registered in the single-height ocean water field.

## Capacity, unchanged budgets

[Full 24-view report](capacity-report.json), [four-view visual report](visual-report.json).

| Tier | Views | Max whole-frame draws / triangles | Max near-ship draws / triangles | Max casters | Per-view median App.frame | Per-view p95 |
|---|---:|---:|---:|---:|---:|---:|
| Medium | 9 | 504 / 563,848 | 487 / 322,166 | 528 | 0.160–0.280 ms | 0.186–0.316 ms |
| High | 15 | 504 / 563,848 | 487 / 322,166 | 734 | 0.146–0.316 ms | 0.163–0.346 ms |

All views had zero dropped/skipped draws, dropped casters, or corrections after settling. Medium retained its 1,024-draw / 2M-triangle budget; high retained 2,048 / 4M. Each CPU sample set covers 180 settled `App.frame` calls and excludes authoritative server stepping, network delivery, rasterization, image encoding, and browser GPU work. Measurements ran without concurrent builds on an i9-13980HX, Linux x86_64, Bun 1.4.3. The largest settled frame was 0.472 ms; these are CPU timings, not GPU FPS.

Cold App.frame reached 53.48 ms and one far-city build unit reached 13.14 ms. The measured streaming-accounting peak was 104,645,053 bytes; this is not measured browser GPU memory. Asset transport has zero latency, unlimited bandwidth and no loss, while native per-frame upload budgets remain enabled. Cold stalls are reported separately rather than hidden by settled results.

The isolated distance views retain map-proxy ownership through 2 km. A separate native integration test then checks actual outward and inward ownership at 115, 180, 220, 280, 650, 900, 1,300 and 2,000 m, with mixed ownership during handover. These results support proceeding without a renderer or budget change; full production content must be measured again.

Reproduce this gate with `bun tools/cruise/review.ts --no-images` using the matching source snapshot. Software RGB does not composite the GPU shadow maps and does not establish identical browser ocean lighting.
