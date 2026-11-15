# Development tools

May import any zone and use Bun built-ins. Nothing in a runtime zone imports
from here.

| Tool | Command | Purpose |
| --- | --- | --- |
| `check.ts` | `bun run check` | The gate: policy rules, zone type checks, tests, time budget |
| `bench.ts` | `bun run bench` | Measurements at the sizing target against budgets |
| `snap.ts`, `snap/` | `bun run snap` | Software rasterizer: a frame packet to a PNG |
| `probe.ts` | `bun run probe` | The single browser launch: Chrome headless, self-check report |
| `probe-textured.ts` | `bun run probe -- --textured` | For each texture variant the GPU takes: test cards of every BC7 mode, BC5 and ASTC block kind through the shell's own upload path, read back against our decoders, and a thatch house drawn by the shell against the software rasterizer, with its pictures saved to `planning/reference/round7-pictures/` |
| `dev.ts` | `bun run dev` | Server plus client rebuild on change |
| `build-client.ts` | `bun run build` | Bundle the shell, copy the page, write the core pack |
| `pack/` | `bun tools/pack/build.ts` | glTF import, pack writer, graybox meshes |
| `simhash.ts` | `bun tools/simhash.ts`, `node tools/simhash.ts` | Hashes of the fixed scenarios in `shared/sim/scenarios.ts` (movement, human pose, snapping, creature pose, tuned content), for comparing engines |
| `device.ts` | `bun run device`, with `--tunnel`, `--self [quick\|ladder\|soak]` | A throwaway server whose short link a phone opens. The page says which device it is on and offers three tests to tap: a quick look at each tier in three scenes; a load ladder that adds bodies, building pieces, triangles and draws until frames break, then texture memory until the device refuses it; and a ten-minute soak. Reports go to `.cache/device/`. `--tunnel` puts it on a temporary Cloudflare address; `--self` has headless Chrome run a test, which must finish |
| `art.ts`, `art/`, `blender/` | `bun run art -- core:raptor`, with `--all`, `--check`, `--sheet`, `--repack` | Builds an asset folder under `assets/source` into its pack, measures it and draws its review sheet ([layout](../assets/source/README.md)). Building needs Blender; the check, the sheet and the game do not |
| `fit-zones.ts` | `bun tools/fit-zones.ts` | Fits the hit capsules to the modelled bodies and measures the match |
| `map.ts`, `map/` | `bun tools/map.ts build <folder> <out.snmap>`, and `unpack`, `proving`, `info` | Builds a map file from a folder of plain layers, turns one back into its folder, writes the proving ground as a file, and says what a file holds. The folder's layout is in the tool's header and in [maps as files](../planning/reference/maps.md) |
| `settings.ts` | `bun run settings` | Writes `planning/reference/settings.md` from the catalogue of server settings; a test fails if the page is stale |
| `sky/` | `bun tools/sky/build.ts`, `bun tools/sky/base.ts`, `bun tools/sky/preview.ts --sheet file` | The sky on lit tiers: the physical sky (after Hillaire 2020) graded to the mood keys and written as the table `client/core/render/skytable.ts` and `assets/source/core/sky/table.png`; the panoramas the keys are painted over; and those panoramas under the table's sky |

`check.ts` holds the allow-list of development packages, the zone import table,
the shell line budget, and the check time budget. Changing any of them is a
decision recorded in [decisions](../planning/decisions.md).

`snap` options: `--pos x,y,z --yaw degrees --pitch degrees --size WxH --out file`.
Yaw 0 faces +Z (north) and positive yaw turns toward +X.
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
`--build --menu` shows the menu for a built piece.

`probe` options: `--bench` also flies the camera for 900 frames and reports
frame times, `--no-voice` leaves out the voice loop, and `--voice` opens a
second page that must hear the first. `CHROME=/path/to/chrome` names the
browser. A headless browser's frame times say little about a player's. For a
real number run `bun run dev` and open `http://localhost:8787/?bench=1` on the
device.
