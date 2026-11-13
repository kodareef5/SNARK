# Integration tests

| File | Holds |
| --- | --- |
| `multiplayer.test.ts` | Join, movement, mutual visibility, structure sync; zero corrections on a clean link; convergence under loss; a hostile client; refusals; a crowded scene within the byte budget |
| `sessions.test.ts` | Spectators, lingering bodies, device keys, the console and its cheats |
| `movement.test.ts` | Swimming, stamina, and movement modifiers, predicted |
| `persistence.test.ts` | Restart round trip; removed content; commit callbacks; three process kills with conservation |
| `determinism.test.ts` | The same scenario under Bun and Node produces the same hashes |
| `items.test.ts`, `equipment.test.ts` | Inventories and the ledger under random moves; hotbar, armor, weapons that hold rounds and attachments |
| `survival.test.ts`, `death.test.ts` | Vitals as rates and deadlines; dying, the cache, the marker, coming back |
| `harvest.test.ts` | Gathering from nodes: what is in reach and what it yields |
| `app.test.ts`, `creator.test.ts` | A whole headless client: screens, keys, the console, chat, voice controls; the character creator |
| `poses.test.ts` | One pose for the server's hit test and every client's drawing |
| `combat.test.ts`, `shooting.test.ts`, `buffs.test.ts`, `structures.test.ts` | Blows by zone and armor; shots with lag compensation; buffs and torpor; damage to things built, and the grenade |
| `round3.test.ts` | Round 3's exit condition as one test; server rules; settings |
| `seams.test.ts` | What round 4 is built on: the body a session drives, who is seen first, whose a thing is |
| `social.test.ts` | Tribes, and the three text channels |
| `voice.test.ts` | The relay with real sessions: tokens, range, mutes, the nearest eight, a hostile client |
| `building.test.ts` | Pieces set down through the client and the server's rules; support and collapse as watchers see it |
| `upkeep.test.ts` | Pieces taken back, mended, taken down; decay |
| `fixtures.test.ts`, `stations.test.ts` | Doors, locks, PINs, boxes and a vault; a campfire that cooks unwatched and a bed to return to life at |
| `creatures.test.ts` | Dormancy and deadlines while dormant; creatures as models; what wild ones do |
| `taming.test.ts` | Taming at the reference's numbers; orders, stances, eating, levels |
| `riding.test.ts` | Saddles, getting on and off, riding with no corrections, a rider hit on the seat |
| `breeding.test.ts` | Pairs, eggs, what hatches, growing up; watched against unwatched across restarts; live birth |
| `round4.test.ts` | Round 4's exit condition as three stories: social, building, creatures |

`fixtures/net.ts` runs a real server and real client sessions in one process on
virtual time. Nothing is mocked. The determinism test is skipped with a message
if Node 24 or later is not installed.

A test that needs a wait runs the virtual clock; none sleeps. A whole day of a
creature growing up is a fraction of a second, because nothing in it steps.
