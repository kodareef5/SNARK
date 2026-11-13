# SNARK: Survival Unstable

A browser survival parody with persistent multiplayer worlds, original creatures,
and PvP built around readable, low-poly 3D.

Start with the [planning index](planning/README.md),
[roadmap](planning/roadmap.md), and [working conventions](planning/workflow.md).
The repository currently contains plans and directory stubs. There is no runnable
game, installed toolchain, automated test suite, or CI workflow yet.

## Project layout

| Directory | Responsibility |
| --- | --- |
| [planning](planning/README.md) | Decisions, research, epics, acceptance scenarios, and team coordination |
| [client](client/README.md) | Browser rendering, input, UI, audio, and prediction |
| [server](server/README.md) | Authoritative simulation, connections, and durable state |
| [shared](shared/README.md) | Portable TypeScript contracts and pure logic |
| [content](content/README.md) | Gameplay definitions for items, creatures, structures, and maps |
| [assets](assets/README.md) | Editable art and browser-ready exports |
| [tools](tools/README.md) | Build, asset, and development tools |
| [tests](tests/README.md) | Future behavioral tests and reusable fixtures |

## Engineering commitments

Use TypeScript, Bun, SQLite, and browser standards. Build a custom WebGL2 renderer
with Chrome as the primary target and Firefox, iOS Safari, and mobile constraints
considered from the first client. WebGPU is out of scope.

The game has zero third-party runtime packages. Pinned development tools are
allowed. Keep gameplay authoritative on the server, measure performance, and test
in browsers. Preserve survival depth while removing meshing, collision exploits,
and duplication. See the [principles](planning/principles.md).

Use feature branches and PRs, with separate clones for remote teams. Update plans
with the changes they describe. The repository is the shared project record.
