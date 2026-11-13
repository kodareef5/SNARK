# Test fixtures

| File | Provides |
| --- | --- |
| `world.ts` | A flat world, the proving ground, and a sealed room builder |
| `net.ts` | `Harness`: a host, a lossy virtual-time network, and client sessions with scripted pilots |
| `glb.ts` | A glTF binary file written in code, standing in for a Blender export |
| `crash-child.ts` | A process that trades items and commits until it is killed |

Fixtures are deterministic: seeded randomness, virtual clocks, generated data.
No real accounts, no copied databases, no large binaries.
