import { expect, test } from "bun:test";
import { App } from "../../client/core/app.ts";
import { CITY_BUFFER } from "../../client/core/render/farcity.ts";
import type { FramePacket } from "../../client/core/render/packet.ts";
import { NO_CLIPS } from "../../shared/anim/clip.ts";
import { chunkAt } from "../../shared/coords.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { MODE_GHOST } from "../../shared/sim/character.ts";
import { F_GROUNDED } from "../../shared/sim/entities.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { KORU_COURSE, koruCourse } from "../../tools/koru/course.ts";
import { Harness } from "../fixtures/net.ts";
import { corePackBytes } from "../fixtures/pack.ts";

test("native Koru rows hand over to map geometry and return without a missing or doubled yacht chunk", () => {
  const map = koruCourse(), chunks = [...new Set(map.statics.filter(s => s.kind.startsWith("core:koru")).map(s => chunkAt(map.dims, s.x, s.z)))];
  const h = new Harness({}, 629, 60, { dev: true, clips: NO_CLIPS, rigs: [], map: writeMap(map) });
  try {
    const pack = parsePack(corePackBytes()), s = h.join("streaming-observer", {}, { manual: true, city: true });
    const app = new App(s, h.reg, pack); app.ui.settings.tier = "high"; app.ui.settings.steady = false;
    let packet: FramePacket | null = null;
    const run = (ms: number) => h.run(ms, now => { packet = app.frame(now, 800, 500); });
    run(1000); s.text("enablecheats"); run(100); s.text("fly"); run(100);
    const c = h.client(s)!, ents = h.world.ents, origin = KORU_COURSE.vessel;
    for (const distance of [115, 280, 650, 900, 115]) {
      ents.setPosition(c.ent, origin.x - distance, 33.38, origin.z - 10);
      ents.vx[c.ent] = ents.vy[c.ent] = ents.vz[c.ent] = 0;
      ents.mode[c.ent] = MODE_GHOST; ents.flags[c.ent] = ents.flags[c.ent]! & ~F_GROUNDED; c.ownDirty = true;
      app.controls.yaw = Math.atan2(distance, 10); app.controls.pitch = -.05; run(1300);
      const p = packet as FramePacket | null;
      expect(p).not.toBeNull(); expect(app.scene?.city).not.toBeNull(); expect(s.world?.city).toBeDefined();
      const far = chunks.filter(chunk => app.scene!.city!.isFar(chunk));
      if (distance === 115) expect(far).toHaveLength(0);
      else if (distance === 280) { expect(far.length).toBeGreaterThan(0); expect(far.length).toBeLessThan(chunks.length); }
      else expect(far).toHaveLength(chunks.length);
      const nearDraws = new Set<number>(); let cityDraws = 0;
      for (let d = 0; d < p!.drawCount; d++) {
        if (p!.drawBuffer[d] === CITY_BUFFER) cityDraws++;
        if (pack.header.meshes[p!.drawMesh[d]!]!.id.startsWith("core:koru")) nearDraws.add(p!.drawBuffer[d]!);
      }
      for (const chunk of chunks) {
        expect(s.world!.city!.complete(chunk)).toBe(!far.includes(chunk));
        expect(nearDraws.has(chunk)).toBe(!far.includes(chunk));
      }
      if (far.length) expect(cityDraws).toBeGreaterThan(0);
      expect(app.scene!.city!.stats.unseen).toBe(0); expect(app.scene!.city!.stats.missing).toBe(0);
      expect(p!.dropped).toBe(0); expect(p!.skipped).toBe(0); expect(p!.casterDropped).toBe(0);
    }
  } finally { h.host.shutdown(); }
});
