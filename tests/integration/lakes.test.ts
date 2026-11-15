// Water standing above the sea, served in a map file: swum into, out of and between at different heights with no
// correction, breathed and drowned in, drunk from and a vessel filled in, a body sinking in it, and ARK's rules for a bed
// and a fire under it.
import { expect, test } from "bun:test";
import { Rng } from "../../shared/rng.ts";
import { STRUCT_UNITS } from "../../shared/coords.ts";
import type { BitWriter } from "../../shared/net/codec.ts";
import { BOX_SELF, CMD_MOVE, CMD_SELECT, CMD_USE, RESULT_DENIED, RESULT_INVALID, RESULT_OK } from "../../shared/net/protocol.ts";
import { NO_TARGET } from "../../server/build.ts";
import { BTN_JUMP, BTN_SPRINT, BTN_USE, MODE_SWIM, MODE_WALK } from "../../shared/sim/character.ts";
import { V_WATER } from "../../shared/sim/vitals.ts";
import { capsuleFree } from "../../shared/world/collide.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { DRINK } from "../../server/use.ts";
import { LAKES, lakesMap } from "../fixtures/lakes.ts";
import { Harness } from "../fixtures/net.ts";

const MAP = writeMap(lakesMap());

function admin(link = {}) {
  const h = new Harness({}, 1, 60, { dev: true, map: MAP });
  const s = h.join("ada", link);
  h.run(500);
  expect(h.say(s, "enablecheats")).toEqual(["cheats enabled"]);
  return { h, s, pilot: h.pilots[0]!, ents: h.world.ents, e: h.ent(s), rec: h.host.records.byPid.get(h.client(s)!.pid)! };
}

test("the client reads the map's water from its file, and swimming into, out of and between waters at different heights costs no corrections at 60 ms", () => {
  const { h, s, pilot, ents, e } = admin({ latencyMs: 60 });
  expect(s.world!.hf.waterAt(LAKES.high.x, LAKES.high.z)).toBe(LAKES.high.surface);
  const p = h.reg.move[ents.kind[e]!]!;
  const modes = new Set<number>();
  const bodies = new Set<number>();
  let inside = 0;
  let corrections = 0;
  const rng = new Rng(5);
  /** From (x, z), legs toward (tx, tz) and back past where it began, swerving, sprinting and jumping now and then. */
  const legs = (x: number, z: number, tx: number, tz: number, n: number): void => {
    expect(h.say(s, `tp ${x} ${z}`)[0]).toContain("at ");
    h.run(500);
    const from = s.stats.corrections;
    for (let i = 0; i < n; i++) {
      const [gx, gz] = i % 2 === 0 ? [tx, tz] : [x, z];
      pilot.yaw = Math.atan2(gx - s.own.x, gz - s.own.z) + rng.range(-0.3, 0.3);
      pilot.pitch = rng.range(-0.6, 0.4);
      [pilot.moveZ, pilot.moveX] = [1, rng.range(-0.3, 0.3)];
      pilot.buttons = (rng.int(3) === 0 ? BTN_JUMP : 0) | (rng.int(2) === 0 ? BTN_SPRINT : 0);
      h.run(5000, () => {
        modes.add(s.own.mode);
        bodies.add(h.world.hf.water!.bodyAt(ents.x[e]!, ents.z[e]!));
        if (!capsuleFree(h.world, ents.x[e]!, ents.y[e]!, ents.z[e]!, p.radius, p.height)) inside++;
      });
    }
    [pilot.moveX, pilot.moveZ, pilot.buttons] = [0, 0, 0];
    h.run(800);
    corrections += s.stats.corrections - from;
  };
  // Along the channel across the step between its reaches; into the pond 20 m up from its terrace and out; into the low pond.
  legs(58, LAKES.river.z, 84, LAKES.river.z, 6);
  legs(LAKES.high.x, LAKES.high.z + LAKES.high.r + 10, LAKES.high.x, LAKES.high.z, 4);
  legs(LAKES.low.x + LAKES.low.r + 8, LAKES.low.z, LAKES.low.x, LAKES.low.z, 4);
  expect([modes.has(MODE_SWIM), modes.has(MODE_WALK), [...bodies].sort()]).toEqual([true, true, [0, 1, 2, 3, 4]]);
  expect([inside, corrections]).toEqual([0, 0]);
  expect([s.own.x, s.own.y, s.own.z, s.own.mode]).toEqual([ents.x[e]!, ents.y[e]!, ents.z[e]!, ents.mode[e]!]);
});

test("in the pond 20 m up a survivor's head goes under and comes up, and E drinks from the water she stands or swims in and fills a vessel", () => {
  const { h, s, pilot, ents, e, rec } = admin();
  const sv = h.host.survival;
  const press = (): void => {
    pilot.buttons = BTN_USE;
    h.run(100);
    pilot.buttons = 0;
    h.run(200);
  };
  sv.add(rec, V_WATER, -60);
  // On the dry plain E finds nothing to do.
  h.say(s, `tp ${LAKES.spawn.x} ${LAKES.spawn.z}`);
  h.run(500);
  let was = sv.value(rec, V_WATER);
  press();
  expect(sv.value(rec, V_WATER)).toBeLessThanOrEqual(was);

  // Put on the bed of the high pond's middle her head is under; she comes up to swim at the surface, and dives again.
  h.say(s, `tp ${LAKES.high.x} ${LAKES.high.z}`);
  h.run(500);
  expect([ents.mode[e], sv.isSubmerged(rec)]).toEqual([MODE_SWIM, true]);
  pilot.buttons = BTN_JUMP;
  h.run(3000);
  pilot.buttons = 0;
  h.run(300);
  expect([ents.mode[e], ents.y[e]! < LAKES.high.surface, sv.isSubmerged(rec)]).toEqual([MODE_SWIM, true, false]);
  [pilot.pitch, pilot.moveZ] = [-1.2, 1];
  h.run(1500);
  expect(sv.isSubmerged(rec)).toBe(true);
  [pilot.pitch, pilot.moveZ, pilot.buttons] = [0, 0, BTN_JUMP];
  h.run(3000);
  pilot.buttons = 0;
  expect(sv.isSubmerged(rec)).toBe(false);
  was = sv.value(rec, V_WATER);
  press();
  expect(sv.value(rec, V_WATER)).toBeCloseTo(was + DRINK, 0);

  // Standing to her shins at the low pond's edge, she drinks again and fills a water skin there.
  const hf = h.world.hf;
  let x = LAKES.low.x;
  while (x < LAKES.low.x + LAKES.low.r + 2 && !(hf.heightAt(x, LAKES.low.z) > LAKES.low.surface - 0.6 && hf.heightAt(x, LAKES.low.z) < LAKES.low.surface - 0.15)) x += 0.25;
  h.say(s, `tp ${x} ${LAKES.low.z}`);
  h.run(1000);
  expect([ents.mode[e], ents.y[e]! < LAKES.low.surface]).toEqual([MODE_WALK, true]);
  was = sv.value(rec, V_WATER);
  press();
  expect(sv.value(rec, V_WATER)).toBeCloseTo(was + DRINK, 0);
  const skin = h.reg.index.get("core:waterskin")!;
  h.host.items.mint(rec, skin, 1);
  const inv = h.host.items.inv(rec);
  const slot = inv.item.indexOf(skin);
  let code = -1;
  s.onResult = (_seq, c) => void (code = c);
  s.command(CMD_USE, (w: BitWriter) => (w.varint(slot), w.u16(skin)));
  h.run(200);
  expect([code, inv.dur[slot]]).toEqual([RESULT_OK, 100]);
});

test("a dodo swims at the surface of the pond 20 m up, and killed there its body sinks to the pond's bed", () => {
  const { h } = admin();
  const ents = h.world.ents;
  const e = h.host.spawnCreature("core:dodo", LAKES.high.x, LAKES.high.z, 1);
  h.host.creatures.mind.stay(e, 0xffffffff);
  h.run(4000);
  expect([ents.mode[e], ents.y[e]! > LAKES.high.surface - 1, ents.y[e]! < LAKES.high.surface]).toEqual([MODE_SWIM, true, true]);
  const rec = h.host.records.byPid.get(ents.pid[e]!)!;
  const before = new Set(h.host.corpses.bodies.keys());
  h.host.survival.hurt(rec, 1e6, 0);
  for (let k = 0; k < 120 && h.host.corpses.falling > 0; k++) h.run(250);
  const body = [...h.host.corpses.bodies.values()].find((b) => !before.has(b.e))!;
  expect([h.host.corpses.falling, body.y < LAKES.high.surface - 2.5, Math.abs(body.y - h.world.hf.heightAt(body.x, body.z)) < 0.3]).toEqual([0, true, true]);
});

test("as in ARK, a bed is not set down under water, and a fire under water is not lit, in a lake as in the sea", () => {
  const { h, s, rec } = admin();
  const id = (name: string): number => h.reg.index.get(`core:${name}`)!;
  const U = STRUCT_UNITS;
  // A campfire on the high pond's bed, 3 m under, and one on its terrace, each with wood.
  const fire = (x: number, z: number): number => {
    const ref = h.world.structs.add(id("campfire"), x, Math.ceil(h.world.hf.heightAt(x, z) * U) / U + 0.25, z, 0, rec.team, 500);
    h.host.items.mint(h.host.fixtures.ensure(ref), id("wood"), 4);
    return ref;
  };
  expect([h.host.stations.toggle(fire(LAKES.high.x, LAKES.high.z)), h.host.stations.toggle(fire(LAKES.high.x, LAKES.high.z + LAKES.high.r + 6))]).toEqual([RESULT_INVALID, RESULT_OK]);
  // A sleeping bag in hand: refused on the pond's shallows under water, set down on the terrace.
  h.say(s, `give piece_sleeping_bag 2`);
  const inv = s.inventory!;
  s.command(CMD_MOVE, (w: BitWriter) => (w.bits(BOX_SELF, 1), w.varint(inv.item.indexOf(id("piece_sleeping_bag"))), w.bits(BOX_SELF, 1), w.varint(inv.hotbar), w.u16(0), w.u16(id("piece_sleeping_bag"))));
  h.run(150);
  s.command(CMD_SELECT, (w: BitWriter) => w.u8(0));
  h.run(150);
  const shore = { x: LAKES.high.x, z: LAKES.high.z + LAKES.high.r - 3 };
  h.say(s, `tp ${shore.x} ${shore.z + 3}`);
  h.run(800);
  const c = h.client(s)!;
  const set = (x: number, z: number): number => h.host.build.set(c, 0, NO_TARGET, 0, 0, Math.round(x * U), Math.round(z * U), 0, 0);
  expect(h.world.hf.heightAt(shore.x, shore.z)).toBeLessThan(LAKES.high.surface - 0.5);
  expect(set(shore.x, shore.z)).toBe(RESULT_DENIED);
  h.run(200);
  expect(s.log.some((l) => l.text.includes("A bed cannot be placed under water."))).toBe(true);
  expect(set(shore.x, shore.z + 5)).toBe(RESULT_OK);
});
