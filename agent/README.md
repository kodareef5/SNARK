# Agent

A player that is a program. `bun agent/main.ts` joins a running server as one
survivor and serves tools on its pipes over the Model Context Protocol, so a
model can play. It is headless `client/core` on a socket: it sends the inputs
and commands a browser sends, and has no powers a player lacks.

| File | Contents |
| --- | --- |
| `main.ts` | Process entry: arguments, the key file, the manifest and the map fetched from the server, the 60 Hz timer, the pipes, joining again after a dropped link |
| `mcp.ts` | The protocol: JSON-RPC 2.0, one object a line, `initialize`, `ping`, `tools/list`, `tools/call` |
| `tools.ts` | `Agent`: the fifteen tools, their arguments and answers, chat and console pace |
| `controller.ts` | One task at a time, as looks and buttons a tick at a time: walking a way, aiming, swinging, opening, and stopping for danger |
| `observe.ts` | The ground about the survivor as letters, and the nearest things by id |
| `commands.ts` | Commands at ten a second, and each one's result |
| `socket.ts` | WebSocket as a `Connection`, as the shell has it |

The zone may import `shared`, `content` and `client/core`, and Bun's
built-ins. It names nothing of the server's. Path finding is not here: it is
`shared/world/path.ts`, written against `CollisionWorld`, so that creatures can
use it too.

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

## Tools

Every answer is JSON with a `state`: `done`, `running`, `blocked` (it stopped
short, and `reason` says why), `danger` (it stopped because the survivor is in
danger) or `refused` (nothing was done). An answer also lists `dangers` while
there are any.

| Tool | Arguments | Does |
| --- | --- | --- |
| `observe` | `radius` 8 to 96 (32), `cell` 1, 2 or 4 (2) | The map in letters and the nearest 40 of each kind of thing, with ids |
| `walk_to` | `x` and `z`, or `id`; `within` (0.6); `wait_s` (25) | Finds a way and walks it |
| `harvest` | `id`, `until` `{item, count}`, `tool`, `wait_s` (25) | Walks to a tree, rock or bush and strikes or picks it until it is gone, or the count is gathered, or a minute has passed. A dead creature is harvested the same way |
| `attack` | `id`, `with`, `until` `out`, `dead` or `{item, count}`, `wait_s` (25) | Walks to a creature or a player and strikes it, going after it when it runs, until it is gone from sight (dead, most often) or, with `out`, knocked out and ready to tame |
| `pick_up` | `id`, `wait_s` (25) | Walks to a small tame of the tribe and takes it in its arms, or to an egg and takes it into the inventory |
| `put_down` | `throw` | Sets down the creature held, or throws it |
| `order` | `id` or none for all in earshot, `order`, `target` | follow, stay, wander, passive, neutral, aggressive, attack_my_target, attack (with a `target`), mate, no_mating |
| `open` | `id`, `pin`, `wait_s` (25) | Walks to a box, a bag or a door and uses it |
| `move_item` | `from`, `slot`, `to`, `to_slot`, `count` | Moves a stack within the inventory, or to and from the open box |
| `craft` | `recipe`, `count` 1 to 100, `learn`, `wait_s` (20) | Makes an item. With `learn` it spends the engram points first |
| `eat` | `item` | Eats or drinks |
| `say` | `channel` global, local or tribe, `text` | A chat line |
| `status` | `wait_s` (0) | The running task, vitals, inventory, the open box, what is being made, chat heard. With `wait_s` it waits for the task |
| `cancel` | | Stops the running task |
| `console` | `line` | A console line. Only with `--console`. The server takes one every 200 ms, so a line asked sooner waits its turn |

`walk_to`, `harvest`, `attack`, `open` and `pick_up` are tasks. One runs at a time, and a second is
refused until the first ends or is cancelled. A task answers when it ends, or
after `wait_s` with `running`, so no call outlasts a client's timeout.

Ids are `n<chunk>.<slot>` for a tree, rock or bush, `s<ref>` for something
built, and `e<index>` for a creature, a player, a dead creature, an egg or a bag.

## What it sees

`observe` at its usual size is about 1.6 KB. North is up and east is right,
which makes x fall to the right.

```
. ground  # built  ^ too steep  ~ deep water  T tree  R rock  b bush
c creature  P player  B box  @ you  ? unknown
```

The ground is judged as the path finder judges it, every half metre, so a dot
is somewhere `walk_to` can stand and a wall 0.2 m thick still shows. A letter
shows the most solid thing in its square. At 2 m and 4 m a doorway may
therefore not show, and a look with `cell` 1 finds it.

A creature's row ends with what is known of it: its level, whether it is wild,
hunts, yours or tamed by another tribe, and if so that it is knocked out,
carried, hurt, badly hurt or near death, as far as any player can tell by
looking. Dead creatures are listed as `body` and eggs as `egg`.

`observe` takes a far layer as its last argument, for what stands beyond the
three chunks a client is sent: the tactical map's `cellAt` fits it. With one,
the radius can grow.

## How it walks

`shared/world/path.ts` finds a way over 1 m cells with the tests movement
uses: on the map, not too steep, not deep enough to swim, and a capsule free a
step above the ground. The step between two cells is tried too, so a thin wall
on the line between them is not walked through. A search expands at most
20,000 cells. A goal more than 96 m off is walked in legs, each found anew
every second.

The controller turns at 6 radians a second and walks when it nearly faces its
heading. Each second it looks the way over and finds another if something has
come to stand on it. If it gains less than 0.3 m in a second it hops, then
finds a way round the cell ahead, and the third time says it is blocked.

Ground floor only. It climbs no stairs, and a thing on a floor above the
ground is answered `blocked`. Fallen into deep water, it swims for its goal at
the surface and walks again when it stands.

## Danger

A hunter within 15 m, a twentieth of its health lost in two seconds, breath
under 30%, being knocked out, and death each end the running task at once,
with the buttons let go. Each is told once: a hunter until it is 20 m off
again, falling health until none has been lost for five seconds. A task
started meanwhile is not stopped by what has been told already, so the
survivor can run. A dead survivor wakes at the first place offered.

An `attack` is a fight, so it is not ended by the thing fought being near,
nor by falling health while two thirds of it are left. Under that, or when
another hunter comes, it ends like any task.

## Not here yet

- Latitude and longitude for `walk_to`. They come with
  `shared/world/coords.ts`, and go in `walkTo` in `tools.ts`.
- Shooting: `attack` strikes with what is in hand and looses nothing.
- Feeding a knocked-out creature to tame it, building and riding.
- Floors above the ground, and swimming to a goal.
