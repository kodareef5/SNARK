import { expect, test } from "bun:test";
import { App } from "../../client/core/app.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { NO_CLIPS } from "../../shared/anim/clip.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { RESULT_OK } from "../../shared/net/protocol.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { Harness } from "../fixtures/net.ts";
import { flatMap } from "../fixtures/map.ts";
import { corePack } from "../fixtures/pack.ts";

test("whole-client saddle driver and passenger cameras remain below a permitted clipping roof and rise outdoors", () => {
  const content = CORE_CONTENT.map(d => d.type === "item" && d.id === "core:saddle_parasaur"
    ? { ...d, saddle: { ...d.saddle!, seats: [
      { id: "rider", driver: true, anchor: [0, 2.57, .7] as const, entry: [1.7, 0, .7] as const },
      { id: "passenger", anchor: [0, 2.57, -.2] as const, entry: [-1.7, 0, -.2] as const },
    ] } } : d);
  const { registry, errors } = compileContent(content);
  expect(errors).toEqual([]);
  const h = new Harness({}, 1, 60, { dev: true, clips: NO_CLIPS, rigs: [], map: writeMap(flatMap(2)) }, registry!);
  try {
    const apps = ["camera-driver", "camera-passenger"].map(name => new App(h.join(name, {}, { manual: true }), h.reg, corePack()));
    const run = (ms: number): void => h.run(ms, now => { for (const app of apps) app.frame(now, 1280, 720); });
    run(600);
    const clients = apps.map(app => h.client(app.session)!), { ents, reg } = h.world;
    const driver = h.host.records.byPid.get(clients[0]!.pid)!, passenger = h.host.records.byPid.get(clients[1]!.pid)!;
    passenger.team = driver.team;
    const mount = h.host.spawnCreature("core:parasaur", 70, 65, 1), record = h.host.records.byPid.get(ents.pid[mount]!)!;
    record.team = driver.team; record.saddle = reg.index.get("core:saddle_parasaur")!;
    h.host.refreshBody(record); h.host.creatures.claimed(mount); h.host.creatures.mind.stay(mount, 0xffffffff);
    const ceiling = reg.index.get("core:ceiling")!;
    for (let x = 52; x <= 88; x += 3) for (let z = 47; z <= 83; z += 3) h.world.structs.add(ceiling, x, 3.1, z, 0, 0, 100);
    for (let i = 0; i < clients.length; i++) ents.setPosition(clients[i]!.ent, 68 + i * 4, 0, 65);
    expect(h.host.riding.mount(clients[0]!, mount)).toBe(RESULT_OK); run(200);
    expect(h.host.riding.mount(clients[1]!, mount)).toBe(RESULT_OK); run(900);
    expect(apps[0]!.session.driving).toBe(mount);
    expect(apps[1]!.session.own.seat).toBe(mount + 1);
    for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) for (const pitch of [-1.2, 0, 1]) {
      for (const app of apps) { app.controls.yaw = yaw; app.controls.pitch = pitch; }
      h.run(100, now => {
        for (const app of apps) {
          app.frame(now, 1280, 720);
          expect(app.cam.y).toBeLessThan(3);
          expect(Number.isFinite(app.cam.x + app.cam.y + app.cam.z)).toBe(true);
        }
      });
    }
    ents.setPosition(mount, 108, 0, 65); h.world.history.discontinuity(mount);
    for (const app of apps) { app.controls.yaw = 0; app.controls.pitch = -.5; }
    run(1500);
    for (const app of apps) expect(app.cam.y).toBeGreaterThan(3.2);
  } finally { h.host.shutdown(); }
});
