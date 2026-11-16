import { expect, test } from "bun:test";
import { App } from "../../client/core/app.ts";
import { CITY_BUFFER } from "../../client/core/render/farcity.ts";
import type { FramePacket } from "../../client/core/render/packet.ts";
import { cruiseStatics } from "../../content/landmarks/cruise.ts";
import { chunkAt } from "../../shared/coords.ts";
import { MODE_GHOST } from "../../shared/sim/character.ts";
import { F_GROUNDED } from "../../shared/sim/entities.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { CRUISE_COURSE, cruiseCourse } from "../../tools/cruise/course.ts";
import { assertCruisePlaced } from "../../tools/cruise/preflight.ts";
import { Harness } from "../fixtures/net.ts";
import { corePack } from "../fixtures/pack.ts";

// The full ship stays in an ordinary wide viewport, so visible near chunks must actually submit their native meshes.
test("native cruise chunks retain one render owner from near through 2 km and back", () => {
  const map = cruiseCourse(), pack = corePack(), origin = CRUISE_COURSE.vessel;
  const chunks = [...new Set(cruiseStatics(origin.x, origin.y, origin.z, origin.yaw).map(row => chunkAt(map.dims, row.x, row.z)))];
  const h = new Harness({}, 629, 60, { dev: true, map: writeMap(map), clips: pack.clips, rigs: pack.header.rigs });
  try {
    expect(assertCruisePlaced(map, h.world.structs, h.reg).length).toBe(map.statics.length);
    const session = h.join("ship-observer", {}, { manual: true, city: true }), app = new App(session, h.reg, pack);
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
      const nearDraws = new Set<number>(); let cityDraws = 0;
      for (let i = 0; i < p!.drawCount; i++) {
        if (p!.drawBuffer[i] === CITY_BUFFER) cityDraws++;
        const id = pack.header.meshes[p!.drawMesh[i]!]!.id;
        if (id.startsWith("core:cruise_") && !id.startsWith("core:cruise_port_")) nearDraws.add(p!.drawBuffer[i]!);
      }
      for (const chunk of chunks) {
        expect(source.complete(chunk)).toBe(!far.includes(chunk));
        expect(nearDraws.has(chunk), `native cruise chunk ${chunk} at ${distance} m`).toBe(!far.includes(chunk));
      }
      if (far.length) expect(cityDraws).toBeGreaterThan(0);
      if (distance >= 650) expect(far.length).toBe(chunks.length);
      expect(city.stats.missing).toBe(0); expect(city.stats.unseen).toBe(0); expect(city.stats.behind).toBe(0);
      expect([p!.dropped, p!.skipped, p!.casterDropped]).toEqual([0, 0, 0]);
    }
    expect([mixed, entirelyNear, entirelyFar]).toEqual([true, true, true]);
  } finally { h.host.shutdown(); }
}, 10000);
