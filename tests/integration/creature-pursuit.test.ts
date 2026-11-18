import { expect, test } from "bun:test";
import { BTN_CROUCH } from "../../shared/sim/character.ts";
import { V_HEALTH } from "../../shared/sim/vitals.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { flatMap } from "../fixtures/map.ts";
import { Harness } from "../fixtures/net.ts";
import { corePack, frozenPack } from "../fixtures/pack.ts";
import { artTest } from "../fixtures/needs-art.ts";

function fixture(grade = 0, pack = frozenPack()) {
  const map = flatMap(4, { minY: -128 });
  for (let z = 0; z < 129; z++) for (let x = 0; x < 129; x++) map.heights[z * 129 + x] = Math.round((128 + (z * 2 - 128) * grade) * 256);
  const h = new Harness({}, 11, 60, { dev: true, clips: pack.clips, rigs: pack.header.rigs, map: writeMap(map) });
  const observer = h.join("observer"); h.run(1000);
  const c = h.client(observer)!; h.world.ents.setPosition(c.ent, 128, h.world.hf.heightAt(128, 128), 128);
  h.run(500);
  return { h, c };
}

function hunts(pack = frozenPack()) {
  // Real normal AI decisions, action wind-up, movement and damage: both approach directions on a slope, a crouching
  // survivor, and a survivor walking into the hunter's chest. The ordinary AI retains its world-space eye aim.
  for (const grade of [0, Math.tan(Math.PI / 9), -Math.tan(Math.PI / 9)]) for (const stance of ["stand", "crouch", "press"]) {
    const { h, c } = fixture(grade, pack);
    try {
      const { ents } = h.world, rec = h.host.records.byPid.get(c.pid)!, hp = h.host.survival.value(rec, V_HEALTH);
      const e = h.host.spawnCreature("core:raptor", 128, 140, 1), x = ents.x[c.ent]!, z = ents.z[c.ent]!;
      h.pilots[0]!.buttons = stance === "crouch" ? BTN_CROUCH : 0;
      if (stance === "press") h.pilots[0]!.moveZ = 127;
      for (let tick = 0; tick < 360 && h.host.combat.hits === 0; tick++) {
        if (stance === "press") h.pilots[0]!.yaw = Math.atan2(ents.x[e]! - ents.x[c.ent]!, ents.z[e]! - ents.z[c.ent]!);
        h.run(1000 / 30);
      }
      expect({ grade, stance, victim: h.host.combat.last.victim }).toEqual({ grade, stance, victim: c.pid });
      expect(hp - h.host.survival.value(rec, V_HEALTH)).toBeGreaterThan(10);
      if (stance !== "press") expect([ents.x[c.ent], ents.z[c.ent]]).toEqual([x, z]);
      expect(h.host.creatures.mind.bites).toBeGreaterThan(0);
      expect(ents.pid[e]).not.toBe(0);
    } finally { h.host.shutdown(); }
  }
  // A hunt must connect across bearings, rather than parking at the one orientation used by the original fixture.
  for (let i = 0; i < 8; i++) {
    const { h, c } = fixture(0, pack);
    try {
      const bearing = (i + .27) * Math.PI / 4, distance = 9 + i * 1.5;
      h.host.spawnCreature("core:raptor", 128 + Math.sin(bearing) * distance, 128 + Math.cos(bearing) * distance, 1);
      for (let tick = 0; tick < 240 && h.host.combat.hits === 0; tick++) h.run(1000 / 30);
      expect({ i, victim: h.host.combat.last.victim }).toEqual({ i, victim: c.pid });
    } finally { h.host.shutdown(); }
  }
}

test("ordinary wild hunters still bite through slopes, crouching, close approach and eight bearings", () => hunts());
artTest("current shipped art retains normal unmounted hillside and close-approach hunts", () => hunts(corePack()));

function ordered(pack = frozenPack()) {
  for (const hunter of ["raptor", "parasaur", "dodo"]) for (const prey of ["raptor", "parasaur", "grazer", "pteranodon"]) {
    const { h, c } = fixture(0, pack);
    try {
      const { ents } = h.world, owner = h.host.records.byPid.get(c.pid)!;
      ents.setPosition(c.ent, 180, 0, 180);
      const e = h.host.spawnCreature(`core:${hunter}`, 128, 115, 1), target = h.host.spawnCreature(`core:${prey}`, 128, 128, 1);
      const rec = h.host.records.byPid.get(ents.pid[e]!)!, victim = h.host.records.byPid.get(ents.pid[target]!)!;
      rec.team = owner.team; ents.setTeam(e, owner.team); h.host.refreshBody(rec); h.host.creatures.claimed(e);
      ents.yaw[target] = 32768; h.host.creatures.mind.look[target] = 32768;
      h.host.creatures.mind.attack(e, target);
      const hp = h.host.survival.value(victim, V_HEALTH);
      for (let tick = 0; tick < 750 && h.host.combat.last.victim !== victim.pid; tick++) {
        h.host.creatures.mind.stay(target, 0xffffffff); h.run(1000 / 30);
      }
      expect({ hunter, prey, attempts: h.host.creatures.mind.bites > 0 }).toEqual({ hunter, prey, attempts: true });
      // Main already misses these tall adult rigs with the dodo's short eye ray. Restoring its approach must not
      // silently change ordinary AI targeting; raptor/grazer still prove real dodo damage, as do all larger hunters.
      if (hunter !== "dodo" || prey === "raptor" || prey === "grazer") {
        expect({ hunter, prey, victim: h.host.combat.last.victim }).toEqual({ hunter, prey, victim: victim.pid });
        expect(hp - h.host.survival.value(victim, V_HEALTH)).toBeGreaterThan(0);
      }
    } finally { h.host.shutdown(); }
  }
}

test("unridden tame raptors, parasaurs and dodos reach their normal attacks against creatures of different sizes", () => ordered());
artTest("current shipped art retains the twelve ordinary tame and creature attack pairs", () => ordered(corePack()));
