import { expect, test } from "bun:test";
import { App } from "../../client/core/app.ts";
import { CITY_BUFFER } from "../../client/core/render/farcity.ts";
import type { FramePacket } from "../../client/core/render/packet.ts";
import { cruiseStatics } from "../../content/landmarks/cruise.ts";
import { chunkAt } from "../../shared/coords.ts";
import { landmarkPoint } from "../../shared/world/landmark.ts";
import { MODE_GHOST } from "../../shared/sim/character.ts";
import { F_GROUNDED } from "../../shared/sim/entities.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { CRUISE_COURSE, cruiseCourse } from "../../tools/cruise/course.ts";
import { assertCruisePlaced } from "../../tools/cruise/preflight.ts";
import { Harness } from "../fixtures/net.ts";
import { cruisePack } from "../fixtures/cruise.ts";

// Collision-only modules do not own draws. The map's cell anchors own near meshes; the complete
// original collision/look rows still supply the far proxy after their chunks leave interest.
test("native cruise cell anchors retain one render owner from near through 2 km and back", () => {
  const map = cruiseCourse(), pack = cruisePack(map.content!.landmarks), origin = CRUISE_COURSE.vessel;
  const rows = cruiseStatics(origin.x, origin.y, origin.z, origin.yaw);
  const chunks = [...new Set(rows.map(row => chunkAt(map.dims, row.x, row.z)))];
  const h = new Harness({}, 629, 60, { dev: true, map: writeMap(map), clips: pack.clips, rigs: pack.header.rigs });
  try {
    expect(assertCruisePlaced(map, h.world.structs, h.reg).length).toBe(map.statics.length);
    const anchors = rows.flatMap(row => {
      const def = h.reg.defs[h.reg.index.get(row.kind)!];
      if (def?.type !== "structure" || !/^cruise:cell_\d+$/.test(def.mesh)) return [];
      const mesh = pack.header.meshes[pack.meshIndex.get(def.mesh)!];
      expect(mesh, `native cell mesh ${def.mesh}`).toBeDefined();
      const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity], point = [0, 0, 0];
      for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) {
        landmarkPoint(row.x, row.y, row.z, row.yaw, [mesh!.center[0] + x * mesh!.half[0], mesh!.center[1] + y * mesh!.half[1], mesh!.center[2] + z * mesh!.half[2]], point);
        for (let axis = 0; axis < 3; axis++) { lo[axis] = Math.min(lo[axis]!, point[axis]!); hi[axis] = Math.max(hi[axis]!, point[axis]!); }
      }
      return [{ mesh: def.mesh, chunk: chunkAt(map.dims, row.x, row.z), lo, hi }];
    });
    expect(anchors.length).toBeGreaterThan(0);
    expect(new Set(anchors.map(anchor => anchor.mesh)).size).toBe(anchors.length);
    const session = h.join("ship-observer", {}, { manual: true }), app = new App(session, h.reg, pack);
    app.ui.settings.tier = "high"; app.ui.settings.steady = false;
    let packet: FramePacket | null = null;
    const run = (ms: number) => h.run(ms, now => { packet = app.frame(now, 1920, 600); });
    run(900); session.text("enablecheats"); run(100); session.text("fly"); run(100);
    const client = h.client(session)!, ents = h.world.ents;
    let mixed = false, entirelyNear = false, entirelyFar = false;
    for (const distance of [115, 180, 220, 280, 650, 900, 1300, 2000, 1300, 900, 650, 280, 220, 180, 115]) {
      ents.setPosition(client.ent, origin.x - distance, 33.38, origin.z);
      ents.vx[client.ent] = ents.vy[client.ent] = ents.vz[client.ent] = 0;
      ents.mode[client.ent] = MODE_GHOST; ents.flags[client.ent] &= ~F_GROUNDED; client.ownDirty = true;
      app.controls.yaw = Math.PI / 2; app.controls.pitch = 0; run(1300);
      const p = packet as FramePacket | null; expect(p).not.toBeNull();
      const city = app.scene!.city!, source = session.world!.city!, far = chunks.filter(chunk => city.isFar(chunk));
      mixed ||= far.length > 0 && far.length < chunks.length; entirelyNear ||= far.length === 0; entirelyFar ||= far.length === chunks.length;
      const nearDraws = new Set<string>(); let cityDraws = 0;
      for (let i = 0; i < p!.drawCount; i++) {
        if (p!.drawBuffer[i] === CITY_BUFFER) cityDraws++;
        const id = pack.header.meshes[p!.drawMesh[i]!]?.id;
        if (id?.startsWith("cruise:cell_")) nearDraws.add(`${p!.drawBuffer[i]}:${id}`);
      }
      for (const chunk of chunks) {
        expect(source.complete(chunk)).toBe(!far.includes(chunk));
      }
      for (const anchor of anchors) {
        const visible = app.cam.boxVisible(anchor.lo[0]!, anchor.lo[1]!, anchor.lo[2]!, anchor.hi[0]!, anchor.hi[1]!, anchor.hi[2]!);
        const drawn = nearDraws.has(`${anchor.chunk}:${anchor.mesh}`);
        if (far.includes(anchor.chunk)) expect(drawn, `far-owned ${anchor.mesh} at ${distance} m`).toBe(false);
        else if (visible) expect(drawn, `visible near cell ${anchor.mesh} at ${distance} m`).toBe(true);
      }
      if (far.length) expect(cityDraws).toBeGreaterThan(0);
      if (distance >= 650) expect(far.length).toBe(chunks.length);
      expect(city.stats.missing).toBe(0); expect(city.stats.unseen).toBe(0); expect(city.stats.behind).toBe(0);
      expect([p!.dropped, p!.skipped, p!.casterDropped]).toEqual([0, 0, 0]);
    }
    expect([mixed, entirelyNear, entirelyFar]).toEqual([true, true, true]);
  } finally { h.host.shutdown(); }
});
