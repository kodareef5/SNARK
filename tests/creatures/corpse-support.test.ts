import { expect } from "bun:test";
import { Corpses as Drawn } from "../../client/core/ragdoll.ts";
import { RemoteSample } from "../../client/core/session.ts";
import { Fall } from "../../shared/anim/corpse.ts";
import { makeHandle } from "../../shared/ids.ts";
import { F_GROUNDED } from "../../shared/sim/entities.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { flatMap } from "../fixtures/map.ts";
import { Harness } from "../fixtures/net.ts";
import { corePack } from "../fixtures/pack.ts";
import { test } from "../fixtures/needs-art.ts";

function notch() {
  const map = flatMap(2), side = Math.sqrt(map.heights.length), pack = corePack();
  for (let z = 10; z <= 54; z++) map.heights[z * side + 32] = Math.round((-15 - map.minY) / map.stepY);
  return new Harness({}, 1, 60, { dev: true, map: writeMap(map), clips: pack.clips, rigs: pack.header.rigs });
}

function kill(h: Harness, species: string, z: number, impact: boolean) {
  const a = h.world.ents, e = h.host.spawnCreature(`core:${species}`, 8, 8, 1);
  a.setPosition(e, 64.2, 5, z); a.flags[e] = a.flags[e]! & ~F_GROUNDED;
  const rec = h.host.records.byPid.get(a.pid[e]!)!;
  h.host.items.mint(rec, h.reg.index.get("core:fiber")!, 7);
  h.host.survival.hurt(rec, 1e6, 0, undefined, impact ? {
    victimPid: rec.pid, victimHandle: makeHandle(e, a.gen[e]!), vx: .2, vy: -2, vz: 0, wx: 0, wy: 1, wz: 0,
  } : undefined);
  return [...h.host.corpses.bodies.values()].at(-1)!;
}

test("opposed steep terrain faces put ordinary and impact corpses to sleep without a continuing save loop", () => {
  const h = notch();
  try {
    const bodies = [kill(h, "raptor", 38, false), kill(h, "raptor", 52, true), kill(h, "parasaur", 68, false), kill(h, "parasaur", 90, true)];
    for (let tick = 0; tick < 900; tick++) h.server.tick();
    const states = bodies.map(b => b.fall!.ragdoll.checkpoint());
    for (const b of bodies) {
      expect(b.drop).toBeNull(); expect(b.moving).toBe(false); expect(b.fall!.still).toBe(true);
      expect(b.fall!.ragdoll.deepest(h.world)).toBeLessThan(.03);
      expect(h.host.items.inv(b.rec).total(h.reg.index.get("core:fiber")!)).toBe(7);
    }
    const revisions = bodies.map(b => b.motionRevision), checkpoints = bodies.map(b => b.motion);
    const dirty = h.host.records.dirty, original = dirty.add.bind(dirty); let marks = 0;
    dirty.add = pid => { if (bodies.some(b => b.rec.pid === pid)) marks++; return original(pid); };
    try { for (let tick = 0; tick < 300; tick++) h.server.tick(); } finally { dirty.add = original; }
    expect(marks).toBe(0);
    bodies.forEach((b, i) => { expect(b.fall!.ragdoll.checkpoint()).toEqual(states[i]); expect(b.motion).toBe(checkpoints[i]); });
    expect(bodies.map(b => b.motionRevision)).toEqual(revisions);
    expect(bodies[0]!.motion).toBeNull(); expect(bodies[2]!.motion).toBeNull(); // Ordinary deaths retain their sparse stationary path.
  } finally { h.host.shutdown(); }
});

test("first-seen ordinary corpses share bounded settling work and converge to the server's supported pose", () => {
  const h = notch();
  try {
    const bodies = Array.from({ length: 16 }, (_, i) => kill(h, "raptor", 34 + i * 4, false));
    for (let tick = 0; tick < 900; tick++) h.server.tick();
    const a = h.world.ents, remote = new RemoteSample(), drawn = new Drawn(h.world.anims);
    remote.count = bodies.length; remote.tick = h.world.tick;
    bodies.forEach((b, i) => {
      remote.id[i] = b.e; remote.gen[i] = a.gen[b.e]!; remote.kind[i] = b.kind;
      remote.x[i] = b.x; remote.y[i] = b.y; remote.z[i] = b.z; remote.yaw[i] = b.yaw;
      remote.anim[i] = a.anim[b.e]!; remote.cue[i] = a.cue[b.e]!; remote.span[i] = a.span[b.e]!;
    });
    const original = Fall.prototype.tick; let steps = 0;
    Fall.prototype.tick = function (world) { if (this.ragdoll.awake) steps++; return original.call(this, world); };
    try {
      for (let frame = 0; frame < 240; frame++) {
        steps = 0; remote.tick += .5;
        drawn.update(remote, h.world, 64, 34, new Map());
        expect(steps).toBeLessThanOrEqual(60);
        if (frame === 1) expect(drawn.list.every(c => c.settledTicks > 0)).toBe(true);
      }
    } finally { Fall.prototype.tick = original; }
    for (const b of bodies) {
      const c = drawn.list.find(c => c.id === b.e)!;
      expect(c.settling).toBe(false); expect(c.fall!.still).toBe(true);
      expect(c.fall!.ragdoll.x).toEqual(b.fall!.ragdoll.x);
      expect(c.fall!.ragdoll.q).toEqual(b.fall!.ragdoll.q);
      expect(c.settledTicks).toBeLessThanOrEqual(300);
    }
  } finally { h.host.shutdown(); }
});
