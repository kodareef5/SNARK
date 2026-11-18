# Integration tests

| File | Holds |
| --- | --- |
| `multiplayer.test.ts` | Join, movement, mutual visibility, structure sync; zero corrections on a clean link; convergence under loss; a hostile client; refusals; a crowded scene within the byte budget |
| `latency.test.ts` | Whole clients a round trip from the server, among more walking creatures than a snapshot carries: none steps back and none blinks out |
| `sessions.test.ts` | Spectators, lingering bodies, device keys, the console and its cheats |
| `faults.test.ts`, `hostile.slow.test.ts` | A command whose handler throws: its player put out and refused, the world going on or stopping by the ledger; a hostile client that can do what a survivor can, across fresh worlds (slow tier) |
| `movement.test.ts` | Swimming, stamina, and movement modifiers, predicted |
| `held.test.ts` | Prediction only on ground the client holds as the map's own: a client holding only its body's sector, every other sample poisoned, predicts the body and its car as one holding the whole map, and the seeded simulation hashes the same; one whose body's sector has not come draws it from the snapshots and predicts again once it comes |
| `persistence.test.ts` | Restart round trip; removed content; commit callbacks; three process kills with conservation |
| `survivor-log.test.ts` | The survivor log on a server: a burst of gives as one entry, a walk, a seat in a car, a death and an admin's lines at their wall times, a restart carrying on; no log without a save; switched on and off while running; on its own thread |
| `save-buffs.test.ts` | Buffs across a restart: a fire burns for what was left of it, a dose wears off, a stun is shown again; a save from before buffs were saved |
| `maps.test.ts` | A map made in the test run by a server, its head and parts served by their names from memory or from its build's folder, and walked on; a map built again beside a running server, whose fresh client still gets the map it holds, and a server started after the new one; where its definition starts creatures; a save refused on another map; the proving ground from its file equal to the one its functions build |
| `trip.test.ts` | The map trip's page option: a page told ?trip watches, and draws and sends what one not told does |
| `tactical.test.ts` | The map on an 8 km map: a far base with no chunk sent, whose bases show, cells by zoom within a kilobyte a second, mates and tames as marks, the minimap and the map screen |
| `determinism.test.ts` | The same scenario under Bun and Node produces the same hashes |
| `items.test.ts`, `equipment.test.ts` | Inventories and the ledger under random moves; hotbar, armor, weapons that hold rounds and attachments |
| `survival.test.ts`, `death.test.ts` | Vitals as rates and deadlines; dying, the cache, the marker, coming back |
| `harvest.test.ts` | Gathering from nodes: what is in reach and what it yields |
| `nodecount.test.ts` | A chunk with every one of its 256 nodes used up |
| `app.test.ts`, `creator.test.ts` | A whole headless client: screens, keys, the console, chat, voice controls; the character creator |
| `poses.test.ts` | One pose for the server's hit test and every client's drawing |
| `combat.test.ts`, `shooting.test.ts`, `buffs.test.ts`, `structures.test.ts` | Blows by zone and armor; shots with lag compensation; buffs and torpor; damage to things built, and the grenade |
| `round3.test.ts` | Round 3's exit condition as one test; server rules at the console |
| `seams.test.ts` | What round 4 is built on: the body a session drives, who is seen first, whose a thing is |
| `social.test.ts` | Tribes, and the three text channels |
| `namesakes.test.ts` | Two survivors whose names differ only by capitals: say, mutes, invitations and putting out |
| `voice.test.ts` | The relay with real sessions: tokens, range, mutes, the nearest eight, a hostile client |
| `building.test.ts` | Pieces set down through the client and the server's rules; support and collapse as watchers see it |
| `upkeep.test.ts` | Pieces taken back, mended, taken down; decay |
| `fixtures.test.ts`, `stations.test.ts` | Doors, locks, PINs, boxes and a vault; a campfire that cooks unwatched and a bed to return to life at |
| `creatures.test.ts` | Dormancy and deadlines while dormant; creatures as models; what wild ones do |
| `hunting.test.ts` | Ways round: a hunter round a wall, a base it cannot get into, a yard to flee, a doorway to follow through, a wall put across a way, five hundred at once |
| `taming.test.ts` | Taming at the reference's numbers; orders, stances, eating, levels |
| `dodo.test.ts` | A dodo tamed on berries as the wiki's table has it, and one running from harm at its speed |
| `riding.test.ts` | Saddles, getting on and off, riding with no corrections, a rider hit on the seat |
| `breaches.test.ts` | What the review of 2026-11-14 found open: a wall with a hair between its pieces, a box or a mount kept after leave to use it ended, getting off with no room, a vault coming down on a body, PIN guessing, and what a dead tame leaves |
| `breeding.test.ts` | Pairs, eggs, what hatches, growing up; watched against unwatched across restarts; live birth |
| `round4.test.ts` | Round 4's exit condition as three stories: social, building, creatures |
| `settings.test.ts` | The two files, the command line and the live file as ARK reads them; the report; the console; single-player settings |
| `rates.test.ts`, `pairing.test.ts` | Each factor and switch read where it is used; damage by who dealt it and who took it, PvE, friendly fire |
| `tuned.test.ts`, `stats.test.ts` | Content as a server's settings have it, derived the same by server and client; the join password; what a client shows by the server's leave; stat multipliers and difficulty |
| `retime.test.ts`, `clock.test.ts` | What is under way timed again when its rule changes, live and across a restart; the live file; the day at the server's scales |
| `round5.test.ts` | Round 5's exit condition as four stories: operator, live, client, catalogue |
| `listen.test.ts` | The address a server listens on: a development server on this machine only, unless asked |
| `contracts.test.ts` | The creature packages' places in a host: carrying, taking an egg and the new orders refused until built; a held creature left where its holder puts it |
| `agent.test.ts`, `agent-play.test.ts` | An agent that plays, its tools called over the protocol: both eras of the protocol, progress and cancellation, resources, the key file, observe, the tools that need no walking; then walking round the wall, a crate set down in the way, up stairs, gathering, opening, and stopping for danger |
| `agent-ride.test.ts`, `agent-base.test.ts`, `agent-fight.test.ts`, `agent-tools.test.ts` | The agent's loop through its tools: a raptor tamed, saddled and ridden, a pteranodon flown and landed, a car driven; a hut built and a campfire, a mortar and a forge worked; a bow and a crossbow from range, armour, drinking, swimming and a stair flight; and the smaller tools' refusals; latitude and longitude past 100 |

`fixtures/net.ts` runs a real server and real client sessions in one process on
virtual time. Nothing is mocked. The determinism test is skipped with a message
if Node 24 or later is not installed.

A test that needs a wait runs the virtual clock; none sleeps. A whole day of a
creature growing up is a fraction of a second, because nothing in it steps.
