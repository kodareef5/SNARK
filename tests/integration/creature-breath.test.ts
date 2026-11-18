import { expect, test } from "bun:test";
import { CORE_CONTENT } from "../../content/core.ts";
import { creatureSize, youngMove } from "../../server/young-move.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { MF_OUT, MODE_WALK, stanceEye } from "../../shared/sim/character.ts";
import { F_GROUNDED } from "../../shared/sim/entities.ts";
import { V_HEALTH, V_OXYGEN, V_TORPOR } from "../../shared/sim/vitals.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { MapWater } from "../../shared/world/water.ts";
import { breathingRig } from "../fixtures/breathing.ts";
import { flatMap } from "../fixtures/map.ts";
import { Harness } from "../fixtures/net.ts";

function yard(enabled = true, young = false, eyeHeight = 2) {
  const f = breathingRig(enabled), compiled = compileContent(CORE_CONTENT.map(d => d.id === "core:dodo" && d.type === "species" ? {
    ...d, radius: .8, height: 3, eyeHeight, swimDepth: 2.5, jumpSpeed: 0,
  } : d));
  if (!compiled.registry) throw new Error(compiled.errors.join("\n"));
  const h = new Harness({}, 1, 60, { dev: true, map: writeMap(flatMap()), rigs: [f.rig], clips: f.clips }, compiled.registry);
  const observer = h.join("observer"); h.run(300); h.say(observer, "enablecheats");
  h.host.survival.gods.add(h.client(observer)!.pid);
  const ents = h.world.ents, adult = h.host.spawnCreature("core:dodo", 120, 120, 1);
  let e = adult, rec = h.host.records.byPid.get(ents.pid[adult]!)!;
  if (young) {
    const egg = h.host.records.create(h.reg.breedEgg[rec.kind]!);
    egg.genome = structuredClone(rec.genome); egg.x = 120; egg.y = 0; egg.z = 116;
    egg.egg = { species: rec.kind, span: 100, hatchAt: h.world.tick + 100, carrier: 0 };
    expect(h.host.breeding.hatchNow(egg)).toBe(true);
    rec = [...h.host.records.byPid.values()].find(r => r.kind === rec.kind && r.grown !== 0)!;
    e = h.host.records.entOf.get(rec.pid)!;
  }
  rec.genome!.wild.fill(0); h.host.survival.init(rec);
  h.host.creatures.mind.stay(e, 0xffffffff);
  ents.setPosition(e, 120, 0, 120); ents.yaw[e] = 0; h.host.creatures.mind.look[e] = 0; ents.flags[e] = ents.flags[e]! | F_GROUNDED; ents.pose(e, h.world.tick);
  h.say(observer, "tp 122 120"); h.run(200);
  const sv = h.host.survival;
  const knock = () => { sv.add(rec, V_TORPOR, rec.vitals!.max[V_TORPOR]! / 1e6 + 1); h.run(1800); expect(rec.out).toBe(true); ents.yaw[e] = 0; h.host.creatures.mind.look[e] = 0; ents.pose(e, h.world.tick); };
  return { h, ents, e, rec, sv, knock, oxygen: () => sv.value(rec, V_OXYGEN) };
}

test("posed KO airways consume oxygen and cause drowning while the legacy stance eye would remain dry, including a hatched young", () => {
  for (const young of [false, true]) for (const enabled of [false, true]) {
    const f = yard(enabled, young);
    try {
      f.knock(); const size = creatureSize(f.h.world, f.e);
      f.h.world.hf.seaLevel = .65 * size;
      const move = youngMove(f.h.world, f.e, f.h.reg.move[f.rec.kind]!);
      expect(f.ents.y[f.e]! + stanceEye(move, f.ents.stance[f.e]!)).toBeGreaterThan(f.h.world.hf.seaLevel);
      f.h.run(3000);
      expect(f.ents.mode[f.e]).toBe(MODE_WALK);
      if (enabled) expect(f.oxygen()).toBeLessThan(143);
      else expect(f.oxygen()).toBe(150);
      f.sv.add(f.rec, V_OXYGEN, -f.oxygen());
      const health = f.sv.value(f.rec, V_HEALTH); f.h.run(1500);
      if (enabled) expect(f.sv.value(f.rec, V_HEALTH)).toBeLessThan(health);
      else { expect(f.sv.value(f.rec, V_HEALTH)).toBe(health); expect(f.oxygen()).toBeGreaterThan(0); }
    } finally { f.h.host.shutdown(); }
  }
});

test("a stationary grounded get-up rechecks its dipping airway and then refills oxygen without movement", () => {
  const f = yard();
  try {
    f.knock(); f.h.world.hf.seaLevel = .4;
    f.h.run(500); expect(f.oxygen()).toBe(150);
    f.sv.add(f.rec, V_TORPOR, -1e6); f.h.run(100);
    expect(f.rec.out).toBe(false); expect(f.ents.mflags[f.e]! & MF_OUT).toBe(0);
    const x = f.ents.x[f.e]!, z = f.ents.z[f.e]!;
    f.h.run(1500); expect(f.oxygen()).toBeLessThan(149);
    expect([f.ents.x[f.e], f.ents.z[f.e], f.ents.mode[f.e]]).toEqual([x, z, MODE_WALK]);
    f.h.run(2500); expect(f.oxygen()).toBe(150);
  } finally { f.h.host.shutdown(); }
});

test("an unconscious long head uses its own shoreline and yaw, with either exposed airway restoring oxygen", () => {
  const f = yard();
  try {
    f.knock();
    const hf = f.h.world.hf, grid = new Uint16Array(hf.sizeX * hf.sizeZ);
    for (let z = 121; z < hf.sizeZ; z++) for (let x = 0; x < hf.sizeX; x++) grid[z * hf.sizeX + x] = 1;
    hf.water = MapWater.fromGrid(f.h.world.dims, 0, 1, 1, [{ name: "shore", level: 1 }], grid);
    f.ents.setPosition(f.e, 120, 0, 120.1); f.h.run(2000);
    expect(hf.waterAt(f.ents.x[f.e]!, f.ents.z[f.e]!)).toBe(-Infinity);
    expect(f.oxygen()).toBeLessThan(146);
    f.ents.yaw[f.e] = 32768; f.h.host.creatures.mind.look[f.e] = 32768; f.ents.pose(f.e, f.h.world.tick);
    f.h.run(1000); expect(f.oxygen()).toBe(150);
    f.ents.setPosition(f.e, 120, 0, 121); f.ents.yaw[f.e] = 16384; f.h.host.creatures.mind.look[f.e] = 16384; f.ents.pose(f.e, f.h.world.tick);
    f.h.run(1000); expect(f.oxygen()).toBe(150);
  } finally { f.h.host.shutdown(); }
});

test("cue expiry returns a resting creature to its legacy breathing rule without retaining stale dry state", () => {
  const f = yard(true, false, .3);
  try {
    f.knock(); f.h.world.hf.seaLevel = .9;
    f.sv.add(f.rec, V_TORPOR, -1e6);
    f.h.run(6500); expect(f.rec.out).toBe(false); expect(f.oxygen()).toBe(150);
    // The authored get-up head is high, but this deliberately different legacy eye is low.
    // Once its cue expires, the explicitly scoped KO feature must stop supplying posed breathing.
    f.h.run(3000); expect(f.oxygen()).toBeLessThan(147);
  } finally { f.h.host.shutdown(); }
});
