import { expect, test } from "bun:test";
import { App } from "../../client/core/app.ts";
import { CameraBody } from "../../client/core/camera-body.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { ART } from "../../tools/art/source.ts";
import { corePack, frozenPack } from "../fixtures/pack.ts";
import { Harness } from "../fixtures/net.ts";
import { rideScene } from "../../tools/snap/ride.ts";

test("the whole client prepares the driven pose before camera placement and releases it on dismount", () => {
  const { registry: reg, errors } = compileContent(CORE_CONTENT.map(d => d.id === "core:raptor" ? { ...d, camera: { height: 1.1, distance: 4, avoidBody: true } } : d));
  if (!reg) throw new Error(errors.join("\n"));
  // The source distribution includes the frozen, rigged raptor used by the saddle tests.
  const pack = ART ? corePack() : frozenPack();
  const h = new Harness({}, 1, 60, { dev: true, clips: pack.clips, rigs: pack.header.rigs }, reg);
  try {
    const app = new App(h.join("camera rider", {}, { manual: true }), reg, pack);
    const run = (ms: number): void => h.run(ms, now => { app.frame(now, 960, 540); });
    run(500); rideScene(app, run, h, "raptor", "ground", false, false);
    const s = app.session, e = s.driving, scene = app.scene!, rig = scene.characters.creature(s.bodyKind)!.rig, query = new CameraBody();
    expect(e).toBeGreaterThanOrEqual(0);
    for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) for (const pitch of [.65, .9, 1.3]) {
      app.controls.yaw = yaw; app.controls.pitch = pitch; run(100);
      const own = scene.own!, drawn = scene.characters.drawnPose(e, s.bodyKind, own.tick);
      expect(drawn).not.toBeNull();
      query.set(rig, drawn!, e, own.generation!, own.kind, 0, own.x, own.y, own.z, own.yaw);
      const cam = app.cam, half = cam.near * Math.tan(cam.fovY / 2), padding = Math.hypot(cam.near, half, half * cam.aspect);
      expect(query.cast(cam.x, cam.y, cam.z, 0, 1, 0, .001, padding)).toBe(.001);
      expect(app.controls.yaw).toBe(yaw); expect(app.controls.pitch).toBe(pitch);
    }
    h.host.riding.dismount(h.client(s)!); run(600);
    expect(s.driving).toBe(-1); expect(scene.own!.kind).toBe(s.ownKind);
    expect([app.cam.x, app.cam.y, app.cam.z].every(Number.isFinite)).toBe(true);
  } finally { h.host.shutdown(); }
});
