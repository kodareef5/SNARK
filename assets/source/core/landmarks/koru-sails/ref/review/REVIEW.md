# Native Koru sail review

Accepted native review, 16 November 2026. All 19 views in [the complete report](report.json) use one finished asset pack `2cea6a4e`, content registry `53c37e66` and marina map `d4c249a1`. The selected PNGs below are actual application frame packets rendered by the repository's software rasterizer. Source geometry, materials and six authored levels are the delivered native assets; these are not reference photographs or concept renders.

## Endpoints and motion

[Lowered broadside](01-lowered-broadside-scene.png), [half hoist](03-half-hoist-scene.png), [raised broadside](05-raised-broadside-scene.png), [sunward ivory surface](06-raised-sunward-scene.png), [reversing at half](09-reversed-half-scene.png).

Three quadrilateral gaff mains and two headsails share an 18-second reversible command. The review operates the actual control with **E** on one client; a separate client observes the reliable synchronized state. Every intermediate pose follows server time. The operator is placed once on the real control deck; exterior review cameras are explicitly placed spectators. This is automated native evidence, not a claim of manual play.

The yacht remains moored and walkable. Cloth folds through connected skinned strips; the gaff uniformly retracts during lowering and returns to its exact full-size geometry when raised. This is a deliberately simplified visual hoist, with no wind or cloth simulation. The former projecting head-cloth neck is absent in the final midpoint view.

## Ordinary access and cameras

[Untouched shore arrival](10-raised-shore-arrival-scene.png), [portrait control prompt](12-control-portrait.png), and grounded sun-deck views [lowered](11-sun-deck-lowered-scene.png), [half](11-sun-deck-half-scene.png), [raised](11-sun-deck-raised-scene.png).

The shore observer uses the authored spawn and facing. Deck observers are placed once on real floors, then use ordinary walking prediction and camera collision. Those views assert grounded walking, dry feet and a free camera capsule. They show the real deck under the overhead cloth. Full traversal and actual packed-geometry headroom are covered by separate native route and clearance audits; placing a review camera is not counted as walking a route.

The final portrait uses the native font's supported separator. Some development HUD captures include one initial placement correction; every view records **zero corrections after settling**.

## Distance, levels and shadows

[Flat lowered](07-lowered-flat-scene.png), [flat raised](08-raised-flat-scene.png), [280 m raised](far-280m-raised-scene.png), [650 m raised](far-650m-raised-scene.png), [650 m half](far-650m-half-scene.png), [900 m raised](far-900m-raised-scene.png).

All five meshes remain owned by the dedicated sail pass through near/far city handover. Native tests move a real observer through 115, 280, 650 and 900 metres and back while the authoritative hoist advances, including when ordinary nearby controller rows are absent. These views exercise L0, L2 and L5; packed-asset audits cover all six authored levels. Thin stays and rigging naturally become subpixel at distant views. Raised endpoint rendering uses five rest bones; folded and moving sails use 227 bones within the existing allocator. The native test also verifies whole-assembly omission under an insufficient bone budget.

Every final view records zero dropped draws, skipped draws and dropped casters. Sail casters use the native posed geometry and bounds. A separate fixed-camera test rasterizes actual folded and raised caster lists into shadow-cascade depth: both contain cloth depth, and raised projected coverage exceeds folded coverage by more than two times. **The RGB software path does not composite shadow maps**, so these PNGs establish visible geometry/materials and camera clearance, not GPU shadow appearance or GPU frame rate.

## Scoped CPU measurement

The report records 180 observer `App.frame` samples per view after at least 30 quiet streaming frames. Intermediate views sample the advancing phase range recorded in each row; endpoint samples are settled. Across the 19 views:

| Per-view statistic | Minimum | Maximum |
| --- | ---: | ---: |
| Median | 0.162 ms | 0.554 ms |
| p95 | 0.184 ms | 0.597 ms |
| p99 | 0.199 ms | 0.801 ms |
| Maximum | 0.208 ms | 0.834 ms |

These are ranges of each view's statistic, not pooled percentiles. Host: Intel Core i9-13980HX, 32 logical CPUs, Linux 7.0.0-38 x86_64, Bun 1.4.3. Sampling excludes the operator application, server stepping, network delivery, software rasterization, encoding and GPU work. The development HUD's virtual 60 Hz is not a measured frame rate.

Reproduce from the repository root:

```sh
bun tools/koru-sails/review.ts --source assets/source --out var/koru-sails-preview/review
bun test tests/integration/koru-sails-render.test.ts
```

The isolated preview uses port 8793 and `var/koru-sails-preview/world.db`. Ports 8790–8792 and their saves are independent. See [the source and bounds documentation](../../README.md) for authoring and packed-geometry checks, and [the original yacht reference provenance](../../../koru/ref/REFERENCES.md) for the real vessel's source imagery.
