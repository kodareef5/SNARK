// A carcass at rest meets what drives or walks into it (shared/anim/ragdoll.ts movers): a car rolled across it wakes it
// and shoves it, the server sends where it went, and a watching client draws it there.
import { expect } from "bun:test";
import { Corpses } from "../../client/core/ragdoll.ts";
import { RemoteSample } from "../../client/core/session.ts";
import { solidOf } from "../../shared/sim/vehicle-movers.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { flatMap } from "../fixtures/map.ts";
import { artTest } from "../fixtures/needs-art.ts";
import { Harness } from "../fixtures/net.ts";

artTest("a car rolled across a settled carcass shoves it, and a watcher draws it where the server has it", () => {
  const h = new Harness({}, 2, 60, { map: writeMap(flatMap(4)) });
  try {
    const w = h.join("watcher");
    h.run(600);
    const a = h.world.ents, seen = h.client(w)!;
    a.setPosition(seen.ent, 94, 0, 76);
    h.world.history.discontinuity(seen.ent);
    const dodo = h.host.spawnCreature("core:dodo", 100, 80, 0), kind = a.kind[dodo]!;
    h.host.survival.hurt(h.host.records.byPid.get(a.pid[dodo]!)!, 10000, 0);
    h.run(5000);
    const body = [...h.host.corpses.bodies.values()].find(b => b.kind === kind)!;
    expect(body.fall?.ragdoll.awake).toBe(false);
    const lay = [body.x, body.z];
    const car = h.host.spawnVehicle("core:compact", 100.3, 72, 0);
    h.run(600);
    const remote = new RemoteSample(), drawn = new Corpses(h.world.anims, undefined, () => false, (k) => solidOf(h.reg, k));
    const draw = () => { w.sampleRemote(remote); drawn.update(remote, w.world!, 0, 0, new Map(), w.corpseMotions); };
    h.run(3000, () => { a.vz[car] = a.z[car]! < 86 ? 4 : 0; a.vx[car] = 0; draw(); });
    h.run(2000, draw);
    // Shoved along the road from where it lay.
    expect(Math.hypot(body.x - lay[0]!, body.z - lay[1]!)).toBeGreaterThan(0.3);
    // The watcher draws it where the server has it.
    const shown = drawn.list.find(c => c.kind === kind)!;
    expect(Math.hypot(shown.x - body.x, shown.z - body.z)).toBeLessThan(0.3);
  } finally { h.host.shutdown(); }
});
