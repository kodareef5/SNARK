// Controlled movement meets only a visible, independently standing adult. Followers/AI keep ordinary movement.
import { expect, test } from "bun:test";
import { frozenPack } from "../fixtures/pack.ts";
import { Rng } from "../../shared/rng.ts";
import { capsuleFree } from "../../shared/world/collide.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { Harness } from "../fixtures/net.ts";
import { flatMap } from "../fixtures/map.ts";

function yard(rtt = 0, pve = false) {
  const pack = frozenPack();
  const h = new Harness({}, 7, 60, { dev: true, clips: pack.clips, rigs: pack.header.rigs, wild: false, map: writeMap(flatMap(4)) });
  h.host.setSetting("serverPVE", String(pve));
  const s = h.join("rider", { latencyMs: rtt / 2, jitterMs: rtt ? 5 : 0 }); h.run(1600);
  const c = h.client(s)!, a = h.world.ents, owner = h.host.records.byPid.get(c.pid)!;
  const place = (e: number, x: number, z: number): void => { a.vx[e] = a.vy[e] = a.vz[e] = 0; a.setPosition(e, x, 0, z); h.world.history.discontinuity(e); };
  const creature = (name: string, x: number, z: number, team = 0): number => {
    const e = h.host.spawnCreature(`core:${name}`, x, z, 1), rec = h.host.records.byPid.get(a.pid[e]!)!;
    rec.team = team; rec.saddle = h.reg.index.get(`core:saddle_${name}`) ?? 0; a.yaw[e] = 0;
    h.host.refreshBody(rec); h.host.creatures.claimed(e); h.host.creatures.mind.stay(e, 0xffffffff); return e;
  };
  place(c.ent, 100, 100); h.run(300);
  const tick = (move: number, yaw = 0): void => { c.inputs.set(h.world.tick + 1, 0, move, yaw, 0, 0); h.server.tick(); };
  return { h, s, c, a, owner, place, creature, tick };
}
function position(h: Harness, e: number): number[] { const a = h.world.ents; return [a.x[e]!, a.y[e]!, a.z[e]!, a.vx[e]!, a.vy[e]!, a.vz[e]!]; }
function barrier(h: Harness, z = 110): void {
  const wall = h.reg.index.get("core:wall_stone")!, door = h.reg.index.get("core:doorframe_stone")!;
  h.world.structs.add(door, 100, 1.5, z, 0, 99, 10000);
  for (let k = 1; k <= 6; k++) for (const sign of [-1, 1]) h.world.structs.add(wall, 100 + sign * 3 * k, 1.5, z, 0, 99, 10000);
}

test("a wild dodo in a doorway and a ring of hostile bodies the walker starts inside allow escape without crossing walls", () => {
  for (const door of [true, false]) {
    const { h, c, a, creature, tick } = yard();
    try {
      const blockers: number[] = [];
      if (door) { barrier(h, 103); blockers.push(creature("dodo", 100, 103)); }
      else for (let i = 0; i < 4; i++) blockers.push(creature("raptor", 100 + Math.sin(i * Math.PI / 2) * 1.2, 100 + Math.cos(i * Math.PI / 2) * 1.2));
      h.run(350); const fixed = blockers.map(e => position(h, e)), p = h.reg.move[a.kind[c.ent]!]!;
      for (let i = 0; i < 100; i++) { tick(127); expect(capsuleFree(h.world, a.x[c.ent]!, a.y[c.ent]!, a.z[c.ent]!, p.radius, p.height)).toBe(true); }
      // Out past the door, and the bodies it pressed through gave way a little, as the walker gave way to them.
      expect(a.z[c.ent]!).toBeGreaterThan(110);
      blockers.forEach((e, i) => expect(Math.hypot(a.x[e]! - fixed[i]![0]!, a.z[e]! - fixed[i]![2]!)).toBeLessThan(1.5));
    } finally { h.host.shutdown(); }
  }
});

test("eight following raptors get through a normal door", () => {
  for (const clustered of [false, true]) {
    const { h, c, a, owner, creature, tick } = yard();
    try {
      barrier(h); const rng = new Rng(109), followers: number[] = [];
      for (let i = 0; i < 8; i++) {
        const e = creature("raptor", clustered ? 97 + rng.float() * 6 : 100 + (rng.float() - .5) * .6, clustered ? 91 + rng.float() * 6 : 97 - i * 2, owner.team);
        h.host.creatures.mind.follow(e, c.ent); followers.push(e);
      }
      for (let i = 0; i < 600; i++) tick(a.z[c.ent]! < 125 ? 127 : 0);
      expect(followers.every(e => a.z[e]! > 111)).toBe(true);
    } finally { h.host.shutdown(); }
  }
});

test("an owner walks out of a dead end past their following and then staying tames", () => {
  for (const stay of [false, true]) {
    const { h, c, a, owner, creature, place, tick } = yard();
    try {
      place(c.ent, 100, 96); const wall = h.reg.index.get("core:wall_stone")!;
      for (const z of [101.5, 104.5, 107.5, 110.5]) for (const x of [98.9, 101.1]) h.world.structs.add(wall, x, 1.5, z, 16384, 99, 10000);
      h.world.structs.add(wall, 100, 1.5, 112.1, 0, 99, 10000);
      const followers = [creature("raptor", 100, 93, owner.team), creature("raptor", 100.2, 90, owner.team)];
      for (const e of followers) h.host.creatures.mind.follow(e, c.ent);
      for (let i = 0; i < 450; i++) tick(a.z[c.ent]! < 111 ? 127 : 0);
      if (stay) for (const e of followers) h.host.creatures.mind.follow(e, -1);
      for (let i = 0; i < 100; i++) tick(127, 32768);
      expect(a.z[c.ent]!).toBeLessThan(100);
    } finally { h.host.shutdown(); }
  }
});

/** The least distance from the walker's middle to the stadium of body `j`, less both radii: below 0 it is inside. */
function gap(h: Harness, walker: number, j: number): number {
  const a = h.world.ents, reg = h.reg, k = a.kind[j]!;
  // As the snapshot rounds it, as the walker meets it.
  const yaw = ((a.yaw[j]! >>> 6) / 1024) * Math.PI * 2, fx = Math.sin(yaw), fz = Math.cos(yaw);
  const r = reg.footRadius[k]!;
  let s0 = reg.footBack[k]! + r, s1 = reg.footFront[k]! - r;
  if (s0 > s1) s0 = s1 = (s0 + s1) / 2;
  const ax = a.x[j]! + fx * s0, az = a.z[j]! + fz * s0, sx = fx * (s1 - s0), sz = fz * (s1 - s0);
  const ss = sx * sx + sz * sz, x = a.x[walker]!, z = a.z[walker]!;
  const t = ss > 0 ? Math.min(1, Math.max(0, ((x - ax) * sx + (z - az) * sz) / ss)) : 0;
  return Math.hypot(x - (ax + sx * t), z - (az + sz * t)) - r - reg.footRadius[a.kind[walker]!]!;
}

test("a survivor walking into a standing rex, raptor or trike stops at its body, from the side or the head, predicted with no correction", () => {
  for (const [name, yaw] of [["rex", 0], ["rex", 16384], ["raptor", 16384], ["trike", 8192]] as const) {
    const { h, s, c, a, creature, place } = yard(150);
    try {
      const e = creature(name, 100, 106);
      a.yaw[e] = yaw;
      a.pose(e);
      place(c.ent, 100, 96);
      h.run(600);
      const before = s.stats.corrections;
      const p = h.pilots[0]!;
      p.moveZ = 127;
      let least = Infinity;
      const facing = a.yaw[e]!;
      let turned = false;
      h.run(6000, () => {
        least = Math.min(least, gap(h, c.ent, e));
        if (a.yaw[e] !== facing) turned = true;
      });
      p.moveZ = 0;
      h.run(400);
      // Never more than a skin inside it: it stops at its body, or slides round it as along a wall, never through it. The
      // walker meets it as its client's snapshot showed it, so a body turning meanwhile is a few centimetres from there.
      expect(least).toBeGreaterThan(turned ? -0.25 : -0.02);
      if (a.z[c.ent]! > a.z[e]!) expect(Math.abs(a.x[c.ent]! - a.x[e]!)).toBeGreaterThan(h.reg.footRadius[a.kind[e]!]!);
      expect(s.stats.corrections - before).toBe(0);
    } finally { h.host.shutdown(); }
  }
});

test("survivors block survivors, but tribemates pass through each other, and a dodo blocks nobody", () => {
  for (const mates of [false, true]) {
    const { h, c, a, owner, place } = yard();
    try {
      const b = h.join("bo");
      h.run(1600);
      const cb = h.client(b)!;
      place(cb.ent, 100, 103);
      if (mates) h.host.records.byPid.get(cb.pid)!.team = owner.team || 77, owner.team = owner.team || 77, h.host.refreshBody(owner), h.host.refreshBody(h.host.records.byPid.get(cb.pid)!);
      h.run(500);
      const p = h.pilots[0]!;
      p.moveZ = 127;
      h.run(3000);
      p.moveZ = 0;
      h.run(300);
      if (mates) expect(a.z[c.ent]!).toBeGreaterThan(106);
      else {
        expect(a.z[c.ent]!).toBeLessThan(103);
        expect(gap(h, c.ent, cb.ent)).toBeGreaterThan(-0.02);
      }
    } finally { h.host.shutdown(); }
  }
  const { h, c, a, creature, place } = yard();
  try {
    creature("dodo", 100, 103);
    place(c.ent, 100, 96);
    h.run(300);
    h.pilots[0]!.moveZ = 127;
    h.run(3000);
    expect(a.z[c.ent]!).toBeGreaterThan(106);
  } finally { h.host.shutdown(); }
});
