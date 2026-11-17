import { expect } from "bun:test";
import { artTest } from "../fixtures/needs-art.ts";
import { App } from "../../client/core/app.ts";
import type { FramePacket } from "../../client/core/render/packet.ts";
import { KORU_LAYOUT } from "../../content/landmarks/koru.ts";
import { MODE_GHOST } from "../../shared/sim/character.ts";
import { F_GROUNDED } from "../../shared/sim/entities.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { CRUISE_COURSE, cruiseCourse } from "../../tools/cruise/course.ts";
import { Harness } from "../fixtures/net.ts";
import { cruisePack } from "../fixtures/cruise.ts";

// The yacht's sails and gaffs are moving parts. Set, they are drawn as far as its far mesh; struck, a headsail rolled on
// its stay is drawn while the near store holds the yacht, and past that its far mesh's stay stands for it.
artTest("Koru's sails set are drawn from 600 m off with its far mesh, and struck are not", () => {
  const map = cruiseCourse(), pack = cruisePack(map.content!.landmarks.map((l) => l.name)), k = CRUISE_COURSE.koru;
  const h = new Harness({}, 629, 60, { dev: true, map: writeMap(map), clips: pack.clips, rigs: pack.header.rigs });
  try {
    const session = h.join("sailor", {}, { manual: true }), app = new App(session, h.reg, pack);
    session.staticsArrived(h.world.statics!);
    app.ui.settings.steady = false;
    app.ui.settings.tier = "medium";
    let packet: FramePacket | null = null;
    const run = (ms: number) => h.run(ms, (now) => { packet = app.frame(now, 1280, 720); });
    run(900); session.text("enablecheats"); run(100); session.text("fly"); run(100);
    const client = h.client(session)!, ents = h.world.ents, scene = app.scene!;
    const parts = new Set(KORU_LAYOUT.motion.parts.map((p) => scene.assets.table.find(p.mesh)));
    const sails = (): number => {
      ents.setPosition(client.ent, k.x - 600, 20, k.z);
      ents.vx[client.ent] = ents.vy[client.ent] = ents.vz[client.ent] = 0;
      ents.mode[client.ent] = MODE_GHOST; ents.flags[client.ent] &= ~F_GROUNDED; client.ownDirty = true;
      app.controls.yaw = Math.PI / 2; app.controls.pitch = 0;
      run(1500);
      const p = packet as FramePacket | null;
      let n = 0;
      for (let d = 0; d < p!.drawCount; d++) if (parts.has(p!.drawMesh[d]!)) n++;
      return n;
    };
    const struck = sails();
    const control = h.reg.index.get("koru:sail_control");
    h.world.structs.chunks.forEach((t, c) => { if (t) for (let r = 0; r < t.kind.length; r++) if (t.kind[r] === control && t.hp[r]! > 0) h.host.motion.throw(c * 65536 + r); });
    run(KORU_LAYOUT.motion.seconds * 1000 + 1000);
    expect([struck, sails()]).toEqual([0, KORU_LAYOUT.motion.parts.length]);
  } finally { h.host.shutdown(); }
});
