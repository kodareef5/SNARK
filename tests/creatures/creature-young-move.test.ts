import { expect, test } from "bun:test";
import { CORE_CONTENT } from "../../content/core.ts";
import { youngMove } from "../../server/young-move.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { TICK_DT } from "../../shared/coords.ts";
import { youngScale } from "../../shared/sim/breeding.ts";
import { Body, BTN_PRIMARY, MODE_SWIM } from "../../shared/sim/character.ts";
import { stepCreature } from "../../shared/sim/creature-actions.ts";
import { V_OXYGEN, V_TORPOR } from "../../shared/sim/vitals.ts";
import { capsuleFree } from "../../shared/world/collide.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { groundAt, GROUND_FREE } from "../../shared/world/path.ts";
import { dinosaurCourse } from "../../tools/dinosaurs/course.ts";
import { Harness } from "../fixtures/net.ts";

function hatched() {
  const result = compileContent(CORE_CONTENT.map(d => d.id === "core:dodo" && d.type === "species" ? {
    ...d, radius: .6, height: 3.96, eyeHeight: 1.32, swimDepth: 1.75, swimEyeHeight: 1.95, jumpSpeed: 0,
  } : d));
  if (!result.registry) throw new Error(result.errors.join("\n"));
  const h = new Harness({}, 1, 60, { dev: true, map: writeMap(dinosaurCourse()) }, result.registry);
  const ada = h.join("observer"); h.run(300); h.say(ada, "enablecheats");
  const adult = h.host.spawnCreature("core:dodo", 110, 92, 1), ents = h.world.ents;
  const parent = h.host.records.byPid.get(ents.pid[adult]!)!, egg = h.host.records.create(h.reg.breedEgg[parent.kind]!);
  egg.genome = structuredClone(parent.genome); egg.x = 110; egg.y = 1; egg.z = 100;
  egg.egg = { species: parent.kind, span: 100, hatchAt: h.world.tick + 100, carrier: 0 };
  expect(h.host.breeding.hatchNow(egg)).toBe(true);
  const rec = [...h.host.records.byPid.values()].find(r => r.kind === parent.kind && r.grown !== 0)!;
  const e = h.host.records.entOf.get(rec.pid)!, base = h.reg.move[rec.kind]!;
  h.host.creatures.mind.stay(e, 0xffffffff);
  return { h, ada, rec, e, base, ents };
}

test("hatched young use their visible size for float depth and breathing, and unconscious young still lose oxygen", () => {
  const { h, ada, rec, e, base, ents } = hatched();
  try {
    h.say(ada, "tp 208 174");
    ents.setPosition(e, 208, -3, 192); h.run(12000);
    const size = youngScale(h.reg.birthScale[rec.kind]!, rec.span, rec.grown, h.world.tick), p = youngMove(h.world, e, base);
    expect(ents.mode[e]).toBe(MODE_SWIM);
    expect(size).toBeLessThan(.26);
    expect(ents.y[e]).toBeCloseTo(-base.swimDepth! * size, 3);
    expect(ents.y[e]! + p.swimEyeHeight!).toBeGreaterThan(0);
    expect(h.host.survival.value(rec, V_OXYGEN)).toBe(150);
    const same = youngMove(h.world, e, base);
    expect(same).toBe(p);
    expect(base.height).toBe(3.96);
    expect(p.walkSpeed).toBe(base.walkSpeed);
    h.host.survival.add(rec, V_TORPOR, rec.vitals!.max[V_TORPOR]! / 1e6 + 1);
    h.run(300); expect(rec.out).toBe(true);
    const oxygen = h.host.survival.value(rec, V_OXYGEN); h.run(4000);
    expect(h.host.survival.value(rec, V_OXYGEN)).toBeLessThan(oxygen - 5);
    expect(h.host.breeding.growNow(rec)).toBe(true);
    expect(youngMove(h.world, e, base)).toBe(base);
  } finally { h.host.shutdown(); }
});

test("a young fits below a low roof; its path footprint and cached attack movement grow out of that clearance", () => {
  const { h, rec, e, base, ents } = hatched();
  try {
    h.world.structs.add(h.reg.index.get("core:ceiling")!, 110, 2.4, 100, 0, 0, 10000);
    const p = youngMove(h.world, e, base);
    expect(capsuleFree(h.world, 110, 1, 100, p.radius, p.height)).toBe(true);
    expect(groundAt(h.world, p, 110, 100)).toBe(GROUND_FREE);
    expect(capsuleFree(h.world, 110, 1, 100, base.radius, base.height)).toBe(false);
    const combat = { primary: { name: "growth exercise", clip: "attack", socket: "head", radius: .4, reach: 3, damage: 1, type: "melee" as const, ticks: 24, lands: 8, through: 12, stamina: 0 } };
    const traverse = () => {
      const b = new Body(); b.x = 110; b.y = 1; b.z = 96; b.grounded = true;
      for (let t = 0; t < 360; t++) stepCreature(h.world, b, 0, 127, 0, 0, BTN_PRIMARY, t === 0 ? BTN_PRIMARY : 0, p, combat, TICK_DT, false);
      return b.z;
    };
    expect(traverse()).toBeGreaterThan(102);
    rec.grown = h.world.tick + Math.floor(rec.span / 4); ents.setYoung(e, rec.span, rec.grown);
    expect(youngMove(h.world, e, base)).toBe(p);
    expect(capsuleFree(h.world, 110, 1, 100, p.radius, p.height)).toBe(false);
    expect(groundAt(h.world, p, 110, 100)).not.toBe(GROUND_FREE);
    expect(traverse()).toBeLessThan(98.5);
  } finally { h.host.shutdown(); }
});

test("a young's generic bite casts from its small eye and cannot retain adult reach", () => {
  const { h, e, base, ents } = hatched();
  try {
    const p = youngMove(h.world, e, base), store = h.world.structs;
    ents.yaw[e] = ents.pitch[e] = 0;
    // Thin horizontal targets bracket the authored juvenile reach. An adult-height ray misses both vertically.
    const kind = h.reg.index.get("core:ceiling_thatch")!;
    expect(kind).toBeDefined();
    const y = ents.y[e]! + p.eyeHeight;
    const near = store.add(kind, 110, y, 101.56, 0, 99, 10000);
    const far = store.add(kind, 110, y, 101.8, 0, 99, 10000);
    const hp = (ref: number) => store.chunks[Math.floor(ref / 65536)]!.hp[ref & 65535]!;
    const first = hp(near), second = hp(far);
    h.host.combat.bite(e);
    expect(hp(near)).toBeLessThan(first);
    expect(hp(far)).toBe(second);
    store.remove(near);
    h.host.combat.bite(e);
    expect(hp(far)).toBe(second);
  } finally { h.host.shutdown(); }
});
