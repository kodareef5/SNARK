import { expect, test } from "bun:test";
import { App } from "../../client/core/app.ts";
import { RESULT_OK } from "../../shared/net/protocol.ts";
import type { Pack } from "../../shared/pack/pack.ts";
import { BTN_SPRINT } from "../../shared/sim/character.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { castWorld, HIT_NONE } from "../../shared/world/ray.ts";
import { flatMap } from "../fixtures/map.ts";
import { artTest } from "../fixtures/needs-art.ts";
import { Harness } from "../fixtures/net.ts";
import { corePack, frozenPack } from "../fixtures/pack.ts";

function opening(pack: Pack, species: string, fps: number, obstacle: "roof" | "beam" | "door", pitch = -.4): void {
  const h = new Harness({}, 1, fps, { dev: true, map: writeMap(flatMap(2)), clips: pack.clips, rigs: pack.header.rigs });
  try {
    const app = new App(h.join("opening-rider", {}, { manual: true }), h.reg, pack);
    const run = (ms: number, observe?: () => void) => h.run(ms, now => { app.frame(now, 960, 540); observe?.(); });
    run(600);
    const c = h.client(app.session)!, a = h.world.ents, actor = h.host.records.byPid.get(c.pid)!;
    const mount = h.host.spawnCreature(`core:${species}`, 70, 64, 1), rec = h.host.records.byPid.get(a.pid[mount]!)!;
    rec.team = actor.team; rec.saddle = h.reg.index.get(`core:saddle_${species}`)!;
    h.host.refreshBody(rec); h.host.creatures.claimed(mount); h.host.creatures.mind.stay(mount, 0xffffffff);
    a.setPosition(c.ent, 68, 0, 64);
    if (obstacle === "roof") {
      const kind = h.reg.index.get("core:ceiling_stone")!;
      for (let x = 61; x <= 79; x += 3) for (let z = 73.5; z <= 88.5; z += 3) h.world.structs.add(kind, x, 2.75 + h.reg.halfY[kind]!, z, 0, 0, 10000);
    } else if (obstacle === "beam") {
      for (const x of [64, 67, 70, 73, 76]) h.world.structs.add(h.reg.index.get("core:wall")!, x, 4.25, 76, 0, 0, 10000);
    } else h.world.structs.add(h.reg.index.get("core:doorframe_stone")!, 70, 1.5, 76, 0, 0, 10000);
    run(200); expect(h.host.riding.mount(c, mount)).toBe(RESULT_OK); run(1200);
    app.controls.yaw = obstacle === "roof" ? Math.PI : 0; app.controls.pitch = pitch; run(300);
    app.controls.moveZ = obstacle === "roof" ? -1 : 1; app.controls.buttons = obstacle === "roof" ? 0 : BTN_SPRINT;
    let previous: number[] | null = null, largest = 0, crossed = 0;
    run(obstacle === "roof" ? 8000 : 6000, () => {
      const s = app.session, own = s.own, cam = app.cam;
      // Measure against the drawn mount, not the 30 Hz simulation staircase at a 120 Hz camera rate.
      const x = s.ownPrev.x + (own.x - s.ownPrev.x) * s.alpha + s.smoothX;
      const y = s.ownPrev.y + (own.y - s.ownPrev.y) * s.alpha + s.smoothY;
      const z = s.ownPrev.z + (own.z - s.ownPrev.z) * s.alpha + s.smoothZ;
      const offset = [cam.x - x, cam.y - y, cam.z - z];
      if (previous) largest = Math.max(largest, Math.hypot(...offset.map((n, i) => n - previous![i]!)));
      previous = offset;
      const inside = obstacle === "roof" ? z > 72 && z < 90 : Math.abs(z - 76) < .1;
      if (inside) {
        crossed++;
        const mid = y + h.reg.move[rec.kind]!.height * .5, dx = cam.x - x, dy = cam.y - mid, dz = cam.z - z, distance = Math.hypot(dx, dy, dz);
        expect(castWorld(h.world, x, mid, z, dx / distance, dy / distance, dz / distance, distance)).toBe(HIT_NONE);
      }
    });
    expect(app.session.own.z).toBeGreaterThan(80);
    if (obstacle === "roof") expect(crossed).toBeGreaterThan(fps);
    expect(largest).toBeLessThanOrEqual(30 / fps);
  } finally { h.host.shutdown(); }
}

for (const fps of [20, 30, 60, 120]) {
  test(`backing a parasaur under a roof preserves camera continuity at ${fps} fps`, () => opening(frozenPack(), "parasaur", fps, "roof", 0));
  test(`sprinting a raptor through a doorway preserves camera continuity at ${fps} fps`, () => opening(frozenPack(), "raptor", fps, "door"));
  test(`sprinting under a narrow beam preserves camera continuity at ${fps} fps`, () => opening(frozenPack(), "raptor", fps, "beam"));
}
artTest("authored rigs retain backing and narrow-opening camera continuity", () => {
  for (const fps of [30, 60]) {
    for (const pitch of [-1, -.4, 0]) opening(corePack(), "parasaur", fps, "roof", pitch);
    opening(corePack(), "raptor", fps, "door");
    for (const kind of ["raptor", "parasaur"]) opening(corePack(), kind, fps, "beam");
  }
});
