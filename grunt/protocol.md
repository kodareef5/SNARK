# The grunt protocol, version 0 (draft)

How a program plays a game as a player. The game describes what its character perceives and accepts the inputs a
player could give; everything that decides, plans or learns is on the other side of the wire.

This is a **draft for review**. Nothing here is implemented yet, and anything can change until a game and the Pi
package both speak it. Open questions are collected at the end.

## Principles

These hold for every version.

1. **The game owns the world.** Physics, rules, permissions and persistence stay in the game. A grunt connection is
   one more authenticated player, with exactly a player's restrictions.
2. **Observations are what the character could perceive.** The game decides what that is (sight, hearing, its own
   interface), never more. An observation is not the game's internal state.
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
    "controls": ["move", "look", "jump", "crouch", "stop", "interact", "use", "select", "items", "chat"],
    "events": ["hurt", "died", "respawn", "chat", "item", "mounted", "dismounted", "notice"],
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
"weight": [31.5, 120], "hotbar": [1, 4, null, ...], "open": null }`. While a container is open, `open` is
`{ "id": "e:…", "slots": [...] }`.

**`chat`**: what the character has heard since the last chat observation: `{ "lines": [{ "channel": "local",
"from": "Ana", "from_id": "e:310", "text": "come here", "t": 1532001 }] }`.

**`focus`**: what the character is looking at and could act on now: `{ "target": "n:7.33", "distance": 2.1,
"verbs": ["harvest"] }` or `{ "target": null }`.

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
`out_of_reach`, `not_permitted`, `no_body`, `stale`, `rate_limited`, `too_long`. A repeated `command` is answered
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
| `chat` | `channel` (`local`, `global`, `group`), `text` | As a player types it |

`duration_ms` and `hold_ms` are at most `limits.max_duration_ms`. To keep moving, a client sends again before the
last one runs out.

## Staying connected

- `ping` (client) → `pong` (game, with `seq`, `tick`, `t`). Any client message counts as life.
- If the game hears nothing for `limits.leash_ms`, it lets go of every control (outcomes `interrupted`, `by`:
  `disconnected` follow on resume) and keeps the session for `command_memory_s`.
- `bye` from either side closes cleanly, with an optional `reason`. The character stays in the world as a
  disconnected player's would.
- `error` (game) answers a message it cannot read: `{ "type": "error", "re": "…", "code": "malformed" |
  "unknown_type" | "rate_limited", "message": "…" }`.

## Not in version 0

Deltas instead of whole snapshots; audio as sound events with direction; the map screen; crafting and building
screens beyond `items`; group (tribe) management; vehicles' own controls; an administrator's channel. An admin's
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
