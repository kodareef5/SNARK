// Native ground movement: actors stop their own capsule, never push another body. No artist rigs are needed.
import { expect, test } from "bun:test";
import { NO_CLIPS } from "../../shared/anim/clip.ts";
import { CUE_DEAD } from "../../shared/anim/pose.ts";
import { RESULT_OK } from "../../shared/net/protocol.ts";
import { Body } from "../../shared/sim/character.ts";
import { F_ALIVE, F_GROUNDED } from "../../shared/sim/entities.ts";
import { V_HEALTH } from "../../shared/sim/vitals.ts";
import { capsuleFree } from "../../shared/world/collide.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { Harness } from "../fixtures/net.ts";
import { flatMap } from "../fixtures/map.ts";

function yard(direction = 1, latencyMs = 0) {
  const h = new Harness({}, 1, 60, { dev: true, clips: NO_CLIPS, rigs: [], map: writeMap(flatMap(4)) });
  const s = h.join("rider", { latencyMs }); h.run(800);
  const c = h.client(s)!, a = h.world.ents, owner = h.host.records.byPid.get(c.pid)!;
  const creature = (name: string, x: number, z: number, team = owner.team): number => {
    const e = h.host.spawnCreature(`core:${name}`, x, z, 1), rec = h.host.records.byPid.get(a.pid[e]!)!;
    rec.team = team; rec.saddle = h.reg.index.get(`core:saddle_${name}`) ?? 0;
    a.yaw[e] = direction === 1 ? 0 : 32768;
    h.host.refreshBody(rec); h.host.creatures.claimed(e); h.host.creatures.mind.stay(e, 0xffffffff);
    return e;
  };
  const mount = creature("raptor", 100, 100), target = creature("parasaur", 100, 100 + direction * 8, owner.team + 10);
  h.host.setSetting("serverPVE", "True");
  a.setPosition(c.ent, 98, 0, 100); h.world.history.discontinuity(c.ent);
  h.pilots[0]!.yaw = direction === 1 ? 0 : Math.PI;
  expect(h.host.riding.mount(c, mount)).toBe(RESULT_OK); h.run(450);
  expect(c.drive).toBe(mount);
  const ticks = (count: number, move: number, entity = mount): void => {
    for (let i = 0; i < count; i++) {
      c.inputs.set(h.world.tick + 1, 0, move, direction === 1 ? 0 : 32768, 0, 0); h.server.tick();
      const p = h.reg.move[a.kind[entity]!]!;
      expect(capsuleFree(h.world, a.x[entity]!, a.y[entity]!, a.z[entity]!, p.radius, p.height)).toBe(true);
    }
  };
  return { h, s, c, a, mount, target, creature, ticks };
}
function distance(h: Harness, first: number, second: number): number {
  const a = h.world.ents, p = h.reg.move[a.kind[first]!]!, q = h.reg.move[a.kind[second]!]!;
  const lowA = a.y[first]! + p.radius, highA = a.y[first]! + Math.max(p.radius, p.height - p.radius);
  const lowB = a.y[second]! + q.radius, highB = a.y[second]! + Math.max(q.radius, q.height - q.radius);
  const y = Math.max(0, lowA - highB, lowB - highA);
  return Math.hypot(a.x[first]! - a.x[second]!, y, a.z[first]! - a.z[second]!);
}
function position(h: Harness, e: number): number[] { const a = h.world.ents; return [a.x[e]!, a.y[e]!, a.z[e]!, a.vx[e]!, a.vy[e]!, a.vz[e]!]; }

test("a mounted raptor stops before a foreign protected tame in either direction, then reverses freely", () => {
  for (const direction of [1, -1]) {
    const { h, a, c, mount, target, ticks } = yard(direction);
    try {
      const fixed = position(h, target), vitals = h.host.records.byPid.get(a.pid[target]!)!.vitals!, hp = vitals.at(V_HEALTH, h.world.tick);
      const radius = h.reg.move[a.kind[mount]!]!.radius + h.reg.move[a.kind[target]!]!.radius;
      for (let i = 0; i < 150; i++) { ticks(1, 127); expect(distance(h, mount, target)).toBeGreaterThanOrEqual(radius - .004); }
      const stopped = a.z[mount]!;
      expect(direction * (stopped - 100)).toBeGreaterThan(5);
      expect(direction * (a.z[target]! - stopped)).toBeGreaterThan(1.5);
      expect(position(h, target)).toEqual(fixed); expect(vitals.at(V_HEALTH, h.world.tick)).toBe(hp);
      expect(a.seat[c.ent]).toBe(mount + 1);
      ticks(80, -127); expect(direction * (stopped - a.z[mount]!)).toBeGreaterThan(3);
    } finally { h.host.shutdown(); }
  }
});

test("a doorway body remains solid without pushing it through the jamb, and a survivor can back out", () => {
  const { h, a, c, mount, target, ticks } = yard();
  try {
    const wall = h.reg.index.get("core:wall_stone")!;
    h.world.structs.add(wall, 97.3, 1.5, 108, 0, 99, 10000);
    h.world.structs.add(wall, 102.7, 1.5, 108, 0, 99, 10000);
    const fixed = position(h, target);
    ticks(150, 127); expect(a.z[mount]!).toBeLessThan(106.5); expect(position(h, target)).toEqual(fixed);
    h.host.riding.dismount(c); h.run(300);
    a.vx[c.ent] = a.vy[c.ent] = a.vz[c.ent] = 0;
    a.setPosition(c.ent, 100, 0, 104); h.world.history.discontinuity(c.ent);
    // Clear the driver's mount, keeping the protected doorway creature stationary.
    a.setPosition(mount, 95, 0, 100); h.world.history.discontinuity(mount);
    ticks(100, 127, c.ent); const stopped = a.z[c.ent]!;
    expect(stopped).toBeGreaterThan(106); expect(stopped).toBeLessThan(107);
    expect(position(h, target)).toEqual(fixed);
    ticks(45, -127, c.ent); expect(stopped - a.z[c.ent]!).toBeGreaterThan(2);
  } finally { h.host.shutdown(); }
});

test("a tamed AI following a survivor cannot walk through another grounded creature", () => {
  const { h, a, c, mount, target } = yard();
  try {
    h.host.riding.dismount(c); h.run(300);
    a.setPosition(c.ent, 100, 0, 118); h.world.history.discontinuity(c.ent);
    a.yaw[mount] = 0; h.host.creatures.mind.follow(mount, c.ent);
    const fixed = position(h, target), radius = h.reg.move[a.kind[mount]!]!.radius + h.reg.move[a.kind[target]!]!.radius;
    let travelled = 0;
    for (let i = 0; i < 180; i++) {
      h.server.tick(); travelled = Math.max(travelled, a.z[mount]! - 100);
      expect(distance(h, mount, target)).toBeGreaterThanOrEqual(radius - .004);
    }
    expect(travelled).toBeGreaterThan(4); expect(position(h, target)).toEqual(fixed);
  } finally { h.host.shutdown(); }
});

test("a survivor stepping between two creatures at a doorway cannot squeeze through them and can back out", () => {
  const { h, a, mount, target, ticks } = yard();
  try {
    const walker = h.join("walker"); h.run(500); const peer = h.client(walker)!;
    const wall = h.reg.index.get("core:wall_stone")!;
    h.world.structs.add(wall, 97.3, 1.5, 108, 0, 99, 10000);
    h.world.structs.add(wall, 102.7, 1.5, 108, 0, 99, 10000);
    ticks(150, 127);
    a.setPosition(peer.ent, 96, 0, 107.2); h.world.history.discontinuity(peer.ent);
    const first = position(h, mount), second = position(h, target), r = h.reg.move[a.kind[peer.ent]!]!.radius;
    for (let i = 0; i < 90; i++) {
      peer.inputs.set(h.world.tick + 1, -127, 0, 0, 0, 0); h.server.tick();
      for (const e of [mount, target]) expect(distance(h, peer.ent, e)).toBeGreaterThanOrEqual(r + h.reg.move[a.kind[e]!]!.radius - .005);
    }
    const stopped = a.x[peer.ent]!;
    expect(stopped).toBeGreaterThan(98); expect(stopped).toBeLessThan(99.5);
    expect(position(h, mount)).toEqual(first); expect(position(h, target)).toEqual(second);
    for (let i = 0; i < 45; i++) { peer.inputs.set(h.world.tick + 1, 127, 0, 0, 0, 0); h.server.tick(); }
    expect(stopped - a.x[peer.ent]!).toBeGreaterThan(3);
  } finally { h.host.shutdown(); }
});

test("a wild raptor hunting past a stationary ridden mount meets the mount in either direction", () => {
  for (const direction of [1, -1]) {
    const { h, a, c, mount, target, creature } = yard(direction);
    try {
      const prey = h.join("prey"); h.run(500); const victim = h.client(prey)!;
      a.setPosition(victim.ent, 100, 0, 100 - direction * 10); h.world.history.discontinuity(victim.ent);
      a.setPosition(target, 125, 0, 125); h.world.history.discontinuity(target);
      const wild = creature("raptor", 100, 100 + direction * 8, 0);
      a.yaw[wild] = direction === 1 ? 32768 : 0;
      h.host.survival.gods.add(c.pid); h.host.survival.gods.add(victim.pid);
      h.host.creatures.mind.provoke(wild, 100, 100 - direction * 10, victim.ent);
      const fixed = position(h, mount), radius = h.reg.move[a.kind[wild]!]!.radius + h.reg.move[a.kind[mount]!]!.radius;
      let closest = Infinity, moved = 0;
      for (let i = 0; i < 120; i++) {
        h.server.tick(); const gap = distance(h, wild, mount); closest = Math.min(closest, gap);
        moved = Math.max(moved, direction * (100 + direction * 8 - a.z[wild]!));
        expect(gap).toBeGreaterThanOrEqual(radius - .004);
      }
      expect(moved).toBeGreaterThan(4); expect(closest).toBeLessThan(radius + .03);
      expect(position(h, mount)).toEqual(fixed); expect(a.seat[c.ent]).toBe(mount + 1);
    } finally { h.host.shutdown(); }
  }
});

test("dead, carried and recycled bodies cannot leave a stale blocker or attach to a reused parent", () => {
  const { h, a, mount, target } = yard();
  try {
    a.setPosition(target, 100, 0, 102);
    const b = new Body(), p = h.reg.move[a.kind[mount]!]!; a.loadBody(mount, b);
    const contacts = h.server.bodyContacts;
    expect(contacts.prepare(mount, b, p)?.count).toBe(1); // The mounted survivor is excluded.
    a.cue[target] = CUE_DEAD; expect(contacts.prepare(mount, b, p)).toBeUndefined(); a.cue[target] = 0;
    a.seat[target] = mount + 1; a.seatGen[target] = a.gen[mount]!;
    expect(contacts.prepare(mount, b, p)).toBeUndefined();
    a.seatGen[target] = (a.gen[mount]! + 1) & 0xffff;
    expect(contacts.prepare(mount, b, p)?.count).toBe(1);
    const old = a.gen[target]; h.host.creatures.remove(target);
    expect(contacts.prepare(mount, b, p)).toBeUndefined();
    let replacement = -1;
    // Entity slots are FIFO recycled, after the currently unused tail.
    for (let i = 0; i <= a.cap && replacement !== target; i++) replacement = a.create(h.reg.index.get("core:parasaur")!, 120, 0, 120, F_ALIVE | F_GROUNDED);
    expect(replacement).toBe(target); expect(a.gen[replacement]).not.toBe(old);
    expect(contacts.prepare(mount, b, p)).toBeUndefined();
  } finally { h.host.shutdown(); }
});

test("ridden movement also stops before wild bodies and other survivors in both directions", () => {
  for (const direction of [1, -1]) for (const survivor of [false, true]) {
    const { h, a, mount, target, ticks } = yard(direction);
    try {
      let blocker = target;
      if (survivor) {
        const peer = h.join("walker"); h.run(500); blocker = h.client(peer)!.ent;
        a.setPosition(target, 125, 0, 125); h.world.history.discontinuity(target);
        a.setPosition(blocker, 100, 0, 100 + direction * 8); h.world.history.discontinuity(blocker);
      } else {
        const rec = h.host.records.byPid.get(a.pid[target]!)!; rec.team = 0;
        h.host.refreshBody(rec); h.host.creatures.claimed(target);
      }
      const fixed = position(h, blocker), radius = h.reg.move[a.kind[mount]!]!.radius + h.reg.move[a.kind[blocker]!]!.radius;
      for (let i = 0; i < 150; i++) { ticks(1, 127); expect(distance(h, mount, blocker)).toBeGreaterThanOrEqual(radius - .004); }
      expect(direction * (a.z[mount]! - 100)).toBeGreaterThan(5);
      expect(position(h, blocker)).toEqual(fixed);
      const stopped = a.z[mount]!; ticks(60, -127); expect(direction * (stopped - a.z[mount]!)).toBeGreaterThan(2);
    } finally { h.host.shutdown(); }
  }
});

test("wild contacts use live poses across an indexed cell edge and do not add wild crowd blocking", () => {
  const { h, a, mount, target, creature } = yard();
  try {
    a.setPosition(mount, 104.1, 0, 100);
    h.host.creatures.mind.contactBodies(); // Captured in the cell starting at x=104.
    a.setPosition(mount, 103.8, 0, 100); // A preceding native controller may cross that edge this tick.
    a.setPosition(target, 125, 0, 125);
    const wild = creature("raptor", 102, 100, 0), otherWild = creature("raptor", 102, 101, 0);
    const b = new Body(), p = h.reg.move[a.kind[wild]!]!; a.loadBody(wild, b);
    const candidates = h.server.bodyContacts.prepare(wild, b, p);
    expect(candidates?.count).toBe(1); // The indexed live mount; neither its rider nor the second wild creature.
    candidates!.clip(b.x, b.y, b.z, 106, b.y, b.z, p.radius, p.height, 5, 0);
    expect(candidates!.result.hit).toBe(true); expect(candidates!.result.x).toBeLessThan(103);
    expect(a.x[otherWild]).toBe(102);
  } finally { h.host.shutdown(); }
});

test("150 ms RTT predicts a parked creature stop and reverse without a large driver correction", () => {
  const { h, s, a, mount, target } = yard(1, 75);
  try {
    h.run(1200); expect(s.driving).toBe(mount);
    let raw = 0, shown = 0, samples = 0;
    const observed = s as unknown as { reconcile(tick: number, body: Body): void }, reconcile = observed.reconcile.bind(s);
    observed.reconcile = (tick, body) => {
      const x = s.own.x, y = s.own.y, z = s.own.z, sx = x + s.smoothX, sy = y + s.smoothY, sz = z + s.smoothZ, sim = s.simTick;
      reconcile(tick, body); if (tick >= sim) return;
      raw = Math.max(raw, Math.hypot(s.own.x - x, s.own.y - y, s.own.z - z));
      shown = Math.max(shown, Math.hypot(s.own.x + s.smoothX - sx, s.own.y + s.smoothY - sy, s.own.z + s.smoothZ - sz)); samples++;
    };
    const fixed = position(h, target), radius = h.reg.move[a.kind[mount]!]!.radius + h.reg.move[a.kind[target]!]!.radius;
    h.pilots[0]!.moveZ = 1;
    for (let i = 0; i < 100; i++) { h.run(50); expect(distance(h, mount, target)).toBeGreaterThanOrEqual(radius - .004); }
    const stopped = a.z[mount]!; expect(stopped).toBeGreaterThan(105); expect(stopped).toBeLessThan(107);
    h.pilots[0]!.moveZ = -1; h.run(2500);
    expect(stopped - a.z[mount]!).toBeGreaterThan(3); expect(position(h, target)).toEqual(fixed);
    expect(samples).toBeGreaterThan(50); expect(raw).toBeLessThan(.05); expect(shown).toBeLessThan(.00001);
    expect(s.stats.undecodable).toBe(0);
  } finally { h.host.shutdown(); }
});
