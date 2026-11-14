# Test fixtures

| File | Provides |
| --- | --- |
| `world.ts` | A flat world, the proving ground, and a sealed room builder |
| `map.ts` | Maps to write as files: flat ground of any size, and a small one with one of everything a file can hold |
| `net.ts` | `Harness`: a host, a lossy virtual-time network, and client sessions with scripted pilots |
| `arena.ts` | Level, dry, empty ground of a given size near the spawn point |
| `build.ts` | Survivors set up to build: cheats, strength, and sixty of every wooden piece in the hotbar |
| `gather.ts` | Finding a resource node and standing a survivor in reach of it |
| `pack.ts` | The core asset pack, built once per test process |
| `glb.ts` | A glTF binary file written in code, standing in for a Blender export |
| `crash-child.ts` | A process that trades items and commits until it is killed |

Fixtures are deterministic: seeded randomness, virtual clocks, generated data.
No real accounts, no copied databases, no large binaries.
