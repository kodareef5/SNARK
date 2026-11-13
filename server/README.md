# Server

The Bun process that owns a world. Headless; no rendering or DOM code.

| File | Contents |
| --- | --- |
| `main.ts` | Process entry: static files, WebSocket adapter, wall-clock tick loop |
| `host.ts` | Assembles world, records, creatures, persistence, and the game loop |
| `game.ts` | Connections, input buffering and validation, player stepping, snapshots, structure sync |
| `world.ts` | The world container |
| `creatures.ts` | Spawning, dormancy, placeholder wander behavior, hunger deadlines |
| `records.ts` | Cold records: name, inventory, vitals, genome |
| `persist/store.ts` | SQLite schema and encoding |
| `persist/persistence.ts` | What each commit contains |

`game.ts`, `creatures.ts`, and `persistence.ts` take no socket and no clock, so
tests run a whole server in memory.

```sh
bun server/main.ts --port 8787 --db var/world.db
```

`--dev` enables the self-check report endpoint and must not be used on a public
server. A login name is not authentication; accounts do not exist yet.

See [authority](../planning/architecture/authority.md),
[scheduling](../planning/architecture/scheduling.md), and
[persistence](../planning/architecture/persistence.md).
