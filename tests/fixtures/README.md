# Test fixtures

| File | Provides |
| --- | --- |
| `world.ts` | The core registry, compiled once per test process; a flat world, the proving ground, and a sealed room builder |
| `map.ts` | Maps to write as files: flat ground of any size, and a small one with one of everything a file can hold |
| `net.ts` | `Harness`: a host, a lossy virtual-time network, and client sessions with scripted pilots |
| `arena.ts` | Level, dry, empty ground of a given size near the spawn point |
| `build.ts` | Survivors set up to build: cheats, strength, and sixty of every wooden piece in the hotbar |
| `gather.ts` | Finding a resource node and standing a survivor in reach of it |
| `agent.ts` | An agent that plays on the harness: its tools called over the protocol while virtual time runs |
| `pack.ts` | The core asset pack: built once by `bun run check` for every test file, or once per test process run alone |
| `glb.ts` | A glTF binary file written in code, standing in for a Blender export |
| `crash-child.ts` | A process that trades items and commits until it is killed |
| `device.ts` | The device probe's page on the harness: a browser and a phone's GPU made of numbers, a client to watch, a run until done |
| `load.ts` | `hungAfter(file)`: the one time limit every test has, after which it is called hung, stretched with the machine's load and the check's workers; what marks a file of the slow tier |
| `preload.ts` | Loaded before each test file (`bunfig.toml`): sets that limit, and under the check says what each worker is running and what each file cost |
| `needs-art.ts` | `test` and `artTest` for tests that need the art in `assets/`, skipped where it is not here: in the code as shown outside, never in the repository |
| `frames.ts`, `device-reports/` | Frame traces for the governor, and the iPhone's three soaks they replay |
| `cityslice.ts`, `miami-slice.gz` | Downtown Miami's 9 by 9 chunks of a built map, its statics and ground (114 KB), for the city census; cut again by `bun tools/bench/census.ts <map> --cut` |

Fixtures are deterministic: seeded randomness, virtual clocks, generated data.
No real accounts, no copied databases, no large binaries.
