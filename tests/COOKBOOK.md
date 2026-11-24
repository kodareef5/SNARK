# Test cookbook

Run one file with `bun test tests/kit/recipes/creature.test.ts`; a folder with `bun test tests/kit/recipes`.

The kit (`tests/kit/kit.ts`) is the front door: `camp()` starts a real server in a named place and
joins a survivor as a real client, and the rest are the actions and readings a test needs. Copy
the nearest recipe below and change it. Three rules:

1. **Real server and real client.** Ask as a player or an admin at the console would. Do not set
   the server's state by hand to skip a check a client would meet, and do not cast to reach a
   private member.
2. **Virtual time only.** Time passes when you call `h.run(ms)` or `until(...)`. No wall clock.
3. **Seeded randomness.** `new Rng(seed)` from `shared/rng.ts`, never `Math.random`.

When the kit is not enough, it stands on `tests/fixtures` ([README](fixtures/README.md)): `h` is a
`Harness` (`fixtures/net.ts`), and `gather.ts`, `build.ts`, `map.ts` and the rest take it.

## The kit's calls

| Call | Gives |
| --- | --- |
| `camp({ place, rules, save, screen, link, gear, items, level, tribe, god, cheats })` | `{ h, ada, me, at }`: the harness, ada's client, her record on the server, where she stands |
| `field()` `room()` `yard()` `street()` `pond()` `dock()` | Places on flat ground 256 m a side: empty; sealed in; a wall ahead; a parked car; water to swim; a moored boat |
| `proving()` `clearing(wide, deep, from)` | The proving ground at its spawn point (trees, rocks, a pool), or on level empty ground there |
| `survivor(h, name, { at, link, ... })` | Another client, on a line of its own: `BAD_LINK` is a poor one. Also joins one again after `restart` |
| `creature(h, species, at, level)` | A wild creature standing still: `{ e, rec }` |
| `tame(h, s, species, { at, level, saddled })` | A creature that is the survivor's, by `forcetame`, saddled through its inventory |
| `vehicle(h, s, kind, { at, yaw, drive })` | A vehicle of the survivor's tribe, the survivor at its wheel with `drive` |
| `find(h, kind)` | The first entity of a kind: a car the map parked, a dummy the console stood |
| `look(h, s, e or point)` `walk(h, s, spot)` `put(h, s, spot)` | Turn to it; walk there with the forward key (false if stopped); teleport |
| `press(h, s, BTN_...)` `use(h, s, e)` `ride(h, s, e)` `drive(h, s, e)` | Hold buttons a few ticks; look and press use; get on or in; get in at the wheel |
| `send(h, s, CMD_..., write)` | A command, and the result code the server answered |
| `h.say(s, line)` | A console line, and what the server printed |
| `h.run(ms)` `until(h, done, seconds)` | Time; time until a condition, bounded |
| `restart(h)` | The server stopped and started on the same save (`camp({ save: true })`) |
| `record(h, s)` `count(h, s, item)` `pos(h, e or s)` `seen(s, e)` `id(name)` | The server's record, items carried, and place; where a client draws an entity; a content index |
| `screen(h, s)` | A survivor joined with `screen: true` runs the whole app: `.app`, `.packet` |
| `shown(view, KEY_...)` `node(view, KEY_...)` `fits(view, KEY_...)` `drawn(view, mesh)` | The interface's text and nodes, whether one is inside the window, how many of a mesh the frame draws |
| `tap(h, view, "KeyI")` `resize(h, view, w, h)` `WINDOWS` | A key; a window size; four shapes to lay out at |
| `direct(w, h, insets, { finger })` `PHONES` `nodes(frame)` | An interface built from its models, with no server: set `.ui` and `.hud`, then `.build()`; nine touch windows; a frame's nodes to compare |
| `pilot(h, s)` | The keys and look a client sends: `moveZ = 1` holds forward |

A helper throws, with the server's own words, when the server refuses what it asked. No recipe
needs the art in `assets/`: the graybox pack draws everything here.

## Recipes

Each block is a file under `tests/kit/recipes`, shown whole. `tests/kit/cookbook.test.ts` fails
if a block and its file differ.

### A command from the player, and its refusal

A feature the player asks for with a `CMD_` code. Send it as the client does and check the result code both ways: refused when it should be, done when it may be.

[kit/recipes/command.test.ts](kit/recipes/command.test.ts)

```ts
import { expect, test } from "bun:test";
import { CMD_SPEND, RESULT_INVALID, RESULT_OK, RESULT_SHORT } from "../../../shared/net/protocol.ts";
import { STAT_NAMES } from "../../../shared/sim/genome.ts";
import { V_HEALTH } from "../../../shared/sim/vitals.ts";
import { camp, send } from "../kit.ts";

test("a stat point is spent only when there is one, and only on a stat", () => {
  const { h, ada } = camp();
  const spend = (stat: number): number => send(h, ada, CMD_SPEND, (w) => w.u8(stat));
  const health = STAT_NAMES.indexOf("health");
  expect(spend(health)).toBe(RESULT_SHORT);
  h.say(ada, "addxp 10");
  expect(ada.progress.statPoints).toBe(1);
  expect(spend(STAT_NAMES.length)).toBe(RESULT_INVALID);
  expect(spend(health)).toBe(RESULT_OK);
  expect([ada.progress.statPoints, ada.vitals.max[V_HEALTH]! / 1e6]).toEqual([0, 110]);
});
```

### An item crafted and used

A new item with an engram and a cost. Give the parts, learn, craft, wait for the job and check what was spent; `takeInHand` from `fixtures/gather.ts` puts it in the hand.

[kit/recipes/item.test.ts](kit/recipes/item.test.ts)

```ts
import { expect, test } from "bun:test";
import { CMD_CRAFT, CMD_LEARN, RESULT_DENIED, RESULT_OK } from "../../../shared/net/protocol.ts";
import { HOLD_TOOL } from "../../../shared/sim/weapon.ts";
import { takeInHand } from "../../fixtures/gather.ts";
import { camp, count, id, send, until } from "../kit.ts";

test("a pick is made from its parts once its engram is learned, and held", () => {
  const { h, ada } = camp({ items: { stone: 1, wood: 1, thatch: 10 } });
  const craft = (): number => send(h, ada, CMD_CRAFT, (w) => (w.u16(id("pick")), w.u8(1)));
  expect(craft()).toBe(RESULT_DENIED);
  expect(send(h, ada, CMD_LEARN, (w) => w.u16(id("engram-pick")))).toBe(RESULT_OK);
  expect(craft()).toBe(RESULT_OK);
  expect(until(h, () => count(h, ada, "pick") === 1, 10)).toBe(true);
  expect([count(h, ada, "stone"), count(h, ada, "wood"), count(h, ada, "thatch")]).toEqual([0, 0, 0]);
  takeInHand(h, ada, id("pick"));
  expect(h.world.ents.hold[h.ent(ada)]).toBe(HOLD_TOOL);
});
```

### A creature spawned, tamed and ridden

A new species. `creature` stands a wild one, `tame` makes one the survivor's and saddles it, `ride` gets on with the use key.

[kit/recipes/creature.test.ts](kit/recipes/creature.test.ts)

```ts
import { expect, test } from "bun:test";
import { BTN_USE } from "../../../shared/sim/character.ts";
import { camp, creature, pos, press, ride, tame, use, walk } from "../kit.ts";

test("a wild raptor is not ridden; a tamed and saddled one carries its rider", () => {
  const { h, ada, me, at } = camp();
  const wild = creature(h, "raptor", { x: at.x + 3, z: at.z }, 5);
  use(h, ada, wild.e);
  expect([wild.rec.team, wild.rec.genome!.level, ada.driving]).toEqual([0, 5, -1]);

  const mine = tame(h, ada, "raptor", { level: 5, saddled: true });
  expect(mine.rec.team).toBe(me.team);
  ride(h, ada, mine.e);
  expect(ada.driving).toBe(mine.e);
  expect(walk(h, ada, { x: at.x, z: at.z + 25 })).toBe(true);
  expect(pos(h, mine.e).z).toBeGreaterThan(at.z + 24);

  press(h, ada, BTN_USE);
  expect(ada.driving).toBe(-1);
});
```

### A vehicle driven

A new vehicle kind. `vehicle` with `drive` parks it and gets the survivor in at its door; `pilot` holds the keys.

[kit/recipes/vehicle.test.ts](kit/recipes/vehicle.test.ts)

```ts
import { expect, test } from "bun:test";
import { BTN_USE } from "../../../shared/sim/character.ts";
import { camp, pilot, pos, press, until, vehicle } from "../kit.ts";

test("a car is driven north from its driver's seat and left where it stops", () => {
  const { h, ada, at } = camp();
  const car = vehicle(h, ada, "compact", { drive: true });
  expect(ada.driving).toBe(car.e);

  pilot(h, ada).moveZ = 1;
  h.run(3000);
  pilot(h, ada).moveZ = 0;
  expect(pos(h, car.e).z).toBeGreaterThan(at.z + 15);
  expect(Math.abs(pos(h, ada).z - pos(h, car.e).z)).toBeLessThan(2);

  expect(until(h, () => Math.hypot(h.world.ents.vx[car.e]!, h.world.ents.vz[car.e]!) < 0.5, 20)).toBe(true);
  press(h, ada, BTN_USE);
  expect(until(h, () => ada.driving === -1, 3)).toBe(true);
});
```

### Something a second player must see, on a bad link

Anything replicated. Join a second client on `BAD_LINK` and compare what it draws (`seen`) with what the server has (`pos`).

[kit/recipes/second-player.test.ts](kit/recipes/second-player.test.ts)

```ts
import { expect, test } from "bun:test";
import { BAD_LINK, camp, pos, ride, seen, survivor, tame, walk } from "../kit.ts";

test("a player on a poor line sees another ride off, where the server has them", () => {
  const { h, ada, at } = camp();
  const bob = survivor(h, "bob", { link: BAD_LINK, at: { x: at.x + 3, z: at.z } });
  const raptor = tame(h, ada, "raptor", { saddled: true });
  expect(seen(bob, raptor.e)).not.toBeNull();

  ride(h, ada, raptor.e);
  walk(h, ada, { x: at.x, z: at.z + 25 });
  h.run(1000);
  const theirs = pos(h, raptor.e);
  const his = seen(bob, raptor.e)!;
  expect(theirs.z).toBeGreaterThan(at.z + 24);
  expect(Math.hypot(his.x - theirs.x, his.z - theirs.z)).toBeLessThan(0.05);
  expect(bob.stats.undecodable).toBe(0);
});
```

### Something only its owner sees

Owner state: vitals, inventory, progress. Give both survivors a screen and check that each interface shows its own.

[kit/recipes/owner.test.ts](kit/recipes/owner.test.ts)

```ts
import { expect, test } from "bun:test";
import { KEY_VITAL } from "../../../client/core/ui/hud.ts";
import { V_HEALTH } from "../../../shared/sim/vitals.ts";
import { camp, node, screen, survivor } from "../kit.ts";

// The bars are keyed KEY_VITAL + 1, + 3, + 5 in the order shown; health is the first.
const HEALTH = KEY_VITAL + 1;

test("a hurt survivor's own screen shows its health; another's shows only theirs", () => {
  const { h, ada, at } = camp({ screen: true });
  const bob = survivor(h, "bob", { screen: true, at: { x: at.x + 2, z: at.z } });
  expect(node(screen(h, ada), HEALTH)!.label).toBe("Health 100%");

  h.say(ada, "hurt 30");
  h.run(300);
  expect(node(screen(h, ada), HEALTH)!.label).toBe("Health 70%");
  expect(node(screen(h, ada), HEALTH)!.value).toBeCloseTo(0.7, 2);
  expect(node(screen(h, bob), HEALTH)!.label).toBe("Health 100%");
  expect(bob.vitals.at(V_HEALTH, bob.latestSnapshot) / bob.vitals.max[V_HEALTH]!).toBe(1);
});
```

### A server setting that changes a rule

A new row in `server/settings`. Start one camp with the setting and one without, and compare. A misspelt name throws at once.

[kit/recipes/setting.test.ts](kit/recipes/setting.test.ts)

```ts
import { expect, test } from "bun:test";
import { CMD_CRAFT, CMD_LEARN } from "../../../shared/net/protocol.ts";
import { camp, count, id, send, until, type CampOptions } from "../kit.ts";

/** The experience a new survivor has after making one pick, under some settings. */
function made(rules: CampOptions["rules"]): number {
  const { h, ada, me } = camp({ rules, items: { stone: 1, wood: 1, thatch: 10 } });
  send(h, ada, CMD_LEARN, (w) => w.u16(id("engram-pick")));
  send(h, ada, CMD_CRAFT, (w) => (w.u16(id("pick")), w.u8(1)));
  expect(until(h, () => count(h, ada, "pick") === 1, 10)).toBe(true);
  return me.xp;
}

test("CraftXPMultiplier multiplies the experience for making a thing", () => {
  expect(made({})).toBe(1.6);
  expect(made({ CraftXPMultiplier: 4 })).toBe(6.4);
});

test("a setting the server does not know stops the test where it is given", () => {
  expect(() => made({ CraftXPMultiplyer: 4 })).toThrow("there is no setting called CraftXPMultiplyer");
});
```

### Something saved that survives a restart

Anything in the save. `camp({ save: true })`, change the world, `restart`, and read it back from the new server.

[kit/recipes/save.test.ts](kit/recipes/save.test.ts)

```ts
import { expect, test } from "bun:test";
import { camp, count, find, pos, restart, survivor, tame, walk } from "../kit.ts";

test("after a restart a survivor is where it stood, with its things and its tame", () => {
  const { h, ada, me, at } = camp({ save: true, items: { stone: 7 } });
  tame(h, ada, "dodo");
  expect(walk(h, ada, { x: at.x - 5, z: at.z - 5 })).toBe(true);
  const stood = pos(h, ada);
  ada.close();
  h.run(200);

  const next = restart(h);
  expect(next.host.loaded!.fresh).toBe(false);
  expect(next.world.tick).toBe(h.world.tick);
  expect(find(next, "dodo").rec.team).toBe(me.team);
  const again = survivor(next, "ada");
  expect(pos(next, again)).toEqual(stood);
  expect(count(next, again, "stone")).toBe(7);
});
```

### Something that happens later, with nobody there

A deadline. Start it, read when it is due, leave, run the time, and come back.

[kit/recipes/timer.test.ts](kit/recipes/timer.test.ts)

```ts
import { expect, test } from "bun:test";
import { TICK_RATE } from "../../../shared/coords.ts";
import { CMD_CRAFT, CMD_LEARN, RESULT_OK } from "../../../shared/net/protocol.ts";
import { camp, count, id, send, survivor } from "../kit.ts";

test("three picks queued are made one after another while their maker is away", () => {
  const { h, ada } = camp({ items: { stone: 3, wood: 3, thatch: 30 } });
  send(h, ada, CMD_LEARN, (w) => w.u16(id("engram-pick")));
  expect(send(h, ada, CMD_CRAFT, (w) => (w.u16(id("pick")), w.u8(3)))).toBe(RESULT_OK);
  const due = ada.progress.jobs[0]!.doneAt;
  expect(due).toBeGreaterThan(h.world.tick + TICK_RATE);
  ada.close();

  h.run(((due - h.world.tick - 1) * 1000) / TICK_RATE);
  expect(h.server.playerCount).toBe(0);
  h.run(60_000);
  const back = survivor(h, "ada");
  expect(count(h, back, "pick")).toBe(3);
  expect(back.progress.jobs).toEqual([]);
});
```

### A structure placed and destroyed

A new piece. Place it from the hand with `CMD_PLACE`, check every client has it, and that only its owner may remove it. For joined pieces see `fixtures/build.ts`.

[kit/recipes/structure.test.ts](kit/recipes/structure.test.ts)

```ts
import { expect, test } from "bun:test";
import { NO_TARGET } from "../../../server/build.ts";
import { STRUCT_UNITS as U } from "../../../shared/coords.ts";
import { CMD_PLACE, CMD_STRUCT, RESULT_NOT_YOURS, RESULT_OK } from "../../../shared/net/protocol.ts";
import { STRUCT_DEMOLISH } from "../../../shared/world/upkeep.ts";
import { takeInHand } from "../../fixtures/gather.ts";
import { camp, count, id, send, survivor } from "../kit.ts";

test("a foundation is set down from the hand; only its builder may demolish it", () => {
  const { h, ada, at } = camp({ items: { piece_foundation_wood: 1 } });
  const bob = survivor(h, "bob", { at: { x: at.x + 2, z: at.z } });
  takeInHand(h, ada, id("piece_foundation_wood"));
  const [x, z] = [Math.round(at.x * U), Math.round((at.z + 4) * U)];
  expect(send(h, ada, CMD_PLACE, (w) => (w.u8(0), w.u32(NO_TARGET), w.sbits(x, 32), w.sbits(z, 32), w.u16(0), w.sbits(0, 8), w.u8(0)))).toBe(RESULT_OK);
  const ref = h.host.build.last;
  expect([h.world.structs.count, bob.world!.structs.count, count(h, ada, "piece_foundation_wood")]).toEqual([1, 1, 0]);

  const demolish = (w: { u32(n: number): void; u8(n: number): void }): void => (w.u32(ref), w.u8(STRUCT_DEMOLISH));
  expect(send(h, bob, CMD_STRUCT, demolish)).toBe(RESULT_NOT_YOURS);
  expect(send(h, ada, CMD_STRUCT, demolish)).toBe(RESULT_OK);
  h.run(200);
  expect([h.world.structs.count, bob.world!.structs.count]).toEqual([0, 0]);
});
```

### A weapon fired, and its damage

A new weapon. Take its kit, wait until it is loaded, stand a dummy with the console, and check the round spent and the blow.

[kit/recipes/weapon.test.ts](kit/recipes/weapon.test.ts)

```ts
import { expect, test } from "bun:test";
import { BTN_PRIMARY } from "../../../shared/sim/character.ts";
import { V_HEALTH } from "../../../shared/sim/vitals.ts";
import { takeInHand } from "../../fixtures/gather.ts";
import { camp, find, id, look, press, until } from "../kit.ts";

test("a pistol shot takes a round and its damage from a dummy's health", () => {
  const { h, ada } = camp({ gear: ["pistol"] });
  takeInHand(h, ada, id("pistol"));
  expect(until(h, () => ada.own.rounds > 0, 10)).toBe(true);
  const rounds = ada.own.rounds;
  expect(h.say(ada, "dummy")).toEqual(["a bare dummy"]);
  const dummy = find(h, "dummy");
  const health = h.host.survival.value(dummy.rec, V_HEALTH);

  look(h, ada, dummy.e);
  press(h, ada, BTN_PRIMARY);
  expect([h.host.combat.hits, ada.own.rounds]).toEqual([1, rounds - 1]);
  expect(h.host.combat.last.damage).toBeGreaterThan(0);
  expect(h.host.survival.value(dummy.rec, V_HEALTH)).toBeCloseTo(health - h.host.combat.last.damage, 0);
});
```

### A HUD element at four window shapes

Anything new on the HUD. Bring it onto the screen, then check its text and that it fits at each of `WINDOWS`.

[kit/recipes/hud-layout.test.ts](kit/recipes/hud-layout.test.ts)

```ts
import { expect, test } from "bun:test";
import { KEY_AMMO, KEY_VITAL } from "../../../client/core/ui/hud.ts";
import { takeInHand } from "../../fixtures/gather.ts";
import { WINDOWS, camp, fits, id, resize, screen, shown, until } from "../kit.ts";

test("the ammunition line and the health bar fit a desktop, an ultrawide and a phone", () => {
  const { h, ada } = camp({ screen: true, gear: ["pistol"] });
  const view = screen(h, ada);
  takeInHand(h, ada, id("pistol"));
  expect(until(h, () => ada.own.rounds > 0, 10)).toBe(true);
  for (const [name, width, height] of WINDOWS) {
    resize(h, view, width, height);
    expect(shown(view, KEY_AMMO), name).toBe("pistol round  6 / 54");
    expect(fits(view, KEY_AMMO), name).toBe(true);
    expect(fits(view, KEY_VITAL + 1), name).toBe(true);
  }
});
```

### A key that does something

A new branch in `App.key`. `tap` the key's code and check what the app did; keys go to the app as the shell sends them.

[kit/recipes/key.test.ts](kit/recipes/key.test.ts)

```ts
import { expect, test } from "bun:test";
import { KEY_INV_SLOT } from "../../../client/core/ui/inventory.ts";
import { camp, node, screen, tap } from "../kit.ts";

test("I opens the inventory and I again closes it, the body's keys still its own", () => {
  const { h, ada, at } = camp({ screen: true });
  const view = screen(h, ada);
  expect([view.app.ui.inventory.open, node(view, KEY_INV_SLOT)]).toEqual([false, null]);

  tap(h, view, "KeyI");
  expect(view.app.ui.inventory.open).toBe(true);
  expect(node(view, KEY_INV_SLOT)).not.toBeNull();
  view.app.key("KeyW", true);
  h.run(1000);
  view.app.key("KeyW", false);
  expect(ada.own.z).toBeGreaterThan(at.z + 2);

  tap(h, view, "KeyI");
  expect([view.app.ui.inventory.open, node(view, KEY_INV_SLOT)]).toEqual([false, null]);
});
```

### A thing drawn in the frame

A new draw. The screen's `packet` is the frame the shell would draw; `drawn` counts a mesh in it.

[kit/recipes/frame.test.ts](kit/recipes/frame.test.ts)

```ts
import { expect, test } from "bun:test";
import { camp, drawn, look, put, screen, tame } from "../kit.ts";

test("a raptor is in the frame once while it is in view, and not when it is behind", () => {
  const { h, ada, at } = camp({ screen: true });
  const view = screen(h, ada);
  expect(view.packet!.drawCount).toBeGreaterThan(0);
  expect(drawn(view, "core:raptor")).toBe(0);

  tame(h, ada, "raptor");
  h.run(300);
  expect(drawn(view, "core:raptor")).toBe(1);

  put(h, ada, { x: at.x, z: at.z - 100 });
  look(h, ada, { x: at.x, z: at.z - 200 });
  h.run(1000);
  expect(drawn(view, "core:raptor")).toBe(0);
});
```

### A rule checked over many random inputs

An invariant. Draw inputs from `Rng` with a few seeds, send them all, and check what must always hold.

[kit/recipes/seeded.test.ts](kit/recipes/seeded.test.ts)

```ts
import { expect, test } from "bun:test";
import { BOX_SELF, CMD_MOVE, RESULT_OK } from "../../../shared/net/protocol.ts";
import { Rng } from "../../../shared/rng.ts";
import { camp, count, send } from "../kit.ts";

for (const seed of [1, 2, 3]) test(`no move between slots makes or loses an item, seed ${seed}`, () => {
  const { h, ada } = camp({ items: { stone: 100, wood: 100, berry: 50 } });
  const rng = new Rng(seed);
  const inv = ada.inventory!;
  let moved = 0;
  for (let n = 0; n < 100; n++) {
    const held = [...inv.item.keys()].filter((slot) => inv.item[slot] !== 0);
    const from = held[rng.int(held.length)]!, to = rng.int(inv.cap), some = rng.int(150), item = inv.item[rng.int(4) === 0 ? to : from]!;
    const code = send(h, ada, CMD_MOVE, (w) => (w.bits(BOX_SELF, 1), w.varint(from), w.bits(BOX_SELF, 1), w.varint(to), w.u16(some), w.u16(item)));
    if (code === RESULT_OK) moved++;
  }
  expect(moved).toBeGreaterThan(30);
  expect(h.host.items.audit()).toEqual([]);
  expect([count(h, ada, "stone"), count(h, ada, "wood"), count(h, ada, "berry")]).toEqual([100, 100, 50]);
  expect(inv.total(h.reg.index.get("core:stone")!)).toBe(100);
});
```
