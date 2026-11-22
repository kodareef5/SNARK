import { expect } from "bun:test";
import { artTest } from "../fixtures/needs-art.ts";
import { App } from "../../client/core/app.ts";
// The app's scenes draw the far city, which a page fetches after its first frame (D873).
import "../../client/core/render/city-late.ts";
import type { FramePacket } from "../../client/core/render/packet.ts";
import { KORU_LAYOUT } from "../../content/landmarks/koru.ts";
import { MODE_GHOST } from "../../shared/sim/character.ts";
import { F_GROUNDED } from "../../shared/sim/entities.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { CRUISE_COURSE, cruiseCourse } from "../../tools/cruise/course.ts";
import { Harness } from "../fixtures/net.ts";
import { cruisePack } from "../fixtures/cruise.ts";

// The yacht's sails and gaffs are moving parts. Set or on their way, they are drawn as far as its far mesh; struck, a
// gaff sail and its gaff are drawn while the near store holds the yacht, and a headsail is put away and its roll on the
// stay drawn in its place, a line as the rig is. The rig is parts that never move, drawn as itself however far.
artTest("Koru's sails set or moving are drawn from 600 m off with its far mesh, struck its headsails' rolls, and its rig always", () => {
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
    const mesh = (p: { mesh: string }): number => scene.assets.table.find(p.mesh);
    const sailParts = KORU_LAYOUT.motion.parts.filter((p) => p.mesh.startsWith("koru:sail_"));
    const of = (kind: string): Set<number> => new Set(KORU_LAYOUT.motion.parts.filter((p) => p.mesh.startsWith(`koru:${kind}_`)).map(mesh));
    const [sailMeshes, rigMeshes, rollMeshes] = [of("sail"), of("rig"), of("roll")];
    const sails = (): [number, number, number] => {
      ents.setPosition(client.ent, k.x - 600, 20, k.z);
      ents.vx[client.ent] = ents.vy[client.ent] = ents.vz[client.ent] = 0;
      ents.mode[client.ent] = MODE_GHOST; ents.flags[client.ent] &= ~F_GROUNDED; client.ownDirty = true;
      app.controls.yaw = Math.PI / 2; app.controls.pitch = 0;
      run(1500);
      const p = packet as FramePacket | null;
      let n = 0, rig = 0, rolls = 0;
      for (let d = 0; d < p!.drawCount; d++) {
        if (sailMeshes.has(p!.drawMesh[d]!)) n++;
        if (rigMeshes.has(p!.drawMesh[d]!)) rig++;
        if (rollMeshes.has(p!.drawMesh[d]!)) rolls++;
      }
      return [n, rig, rolls];
    };
    const control = h.reg.index.get("koru:sail_control");
    const toss = (): void => h.world.structs.chunks.forEach((t, c) => { if (t) for (let r = 0; r < t.kind.length; r++) if (t.kind[r] === control && t.hp[r]! > 0) h.host.motion.throw(c * 65536 + r); });
    // Struck; rising; set; coming down; struck again. A sail on its way is drawn as a set one is, a headsail's roll
    // while it is not set, and the rig's parts throughout but the forestays struck.
    const seen = [sails()];
    toss();
    seen.push(sails());
    run(KORU_LAYOUT.motion.seconds * 1000);
    seen.push(sails());
    toss();
    seen.push(sails());
    run(KORU_LAYOUT.motion.seconds * 1000);
    seen.push(sails());
    // Struck, the forestays are inside the rolls and put away with the sheets.
    const forestays = KORU_LAYOUT.motion.parts.filter((p) => p.mesh.startsWith("koru:rig_forestays_")).length;
    const [struck, moving, set]: [number, number, number][] = [[0, rigMeshes.size - forestays, 2], [sailParts.length, rigMeshes.size, 2], [sailParts.length, rigMeshes.size, 0]];
    expect([sailParts.length, rigMeshes.size, rollMeshes.size, forestays]).toEqual([8, 16, 2, 3]);
    expect(seen).toEqual([struck, moving, set, moving, struck]);
  } finally { h.host.shutdown(); }
});
