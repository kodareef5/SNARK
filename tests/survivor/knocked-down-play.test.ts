// A survivor knocked down by a car door (Knockdowns) lies as the server's ragdoll. Its own client follows the server
// while it lies, with nothing to correct, and a client watching lays and steps the same ragdoll tick for tick.
import { expect, test } from "bun:test";
import { Corpses } from "../../client/core/ragdoll.ts";
import { RemoteSample } from "../../client/core/session.ts";
import { NO_CLIPS } from "../../shared/anim/clip.ts";
import { CUE_DOWN } from "../../shared/anim/pose.ts";
import { survivorKind } from "../../shared/sim/blockers.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { Harness } from "../fixtures/net.ts";
import { flatMap } from "../fixtures/map.ts";

/** A walker on a delayed link where a passing car's open door strikes it, and a watcher standing by. */
function road() {
  const h = new Harness({}, 5, 60, { dev: true, clips: NO_CLIPS, rigs: [], wild: false, map: writeMap(flatMap(4)) });
  h.host.setSetting("Knockdowns", "true");
  const s = h.join("walker", { latencyMs: 75 }), w = h.join("watcher");
  h.run(600);
  const a = h.world.ents, c = h.client(s)!, seen = h.client(w)!;
  const car = h.host.spawnVehicle("core:compact", 100, 60, 0);
  const driver = h.host.spawnCreature("core:civilian", 101.5, 60, 1);
  expect(h.host.urban.seatNpc(driver, car, "driver")).toBe(0);
  h.run(1500);
  a.setPosition(c.ent, 100 + 1.25 + 0.4, 0, 80);
  h.world.history.discontinuity(c.ent);
  a.setPosition(seen.ent, 96, 0, 84);
  h.world.history.discontinuity(seen.ent);
  h.run(1000);
  h.host.urban.toggleDoor(a.pid[driver]!);
  h.run(500);
  return { h, s, w, a, c, car };
}

function drive(h: Harness, a: Harness["world"]["ents"], car: number, ms: number, each?: () => void): void {
  h.run(ms, () => {
    if (a.z[car]! < 90) { a.vz[car] = 9; a.vx[car] = 0; }
    each?.();
  });
}

test("a knocked-down survivor's own client follows its fall with no corrections", () => {
  const { h, s, a, car } = road();
  try {
    const before = s.stats.corrections;
    let unpredicted = 0;
    drive(h, a, car, 6000, () => { if (!s.predicting) unpredicted++; });
    expect(h.host.falls.stats).toMatchObject({ fell: 1, rose: 1 });
    expect(unpredicted).toBeGreaterThan(30);
    expect([s.predicting, s.stats.corrections - before]).toEqual([true, 0]);
  } finally { h.host.shutdown(); }
});

test("a watching client lays and steps the fall as the server does, tick for tick", () => {
  const { h, w, a, c, car } = road();
  try {
    const remote = new RemoteSample(), drawn = new Corpses(h.world.anims, undefined, (k) => survivorKind(h.reg, k));
    const poses = new Map<number, { rot: Float32Array; pos: Float32Array; x: number; y: number; z: number }>();
    let compared = 0, rising = 0;
    drive(h, a, car, 6000, () => {
      const pose = h.host.falls.poseOf(c.ent);
      if (pose) poses.set(h.world.tick, { rot: pose.rot.slice(), pos: pose.pos.slice(), x: a.x[c.ent]!, y: a.y[c.ent]!, z: a.z[c.ent]! });
      w.sampleRemote(remote);
      drawn.update(remote, w.world!, 0, 0, new Map(), w.corpseMotions);
      const f = drawn.humans.of(c.ent);
      if (!f) return;
      if (!f.down) { rising++; return; }
      const server = poses.get(f.clock);
      if (!server) return;
      expect([f.x, f.y, f.z]).toEqual([server.x, server.y, server.z]);
      expect(f.solved.rot).toEqual(server.rot);
      expect(f.solved.pos).toEqual(server.pos);
      compared++;
    });
    expect(h.host.falls.stats.rose).toBe(1);
    expect(compared).toBeGreaterThan(30);
    expect(rising).toBeGreaterThan(10);
    expect(drawn.humans.of(c.ent)).toBeUndefined();
  } finally { h.host.shutdown(); }
});

test("a watching client lays a dead survivor's body where the server's lies", () => {
  const { h, s, w, a, c } = road();
  try {
    const remote = new RemoteSample(), drawn = new Corpses(h.world.anims, undefined, (k) => survivorKind(h.reg, k));
    const [x, z] = [a.x[c.ent]!, a.z[c.ent]!];
    h.say(s, "suicide");
    h.run(3000, () => {
      w.sampleRemote(remote);
      drawn.update(remote, w.world!, 0, 0, new Map(), w.corpseMotions);
    });
    let body = -1;
    for (let j = 0; j < a.flags.length; j++) if (h.host.corpses.at(j) && survivorKind(h.reg, a.kind[j]!)) body = j;
    const f = drawn.humans.of(body)!;
    expect(f.down).toBe(true);
    // It lies where the server's lies, near where it died.
    expect([f.x, f.y, f.z]).toEqual([a.x[body]!, a.y[body]!, a.z[body]!]);
    expect(Math.hypot(f.x - x, f.z - z)).toBeLessThan(1.5);
  } finally { h.host.shutdown(); }
});

test("a watcher draws every survivor it sees knocked down as down, by its fall or by a topple until the fall comes", () => {
  const h = new Harness({}, 5, 60, { dev: true, clips: NO_CLIPS, rigs: [], wild: false, map: writeMap(flatMap(4)) });
  try {
    h.host.setSetting("Knockdowns", "true");
    const w = h.join("watcher"), fallers = Array.from({ length: 8 }, (_, k) => h.join(`faller${k}`));
    h.run(800);
    const a = h.world.ents, seen = h.client(w)!;
    a.setPosition(seen.ent, 100, 0, 70);
    h.world.history.discontinuity(seen.ent);
    const ids = fallers.map((s, k) => {
      const c = h.client(s)!;
      a.setPosition(c.ent, 96 + (k % 4) * 2, 0, 76 + Math.floor(k / 4) * 2);
      h.world.history.discontinuity(c.ent);
      return c.ent;
    });
    h.run(800);
    for (const e of ids) expect(h.host.falls.knock(e, 0, 1, 3, 2, 0, 0)).toBe(true);
    const remote = new RemoteSample(), drawn = new Corpses(h.world.anims, undefined, (k) => survivorKind(h.reg, k));
    let standing = 0;
    h.run(1500, () => {
      w.sampleRemote(remote);
      drawn.update(remote, w.world!, 0, 0, new Map(), w.corpseMotions);
      for (let i = 0; i < remote.count; i++) {
        if (!ids.includes(remote.id[i]!) || (remote.cue[i]! & CUE_DOWN) === 0) continue;
        if (drawn.humans.of(remote.id[i]!)) continue;
        if (drawn.humans.waiting(remote.id[i]!, remote.tick) === 0) standing++;
      }
    });
    expect(standing).toBe(0);
    expect(h.host.falls.stats.fell).toBe(8);
  } finally { h.host.shutdown(); }
});
