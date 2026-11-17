# Agent

A player that is a program. `bun agent/main.ts` joins a running server as one
survivor and serves tools on its pipes over the Model Context Protocol, so a
model can play. It is headless `client/core` on a socket: it sends the inputs
and commands a browser sends, and has no powers a player lacks.

| File | Contents |
| --- | --- |
| `main.ts` | Process entry: arguments, the key file, the manifest and the map fetched from the server, the 60 Hz timer, the pipes, joining again after a dropped link, and travel between servers |
| `mcp.ts` | The protocol: JSON-RPC 2.0, one object a line, in both eras (below) |
| `defs.ts` | The tools as a client lists them: arguments, answers, annotations, and the instructions |
| `tools.ts` | `Agent`: what each tool does, as commands and tasks, and status |
| `controller.ts` | One task at a time, as looks and buttons a tick at a time: walking, climbing, swimming, riding, flying, driving, aiming, shooting, swinging, opening, and stopping for danger |
| `observe.ts` | The floor about the survivor as letters, and the nearest things by id |
| `lookup.ts`, `guide.ts` | The resources: recipes, items, creatures and the guide |
| `commands.ts` | Commands at ten a second, and each one's result |
| `travel.ts` | The travel tool and the cluster's servers |
| `socket.ts` | WebSocket as a `Connection`, as the shell has it |

The zone may import `shared`, `content` and `client/core`, and Bun's
built-ins. It names nothing of the server's. Ways are found in `shared/world`:
`path.ts` on the ground, `layers.ts` up stairs, over bridges and across water,
both written against `CollisionWorld` so that creatures can use them too.

## Run it

```sh
bun run dev                                                    # a server, or any other
bun agent/main.ts --url ws://localhost:8787/ws --name Scout    # speaks MCP on its pipes
claude mcp add snark -- bun agent/main.ts --url ws://localhost:8787/ws --name Scout
```

The last line registers it with Claude Code from the repository's folder. From
anywhere else give `main.ts` by its full path. The same command and arguments go
in an `.mcp.json`.

- `--name` is the survivor's name: 1 to 24 letters, digits, spaces, `_` or `-`.
- `--console` adds the `console` tool. Without it the tool is not listed. What
  a console line may do is the server's decision, as for any player.
- `SNARK_PASSWORD` is the join password of a server that asks one.
- The name belongs to a key, as a browser's does. It is made on first run and
  kept in `~/.snark/agent-<name>.key`, readable by its owner alone. Lose the
  file and the name is lost with it.
- Logs go to standard error. Standard output carries the protocol only.

A dropped link or a full server is tried again every five seconds. Any other
refusal (a wrong password, a name that belongs to another key, another build's
content) is not, and every tool then answers `refused` with the reason.

`bun run agent-trip` plays the whole loop through the pipes against a throwaway
proving-ground server; `bun run bed-trip` and `bun run cluster-trip` play beds
and travel.

## The protocol

Both eras of MCP are spoken on the one pipe:

- A request whose `_meta` names `io.modelcontextprotocol/protocolVersion`
  `2026-07-28` is served on its own, needing
  `io.modelcontextprotocol/clientCapabilities` beside it. Its result carries
  `resultType` and the server's identity; lists carry `ttlMs` and `cacheScope`.
  Another version gets error -32022 with the versions spoken. `server/discover`
  answers the versions, capabilities and instructions.
- `initialize` serves the revisions from 2024-11-05 to 2025-11-25, as before.

A tool's answer is one JSON object, sent as `structuredContent` and as text,
and every tool lists an `outputSchema` and annotations (only `observe` and
`status` are read-only). A tool error is an answer with `isError` and state
`refused`. A call whose `_meta` has a `progressToken` is told
`notifications/progress` each second while a task runs: seconds waited, of
`wait_s`. `notifications/cancelled` stops the task the call began, and the call
is owed no answer. Resources: `snark://guide`, `snark://recipes`,
`snark://items` and `snark://creatures`, from the content the server tuned.

## Tools

Every answer has a `state`: `done`, `running` (still going; `status` waits for
it), `blocked` (it stopped short, and `reason` says why), `danger` (it stopped
because the survivor is in danger) or `refused` (nothing was done). An answer
also lists `dangers` while there are any. Places are x and z, or `lat` and `lon`
as the map screen gives them (units of 102.4 m south and east of the map's top
left, ten a sector); a storey is chosen with `y`.

| Tool | Does |
| --- | --- |
| `observe` | The floor about you in letters and the nearest things of each kind by id: nodes, terminals, stations (lit or out), boxes, beds, doors, stairs with the heights they join, creatures (saddled, named), cars (who drives), bodies, eggs, players. `list` is how many of a kind (10) |
| `status` | You (where, lat and lon, height above the ground, vitals, level and points, what is in hand, what you ride), inventory with uses left and rounds loaded, what is worn, buffs, the open box, station (fire, firing lanes, queue) or creature (taming, effectiveness, torpor, saddled), hand jobs, news (hits, kills, wounds, tames), chat heard; `choosing` with no body |
| `go_to` | Walks, climbs, swims; riding it rides, on a flyer it flies and lands (`land` false hovers), in a car it drives. `run` sprints, `swim` false keeps out of water |
| `harvest` | A tree, rock, bush or dead body, until used up or `until` an item count, with a `tool` |
| `attack` | Melee or bare hands, or from range with a bow, crossbow, slingshot, gun or bola: it loads `ammo`, keeps its distance and leads the target. `until` out, dead or an item count. Riding, the mount bites |
| `open` | A box, bag, station or door; a knocked-out creature, or one of your tribe's, opens its inventory |
| `move_item` | A stack by slot or item between `self`, `box` (the open one) and `ground` |
| `craft` | In the hands, or at a station (`at`, else the nearest of yours), learning the engram with `learn` |
| `use_item` | Eats; drinks from a skin, or `water` where you stand or swim; wears armour; takes a weapon or tool in hand; loads ammunition; fits an attachment. With `on`, food or a narcotic into a knocked-out creature, a saddle onto a tame |
| `mount` | Gets on a saddled tame or into a car at its door; `off` gets off or out |
| `carry` | Picks up a small creature or an egg; `put` down or throw |
| `order` | follow, stay, wander, the stances, attack_my_target, attack, land, mate, no_mating, unsaddle, name, level |
| `place` | A foundation or a thing on the ground or a floor; a wall, doorframe (`as`), ceiling, pillar or stairs on a `side` of a piece; a door in its frame |
| `structure` | light, put_out, lock, unlock, pin, pick_up, demolish, repair; name a bed, travel from one |
| `rise` | With no body: rises at a place `status` lists under `choosing` |
| `level_up` | Spends a level point on a stat |
| `say` | A chat line: global, local or tribe |
| `cancel` | Stops the running task |
| `travel` | With no `to`, the cluster's servers; with `to`, walks to an obelisk's terminal and goes |
| `console` | A console line. Only with `--console` |

`go_to`, `harvest`, `attack`, `open`, `craft` at a station, `place`, `mount`,
`carry`, `structure` and `use_item` on a creature walk first and run as tasks.
One runs at a time, and a second is refused until the first ends or is
cancelled. A task answers when it ends, or after `wait_s` with `running`, so no
call outlasts a client's timeout.

Ids are `n<chunk>.<slot>` for a tree, rock or bush, `s<ref>` for something
built, and `e<index>` for a creature, a player, a car, a dead body, an egg or a
bag.

## What it sees

`observe` at its usual size answers about 2 to 3 KB, whatever the city: a 33
letter square and at most ten things of each kind. North is up and east is
right, which makes x fall to the right.

On the ground:

```
. ground  # built  ^ too steep  ~ deep water  T tree  R rock  b bush
c creature or car  P player  B box or station  @ you  ? unknown
```

The ground is judged as the ground's way finder judges it, every half metre, so
a dot is somewhere `go_to` can stand and a wall 0.2 m thick still shows. A
letter shows the most solid thing in its square, so at 2 m and 4 m a doorway may
not show, and a look with `cell` 1 finds it.

Standing a metre or more above the ground, on a floor, a deck or a stair, it
draws that storey instead: `.` floor at your height, `+` higher (stairs up or a
step), `-` lower (stairs down), a space where there is nothing to stand on, `#`
wall. `self` then says how far above the ground you are, and `stairs` lists
the flights and ramps near with the heights they join, so a storey can be
asked for with `go_to`'s `y`.

## How it moves

On the ground, to a goal on the ground, `shared/world/path.ts` finds a way over
1 m cells with the tests movement uses. Off the ground, in water, to a goal on a
floor, or where the ground has no way, `shared/world/layers.ts` searches cells
with a node for each height a body stands at there: a move is walked in
sub-samples by the step's own probes (a step up, a slope, a step down, a fall it
lands from unhurt), and deep water is swum at the float line at 1.7 times the
cost. Its search runs 1,500 nodes a tick, so a climb of twelve storeys is
spread over ticks. A goal more than 96 m off is walked in legs.

The controller turns at 6 radians a second and walks when it nearly faces its
heading. A mount turns at its own rate, so the look is set at once and the
walking waits for the body. Each second it looks the way over and finds another
if something has come to stand on it. If it gains less than 0.3 m in a second it
hops, then finds a way round the cell ahead, and the third time says it is
blocked.

The way finders see what is built and what grows, not bodies, so every car in
view and a body's width round it are kept off. A goal on a floor more than
80 m off is walked toward on the ground, and climbed to once near.

Flying, it holds jump, climbs to 20 m over the ground, water and skyline ahead
(the near rows, and the map's own pieces from the map file), climbs nearly
straight up past anything tall close ahead, slows near the place, brakes to a
hover and lets go of jump over dry ground it may stand on, looking up to 20 m
round for one. Driving, it finds a way for a body as wide as the car on ground a
car climbs, steers at a point along it, backs round first when the way is
behind it, slows for bends, brakes with the throttle against the motion, backs
off what it runs into, and holds the handbrake once there.

## Danger

A hunter within 15 m (not one knocked out or tamed), a twentieth of its health
lost in two seconds, breath under 30%, being knocked out, and death each end the
running task at once, with the buttons let go. Each is told once: a hunter until
it is 20 m off again, falling health until none has been lost for five seconds.
A task started meanwhile is not stopped by what has been told already, so the
survivor can run. A dead survivor chooses where to rise with `rise`, as a player
does; until it does it has no body.

An `attack` is a fight, so it is not ended by the thing fought being near, nor
by falling health while two thirds of it are left. Under that, or when another
hunter comes, it ends like any task.

## Not here yet

- Breeding beyond carrying an egg: claiming a baby and feeding it.
- Grenades thrown at a target, and the pteranodon's grab.
- Refuelling a car: nothing in the game does yet.
