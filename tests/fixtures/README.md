# Test fixtures

| File | Provides |
| --- | --- |
| `world.ts` | The core registry, compiled once per test process; a flat world, the proving ground, and a sealed room builder |
| `map.ts` | Maps to write as files: flat ground of any size, and a small one with one of everything a file can hold |
| `net.ts` | `Harness`: a host, a lossy virtual-time network, and client sessions with scripted pilots |
| `arena.ts` | Level, dry, empty ground of a given size near the spawn point |
| `city.ts` | A flat map whose statics are city pieces of the ruin kit, a server on it, and a rocket, a grenade and a rifle round from nobody |
| `sketch.ts` | A building set down by hand on its frame's tiles, with the map's buildings made for it: in a bare store for the support rule, or under a server for a collapse |
| `slots.ts` | Bases built by slot on the store's own path: a first piece by its pose, pieces joined to pieces by a place and a turn, pieces by their place on the base's squares or by frame and key; what the server would say of one; a store's rows mirrored into another |
| `build.ts` | Survivors set up to build: cheats, strength, and sixty of every wooden piece in the hotbar |
| `plans.ts` | Houses as blueprint pieces, a base raised from them straight into a server's rows, the template hammer in a survivor's hotbar, and a blueprint sent up in parts |
| `enemy-scan.ts` | The enemy range answered by reading every slot of the chunks in range, which the claims grid is proved against |
| `gather.ts` | Finding a resource node and standing a survivor in reach of it |
| `agent.ts` | An agent that plays on the harness: its tools called over the protocol while virtual time runs |
| `pack.ts` | The core asset pack: built once by `bun run check` for every test file, or once per test process run alone |
| `glb.ts` | A glTF binary file written in code, standing in for a Blender export |
| `crash-child.ts` | A process that trades items and commits until it is killed |
| `device.ts` | The device probe's page on the harness: a browser and a phone's GPU made of numbers, a client to watch, a run until done |
| `load.ts` | `hungAfter(file)`: the one time limit every test has, after which it is called hung, stretched with the machine's load and the check's workers; what marks a file of the slow tier |
| `preload.ts` | Loaded before each test file (`bunfig.toml`): collects what the last file in the worker left, sets that limit, and under the check says what each worker is running and what each file cost |
| `needs-art.ts` | `test` and `artTest` for tests that need the art in `assets/`, skipped where it is not here: in the code as shown outside, never in the repository |
| `frames.ts`, `device-reports/` | Frame traces for the governor, and the iPhone's three soaks they replay |
| `cityslice.ts`, `miami-slice.gz` | Downtown Miami's 9 by 9 chunks of the 16 km map as built, its statics and ground (136 KB), for the city census; cut again by `bun tools/bench/census.ts <map> --cut` |

Fixtures are deterministic: seeded randomness, virtual clocks, generated data.
No real accounts, no copied databases, no large binaries.
