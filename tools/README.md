# Development tools

May import any zone and use Bun built-ins. Nothing in a runtime zone imports
from here.

| Tool | Command | Purpose |
| --- | --- | --- |
| `check.ts` | `bun run check` | The gate, one at a time on a machine: policy rules, zone type checks, every fast test. Given folders or files of tests, or `--smoke`, a look at those while building |
| `test-area.ts` | `bun tools/test-area.ts --move --paths` | Moves test files a branch left in `tests/unit` or `tests/integration` to their areas, by `test-areas.json`, and rewrites the old paths named in text |
| `bench.ts` | `bun run bench` | Measurements at the sizing target against budgets. `-- --parts` adds the comparison of our part compression with zlib and Brotli, which takes minutes |
| `snap.ts`, `snap/` | `bun run snap` | Software rasterizer: a frame packet to a PNG |
| `probe.ts` | `bun run probe` | The single browser launch: Chrome headless, self-check report |
| `probe-textured.ts` | `bun run probe -- --textured` | For each texture variant the GPU takes: test cards of every BC7 mode, BC5 and ASTC block kind through the shell's own upload path, read back against our decoders, and a thatch house drawn by the shell against the software rasterizer, with its pictures saved to `planning/reference/round7-pictures/` |
| `probe-lit.ts`, `probe-lit/` | `bun run probe -- --lit` | The frames core builds at the lit tiers, drawn by the shell and held to the software rasterizer and to each check's own measures: a check is a file under `probe-lit/` and a line in the tool. The depth check reads the depth buffer's bits, the far range keeping 0.3 m of sea over ground 2 km off, the near range in front of the far, and the seam between them dry and under the sea |
| `dev.ts` | `bun run dev` | Server plus client rebuild on change |
| `build-client.ts` | `bun run build`, with `--stress`, `--quick` (quicker Brotli) and `--dist DIR` | Bundle the shell, copy the page, write the core pack. A tool that goes on running builds through `buildClientApart`, in a process of its own; only a plain `bun run build` is weighed |
| `page-script.ts` | `bun tools/page-script.ts --check [DIR]` | The page's script as the build writes it: `main.js` and `page.js` for the first frame, the late files taking what they share from `page.js` (D1106); the check's "script" step builds it without art and checks that shape |
| `script-notes.ts` | (used by the build) | What a player is sent of comments: none. Takes shader notes and empty lines out of the scripts and comments out of the page, checks the scripts mean the same, and counts what is left (D1108) |
| `pack/` | `bun tools/pack/build.ts` | glTF import, pack writer, graybox meshes |
| `first-frame.ts` | `bun tools/sizes.ts --first-frame [client folder]` | What the first frame downloads, part by part and the page's script by module and folder, as every build writes it beside the client (`first-frame.json`), against the last build; `/admin/first-frame.html` shows the same |
| `reports.ts` | `bun tools/reports.ts list`, `show N`, `perf N`, `events N`, `log N [errors]`, `net N`, `done N "<line>"`, `reopen N`, `delete N`, `path N`, with `--dir` | Captures saved from the debug bar with F8 (`var/reports/NNNN`), and the notes of bug report mode before it: `report.md` first, the pictures' paths, the performance record and where a frame's time went, the lag events, the log and the socket by category |
| `report-trip.ts` | `bun tools/report-trip.ts --dist <built client>`, with `--canvas 1800x962@2`, `--seconds`, `--reports` | The proof of the debug bar: a dev server and headless Chrome turn the bar on, throw a page error and log a server line, take a picture of each tab, save a capture with words, and read it back; prints what the bar and a picture cost, and the first frame's bytes |
| `ticks.ts` | `bun tools/ticks.ts http://127.0.0.1:8787/admin/ticks.json`, or a saved copy, with `--all` | A server's long ticks as its own record keeps them (`server/admin/parts.ts`): each called its own work, waiting for a core or waiting for pages by the process's counters over it, with the parts its own time went to |
| `simhash.ts` | `bun tools/simhash.ts`, `node tools/simhash.ts` | Hashes of the fixed scenarios in `shared/sim/scenarios.ts` (movement, human pose, snapping, creature pose, tuned content), for comparing engines |
| `device.ts` | `bun run device`, with `--tunnel`, `--terrain`, `--self [quick\|ladder\|soak\|terrain]`, and for `--self` `--texfmt`, `--assetnet`, `--rebuild` | A throwaway server whose short link a phone opens. The page says which device it is on and offers three tests to tap: a quick look that asks the GPU questions round 8 leans on (depth bits, `depthRange`, compared lookups, a 16-bit depth array, an RGBA8 3D texture, units, uniform blocks, and what depth, full-screen and draw passes cost) and then draws each tier in three scenes; a load ladder that adds bodies, building pieces, triangles and draws until frames break, then texture memory, sampled by a draw and read back, until the device refuses it; and a ten-minute soak. With `--terrain` the server is on the bench's 8 km map and the page offers only the terrain flight (D253): a minute over the ground at medium and at low poly, jumping 2 km every 10 s. Reports go to `.cache/device/`. It serves a client built into a temporary folder of its own, so a build in the checkout cannot change what a phone fetches, and a report says if what it serves changed. `--tunnel` puts it on a temporary Cloudflare address; `--self` has headless Chrome run a test, which must finish, forced to a texture variant with `--texfmt`, over a made-up asset link with `--assetnet delay,KB/s,%lost`, or with a plain build of client/dist beside it with `--rebuild` |
| `art.ts`, `art/`, `blender/` | `bun run art -- core:raptor`, with `--all`, `--check`, `--sheet`, `--repack` | Builds an asset folder under `assets/source` into its pack, measures it and draws its review sheet ([layout](../assets/source/README.md)). Building needs Blender; the check, the sheet and the game do not |
| `fit-zones.ts` | `bun tools/fit-zones.ts`, `bun tools/fit-zones.ts core:dodo` | Fits the hit capsules to the modelled bodies and measures the match; given a creature, measures the capsules its build fitted |
| `map.ts`, `map/` | `bun tools/map.ts build <folder> <out.snmap>`, and `unpack`, `proving`, `info`, `pack` | Builds a map file from a folder of plain layers, turns one back into its folder, writes the proving ground as a file, says what a file holds, and writes the copies a server sends (`map/pack.ts`, which holds a built map to its byte budgets). The folder's layout is in the tool's header and in [maps as files](../planning/reference/maps.md) |
| `mapworld/` | `bun tools/mapworld/build.ts miami`, and `walk.ts`, `views.ts`, `pictures.ts` | A playable map file from a painted map's base layers: ground, colour, nodes, spawn points and regions, with a slot for layers of statics. See its [README](mapworld/README.md) |
| `settings.ts` | `bun run settings` | Writes `planning/reference/settings.md` from the catalogue of server settings; a test fails if the page is stale |
| `sky/` | `bun tools/sky/build.ts`, `bun tools/sky/base.ts`, `bun tools/sky/preview.ts --sheet file` | The sky on lit tiers: the physical sky (after Hillaire 2020) graded to the mood keys and written as the table `client/core/render/skytable.ts` and `assets/source/core/sky/table.png`; the panoramas the keys are painted over; and those panoramas under the table's sky |

`check.ts` holds the allow-list of development packages and the zone import table.
It prints the line count of each untested client zone and fails on none.

`snap` options: `--pos x,y,z --yaw degrees --pitch degrees --size WxH --out file`.
Yaw 0 faces +Z (north) and positive yaw turns toward +X. `--map file.snmap`
draws that map in place of the proving ground, from its first spawn point
unless `--pos` says otherwise.
Scenes: `--ui`, `--poses N`, `--looks`, `--gear`, `--fight bow`, `--creator`,
`--house`, `--build`, `--falling`, and `--creatures` (with `--near` for a rider
up close, `--young` for each species at four ages beside its egg).
`--graphics lowpoly|medium|high|ultra|all` draws as a client on that tier does,
textures and all, once its card is full; `--view close|far|wall|floor` with
`--house`, and `--source DIR` for another tree's asset folders. See
[looking at an asset](../assets/source/README.md#looking-at-an-asset).
With `--ui`: `--console "text"` types a console line, `--inventory` opens the
inventory, `--chat` opens the chat box. `--face degrees` turns a line-up.
`--house` takes a tier (`thatch`, `wood`, `stone`, `metal`), and with
`--falling ms` shows the house that long after a corner foundation went.
`--build --menu` shows the menu for a built piece. `--used x,z` uses up the
node standing nearest that place, so its stump or stripped bush is drawn.

`probe` options: `--bench` also flies the camera for 900 frames and reports
frame times, `--no-voice` leaves out the voice loop, and `--voice` opens a
second page that must hear the first. `CHROME=/path/to/chrome` names the
browser. A headless browser's frame times say little about a player's. For a
real number run `bun run dev` and open `http://localhost:8787/?bench=1` on the
device.
