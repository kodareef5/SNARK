# SNARK: Survival Unstable

A browser survival parody with persistent multiplayer worlds, original creatures,
and PvP built around readable, low-poly 3D.

Five rounds are built. The engine spine: an authoritative Bun server, a predicted
client, SQLite persistence, an asset pipeline, a WebGL2 renderer. On it, the
survival core (gathering, an inventory with a ledger, crafting, levels and
engrams, vitals, swimming, death with a cache and a marker, an admin console
with cheats and a spectator camera); combat (a survivor with a skeleton and a
character creator, melee, bows and guns with lag compensation, hit zones, armor,
buffs and torpor, grenades and structure damage); and a first working example
of each larger module: tribes, text chat and voice relayed through the server,
building with snapping, support and collapse, doors, locks, boxes, a campfire
and a bed, creatures that hunt or flee, taming, commanding, riding, and
breeding. And a server configured as an ARK server is: its two ini files, its
command line and its live file, with 115 of its settings taking effect and
the rest read, checked and listed as waiting for what they wait for. Start with
the [roadmap](planning/roadmap.md), the
[gameplay data model](planning/architecture/gameplay-model.md), and, to run a
server, the [operator's guide](planning/reference/operators.md).

## Run it

```sh
bun install
bun run dev        # http://localhost:8787
```

The page remembers its default survivor and device key in local storage, so a
reload returns to the same survivor. To play two survivors in separate tabs,
open `http://localhost:8787/?name=Ada` and `http://localhost:8787/?name=Bea`.
An explicit name selects that survivor without replacing the saved default;
another tab with the same name and key takes over its connection. Clearing
local storage loses the key. If storage is unavailable, identity lasts only for
that page load. An older unnamed survivor is recoverable with `?name=OldName`
while its device key is still saved; the former timer-generated name cannot be
inferred automatically.

The world is the proving ground:
a checkered plaza with slopes, stairs, a house, a pool to swim and drown in, and
around it trees, rocks, bushes, a herd of parasaurs, and further off a few
raptors that will come for you.

| Key | Does |
| --- | --- |
| Click | Capture the mouse; then the weapon in hand: hold to swing, hold and let go to draw and loose a bow, press to fire a gun |
| Right mouse | Aim: the view narrows, far more through a scope |
| W A S D, Space, Shift | Walk, jump (rise when swimming), sprint |
| C, X | Crouch, lie prone; press again to stand |
| 1 to 0 | Take that hotbar slot in hand, or put it away |
| R | Reload |
| G | Let a drawn bow down without loosing. With a melee weapon in hand, swing it |
| V | Look from behind the body, or from its eyes |
| E | At an obelisk's terminal, the other servers of the cluster to travel to with all you carry ([server/README.md](server/README.md)). Pick a bush, open a cache or a box, open a door, get on a saddled creature of your tribe and off it, get into a car by the door you stand at (the driver's or the passenger's) and out of it, pull a car's driver out, take a young creature that is nobody's, look into one that is unconscious or yours. Held on something built: what can be done to it |
| In a car | W and S throttle and brake (held S reverses once stopped), A and D steer, Space the handbrake, E get out. A passenger looks and shoots out of the window |
| F | Look into the creature you ride or look at: follow or stay, its stance, its saddle, whether it may mate, its levels |
| T, Y, J, U | Whistle the creature looked at to follow, to stay; all of them to follow, to stay |
| Building piece in hand | Left button sets it down where it is shown. E turns it, Q takes the next nearest place (held: open ground), R changes a wall to a doorframe or a windowframe, arrow keys raise and lower a foundation |
| I, P, M, O | Inventory, character (stats, engrams, crafting), map, settings (among them voice volume, and whether B is held or switches the microphone) |
| B | Hold to talk to those near; with Alt a whisper, with Shift a yell. The first press asks for the microphone |
| Enter, Insert, / | Chat: to everyone, to those within 60 m, to your tribe. Tab changes channel, Enter says the line |
| Backquote or Tab | Console. `help` lists commands; `tribe` founds and runs a tribe; `mute <name>` stops you hearing someone |
| Escape | Close a screen |

Under `bun run dev` cheats need no password, so the server answers this machine
only (`bun run dev -- --host 0.0.0.0` lets the network in): type `enablecheats`, then try
`give stone 50`, `spawn grazer 150`, `tp 172 256`, `ghost`, `settime 21`,
`spectate`. For a fight: `kit bow`, `kit rifle`, `kit grenades` (then move the
weapon to the hotbar in the inventory and press its number), `dummy flak` for
something to shoot, `armor flak` to wear a set, `place wall_wood` for something
to burn, `give piece_foundation_wood 10` and `give piece_wall_wood 20` for
something to build with (move them to the hotbar), `buff burning`, and `settings`
and `setting <name> [value]` for the server's rules. For a car: `spawn compact` sets one down 4 m ahead, anyone's to take. For creatures: `spawn parasaur 20`, `forcetame` on the one
you look at, `give saddle_parasaur 1`, and for breeding two of them told they
may mate, then `hatch` on the egg and `grow` on what hatches. A development
server reads `config/dev`: taming, hatching and growing up turned up, so that
raising a creature takes minutes and not a day, and wild creatures of level 1
to 30. On a real server set `ServerAdminPassword` in its settings, or
`SNARK_ADMIN_PASSWORD`; without one cheats are off.

## Run a server

```sh
bun run build
bun server/main.ts --config config/boosted-50x --db world.db --port 8787
```

A server is configured as ARK's is: `GameUserSettings.ini` and `Game.ini` in
the folder named, ARK's `?Key=Value` and `-Flag` on the command line, and a
live file read again while it runs. `config` holds four folders to start from:
`official`, `boosted-10x`, `boosted-50x` and `dev`. As it starts the server
says what it applied, what waits for a feature, and what it refused and why.
The [operator's guide](planning/reference/operators.md) has the rest, and the
[settings reference](planning/reference/settings.md) every setting.

Voice needs a microphone, and away from `localhost` a browser gives one only to
a page served over TLS: start the server with `--cert cert.pem --key key.pem`.

## Commands

| Command | What it does |
| --- | --- |
| `bun run check` | Policy rules, type checks for every zone, and all tests. About 22 seconds on a quiet 32-thread machine; fails above 45 s |
| `bun run bench` | Builds the sizing target (8 km, 500,000 structures, 2.6 million resource nodes, 30,000 creatures, 100 players) and holds each measurement to a budget. `-- --config config/boosted-50x` holds a boosted server to the same budgets |
| `bun run settings` | Writes the settings reference from the catalogue. The check fails if it is stale |
| `bun run snap` | Draws the proving ground to `artifacts/snap.png` with a software rasterizer. No browser. `-- --ui` draws the interface over it; `-- --poses N` a line-up of bodies in motion; `-- --fight bow` a survivor mid-fight as its own client shows it; `-- --creatures` the modelled creatures, with `--young` each at four ages beside its egg |
| `bun run probe` | Opens installed Chrome headless once and prints the page's self-check report. `-- --bench` adds frame times |
| `bun run dev` | Development server with client rebuild on change |
| `bun tools/map.ts` | Builds a map file from a folder of plain layers, and unpacks one into its folder. A server runs it with `--map <file>`; see [maps as files](planning/reference/maps.md) |
| `bun run agent` | Joins a running server as a survivor and serves tools over stdio for a model to play with (MCP). `claude mcp add snark -- bun agent/main.ts --name Scout`; see [the agent](agent/README.md) |
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
| [server](server/README.md) | Game loop, every gameplay system, records, persistence, the voice relay, process entry |
| [agent](agent/README.md) | A player that is a program: observe, walk, gather, open and speak as tools for a model |
| [tools](tools/README.md) | Check, bench, snapshot, pack build, probe, dev server |
| `config` | Example server configurations: ARK's two ini files in a folder each |
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
