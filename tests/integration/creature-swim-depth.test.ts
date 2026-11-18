import { expect, test } from "bun:test";
import { CORE_CONTENT } from "../../content/core.ts";
import type { SpeciesDef } from "../../shared/content/defs.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { BTN_JUMP, MODE_SWIM, MODE_WALK } from "../../shared/sim/character.ts";
import { F_GROUNDED } from "../../shared/sim/entities.ts";
import { V_OXYGEN, V_TORPOR } from "../../shared/sim/vitals.ts";
import { PROVING_POOL } from "../../shared/world/proving.ts";
import { flatGround } from "../fixtures/arena.ts";
import { Harness } from "../fixtures/net.ts";

function setup(more: Partial<SpeciesDef> = {}) {
  const result = compileContent(CORE_CONTENT.map(d => d.id === "core:dodo" && d.type === "species" ? {
    ...d, radius: .6, height: 3.96, eyeHeight: 1.32, swimDepth: 1.12, jumpSpeed: 0, ...more,
  } : d));
  if (!result.registry) throw new Error(result.errors.join("\n"));
  const h = new Harness({}, 1, 60, { dev: true }, result.registry);
  const ada = h.join("ada"); h.run(500); h.say(ada, "enablecheats");
  const g = flatGround(h, 40, 30), ents = h.world.ents, sv = h.host.survival;
  h.say(ada, `tp ${g.x + 20} ${g.z + 6}`);
  const me = h.host.records.byPid.get(h.client(ada)!.pid)!;
  sv.gods.add(me.pid);
  const put = (offset: number) => {
    const e = h.host.spawnCreature("core:dodo", g.x + 6 + offset, g.z + 20, 1);
    expect(e).toBeGreaterThanOrEqual(0);
    h.host.creatures.mind.stay(e, h.world.tick + 1e6);
    const rec = h.host.records.byPid.get(ents.pid[e]!)!;
    rec.genome!.wild.fill(0); sv.init(rec);
    return { e, rec };
  };
  const sink = (e: number, offset: number) => {
    ents.flags[e] = ents.flags[e]! & ~F_GROUNDED;
    ents.mode[e] = MODE_WALK;
    ents.setPosition(e, PROVING_POOL.x + offset, h.world.hf.seaLevel - 3, PROVING_POOL.z);
    ents.vx[e] = ents.vy[e] = ents.vz[e] = 0;
  };
  return { h, ada, me, ents, sv, put, sink };
}

test("a tall low-headed creature comes up for air at its authored depth; unconscious it remains submerged and consumes oxygen", () => {
  const { h, ada, sv, ents, put, sink } = setup();
  const awake = put(0), cold = put(4);
  sv.add(cold.rec, V_TORPOR, cold.rec.vitals!.max[V_TORPOR]! / 1e6 + 1);
  h.run(500);
  expect(cold.rec.out).toBe(true);
  h.say(ada, `tp ${PROVING_POOL.x + 12} ${PROVING_POOL.z + .5}`);
  sink(awake.e, -3); sink(cold.e, 3);
  h.run(12000);
  expect(ents.mode[awake.e]).toBe(MODE_SWIM);
  expect(ents.y[awake.e]! + 1.32).toBeGreaterThan(h.world.hf.seaLevel);
  expect(ents.y[awake.e]).toBeCloseTo(h.world.hf.seaLevel - 1.12, 3);
  expect(sv.value(awake.rec, V_OXYGEN)).toBe(150);
  expect(ents.y[cold.e]! + 1.32).toBeLessThan(h.world.hf.seaLevel);
  expect(sv.value(cold.rec, V_OXYGEN)).toBeLessThan(120);
  expect(sv.value(cold.rec, V_OXYGEN)).toBeGreaterThan(110);
});

test("ridden authored-depth swimming and diving replays identically on owner and server", () => {
  const { h, ada, me, ents, put, sink } = setup(), tame = put(0);
  expect(h.host.taming.give(tame.rec, me, .9, "forced")).toBe(true);
  h.run(500);
  expect(h.host.game.take(h.client(ada)!, tame.e)).toBe(true);
  h.run(500);
  expect(ada.driving).toBe(tame.e);
  sink(tame.e, 0);
  h.run(1000);
  const pilot = h.pilots[0]!, baseline = ada.stats.corrections + ada.stats.stateCorrections;
  pilot.buttons = BTN_JUMP;
  h.run(2200);
  expect(ents.y[tame.e]).toBeCloseTo(h.world.hf.seaLevel - 1.12, 3);
  pilot.buttons = 0; pilot.moveZ = 1; pilot.pitch = -.8;
  h.run(1000);
  expect(ents.y[tame.e]! + 1.32).toBeLessThan(h.world.hf.seaLevel);
  pilot.moveZ = 0; pilot.pitch = 0; pilot.buttons = BTN_JUMP;
  h.run(2200);
  pilot.buttons = 0; h.run(500);
  expect(ada.stats.corrections + ada.stats.stateCorrections).toBe(baseline);
  expect(Math.abs(ada.own.y - ents.y[tame.e]!)).toBeLessThan(.001);
  expect(ents.y[tame.e]).toBeCloseTo(h.world.hf.seaLevel - 1.12, 3);
});

test("a measured raised swimming head breathes at deep immersion only while conscious; absent data keeps ordinary submersion", () => {
  for (const raised of [false, true]) {
    const { h, ada, sv, ents, put, sink } = setup({ swimDepth: 1.75, ...(raised ? { swimEyeHeight: 1.97 } : {}) });
    const awake = put(0), cold = put(4);
    sv.add(cold.rec, V_TORPOR, cold.rec.vitals!.max[V_TORPOR]! / 1e6 + 1);
    h.run(500);
    h.say(ada, `tp ${PROVING_POOL.x + 12} ${PROVING_POOL.z + .5}`);
    sink(awake.e, -3); sink(cold.e, 3);
    // Both breathing points differ at this same authored float line: the unconscious animal cannot hold its neck up.
    ents.setPosition(cold.e, PROVING_POOL.x + 3, h.world.hf.seaLevel - 1.75, PROVING_POOL.z);
    h.run(12000);
    expect([ents.mode[awake.e], cold.rec.out]).toEqual([MODE_SWIM, true]);
    expect(ents.y[awake.e]).toBeCloseTo(h.world.hf.seaLevel - 1.75, 3);
    expect(ents.y[awake.e]! + 1.32).toBeLessThan(h.world.hf.seaLevel);
    if (raised) expect(sv.value(awake.rec, V_OXYGEN)).toBe(150);
    else expect(sv.value(awake.rec, V_OXYGEN)).toBeCloseTo(114, 0); // First underwater notification is one fixed tick later.
    expect(sv.value(cold.rec, V_OXYGEN)).toBeLessThan(120);
    expect(sv.value(cold.rec, V_OXYGEN)).toBeGreaterThan(110);
    h.host.shutdown();
  }
});
