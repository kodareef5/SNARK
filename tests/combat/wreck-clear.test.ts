import { expect, test } from "bun:test";
import type { Source } from "../../server/combat.ts";
import { BTN_PRIMARY } from "../../shared/sim/character.ts";
import { DMG_MELEE } from "../../shared/sim/damage.ts";
import { capsuleFree } from "../../shared/world/collide.ts";
import { city, rocket } from "../fixtures/city.ts";
import { takeInHand } from "../fixtures/gather.ts";
import { count, id, pos, put, record, survivor } from "../kit/kit.ts";

const COMPACT = "core:compact_abandoned_white";
const STRIPPED = "core:zzzzzzzwreck_compact_abandoned_stripped";
const beside = { x: 126.665, z: 127.6 };

function street() {
  const c = city([{ kind: COMPACT, x: 128, z: 128 }]);
  const { h } = c, car = c.refs[0]!;
  const ada = survivor(h, "ada", { at: beside, items: { pick_metal: 1 } });
  const rec = record(h, ada);
  const pick: Source = { by: rec, x: beside.x, z: beside.z, item: id("pick_metal"), base: 32, type: DMG_MELEE,
    quality: 1, draw: 1, attack: 1, torporInstant: 0, torporOver: 0, torporSeconds: 0, buff: 0 };
  const hit = (source = pick) => h.host.combat.hitStructure(source, car, 127.1, 0.8, 127.6);
  const free = () => {
    const at = pos(h, ada), move = h.reg.move[rec.kind]!;
    return capsuleFree(h.world, at.x, at.y, at.z, move.radius, move.height);
  };
  return { c, h, car, ada, rec, hit, free };
}

test("the miner clears an opening door and can walk away", () => {
  const { c, h, car, ada, free } = street();
  takeInHand(h, ada, id("pick_metal"));
  h.run(1200);
  const pilot = h.pilots[0]!;
  pilot.yaw = Math.PI / 2;
  pilot.pitch = -0.9;
  h.run(200);
  for (let i = 0; i < 8; i++) {
    pilot.buttons = BTN_PRIMARY;
    h.run(230);
    pilot.buttons = 0;
    h.run(740);
  }
  const after = pos(h, ada);
  expect([c.id(car), free()]).toEqual([STRIPPED, true]);
  expect(after.x).toBeLessThan(beside.x);
  pilot.yaw = -Math.PI / 2;
  pilot.moveZ = 1;
  h.run(1000);
  expect(pos(h, ada).x).toBeLessThan(after.x - 1);
});

test("a wall holds the miner on its side until the door has room", () => {
  const { c, h, car, ada, rec, hit, free } = street();
  h.world.structs.add(id("wall"), 126.11, 1.5, 127.4, 16384, 23, 10000);
  for (let i = 0; i < 7; i++) hit();
  const state = () => [pos(h, ada), c.hp(car), c.id(car), count(h, ada, "polymer"), rec.xp];
  const before = state();
  expect(free()).toBe(true);
  expect([hit(), hit(), state()]).toEqual([0, 0, before]);
  put(h, ada, { x: 129.7, z: 128 });
  expect(hit()).toBeGreaterThan(0);
  expect([c.id(car), count(h, ada, "polymer")]).toEqual([STRIPPED, 10]);
});

test("a blocked door waits without pushing one survivor into another", () => {
  const { c, h, car, ada, hit } = street();
  const bob = survivor(h, "bob", { at: { x: 125.8, z: 127.5 } });
  const before = [pos(h, ada), pos(h, bob)];
  for (let i = 0; i < 7; i++) hit();
  expect([hit(), c.id(car), pos(h, ada), pos(h, bob)]).toEqual([0, COMPACT, ...before]);
  put(h, bob, { x: 122, z: 127.5 });
  expect(hit()).toBeGreaterThan(0);
  expect(c.id(car)).toBe(STRIPPED);
});

test("blasts can destroy a wreck while its door is obstructed", () => {
  const { c, h, car, ada, hit } = street();
  h.world.structs.add(id("wall"), 126.11, 1.5, 127.4, 16384, 23, 10000);
  const at = pos(h, ada);
  hit(rocket(h.reg));
  hit(rocket(h.reg));
  expect([c.id(car), c.hp(car) < 4000, pos(h, ada)]).toEqual([COMPACT, true, at]);
  hit(rocket(h.reg));
  hit(rocket(h.reg));
  expect([c.id(car), pos(h, ada), count(h, ada, "polymer")]).toEqual(["", at, 0]);
});

test("two miners stay put if only one can clear the door", () => {
  const { c, h, car, ada, hit } = street();
  put(h, ada, { x: beside.x, z: 127.04 });
  const bob = survivor(h, "bob", { at: { x: beside.x, z: 128.04 } });
  h.world.structs.add(id("wall"), 126.11, 1.5, 125.65, 16384, 23, 10000);
  const before = [pos(h, ada), pos(h, bob)];
  for (let i = 0; i < 7; i++) hit();
  expect([hit(), pos(h, ada), pos(h, bob)]).toEqual([0, ...before]);
  put(h, ada, { x: 131, z: 128 });
  expect(hit()).toBeGreaterThan(0);
  expect([c.id(car), pos(h, bob).x < beside.x]).toEqual([STRIPPED, true]);
});
