# Development tools

May import any zone and use Bun built-ins. Nothing in a runtime zone imports
from here.

| Tool | Command | Purpose |
| --- | --- | --- |
| `check.ts` | `bun run check` | The gate: policy rules, zone type checks, tests, time budget |
| `bench.ts` | `bun run bench` | Measurements at the sizing target against budgets |
| `snap.ts`, `snap/` | `bun run snap` | Software rasterizer: a frame packet to a PNG |
| `probe.ts` | `bun run probe` | The single browser launch: Chrome headless, self-check report |
| `dev.ts` | `bun run dev` | Server plus client rebuild on change |
| `build-client.ts` | `bun run build` | Bundle the shell, copy the page, write the core pack |
| `pack/` | `bun tools/pack/build.ts` | glTF import, pack writer, graybox meshes |
| `simhash.ts` | `bun tools/simhash.ts`, `node tools/simhash.ts` | State hash of a fixed scenario, for comparing engines |

`check.ts` holds the allow-list of development packages, the zone import table,
the shell line budget, and the check time budget. Changing any of them is a
decision recorded in [decisions](../planning/decisions.md).

`snap` options: `--pos x,y,z --yaw degrees --pitch degrees --size WxH --out file`.
