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

test("a wild dodo in a doorway and a ring of hostile bodies allow deterministic escape without crossing walls", () => {
  for (const door of [true, false]) {
    const { h, c, a, creature, tick } = yard();
    try {
      const blockers: number[] = [];
      if (door) { barrier(h, 103); blockers.push(creature("dodo", 100, 103)); }
      else for (let i = 0; i < 4; i++) blockers.push(creature("raptor", 100 + Math.sin(i * Math.PI / 2) * 1.2, 100 + Math.cos(i * Math.PI / 2) * 1.2));
      h.run(350); const fixed = blockers.map(e => position(h, e)), p = h.reg.move[a.kind[c.ent]!]!;
      for (let i = 0; i < 100; i++) { tick(127); expect(capsuleFree(h.world, a.x[c.ent]!, a.y[c.ent]!, a.z[c.ent]!, p.radius, p.height)).toBe(true); }
      expect(a.z[c.ent]!).toBeGreaterThan(110); expect(blockers.map(e => position(h, e))).toEqual(fixed);
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
