# SNARK: Survival Unstable

A browser survival parody with persistent multiplayer worlds, original creatures,
and PvP built around readable, low-poly 3D.

Two rounds are built. The engine spine: an authoritative Bun server, a predicted
client, SQLite persistence, an asset pipeline, a WebGL2 renderer. On it, the
survival core: gathering from trees, rocks, and bushes, an inventory with a
ledger, crafting, levels and engrams, vitals, swimming, drowning, death with a
cache and a marker, respawning, and an admin console with cheats and a spectator
camera. Building, creature behavior, taming, combat, and tribes are planned, not
built. Start with the [roadmap](planning/roadmap.md) and the
[gameplay data model](planning/architecture/gameplay-model.md).

## Run it

```sh
bun install
bun run dev        # http://localhost:8787
```

Open the page in two tabs to see two survivors. The world is the proving ground:
a checkered plaza with slopes, stairs, a house, a pool to swim and drown in, and
around it trees, rocks, bushes, and a herd of wandering placeholder creatures.

| Key | Does |
| --- | --- |
| Click | Capture the mouse; then hold to strike a tree or rock |
| W A S D, Space, Shift | Walk, jump (rise when swimming), sprint |
| E | Pick a bush, open a cache, close it |
| I, C, M | Inventory, character (stats, engrams, crafting), map |
| Backquote or Tab | Console. `help` lists commands |
| Escape | Close a screen |

Under `bun run dev` cheats need no password: type `enablecheats`, then try
`give stone 50`, `spawn grazer 150`, `tp 172 256`, `ghost`, `settime 21`,
`spectate`. On a real server set `SNARK_ADMIN_PASSWORD`; without it cheats are
off.

## Commands

| Command | What it does |
| --- | --- |
| `bun run check` | Policy rules, type checks for every zone, and all tests. Under three seconds today; fails above 20 s |
| `bun run bench` | Builds the sizing target (8 km, 500,000 structures, 2.6 million resource nodes, 30,000 creatures, 100 players) and holds each measurement to a budget |
| `bun run snap` | Draws the proving ground to `artifacts/snap.png` with a software rasterizer. No browser. `-- --ui` draws the interface over it |
| `bun run probe` | Opens installed Chrome headless once and prints the page's self-check report. `-- --bench` adds frame times |
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
