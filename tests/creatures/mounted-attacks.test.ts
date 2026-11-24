import { expect, test } from "bun:test";
import { EVENT_HIT, RESULT_OK } from "../../shared/net/protocol.ts";
import { BTN_PRIMARY } from "../../shared/sim/character.ts";
import { ACT_SWING } from "../../shared/sim/weapon.ts";
import { V_HEALTH } from "../../shared/sim/vitals.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { flatMap } from "../fixtures/map.ts";
import { Harness } from "../fixtures/net.ts";
import { frozenPack } from "../fixtures/pack.ts";
import { camp, creature, id, pilot, press, record, ride, survivor, tame } from "../kit/kit.ts";

function fixture(kind: string, across = 0) {
  const pack = frozenPack();
  const map = flatMap(4, { minY: -128 });
  for (let j = 0; j < 129; j++) for (let i = 0; i < 129; i++) map.heights[j * 129 + i] = Math.round((128 + (i * 2 - 128) * across) * 256);
  const h = new Harness({}, 5, 60, { dev: true, clips: pack.clips, rigs: pack.header.rigs, map: writeMap(map) });
  const rider = h.join("rider"), observer = h.join("observer"); h.run(1000);
  const c = h.client(rider)!, ents = h.world.ents, owner = h.host.records.byPid.get(c.pid)!;
  const mount = h.host.spawnCreature(`core:${kind}`, 128, 70, 1), rec = h.host.records.byPid.get(ents.pid[mount]!)!;
  rec.team = owner.team; rec.saddle = h.reg.index.get(`core:saddle_${kind}`)!; ents.setTeam(mount, rec.team);
  h.host.refreshBody(rec); h.host.creatures.claimed(mount); h.host.creatures.mind.stay(mount, 0xffffffff);
  ents.setPosition(c.ent, 126, h.world.hf.heightAt(126, 70), 70);
  expect(h.host.riding.mount(c, mount)).toBe(RESULT_OK); h.run(1000); expect(c.drive).toBe(mount);
  function target(species: string, distance: number, x = 128) {
    const e = h.host.spawnCreature(`core:${species}`, x, 70 + distance, 1);
    h.host.creatures.mind.stay(e, 0xffffffff);
    return h.host.records.byPid.get(ents.pid[e]!)!;
  }
  function attack(pitch = 0) {
    h.pilots[0]!.pitch = pitch; h.run(150);
    const before = h.host.combat.hits, riderHp = h.host.survival.value(owner, V_HEALTH);
    h.pilots[0]!.buttons = BTN_PRIMARY;
    for (let f = 0; f < 39; f++) h.run(1000 / 60);
    h.pilots[0]!.buttons = 0; h.run(100);
    expect(c.drive).toBe(mount); expect(h.host.survival.value(owner, V_HEALTH)).toBeGreaterThanOrEqual(riderHp);
    return { hits: h.host.combat.hits - before, feedback: rider.events.filter(e => e.kind === EVENT_HIT) };
  }
  return { h, rider, observer, mount, rec, c, target, attack };
}

test("a ridden parasaur bites a survivor three metres ahead on a 20-degree cross slope", () => {
  for (const across of [-1, 1]) {
    const f = fixture("parasaur", across * Math.tan(Math.PI / 9));
    const { h } = f;
    try {
      const target = h.client(f.observer)!;
      h.world.ents.setPosition(target.ent, 128, h.world.hf.heightAt(128, 73), 73);
      const eye = new Float64Array(3);
      h.host.combat.eye(f.mount, eye);
      const ents = h.world.ents;
      const pitch = Math.atan2(ents.y[target.ent]! + 1.2 - eye[1]!, ents.z[target.ent]! - eye[2]!);
      const result = f.attack(pitch);
      expect(result.hits).toBe(1);
      expect(h.host.combat.last.victim).toBe(target.pid);
      expect(result.feedback).toHaveLength(1);
      expect(f.observer.events.filter(e => e.kind === EVENT_HIT)).toHaveLength(0);
    } finally { h.host.shutdown(); }
  }
});

test("wild and unmounted tame hits never send a marker to character creation or spectators", () => {
  for (const owned of [false, true]) {
    const pack = frozenPack(), h = new Harness({ spectators: "anyone" }, 5, 60, { dev: true, clips: pack.clips, rigs: pack.header.rigs, map: writeMap(flatMap(4)) });
    try {
      const creator = h.join("creator", {}, { look: null }), watcher = h.join("watcher", {}, { spectate: true }), survivor = h.join("survivor"); h.run(1000);
      const c = h.client(survivor)!, ents = h.world.ents;
      expect([h.client(creator)!.pid, h.client(watcher)!.pid]).toEqual([0, 0]);
      ents.setPosition(c.ent, 128, 0, 128);
      const e = h.host.spawnCreature(owned ? "core:parasaur" : "core:raptor", 128, 140, 1), rec = h.host.records.byPid.get(ents.pid[e]!)!;
      if (owned) { rec.team = h.host.records.byPid.get(c.pid)!.team + 1; ents.setTeam(e, rec.team); h.host.refreshBody(rec); h.host.creatures.claimed(e); h.host.creatures.mind.attack(e, c.ent); }
      for (let tick = 0; tick < 300 && h.host.combat.hits === 0; tick++) h.run(1000 / 30);
      expect(h.host.combat.last.victim).toBe(c.pid); h.run(100);
      for (const s of [creator, watcher, survivor]) expect(s.events.filter(e => e.kind === EVENT_HIT)).toEqual([]);
      // The native structure hit path has the same recipient policy; a real thatch wall takes damage.
      ents.setPosition(c.ent, 160, 0, 128); h.host.creatures.mind.stay(e, 0xffffffff);
      ents.setPosition(e, 128, 0, 128); ents.yaw[e] = 0; ents.pitch[e] = 0; ents.act[e] = ACT_SWING; ents.actTicks[e] = 11; ents.pose(e, h.world.tick);
      h.world.structs.add(h.reg.index.get("core:wall_thatch")!, 128, 1.5, 129.5, 0, 0, 10000);
      const before = h.host.combat.structureHits; h.host.combat.bite(e); h.run(100);
      expect(h.host.combat.structureHits).toBeGreaterThan(before);
      for (const s of [creator, watcher, survivor]) expect(s.events.filter(e => e.kind === EVENT_HIT)).toEqual([]);
    } finally { h.host.shutdown(); }
  }
});

test("a mount's former rider receives no attack marker after normal dismount", () => {
  const f = fixture("raptor"), { h } = f;
  try {
    const target = f.target("parasaur", 2.5), e = h.host.records.entOf.get(target.pid)!;
    expect(f.attack().feedback.length).toBe(1);
    h.host.riding.dismount(f.c); h.run(500); expect(f.c.drive).toBe(-1);
    f.rider.events.length = 0;
    h.host.creatures.mind.attack(f.mount, e); const before = h.host.combat.hits;
    for (let tick = 0; tick < 150 && h.host.combat.hits === before; tick++) { h.host.creatures.mind.stay(e, 0xffffffff); h.run(1000 / 30); }
    expect(h.host.combat.hits).toBeGreaterThan(before); expect(h.host.combat.last.by).toBe(f.rec.pid);
    h.run(100); expect(f.rider.events.filter(e => e.kind === EVENT_HIT)).toEqual([]);
  } finally { h.host.shutdown(); }
});

test("a mounted raptor harvests a corpse and shares XP with its rider and tribe", () => {
  const { h, ada, me, at } = camp({ tribe: "Crew" });
  const bob = survivor(h, "bob", { tribe: "Crew", at: { x: at.x + 8, z: at.z } });
  const mount = tame(h, ada, "raptor", { saddled: true });
  ride(h, ada, mount.e);
  const eye = new Float64Array(3);
  h.host.combat.eye(mount.e, eye);
  const prey = creature(h, "dodo", { x: eye[0]!, z: eye[2]! + 1.5 });
  h.host.survival.hurt(prey.rec, 1e6, 0);
  h.run(2000);
  const [body] = h.host.corpses.bodies.values();
  expect(body).toBeDefined();
  const middle = h.host.corpses.middle(body!);
  h.host.combat.eye(mount.e, eye);
  const dx = middle.x - eye[0]!, dz = middle.z - eye[2]!;
  const controls = pilot(h, ada);
  controls.yaw = Math.atan2(dx, dz);
  controls.pitch = Math.atan2(middle.y - eye[1]!, Math.hypot(dx, dz));
  h.run(200);
  const mate = record(h, bob);
  const mountXp = mount.rec.xp, riderXp = me.xp, mateXp = mate.xp;
  press(h, ada, BTN_PRIMARY);
  h.run(600);
  const items = h.host.items.inv(mount.rec);
  expect(items.total(id("hide")) + items.total(id("meat"))).toBeGreaterThan(0);
  expect([mount.rec.xp - mountXp, ada.progress.xp - riderXp, bob.progress.xp - mateXp]).toEqual([1, 0.5, 0.5]);
});
