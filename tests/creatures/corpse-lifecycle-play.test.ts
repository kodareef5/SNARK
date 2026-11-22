import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Corpses as Drawn } from "../../client/core/ragdoll.ts";
import { RemoteSample } from "../../client/core/session.ts";
import type { HostOptions } from "../../server/host.ts";
import { Fall, layCorpse } from "../../shared/anim/corpse.ts";
import { Solved } from "../../shared/anim/skeleton.ts";
import { makeHandle } from "../../shared/ids.ts";
import { decodeCorpseCheckpoint } from "../../shared/net/corpse.ts";
import { F_GROUNDED } from "../../shared/sim/entities.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { flatMap } from "../fixtures/map.ts";
import { BIRD, BIRD_RIG, birdSet } from "../fixtures/bird.ts";
import { artTest } from "../fixtures/needs-art.ts";
import { Harness } from "../fixtures/net.ts";

const MAP = writeMap(flatMap(2));
function options(): HostOptions {
  const set = birdSet(), clips = set.clips.map(c => ({ ...c, id: c.id.replace(BIRD, "core:dodo") }));
  return { dev: true, map: MAP, clips: { ...set, clips, index: new Map(clips.map((c, i) => [c.id, i])) }, rigs: [{ ...BIRD_RIG, id: "core:dodo" }] };
}
function killed(h: Harness, kind: string, x: number, y: number, z: number, vx = 12, vz = 0) {
  const ents = h.world.ents, e = h.host.spawnCreature(kind, x, z, 1);
  ents.setPosition(e, x, y, z); ents.flags[e] = ents.flags[e]! & ~F_GROUNDED;
  const rec = h.host.records.byPid.get(ents.pid[e]!)!, fibre = h.reg.index.get("core:fiber")!;
  expect(h.host.items.mint(rec, fibre, 7)).toBe(7);
  h.host.survival.hurt(rec, 1e6, 0, undefined, { victimPid: rec.pid, victimHandle: makeHandle(e, ents.gen[e]!), vx, vy: 0, vz, wx: .4, wy: 1.3, wz: -.7 });
  const b = [...h.host.corpses.bodies.values()].at(-1)!;
  expect(b.motionRevision).toBe(1); expect(b.drop).toBeNull();
  return b;
}

function continued(kind: string, host: HostOptions): void {
  const dir = mkdtempSync(join(tmpdir(), "snark-corpse-lifecycle-")), opts = { ...host, dbPath: join(dir, "world.db") };
  const h = new Harness({}, 1, 60, opts); let closed = false, resumed: Harness | null = null;
  try {
    const b = killed(h, kind, 63.25, 40, 50.125);
    for (let tick = 0; tick < 20; tick++) h.server.tick();
    const motion = h.host.corpses.motion(b.e)!, cp = decodeCorpseCheckpoint(motion.data)!;
    expect(cp.x).toBeGreaterThan(64);
    const anim = h.world.anims[b.kind]!, doll = layCorpse(anim, cp.out, cp.air, cp.x, cp.y, cp.z, cp.yaw, cp.size, new Solved(anim.rig.bones), cp.standing)!;
    expect(doll.restore(cp.state, cp.awake)).toBe(true);
    const authoritative = new Fall(doll); authoritative.ticks = cp.ticks;
    const remote = new RemoteSample(), drawn = new Drawn(h.world.anims), ents = h.world.ents;
    remote.count = 1; remote.id[0] = b.e; remote.gen[0] = ents.gen[b.e]!; remote.kind[0] = b.kind;
    remote.x[0] = b.x; remote.y[0] = b.y; remote.z[0] = b.z; remote.yaw[0] = b.yaw;
    remote.anim[0] = ents.anim[b.e]!; remote.cue[0] = ents.cue[b.e]!; remote.span[0] = ents.span[b.e]!; remote.tick = motion.tick;
    const motions = new Map([[makeHandle(b.e, ents.gen[b.e]!), motion]]);
    drawn.update(remote, h.world, b.x, b.z, new Map(), motions);
    expect(drawn.list[0]!.motionRevision).toBe(motion.revision);
    h.host.shutdown(); closed = true;
    resumed = new Harness({}, 1, 60, opts);
    const next = resumed.host.corpses.bodies.get(b.rec.pid)!;
    expect(next.fall!.ragdoll.checkpoint()).toEqual(cp.state);
    for (let tick = 0; tick < 600; tick++) {
      authoritative.tick(h.world); resumed.server.tick(); remote.tick++;
      drawn.update(remote, h.world, b.x, b.z, new Map(), motions);
      expect(next.fall!.ragdoll.checkpoint()).toEqual(authoritative.ragdoll.checkpoint());
      expect(drawn.list[0]!.fall!.ragdoll.checkpoint()).toEqual(authoritative.ragdoll.checkpoint());
      expect(next.fall!.ticks).toBe(authoritative.ticks);
    }
    expect(next.y).toBeLessThan(2); expect(next.fall!.still).toBe(true);
    expect(resumed.host.items.inv(next.rec).total(resumed.reg.index.get("core:fiber")!)).toBe(7);
  } finally { if (!closed) h.host.shutdown(); resumed?.host.shutdown(); rmSync(dir, { recursive: true, force: true }); }
}

test("a moving fixture corpse, a late drawn observer and SQLite restart continue identically through landing", () => continued("core:dodo", options()));
artTest("an authored raptor checkpoint stays bit-exact through late drawing, restart and landing", () => continued("core:raptor", { dev: true, map: MAP }));

test("an impact corpse retains reachable inventory and harvest geometry at every map edge", () => {
  const h = new Harness({}, 1, 60, options());
  try {
    for (const [x, z, vx, vz] of [[3, 48, -30, 0], [125, 48, 30, 0], [48, 3, 0, -30], [48, 125, 0, 30], [3, 3, -30, -30], [125, 125, 30, 30]]) {
      const b = killed(h, "core:dodo", x!, 2, z!, vx, vz);
      for (let tick = 0; tick < 300; tick++) h.server.tick();
      expect(b.x).toBeGreaterThan(0); expect(b.x).toBeLessThan(128);
      expect(b.z).toBeGreaterThan(0); expect(b.z).toBeLessThan(128);
      const middle = h.host.corpses.middle(b);
      expect(h.host.corpses.cast(middle.x, middle.y + 2, middle.z, 0, -1, 0, 3)).toBe(b.e);
      expect(h.host.items.inv(b.rec).total(h.reg.index.get("core:fiber")!)).toBe(7);
      expect(h.host.items.audit()).toEqual([]);
    }
  } finally { h.host.shutdown(); }
});

artTest("an authored pteranodon impact death eighty metres up reaches terrain after the old ten-second cutoff", () => {
  const h = new Harness({}, 1, 60, { dev: true, map: MAP });
  try {
    const b = killed(h, "core:pteranodon", 40, 80, 40);
    for (let tick = 0; tick < 301; tick++) h.server.tick();
    expect(b.y).toBeGreaterThan(3); expect(b.fall!.still).toBe(false); expect(b.drop).toBeNull();
    for (let tick = 301; tick < 1000; tick++) h.server.tick();
    expect(b.y).toBeLessThan(3); expect(b.fall!.still).toBe(true);
  } finally { h.host.shutdown(); }
});
