import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TitleScenes } from "../../server/admin/title-scenes.ts";
import { OPENING_SHOT, validShot } from "../../shared/title-scene.ts";
import { Camera } from "../../client/core/render/camera.ts";
import type { Scene } from "../../client/core/render/scene.ts";
import { RemoteSample } from "../../client/core/session.ts";
import { shoreView } from "../../client/core/title-shore.ts";
const picture = "data:image/webp;base64,UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA";
const write = (store: TitleScenes, data: object) =>
  store.admin(
    new Request("http://cluster/api", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) }),
  );
test("a cluster publishes camera and loading plates together, protects a newer edit and retains the public shot on restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "snark-shots-")),
    path = join(dir, "shots.sqlite");
  const a = new TitleScenes(path),
    b = new TitleScenes(path);
  const shot = { ...OPENING_SHOT, id: "harbor", name: "Harbor", camera: { ...OPENING_SHOT.camera, pan: 21 } };
  try {
    expect(await a.active().json()).toMatchObject({ id: OPENING_SHOT.id });
    expect((await write(a, { shot, revision: 0, publish: false })).status).toBe(200);
    expect(await b.active().json()).toMatchObject({ id: OPENING_SHOT.id });
    expect(a.poster(true).status).toBe(307);
    expect((await write(b, { shot, revision: 0, publish: false })).status).toBe(409);
    expect((await write(b, { shot, revision: 1, publish: true, picture })).status).toBe(400);
    expect((await write(b, { shot, revision: 1, publish: true, picture, portrait: picture })).status).toBe(200);
    expect((await write(a, { shot: { ...shot, name: "Unpublished" }, revision: 2, publish: false })).status).toBe(200);
    const reopened = new TitleScenes(path);
    try {
      expect(await reopened.active().json()).toEqual(shot);
      expect(await reopened.poster(false).arrayBuffer()).toEqual(await b.poster(true).arrayBuffer());
      expect(a.poster(false).headers.get("content-type")).toBe("image/webp");
    } finally {
      reopened.close();
    }
  } finally {
    a.close();
    b.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("an authored shot keeps its light and camera deterministic while the seated gaze and mechanical index animate independently", () => {
  const cam = new Camera(),
    actors = new RemoteSample(),
    scene = { characters: { seatedHeadTurn: 0 }, eyeIndexOffset: 0, eyeSeconds: 0 } as Scene;
  const view = (t: number, mx = 0) => {
    shoreView(scene, cam, actors, OPENING_SHOT, t, mx, 0, 5);
    return [cam.x, cam.y, cam.z, cam.yaw, cam.pitch];
  };
  cam.aspect = 16 / 9;
  const original = view(1),
    gaze = scene.characters.seatedHeadTurn,
    step = scene.eyeIndexOffset;
  expect(view(6)).toEqual(original);
  expect(scene.characters.seatedHeadTurn).not.toBe(gaze);
  expect(scene.eyeIndexOffset).not.toBe(step);
  expect(actors.tick).toBe(180);
  expect(scene.eyeSeconds + 40).toBeGreaterThan(11);
  expect(scene.eyeSeconds + 40).toBeLessThan(21);
  expect(view(6, 1)).not.toEqual(original);
  expect(view(6)).toEqual(original);
  cam.aspect = 9 / 16;
  expect(view(6)).not.toEqual(original);
  expect(validShot({ ...OPENING_SHOT, camera: { ...OPENING_SHOT.camera, pan: Infinity } })).toBe(false);
  expect(validShot({ ...OPENING_SHOT, set: "../other" })).toBe(false);
});
