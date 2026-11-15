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
| `spawner.ts` | The map's spawn regions kept stocked with wild creatures, at ARK's pace and away from survivors and bases |
| `taming.ts`, `riding.ts`, `breeding.ts` | Creatures that become somebody's, are told what to do, ridden, and bred |
| `eggs.ts`, `feces.ts` | Eggs as things, taken up, kept and set down; what creatures leave when they go, and the eggs laid in its place |
| `settings/` | ARK's settings: the catalogue of them (`row.ts`, `rows-*.ts`, `catalog.ts`), the ini reader, the rules they give (`rules.ts`), reading a config folder, a command line and the live file (`config.ts`), lists that name content (`lists.ts`), the settings that change content, as a tuning (`tune.ts`), and those that change the spawn tables (`spawns.ts`) |
| `console.ts`, `commands/` | The console and its commands: session, admin, combat, social, creatures, settings |
| `persist/store.ts`, `persist/codec.ts` | SQLite schema, and a record as bytes, the form a save keeps it in and a transfer carries it in |
| `persist/persistence.ts` | What each commit contains |
| `cluster/` | The servers of a cluster: the shared folder (`folder.ts`), a transfer's sealed file (`parcel.ts`), travel, recovery and the travel list (`cluster.ts`), and whether the cluster balances (`audit.ts`) |

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

## A cluster

Servers of one cluster share a folder and nothing else; a survivor travels between them with what it carries
([transfers](../planning/architecture/transfers.md)). Give each the same `-clusterid`, a save of its own, and a port of its
own. Two maps on one machine, from the repository's root once `bun run build` has made the client and
`bun tools/mapworld/build.ts miami` and `bun tools/mapworld/build.ts tampa` the maps:

```sh
bun server/main.ts --dev --host 0.0.0.0 --map var/maps/miami.snmap --port 8798 --db var/cluster/miami.db -clusterid=florida
bun server/main.ts --dev --host 0.0.0.0 --map var/maps/tampa.snmap --port 8799 --db var/cluster/tampa.db -clusterid=florida
```

The saves are beside each other, so both servers share the folder `var/cluster/clusters/florida`; `-ClusterDirOverride=<folder>`
puts it anywhere else on this machine. A new save takes the lowest world id the cluster has not given out; two saves made
outside a cluster are both world 1, so only one of them can join. Open `http://localhost:8798` (from a phone,
`http://<this machine's address>:8798`), press L for the travel list and choose Tampa: the page goes to port 8799 and the
survivor arrives at its spawn point. L there and Miami bring it back to where it stood. `travel` in the console lists and
leaves the same way. A survivor whose page closed on the way, or that was turned away, is back on the server it left as soon
as its owner joins there, and by itself after ten minutes. Reached through tunnels, give each server
`--public-url https://<its own tunnel's host>`, and a page that came by one goes by the other's. An operator's `cluster`
lists the cluster and who is away, and `cluster audit` says whether every item of it is accounted for.

See [authority](../planning/architecture/authority.md),
[scheduling](../planning/architecture/scheduling.md), and
[persistence](../planning/architecture/persistence.md).
