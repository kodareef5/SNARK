# SNARK: Survival Unstable

A browser survival parody with persistent multiplayer worlds, original creatures,
and PvP built around readable, low-poly 3D.

The engine spine exists: an authoritative Bun server, a predicted client, SQLite
persistence, an asset pipeline, a WebGL2 renderer, and a graybox proving ground
to walk around in. Gameplay beyond walking is planned, not built. Start with the
[roadmap](planning/roadmap.md) and the [architecture](planning/architecture/README.md).

## Run it

```sh
bun install
bun run dev        # http://localhost:8787  (click to capture the mouse; WASD, space, shift)
```

Open the page in two tabs to see two survivors. The world is the proving ground:
a checkered plaza with slopes, stairs, a house, a thin wall, pillars, crates, and
a herd of wandering placeholder creatures.

## Commands

| Command | What it does |
| --- | --- |
| `bun run check` | Policy rules, type checks for every zone, and all tests. Under a second today; fails above 20 s |
| `bun run bench` | Builds the sizing target (8 km, 500,000 structures, 30,000 creatures, 100 players) and holds each measurement to a budget |
| `bun run snap` | Draws the proving ground to `artifacts/snap.png` with a software rasterizer. No browser |
| `bun run probe` | Opens installed Chrome headless once and prints the page's self-check report |
| `bun run dev` | Development server with client rebuild on change |
| `bun run build` | Builds the client into `client/dist` |

Every change passes `bun run check`. There is no browser test suite and there
will not be one: see the [testing policy](planning/quality/testing.md).

## Layout

| Directory | Responsibility |
| --- | --- |
| [planning](planning/README.md) | Decisions, architecture, roadmap, epics, quality |
| [shared](shared/README.md) | Conventions, maths, world, simulation, protocol, content, pack format |
| [content](content/README.md) | Definitions as data |
| [client](client/README.md) | `core`: headless session and frame building. `shell`: WebGL2 and DOM |
| [server](server/README.md) | Game loop, creatures, records, persistence, process entry |
| [tools](tools/README.md) | Check, bench, snapshot, pack build, probe, dev server |
| [tests](tests/README.md) | Unit and integration tests, fixtures |
| [assets](assets/README.md) | Editable art sources and runtime exports |

## Engineering commitments

TypeScript, Bun, SQLite, and browser standards. A custom WebGL2 renderer.
Zero runtime packages; development packages are allow-listed. The server owns
the world; the client predicts with the same simulation code and is corrected by
it. Measure before optimizing and record what was measured. See the
[principles](planning/principles.md) and [decisions](planning/decisions.md).

Work happens on `main` while one builder is active. See the
[working conventions](planning/workflow.md).
