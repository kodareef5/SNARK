# Native Koru review

Accepted 2026-11-16: **18 native App views** of the full-scale moored yacht, including all four walkable floors, real shore arrival, boarding, stairs, portrait, flat detail and distant handovers. All views use one finished state: pack `570bb4a5`, content `4dce9e09`, map `f5b2d910`. The final artwork is `c35bdda7`; complete far proxies are `d75cbe06`. [Full per-view evidence](report.json) records cameras, physical support, streaming ownership, draw counts, hashes and timing.

The pipeline is native map → authoritative Harness → normal App → streamed production packs → native frame packet → software Rasterizer. The first arrival uses the genuine terrain spawn and authored yaw, with no placement or camera override. Other interior views use one documented setup placement, then ordinary grounded prediction and camera collision; exterior views identify their spectator placement. Separate native route tests walk from shore through the gangway and all floors using player input, including delayed peers and persistence. These are automated native checks, not a claim of manual play.

Every captured walking view remained supported and dry; full-silhouette views passed both framing and physical sightline checks. All 18 views had **zero settled prediction corrections and zero dropped/skipped draws or shadow casters**. A setup correction visible in some debug HUDs precedes the settled measurement. Native far geometry passes cross-section checks through every mast segment at both proxy levels; 280 m shows all three complete shafts through mixed ownership. At 650–900 m, thin rigging and tapered tips become subpixel in the 1200×800 software image. No renderer workaround was introduced.

| Evidence | Native images |
| --- | --- |
| Arrival and scale | [Shore arrival](01-authentic-arrival-scene.png), [port profile and utility launch](03-port-profile-scene.png) |
| Boarding | [Port gangway](06-port-gangway-scene.png) |
| Four floors | [Lower corridor](07-lower-interior-scene.png), [main salon](08-main-salon-scene.png), [upper bridge](09-upper-bridge-scene.png), [sun terrace](10-sun-terrace-scene.png) |
| Normal cameras | [Grand stairs](11-grand-stair-scene.png), [portrait HUD](12-portrait-arrival-lobby.png), [shoulder view with survivor scale and Galley and Pantry plaque](15-shoulder-stair-scene.png) |
| Flat detail | [Profile](13-flat-profile-scene.png), [salon](14-flat-main-salon-scene.png) |
| Distant identity | [280 m](16-far-280m-scene.png), [900 m](18-far-900m-scene.png) |

CPU sampling used Bun 1.4.3 on an Intel Core i9-13980HX Linux workstation, with other authoring/build jobs idle. Each view waited for 30 quiet streaming frames and then measured **180 `App.frame` calls**. The ranges below span the 18 per-view statistics; they are not pooled quantiles.

| Per-view statistic | Range across views |
| --- | --- |
| Median | 0.099–0.410 ms |
| 95th percentile | 0.120–0.468 ms |
| 99th percentile | 0.129–0.568 ms |
| Maximum | 0.149–0.583 ms |

These wall times exclude authoritative server stepping, network delivery, software rasterization, image encoding and browser GPU work. They do not establish GPU frame rate or identical lit-ocean shading. The actual browser uses the same scene packets and asset pipeline; the software captures retain their stated rendering limits.

Reproduce from the repository root with `bun tools/koru/review.ts`. The isolated playable preview is `bun tools/koru/dev.ts` (port 8792, `var/koru-preview/world.db`); existing helicopter and utility-boat previews use their separate ports and saves. [Reference attribution and reconstruction provenance](../REFERENCES.md) distinguish the published exterior proportions from the original interior arrangement.
