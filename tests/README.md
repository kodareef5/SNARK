# Tests

Run with `bun run check`, which leaves out the slow tier (files named
`*.slow.test.ts`); `bun run slow` runs those, and `bun test` alone runs both.
All of them run in Bun; none opens a browser. See the
[testing policy](../planning/quality/testing.md).

| Directory | Purpose |
| --- | --- |
| [unit](unit/README.md) | One module at a time: codec, world, controller, packs, rendering, HUD, simulation rules |
| [integration](integration/README.md) | A server with clients on the in-memory transport; SQLite; process kills; a second engine |
| [fixtures](fixtures/README.md) | Small worlds, the multiplayer harness, a generated glTF file, the crash child |
| [performance](performance/README.md) | Notes on `bun run bench`, which lives in `tools/bench.ts` |

Tests may import any zone except `client/shell`. Temporary databases go in the
system temporary directory and are removed afterward.
