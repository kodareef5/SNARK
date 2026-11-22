# Tests

To write a test, start from the [cookbook](COOKBOOK.md): fifteen recipes on the kit in [kit](kit/kit.ts).

Tests live by area, one folder each, flat inside it. A test of one module and a
test of a whole server with clients sit side by side; where both had one name,
the second is `<name>-play.test.ts`. A slow test is named `*.slow.test.ts` and
stays in its area.

| Area | Holds |
| --- | --- |
| `agents` | Players that are programs: the agent and its tools, grunt, the cast |
| `assets` | Packs, textures, the art tool, streaming and what the page stores |
| `build` | Pieces: placing, joins, support, collapse, doors and boxes, upkeep |
| `combat` | Weapons, shots, blows, buffs, damage |
| `creatures` | Poses, taming, breeding, riding, corpses, flyers, each species |
| `items` | Inventories, crafting stations, loot, gathering, supply drops |
| `net` | The wire, sessions, prediction under latency and loss |
| `render` | The frame: what is drawn, lit, shadowed and left out, on every tier |
| `server` | The tick, saves, settings, content packs, admin, clusters |
| `sound` | Sounds, music, voice |
| `survivor` | A survivor's body: walking, swimming, gliding, vitals, death, emotes |
| `tools` | The check, the build, the wiki, the device probe |
| `ui` | The HUD, screens, pads and touch, cameras and sights |
| `vehicles` | Cars, boats, helicopters: handling, contacts, seats, sites |
| `world` | Ground, maps and their files, ways, water, streets, landmarks |

A feature's name wins over its layer: `vehicle-sound.test.ts` is in `vehicles`,
not `sound`. Put a new test with its kin. Add an area only when a real group
has no home.

```
bun test tests/vehicles/zephyr-thrusters.test.ts   one file
bun run check -- tests/vehicles tests/net/wire.test.ts
                                                   policy, types and those tests
bun run check -- --smoke                           policy, types and tests/smoke.txt
bun run check                                      everything fast: the gate, to land
bun run slow                                       the slow tier alone
```

The smoke set is [smoke.txt](smoke.txt): about twenty cheap files that walk the
spine of the game. Where the art is not installed, a test that needs it is
skipped ([needs-art.ts](fixtures/needs-art.ts)) and the check fails as not a
gate; `bun run check -- --no-art` passes and counts them.

[kit](kit/kit.ts) holds the test kit, its own tests and the cookbook's recipes
(`bun run check -- tests/kit` runs them). [fixtures](fixtures/README.md) holds
small worlds, the multiplayer harness and the crash child. [performance](performance/README.md) holds notes on
`bun run bench`. Tests may import any zone except `client/shell`. Temporary
databases go in the system's temporary folder and are removed afterward.

A branch from before the move may still add files to `tests/unit` or
`tests/integration`. Merge it with `git -c merge.directoryRenames=false merge`,
or git guesses an area for each new file and calls it a conflict. Then
`bun tools/test-area.ts --move --paths` moves them to their areas and rewrites
the old paths named in text.
