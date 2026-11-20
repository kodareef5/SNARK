# The grunt protocol, version 0 (draft)

How a program plays a game as a player. The game describes what its character perceives and accepts the inputs a
player could give; everything that decides, plans or learns is on the other side of the wire.

This is a **draft for review**. Nothing here is implemented yet, and anything can change until a game and the Pi
package both speak it. Open questions are collected at the end.

## Principles

These hold for every version.

1. **The game owns the world.** Physics, rules, permissions and persistence stay in the game. A grunt connection is
   one more authenticated player, with exactly a player's restrictions.
2. **Observations are what the character could perceive, all at once.** The game decides what that is: a player's
   senses (sight, hearing, its own interface), fair but a little heightened, since a program cannot turn its head as
   quickly as a player's eyes move: all-round awareness of what is near, a little round corners close by, nothing a
   solid wall hides at a distance. A client never has to turn to learn what is about it; turning is for acting and
   for looking natural. An observation is not the game's internal state.
3. **Controls are physical, not intentions.** `move`, `look`, `interact` belong to the protocol. `go to the tree`,
   `gather 200 wood`, `organise the chest` belong to the player program.
4. **Nothing runs unbounded.** Every continuous control has a duration, and the game lets go of every control when
   the connection goes quiet. A crashed client never leaves a character running.
5. **Every effect is accounted for.** A command is acknowledged at once (accepted or rejected, with a reason) and
   reports how it ended (completed, interrupted, failed). Acceptance never claims success.
6. **A command happens once.** Commands carry ids, and a repeated id is answered again, never executed again.
7. **Everything is ordered.** One sequence number per connection orders every observation and event, so a client can
   tell stale information from fresh.
8. **The protocol knows nothing of the client.** Pi, a script, a test harness or a trained policy are all just
   clients.

## Transport and envelope

A WebSocket, one JSON object a text frame, UTF-8. The game names its endpoint (for example `ws://host:port/grunt`).

Every message has:

| Field | Type | Meaning |
| --- | --- | --- |
| `grunt` | integer | The protocol's major version: `0` |
| `type` | string | The message type, below |
| `id` | string, optional | Set by the sender on a request it wants answered |
| `re` | string, optional | On an answer: the `id` it answers |

Within a major version changes are additive: a receiver ignores fields and message types it does not know. A
capability the game lacks is absent from `welcome`, never half-implemented.

## Connecting

```
client                                      game
  | hello {versions, client, auth, resume?} -> |
  | <- welcome {session, character, frame, capabilities, limits}
  |    or refused {code, reason, retry}         |
```

### `hello` (client)

```json
{ "grunt": 0, "type": "hello", "id": "h1",
  "versions": [0],
  "client": { "name": "pi-grunt", "version": "0.1.0" },
  "auth": { "method": "key", "name": "Scout", "proof": "..." },
  "resume": { "session": "s-91f2", "last_seq": 8024 } }
```

- `auth` is game-defined. The game lists its methods in its documentation; `name` is the character's name where the
  method has one. A secret never travels in an observation or event.
- `resume` reattaches to a session the game still holds (after a dropped link). The character is the same character
  either way: a session is the connection's state (subscriptions, remembered command ids), not the character.

### `welcome` (game)

```json
{ "grunt": 0, "type": "welcome", "re": "h1",
  "session": "s-91f2", "seq": 8025,
  "game": { "name": "SNARK", "version": "2026.11.20", "world": "island" },
  "character": { "id": "e:4471", "name": "Scout", "alive": true },
  "frame": { "units": "m", "up": "+y", "east": "+x", "south": "+z" },
  "capabilities": {
    "channels": ["self", "entities", "terrain", "inventory", "chat", "focus"],
    "controls": ["move", "look", "jump", "crouch", "stop", "interact", "use", "select", "items", "craft", "rotate", "chat"],
    "events": ["hurt", "died", "respawn", "chat", "item", "mounted", "dismounted", "notice", "blocked", "heard", "crafted", "built", "struck"],
    "verbs": ["open", "harvest", "pick_up", "mount", "talk"]
  },
  "limits": { "max_duration_ms": 2000, "leash_ms": 1500, "max_rate_hz": 20,
              "act_per_s": 20, "command_memory_s": 600 } }
```

- `frame` says how positions are given. Angles are always the protocol's (below), whatever the game's own.
- `limits` are the game's: a client stays within them and the game enforces them.

### `refused` (game)

`{ "type": "refused", "re": "h1", "code": "auth" | "version" | "full" | "banned" | "content", "reason": "...", "retry": true | false }`.
`retry` says whether trying the same `hello` later can succeed (a full server can; a wrong key cannot).

## Positions, angles and ids

- A **position** is `[x, y, z]` in the game's `frame`, in metres.
- **Yaw** is in radians, 0 facing north, increasing clockwise seen from above. **Pitch** is in radians, 0 level,
  positive looking up. A **bearing** is a yaw relative to the character's facing: 0 ahead, positive to the right,
  in (−π, π].
- An **entity id** is an opaque string, stable for as long as the game can say it is the same thing. A client may
  hold an id it no longer sees and use it later; the game answers `unknown_target` if it is gone.

## Observing

Observations come in **channels**. A client asks for one snapshot with `observe`, or a stream with `subscribe`.
In version 0 every observation of a channel is that channel's whole snapshot (no deltas).

### `observe` (client) and `observation` (game)

```json
{ "grunt": 0, "type": "observe", "id": "o7",
  "channels": { "self": {}, "entities": { "radius": 40, "max": 20 }, "terrain": { "radius": 16 } } }
```

```json
{ "grunt": 0, "type": "observation", "re": "o7", "seq": 8031, "tick": 912044, "t": 1532104,
  "channels": { "self": { ... }, "entities": { ... }, "terrain": { ... } } }
```

`seq` orders it among everything the connection receives. `tick` is the game's simulation step and `t` its clock in
milliseconds, so a client can measure staleness and latency.

### `subscribe` and `unsubscribe` (client)

```json
{ "grunt": 0, "type": "subscribe", "id": "s1",
  "channels": { "self": { "hz": 10 }, "entities": { "hz": 4, "radius": 60, "max": 30 }, "chat": {} },
  "events": ["*"] }
```

The game answers `{ "type": "subscribed", "re": "s1", "channels": { "self": { "hz": 10 }, ... } }` with the rates
it will really send (clamped to `max_rate_hz`), then sends `observation` messages without `re`. A channel without
`hz` (such as `chat`) is sent when it changes. A second `subscribe` replaces the first. `unsubscribe` with
`channels` and `events` lists stops those.

### Channels in version 0

**`self`**: the character as its player knows it.

```json
{ "id": "e:4471", "name": "Scout", "alive": true, "pos": [812.4, 3.1, 1404.9], "yaw": 1.57, "pitch": -0.1,
  "vel": [0.0, 0.0, 3.2], "on": "ground" | "water" | "air" | "mount" | "vehicle",
  "vitals": { "health": [82, 100], "stamina": [40, 100], "food": [60, 100], "water": [71, 100],
              "oxygen": [100, 100], "weight": [31.5, 120] },
  "held": { "item": "stone_pick", "slot": 1, "uses": [88, 100] },
  "mount": null, "status": ["cold"], "level": 4 }
```

A vital is `[value, max]`. A game omits vitals it has none of and may add its own.

**`entities`**: the things the character perceives, nearest first, within `radius` (metres) and at most `max`.

```json
{ "items": [
  { "id": "e:9120", "kind": "creature", "type": "raptor", "name": null, "pos": [830.2, 3.0, 1398.1],
    "distance": 19.1, "bearing": 0.42, "vel": [-2.1, 0, 0.4], "health": 1.0,
    "disposition": "hostile", "tags": ["wild", "hunting"], "affords": [] },
  { "id": "n:7.33", "kind": "resource", "type": "tree", "pos": [815.0, 3.0, 1409.2],
    "distance": 5.0, "bearing": -0.20, "affords": ["harvest"] } ],
  "more": 12 }
```

- `kind` is one of `creature`, `player`, `resource`, `item`, `structure`, `container`, `vehicle`, `projectile`,
  `other`. `type` is the game's own name for it.
- `disposition` is what the character can tell: `hostile`, `neutral`, `friendly`, `own` (theirs or their group's).
- `health` is a fraction, only where the player's interface would show it.
- `affords` lists the `interact` verbs the character could use on it from where it stands; a verb the game knows but
  that needs the character nearer is left out.
- `more` counts what was left out by `max`.

**`terrain`**: the ground about the character, enough to find a way as a player looking at it could.

```json
{ "cell": 1, "origin": [796, 1388], "size": [33, 33], "rows": ["....TT..~~~", "..."],
  "legend": { ".": "walkable", "#": "blocked", "^": "steep", "~": "deep_water", ",": "shallow_water",
              "T": "tree", "R": "rock", "@": "self", "?": "unknown" },
  "heights": null }
```

`origin` is the grid's north-west corner as `[x, z]` (in `frame`'s horizontal axes), rows run north to south and
columns west to east. `heights`, if asked with `{ "heights": true }`, is a row-major array of ground heights.

**`inventory`**: `{ "slots": [{ "slot": 0, "item": "wood", "count": 40, "uses": null }], "capacity": 30,
"weight": [31.5, 120], "hotbar": [1, 4, null, ...], "open": null, "craftable": [...], "crafting": [...] }`. While a
container is open, `open` is `{ "id": "e:…", "slots": [...] }`.

`craftable` is what the inventory screen offers to make: every recipe the character knows, with what it needs and how
many it could make now, `{ "item": "wood_wall", "needs": { "wood": 15, "thatch": 4, "fiber": 2 }, "can": 2,
"seconds": 1.5, "at": null }`, where `at` names a station kind the recipe needs (`"campfire"`, `"smithy"`) or is
null for the hands. `crafting` is the queue: `[{ "item": "wood_wall", "left": 2, "ready_in_s": 0.8 }]`.

**`chat`**: what the character has heard since the last chat observation: `{ "lines": [{ "channel": "local",
"from": "Ana", "from_id": "e:310", "text": "come here", "t": 1532001 }] }`.

**`focus`**: what the character is looking at and could act on now: `{ "target": "n:7.33", "distance": 2.1,
"verbs": ["harvest"] }` or `{ "target": null }`.

A game may also offer the aimed way of building a player has (the build helper below is the way grunt builds). While
a structure is held, `focus` then has `placement`, the preview a player sees: `{ "piece": "wood_wall", "pos":
[...], "yaw": 1.57, "snapped": { "to": "s:12", "where": "east" }, "valid": true, "reason": null }`. `snapped` is null
for a piece standing free; `reason` says why an invalid preview is refused (`no_support`, `blocked`, `occupied`,
`too_far`, `not_flat`, `not_permitted`). `use primary` places the piece where the preview stands, if it is valid.

**`image`** (optional capability): a frame of the character's view, `{ "mime": "image/jpeg", "width": 384,
"height": 216, "data": "<base64>" }`, asked with `{ "width": …, "height": … }`. Only when the game lists it.

## Events

`{ "grunt": 0, "type": "event", "seq": 8044, "tick": 912070, "t": 1532540, "kind": "hurt", "data": { ... } }`

| Kind | Data |
| --- | --- |
| `hurt` | `amount`, `health` after, `by` (an entity id if the character can tell), `kind` (`melee`, `projectile`, `fall`, `drown`, `cold`, `heat`, `other`) |
| `died` | `by`, `pos` |
| `respawn` | the places the character may rise (`choices`: `[{ "id", "name", "pos" }]`), while it has no body |
| `chat` | one line, as in the `chat` channel |
| `item` | `item`, `delta` (gained positive, lost negative), `count` after |
| `mounted`, `dismounted` | `mount` (an entity id) |
| `notice` | something the interface tells the player: `text`, `level` (`info`, `warning`, `danger`) |
| `blocked` | movement stopped by something: `by` (an entity id, `terrain`, `water` or `structure`), `pos` |
| `heard` | a sound the character heard: `kind` (`creature`, `footsteps`, `impact`, `shot`, `voice`, `other`), `bearing`, `loudness` (0 to 1), `what` if a player could tell (`raptor`), never a hidden entity's id |
| `crafted` | `item`, `count`, from the `crafting` queue |

A game may send kinds it lists in `welcome` beyond these; a client ignores kinds it does not know.

## Acting

### `act` (client)

```json
{ "grunt": 0, "type": "act", "id": "a1042", "command": "cmd-1042", "basis": 8031,
  "actions": [
    { "control": "move", "forward": 1, "strafe": 0, "sprint": false, "duration_ms": 500 },
    { "control": "look", "yaw": 1.95, "pitch": 0 } ] }
```

- `command` is unique within the session and is what makes the act happen once.
- `basis` is the `seq` of the observation the decision was made on. The game may reject an action whose target has
  changed meaning since (`stale`), and always records it, so a trace shows what each decision saw.
- The actions of one `act` start together, on the same tick. Doing things one after another is the client's job.
- A new action of a control replaces the running one of that control (a new `move` replaces the last `move`).

### `ack` (game), at once

```json
{ "grunt": 0, "type": "ack", "re": "a1042", "command": "cmd-1042", "seq": 8032,
  "actions": [ { "index": 0, "accepted": true }, { "index": 1, "accepted": true } ] }
```

A rejected action has `"accepted": false` and a `code`: `unknown_control`, `bad_arguments`, `unknown_target`,
`out_of_reach`, `not_permitted`, `no_body`, `stale`, `rate_limited`, `too_long`, `missing_items` (a `craft` without what
its recipe needs, a `select` or `items` of an empty slot). A repeated `command` is answered
with the first `ack` again and `"duplicate": true`.

### `outcome` (game), when each accepted action ends

```json
{ "grunt": 0, "type": "outcome", "command": "cmd-1042", "index": 0, "seq": 8061,
  "status": "completed", "detail": { "moved_m": 1.6 } }
```

`status` is `completed` (it ran its course), `interrupted` (with `by`: `replaced`, `stop`, `died`, `mounted`,
`knocked_out`, `disconnected`, `game`) or `failed` (with a `code` as in `ack`, or `blocked`). An instant action
(`chat`, `select`) has its outcome right after its `ack`. Every accepted action gets exactly one outcome, even when
the connection is about to close.

### Controls in version 0

| Control | Arguments | Notes |
| --- | --- | --- |
| `move` | `forward`, `strafe` in [−1, 1], `sprint`, `duration_ms` | Relative to facing, as a player's keys or stick |
| `look` | `yaw`, `pitch`; or `yaw_delta`, `pitch_delta` | The body turns at the game's own rate; the outcome comes when it faces the asked way |
| `jump` | `hold_ms` (default a tap) | Held for flying or swimming up, where the game does that |
| `crouch` | `on` | |
| `stop` | none | Lets go of every control. Always accepted |
| `interact` | `target`, `verb`, `hold_ms` | A verb from the target's `affords`; `hold_ms` for verbs held down (`harvest`) |
| `use` | `hand` (`primary`, `secondary`), `hold_ms` | What the held item does: swing, shoot, eat. Aimed by `look` |
| `select` | `slot` | Takes a hotbar slot in hand |
| `items` | `op` (`move`, `drop`, `equip`, `consume`), `slot`, `to`, `count` | The inventory screen's moves; `to` is `self`, `open` or `ground` |
| `craft` | `item`, `count` | The inventory screen's craft button, from `craftable`; the outcome comes when the last is made (`crafted` events between) |
| `rotate` | `steps` | Turns the held structure's preview, a step being the game's own (90° for most pieces) |
| `chat` | `channel` (`local`, `global`, `group`), `text` | As a player types it |
| `plan` | `op` (`check`, `build`), `plan`, `from`, `to` | The build helper, below |
| `assist` | `kind` (`aim`, `attack`, `harvest`), `target`, `range`, `until` | The hands done for the client, below |

`duration_ms` and `hold_ms` are at most `limits.max_duration_ms`. To keep moving, a client sends again before the
last one runs out.

### Building: the build helper

A player builds by aiming each piece and reading the preview. A program has no business aiming foundations: where a
game offers the build helper (`plan` in `controls`, `building` in `capabilities`), the client says the whole
structure at once, the game checks it, and places it, piece by piece, at a pace and reach the game sets. It is more
than a player's hands can do, held back on purpose (`rate`, `reach`), and every rule a player's placement keeps
(support, room, ground, enemies near, the pieces in the bag) still holds.

`capabilities.building` gives the grid and the pieces:

```json
{ "cell": 3, "storey": 3, "reach": 24, "rate": 2, "max_pieces": 80,
  "tiers": { "wood": { "foundation": "piece_foundation_wood", "wall": "piece_wall_wood",
                       "doorframe": "piece_wall_wood", "windowframe": "piece_wall_wood", "ceiling": "piece_ceiling_wood",
                       "door": "piece_door_wood", "pillar": "piece_pillar_wood", "stairs": "piece_stairs_wood" },
             "thatch": { "foundation": "…", "wall": "…", "doorframe": "…", "ceiling": "…", "door": "…" } } }
```

A **plan** is an anchor and pieces in order: `{ "anchor": { "at": [x, z], "turns": 0 }, "pieces": [{ "form":
"foundation", "item": "piece_foundation_wood", "cell": [0, 0], "level": 0 }, { "form": "wall", "item": "…", "cell":
[0, 0], "level": 0, "side": "n" }, …] }`. Cells are the plan's own grid: `i` grows east, `j` south; cell 0, 0's
centre is at the anchor, and `turns` quarter turns clockwise (seen from above) turn the whole grid. A piece on an edge
(wall, doorframe, windowframe, door) names the cell's `side` (`n`, `e`, `s`, `w`); a ceiling's `level` is the storey
it roofs; a pillar stands at its cell's north-west corner; stairs give `up`, the way up. An anchor `{ "base": id }`
lays the plan on the grid of a base already standing; a point on the grid of one of the character's own bases nearby
joins that base, as a player's pieces snap to what stands.

- `op: "check"` answers at once (`completed`), its `detail` a verdict for every piece, in order, each as though the
  pieces before it that can go had gone: `ok`, `built` (the same piece already stands there), `occupied` (another
  piece does), `blocked` (with `by`: a thing or body in the way), `no_support`, `terrain`, `not_in_tier`,
  `enemy_near`; and `need` (items for the pieces still to place) and `have` (those in the bag).
- `op: "build"` places pieces `from` … `to` in order, at `rate` a second, each within `reach` of the character,
  taking each from the bag. A piece already standing is passed over. Its outcome is `completed` with `detail.placed`,
  `detail.ids` and `detail.base`, or `failed` at the first piece that cannot go: `detail.at` (its index),
  `detail.reason` (a verdict, `too_far`, or `missing_items` with `item`) and `by`. The client deals with it and sends
  the plan again from there. `built` events come as pieces go up. `stop` stops it.

### Assists: the hands done for the client

Some of what a player's hands do is held buttons and a steady aim: chopping a tree to the end, keeping the
crosshair on a raptor, leading a running target with a bow. A program working those through `look` and `use` twenty
times a second is slow and brittle, and a model deciding each swing is waste. Where a game offers assists (`assist`
in `controls`, `assists` in `capabilities`), the client names the job and the target, and the game works the hands
until it is done, at limits it sets and advertises:

```json
"assists": { "kinds": ["aim", "attack", "harvest"], "reaction_ms": 150, "spread_deg": 1.5 }
```

- `aim`: keep the crosshair on the target (leading it, with a bow in hand), until stopped or `until.seconds`.
- `attack`: close in and strike at the weapon's own pace; with a bow, keep `range` [near, far] metres (turning to run
  when the target comes inside `near`), lead, and loose. Until the target is dead (`result: "killed"`), or
  `until.health_below` / `until.stamina_below` (the client's own line to break off at).
- `harvest`: swing (or pick) at the tool's pace until the thing is used up (`gone`) or `until.count` of its yield.

The outcome's `detail` gives `result` (`killed`, `gone`, `count`, `health`, `stamina`, `weight`, `seconds`, or on
failure `lost`, `obstructed` with `by`, `ammo`, `out_of_reach`) and the tally: `swings`, `shots`, `hits`, `damage`,
`gained`. `struck` events come as blows land.

An assist is fair because it is a good player's hands, never more, and never eyes:

1. It works only on what the character perceives: an unseen target is refused, and one lost from sight for 1.5 s
   ends it.
2. Its tracking runs `reaction_ms` behind the target (where it was then, carried on as it was moving then): a
   sudden turn fools it for that long, as it fools a player.
3. It turns no faster than the body turns, strikes no faster than the weapon swings, draws as long as the bow draws.
4. A ranged shot has `spread_deg` of error at a still target, growing with how fast the target crosses the line;
   arrows fly, take time, and are stopped by what is in the way. It hits what a good player hits, not everything.
5. It never strikes what it is not after: something else under the crosshair ends it (`obstructed`, `by`).
6. Everything costs what it costs a player: stamina, durability, ammunition.
7. The client's own `move` or `look` takes over from it at once.

## Staying connected

- `ping` (client) → `pong` (game, with `seq`, `tick`, `t`). Any client message counts as life.
- If the game hears nothing for `limits.leash_ms`, it lets go of every control (outcomes `interrupted`, `by`:
  `disconnected` follow on resume) and keeps the session for `command_memory_s`.
- `bye` from either side closes cleanly, with an optional `reason`. The character stays in the world as a
  disconnected player's would.
- `error` (game) answers a message it cannot read: `{ "type": "error", "re": "…", "code": "malformed" |
  "unknown_type" | "rate_limited", "message": "…" }`.

## Not in version 0

Deltas instead of whole snapshots; stations' own screens beyond `craft` with `at`; inspecting a
creature or a structure closely; group (tribe) management; vehicles' own controls; an administrator's channel. An admin's
powers, if a game offers them, go through a separate, explicitly granted and logged channel, never through the
player's controls.

## Open questions

1. **Ways found by the game.** Finding a path from `terrain` alone is the honest way, but a player sees far more of
   the world than a 33 m grid. Should a game be allowed to offer a `route` query (waypoints over what the character
   can see), as an optional assist, clearly marked as such?
2. **Coarse controls.** Should a game be allowed to offer optional higher controls (`walk_to` a point) that it runs
   with its own movement code, for clients that are not yet able to steer? SNARK's agent already has them. They make
   early players possible, at the cost of putting skill in the game.
3. **Deltas.** Whole snapshots are simple and fine at a few hertz; when do `entities` at 10 Hz make deltas worth
   their complexity?
4. **Hearing.** Sounds the character hears are information a player has (a raptor behind a rock). As events with a
   direction and loudness, or a channel?
5. **Time.** Should a client be able to ask the game to step (for training and replay) on a private world, or is
   real time the only time?
6. **Several characters on one connection**, for a host running many, or always one connection a character?
