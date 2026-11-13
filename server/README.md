# Server

The Bun process that owns a world. Headless; no rendering or DOM code.

| File | Contents |
| --- | --- |
| `main.ts` | Process entry: static files, WebSocket adapter for the game and for voice, wall-clock tick loop |
| `host.ts` | Assembles world, records, every system below, persistence, and the game loop |
| `game.ts` | Connections, input buffering and validation, the body each session drives, snapshots by class, structure sync |
| `world.ts` | The world container |
| `records.ts` | Cold records: name, inventory, vitals, genome, team, and what each system keeps on one |
| `own.ts` | What only a survivor's own client is told, and the commands that act on its own things |
| `items.ts` | The only code that edits inventories, and the ledger |
| `survival.ts` | Vitals as rates and deadlines; what stats do to a body |
| `progression.ts` | Experience, levels, engrams, crafting jobs |
| `harvest.ts` | Gathering from resource nodes |
| `death.ts` | Death, caches, markers, the use button, coming back |
| `combat.ts`, `projectiles.ts`, `history.ts` | Blows, the one damage function's caller, shots in flight, and where bodies were for lag compensation |
| `buffs.ts` | What acts on a body for a time |
| `rules.ts` | The numbers an operator may turn |
| `tribes.ts`, `chat.ts` | Who is with whom, and what they write to each other |
| `voice.ts` | The voice relay: who hears whom, and frames passed on undecoded |
| `build.ts`, `decay.ts` | Setting pieces down, acting on them, collapse, and decay |
| `fixtures.ts`, `stations.ts` | Things built that have state: doors, locks, boxes, fires, beds |
| `creatures.ts`, `behavior.ts` | Spawning, dormancy and stepping; what a creature decides to do |
| `taming.ts`, `riding.ts`, `breeding.ts` | Creatures that become somebody's, are told what to do, ridden, and bred |
| `console.ts`, `commands/` | The console and its commands: session, admin, combat, social, creatures |
| `persist/store.ts` | SQLite schema and encoding |
| `persist/persistence.ts` | What each commit contains |

Nothing but `main.ts` takes a socket or a clock, so tests run a whole server in
memory. Almost nothing steps: what happens at a moment is a deadline on one
heap, and what changes steadily is worked out when asked.

```sh
bun server/main.ts --port 8787 --db var/world.db
```

`--dev` enables the self-check report endpoint, cheats without a password, and
rules that hurry taming, hatching and growing up. It must not be used on a
public server. `--cert` and `--key` serve over TLS, which a browser asks for
before it gives a page a microphone anywhere but `localhost`. A login name is not authentication; accounts do not exist yet.

See [authority](../planning/architecture/authority.md),
[scheduling](../planning/architecture/scheduling.md), and
[persistence](../planning/architecture/persistence.md).
