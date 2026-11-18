import { expect, test } from "bun:test";
import { V_HEALTH } from "../../shared/sim/vitals.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { flatMap } from "../fixtures/map.ts";
import { Harness } from "../fixtures/net.ts";
import { frozenPack } from "../fixtures/pack.ts";

function fixture() {
  const pack = frozenPack();
  const h = new Harness({}, 11, 60, { dev: true, clips: pack.clips, rigs: pack.header.rigs, map: writeMap(flatMap(4)) });
  const observer = h.join("observer"); h.run(1000);
  const c = h.client(observer)!; h.world.ents.setPosition(c.ent, 128, 0, 100);
  h.run(500);
  return { h, c };
}

test("an unmounted hunter brakes into its posed bite range without pushing the stationary survivor", () => {
  const { h, c } = fixture();
  try {
    const { ents } = h.world, rec = h.host.records.byPid.get(c.pid)!, hp = h.host.survival.value(rec, V_HEALTH);
    const e = h.host.spawnCreature("core:raptor", 144, 100, 1), x = ents.x[c.ent]!, z = ents.z[c.ent]!;
    let fastest = 0;
    for (let tick = 0; tick < 300 && h.host.combat.hits === 0; tick++) {
      h.run(1000 / 30); fastest = Math.max(fastest, Math.hypot(ents.vx[e]!, ents.vz[e]!));
    }
    expect(fastest).toBeGreaterThan(5); expect(h.host.combat.last.victim).toBe(c.pid);
    expect(hp - h.host.survival.value(rec, V_HEALTH)).toBeGreaterThan(10);
    const distance = Math.hypot(ents.x[e]! - ents.x[c.ent]!, ents.z[e]! - ents.z[c.ent]!);
    expect(distance).toBeGreaterThan(1.7); expect(distance).toBeLessThan(2.9);
    expect([ents.x[c.ent], ents.z[c.ent]]).toEqual([x, z]);
  } finally { h.host.shutdown(); }
});

test("a tame keeps pace with fleeing prey during bite wind-up instead of repeatedly stopping outside its jaws", () => {
  const { h, c } = fixture();
  try {
    const { ents } = h.world, owner = h.host.records.byPid.get(c.pid)!;
    const hunter = h.host.spawnCreature("core:raptor", 128, 110, 1), prey = h.host.spawnCreature("core:parasaur", 138, 110, 1);
    const rec = h.host.records.byPid.get(ents.pid[hunter]!)!, victim = h.host.records.byPid.get(ents.pid[prey]!)!;
    rec.team = owner.team; ents.setTeam(hunter, owner.team); h.host.refreshBody(rec); h.host.creatures.claimed(hunter);
    h.host.creatures.mind.stay(prey, 0xffffffff); h.host.creatures.mind.attack(hunter, prey);
    const hp = h.host.survival.value(victim, V_HEALTH); let pacing = 0, blows = 0, previous = 0;
    for (let tick = 0; tick < 210 && !victim.dead; tick++) {
      h.run(1000 / 30);
      if (h.host.combat.hits > previous && h.host.combat.last.by === rec.pid && h.host.combat.last.victim === victim.pid) blows++;
      previous = h.host.combat.hits;
      const distance = Math.hypot(ents.x[hunter]! - ents.x[prey]!, ents.z[hunter]! - ents.z[prey]!);
      if (Math.hypot(ents.vx[prey]!, ents.vz[prey]!) > 4 && distance < 3.2 && ents.actTicks[hunter]! > 0 && ents.actTicks[hunter]! < 11) {
        expect(Math.hypot(ents.vx[hunter]!, ents.vz[hunter]!)).toBeGreaterThan(3);
        expect(h.host.creatures.mind.move[hunter]).toBeGreaterThan(0); pacing++;
      }
    }
    expect(blows).toBeGreaterThanOrEqual(4); expect(hp - h.host.survival.value(victim, V_HEALTH)).toBeGreaterThan(50);
    expect(pacing).toBeGreaterThan(10);
  } finally { h.host.shutdown(); }
});
