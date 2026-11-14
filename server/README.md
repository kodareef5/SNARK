# Server

The Bun process that owns a world. Headless; no rendering or DOM code.

| File | Contents |
| --- | --- |
| `main.ts` | Process entry: static files, WebSocket adapter for the game and for voice, wall-clock tick loop |
| `host.ts` | Assembles world, records, every system below, persistence, and the game loop |
| `game.ts` | Connections, input buffering and validation, the body each session drives, snapshots by class, structure sync |
| `world.ts` | The world container, made from a map file; the proving ground as one |
| `records.ts` | Cold records: name, inventory, vitals, genome, team, and what each system keeps on one |
| `own.ts` | What only a survivor's own client is told, and the commands that act on its own things |
| `items.ts` | The only code that edits inventories, and the ledger |
| `survival.ts` | Vitals as rates and deadlines; what stats do to a body |
| `progression.ts` | Experience, levels, engrams, crafting jobs |
| `harvest.ts` | Gathering from resource nodes |
| `death.ts` | Death, caches, markers, the use button, coming back |
| `combat.ts`, `projectiles.ts`, `history.ts` | Blows, the one damage function's caller, shots in flight, and where bodies were for lag compensation |
| `buffs.ts` | What acts on a body for a time |
| `tribes.ts`, `chat.ts` | Who is with whom, and what they write to each other |
| `voice.ts` | The voice relay: who hears whom, and frames passed on undecoded |
| `build.ts`, `decay.ts` | Setting pieces down, acting on them, collapse, and decay |
| `fixtures.ts`, `stations.ts` | Things built that have state: doors, locks, boxes, fires, beds |
| `creatures.ts`, `behavior.ts` | Spawning, dormancy and stepping; what a creature decides to do |
| `taming.ts`, `riding.ts`, `breeding.ts` | Creatures that become somebody's, are told what to do, ridden, and bred |
| `settings/` | ARK's settings: the catalogue of them (`row.ts`, `rows-*.ts`, `catalog.ts`), the ini reader, the rules they give (`rules.ts`), reading a config folder, a command line and the live file (`config.ts`), lists that name content (`lists.ts`), and the settings that change content, as a tuning (`tune.ts`) |
| `console.ts`, `commands/` | The console and its commands: session, admin, combat, social, creatures, settings |
| `persist/store.ts` | SQLite schema and encoding |
| `persist/persistence.ts` | What each commit contains |

Nothing but `main.ts` takes a socket or a clock, so tests run a whole server in
memory. Almost nothing steps: what happens at a moment is a deadline on one
heap, and what changes steadily is worked out when asked.

```sh
bun server/main.ts --config config/dev --port 8787 --db var/world.db
```

A server is configured as ARK's is. `--config` names a folder holding
`GameUserSettings.ini` and `Game.ini`; settings of the first may also be given
ARK's way on the command line (`?TamingSpeedMultiplier=5 -NoDinos`), which is
stronger than the files. What was read is reported at start: applied, not yet
effective, of no meaning here, unknown, refused. Settings that change what
content says are applied to the definitions once, before anything reads them
(`contentFor`), and clients are told how as they join. When a rule that times
something changes, the host times again whatever is under way, at a load and
while it runs. Every setting is listed in the
[settings reference](../planning/reference/settings.md), and how a server is
run in the [operator's guide](../planning/reference/operators.md).

`--dev` enables the self-check report endpoint and cheats without a password, and
reads `config/dev` when no other folder is named. It must not be used on a
public server. `--cert` and `--key` serve over TLS, which a browser asks for
before it gives a page a microphone anywhere but `localhost`. A login name is not authentication; accounts do not exist yet.

See [authority](../planning/architecture/authority.md),
[scheduling](../planning/architecture/scheduling.md), and
[persistence](../planning/architecture/persistence.md).
