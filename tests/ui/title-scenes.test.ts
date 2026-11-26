import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Acts } from "../../server/acts.ts";
import { refused, type AdminGate } from "../../server/admin/gate.ts";
import { TitleScenes } from "../../server/admin/title-scenes.ts";
import { Guesses } from "../../server/guesses.ts";
import { DEFAULT_LOADER_SHOT, initialShots, type LoaderScene } from "../../shared/player-scenes.ts";
import { OPENING_SHOT, validShot } from "../../shared/title-scene.ts";
import { Camera } from "../../client/core/render/camera.ts";
import type { Scene } from "../../client/core/render/scene.ts";
import { RemoteSample } from "../../client/core/session.ts";
import { KEEL, SEXTANT_PIVOT } from "../../shared/world/tide-eye.ts";
import profile from "../../shared/world/sextant-profile.json" with { type: "json" };
import { flatWorld } from "../fixtures/world.ts";
import { AnimState } from "../../shared/anim/pose.ts";
import { MODE_WALK } from "../../shared/sim/character.ts";
import { GEAR_COUNT, GEAR_WORN } from "../../shared/sim/entities.ts";
import { HeldTops } from "../../client/core/render/blocks.ts";
import { writeEyeSky } from "../../client/core/render/tide-eye.ts";
import { FRAME, FRAME_FLOATS, type FramePacket } from "../../client/core/render/packet.ts";
import { heroMeshes, mountRex, shoreLight, shoreView } from "../../client/core/title-shore.ts";
const picture = "data:image/webp;base64,UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA";
const loader = async (store: TitleScenes) => (await store.loader().json() as LoaderScene).shot;
const write = (store: TitleScenes, data: object, category = "title") =>
  store.admin(
    new Request(`http://cluster/api?category=${category}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) }),
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
test("title and loader publish their own composition and two frames", async () => {
  const dir = mkdtempSync(join(tmpdir(), "snark-loader-shots-"));
  const path = join(dir, "shots.sqlite");
  const first = new TitleScenes(path), another = new TitleScenes(path);
  const shot = { ...DEFAULT_LOADER_SHOT, id: "new-loader", subject: "rex" as const };
  try {
    expect(await loader(first)).toEqual(DEFAULT_LOADER_SHOT);
    expect(first.loaderPoster(true).headers.get("location")).toBe("/title/loader-wynwood-portrait.webp");
    expect((await write(first, { shot, revision: 0, publish: false, category: "title" }, "loaders")).status).toBe(400);
    expect((await write(first, { shot, revision: 0, publish: false }, "wiki")).status).toBe(405);
    expect((await write(first, { shot, revision: 0, publish: false }, "loaders")).status).toBe(200);
    expect(await loader(another)).toEqual(DEFAULT_LOADER_SHOT);
    expect((await write(another, { shot, revision: 0, publish: true, picture, portrait: picture }, "loaders")).status).toBe(409);
    expect((await write(another, { shot, revision: 1, publish: true, picture }, "loaders")).status).toBe(400);
    expect((await write(another, { shot, revision: 1, publish: true, picture, portrait: picture }, "loaders")).status).toBe(200);
    expect((await write(first, { shot: OPENING_SHOT, revision: 0, publish: false })).status).toBe(200);
    expect(await first.active().json()).toEqual(OPENING_SHOT);
    expect(first.poster(true).headers.get("location")).toBe("/title/red-tide-portrait.webp");
    const reopened = new TitleScenes(path);
    try {
      expect(await loader(reopened)).toEqual(shot);
      expect(reopened.loaderPoster(false).headers.get("content-type")).toBe("image/webp");
      expect(reopened.loaderPoster(true).status).toBe(200);
    } finally { reopened.close(); }
  } finally {
    first.close();
    another.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a shot saved in the studio is logged by which shot and for which screen", async () => {
  const dir = mkdtempSync(join(tmpdir(), "snark-logged-shots-"));
  const store = new TitleScenes(join(dir, "shots.sqlite"));
  const acts = new Acts({ persistence: null, tick: () => 0, wall: Date.now, say: () => {}, shown: () => false, tellAll: () => {} });
  const gate: AdminGate = { dev: false, password: "kiwi", guesses: new Guesses(), tick: () => 0 };
  const signed = async (data: object, category = "title", method = "POST"): Promise<number> => {
    const req = new Request(`http://cluster/api?category=${category}`, {
      method, headers: { "content-type": "application/json", authorization: `Basic ${btoa("kody:kiwi")}` }, ...(method === "POST" ? { body: JSON.stringify(data) } : {}),
    });
    return (refused(req, "1.2.3.4", gate) ?? (await store.admin(req, acts))).status;
  };
  const shot = { ...OPENING_SHOT, id: "harbor", name: "Harbor", camera: { ...OPENING_SHOT.camera, pan: 21 } };
  try {
    expect(await signed({ shot, revision: 0, publish: false })).toBe(200);
    expect(await signed({ shot, revision: 1, publish: true, picture, portrait: picture })).toBe(200);
    expect(await signed({ shot: { ...DEFAULT_LOADER_SHOT, name: "Wynwood dusk" }, revision: 0, publish: false }, "loaders")).toBe(200);
    // Refused, stale or only read: nothing changed, and nothing is logged.
    expect(await signed({ shot, revision: 0, publish: false })).toBe(409);
    expect(await signed({ shot, revision: 2, publish: true, picture })).toBe(400);
    expect(await signed({}, "title", "GET")).toBe(200);
    expect(acts.recent().map((a) => [a.name, a.what])).toEqual([
      ["(kody)", 'saved the shot "Harbor" for the title screen as a draft'],
      ["(kody)", 'published the shot "Harbor" for the title screen'],
      ["(kody)", 'saved the shot "Wynwood dusk" for the loading screen as a draft'],
    ]);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a stored catalogue adds new declarations without replacing edits", async () => {
  const dir = mkdtempSync(join(tmpdir(), "snark-authored-shots-"));
  const path = join(dir, "shots.sqlite");
  const custom = { ...DEFAULT_LOADER_SHOT, name: "Operator crop", camera: { ...DEFAULT_LOADER_SHOT.camera, tilt: 12 } };
  const saved = { revision: 7, active: custom.id, published: custom, shots: [custom] };
  const db = new Database(path);
  db.exec("CREATE TABLE title (id INTEGER PRIMARY KEY, revision INTEGER NOT NULL, catalog TEXT NOT NULL, poster BLOB, portrait BLOB)");
  db.query("INSERT INTO title VALUES (2, 7, ?, ?, ?)").run(JSON.stringify(saved), new Uint8Array(24).fill(7), new Uint8Array(24).fill(9));
  db.close();
  const store = new TitleScenes(path);
  try {
    const response = await store.admin(new Request("http://cluster/api?category=loaders"));
    expect(await response.json()).toEqual({ ...saved, shots: [custom, ...initialShots("loaders").shots.filter((shot) => shot.id !== custom.id)] });
    expect(await loader(store)).toEqual(custom);
    expect(new Uint8Array(await store.loaderPoster(false).arrayBuffer())).toEqual(new Uint8Array(24).fill(7));
    expect(new Uint8Array(await store.loaderPoster(true).arrayBuffer())).toEqual(new Uint8Array(24).fill(9));
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

function beachCast() {
  const { hf, reg } = flatWorld(8);
  const eye = { name: "Wynwood", x: 3832, y: 5, z: 3712, yaw: 22790, radius: 64, color: "red", form: "sextant" } as const;
  const actors = new RemoteSample();
  const cast = mountRex(actors, { hf, tops: new HeldTops(hf.dims), actor: [404, 498], eye: { ...eye } }, reg);
  return { actors, cast, reg };
}

test("Meridian sits in the grounded Rex’s driver seat and the loader prioritizes both painted meshes", () => {
  const { actors, reg } = beachCast();
  const motion = new AnimState();
  motion.unpack(actors.anim[0]!);
  expect(motion).toMatchObject({ grounded: true, mode: MODE_WALK, speed: 0 });
  expect(actors.kind[0]).toBe(reg.index.get("core:rex")!);
  expect(actors.gear[GEAR_WORN]).toBe(reg.index.get("core:saddle_rex")!);
  expect([...actors.colors.slice(0, 6)]).toEqual([8, 7, 14, 6, 9, 3]);
  expect(heroMeshes).toContain("core:rex");
  expect(actors.seat[1]).toBe(actors.id[0]! + 1);
  expect(actors.seatGen[1]).toBe(actors.gen[0]!);
  expect(actors.seatSlot[1]).toBe(1);
  expect(actors.y[0]).toBeCloseTo(0);
  expect(heroMeshes).toContain("core:saddle_rex/worn");
  for (const [i, name] of ["hat", "shirt", "gloves", "pants", "boots"].entries())
    expect(actors.gear[GEAR_COUNT + GEAR_WORN + i]).toBe(reg.index.get("core:meridian_" + name)!);
});

test("the shore clock opens face-on, completes a turn about the keel, and keeps the red beam on its rotating tip", () => {
  const { cast, actors } = beachCast(), cam = new Camera();
  const scene = { characters: {} } as Scene;
  const view = (t: number) => shoreView(scene, cam, actors, OPENING_SHOT, t, 0, 0, cast);
  cam.aspect = 16 / 9;
  view(0);
  const start = cast.eye.yaw;
  const yaw = start * Math.PI / 32768, bearing = Math.atan2(cam.x - cast.eye.x, cam.z - cast.eye.z);
  expect(Math.cos(yaw - bearing)).toBeGreaterThan(0.999);
  // Check the two ends of the cup's opening in screen space with the actual beach-to-Wynwood sightline.
  const pivotY = cast.eye.y + KEEL + (SEXTANT_PIVOT - KEEL) * scene.sextantScale;
  const bow = profile.bowX * scene.sextantScale;
  for (const aspect of [16 / 9, 390 / 844]) {
    cam.aspect = aspect;
    view(0);
    cam.update();
    const hub = [0, 0, 0], rim = [0, 0, 0];
    expect(cam.project(cast.eye.x, pivotY, cast.eye.z, hub)).toBe(true);
    expect(cam.project(cast.eye.x - bow * Math.cos(yaw), pivotY, cast.eye.z + bow * Math.sin(yaw), rim)).toBe(true);
    expect(rim[0]!).toBeGreaterThan(0.035);
    expect(hub[0]!).toBeLessThan(0.9);
    expect((hub[0]! - rim[0]!) * aspect).toBeGreaterThan(0.07);
    expect(hub[1]!).toBeGreaterThan(0.2);
    expect(hub[1]!).toBeLessThan(0.7);
  }
  const frame = new Float32Array(FRAME_FLOATS);
  view(45);
  expect((cast.eye.yaw - start) & 65535).toBe(16384);
  writeEyeSky(frame, [cast.eye], scene.eyeSeconds, cast.eye.x, 0, cast.eye.z, scene.sextantScale);
  const theta = cast.eye.yaw * Math.PI / 32768;
  // The figure stands over the keel's finial, where the beam leaves (the profile's emitter).
  expect(frame[FRAME.eyes]).toBeCloseTo(profile.emitter[0]! * scene.sextantScale * Math.cos(theta));
  expect(frame[FRAME.eyes + 2]).toBeCloseTo(-profile.emitter[0]! * scene.sextantScale * Math.sin(theta));
  view(180);
  expect(cast.eye.yaw).toBe(start);
});

test("a preset can frame the coast, the Rex alone, or the mounted pair", () => {
  const cam = new Camera(), { cast, actors } = beachCast(), scene = { characters: {} } as Scene;
  for (const [subject, count] of [["coast", 0], ["rex", 1], ["rider", 2]] as const) {
    const shot = { ...OPENING_SHOT, subject };
    expect(validShot(shot)).toBe(true);
    shoreView(scene, cam, actors, shot, 0, 0, 0, cast);
    expect(actors.count).toBe(count);
  }
  expect(validShot({ ...OPENING_SHOT, subject: "missing" })).toBe(false);
});

test("the clock and seated gaze move while the shoulder camera holds steady in the authored sunset", () => {
  const cam = new Camera(), { cast, actors } = beachCast(), scene = { characters: {} } as Scene;
  const view = (t: number, mx = 0) => {
    shoreView(scene, cam, actors, OPENING_SHOT, t, mx, 0, cast);
    return [cam.x, cam.y, cam.z, cam.yaw, cam.pitch, actors.y[0], scene.characters.seatedHeadTurn];
  };
  cam.aspect = 16 / 9;
  const start = view(0);
  view(16);
  expect(scene.eyeIndexOffset).toBeGreaterThan(0.6);
  const turn = view(48);
  expect(scene.eyeIndexOffset).toBeLessThan(-0.6);
  view(40);
  expect(scene.hour).toBeCloseTo(OPENING_SHOT.camera.hour);
  view(120);
  expect(scene.hour).toBeCloseTo(OPENING_SHOT.camera.hour);
  expect(view(48)).toEqual(turn);
  expect(view(0)).toEqual(start);
  expect(view(0, 1)).not.toEqual(start);
  view(1);
  expect(actors.y[0]).toBe(start[5]);
  expect(view(1).slice(0, 5)).toEqual(start.slice(0, 5));
  expect(scene.characters.seatedHeadTurn).not.toBe(start[6]);
  expect(actors.y[0]).toBe(actors.y[1]);
  expect(actors.tick).toBe(30);
  expect(scene.eyeSeconds + 40).toBeGreaterThan(11);
  expect(scene.eyeSeconds + 40).toBeLessThan(21);
  // The sky's display is held at full power and its own clock only runs forward: nothing in it plays back.
  const lanes = [0, 1, 30, 92, 600].map((t) => {
    view(t);
    const frame = new Float32Array(FRAME_FLOATS);
    writeEyeSky(frame, [cast.eye], scene.eyeSeconds, cast.eye.x, 0, cast.eye.z, scene.sextantScale, scene.eyeHold);
    return [frame[FRAME.eyes + 7]!, frame[FRAME.eyes + 8]!, frame[FRAME.eyes + 9]!];
  });
  for (let i = 1; i < lanes.length; i++) {
    expect(lanes[i]![0]).toBe(1);
    expect(lanes[i]![1]!).toBeGreaterThan(lanes[i - 1]![1]!);
    expect(lanes[i]![2]).toBe(lanes[0]![2]!);
  }
  cam.aspect = 9 / 16;
  expect(view(0)).not.toEqual(start);
  expect(validShot({ ...OPENING_SHOT, camera: { ...OPENING_SHOT.camera, pan: Infinity } })).toBe(false);
  expect(validShot({ ...OPENING_SHOT, set: "../other" })).toBe(false);
});

test("the Rex shot retains its deep sunset grade and caps red spill for later studio hours", () => {
  const packet = { frame: new Float32Array(FRAME_FLOATS) } as FramePacket;
  for (const exposure of [0, 7, 148, 26530]) {
    packet.frame.fill(0);
    packet.frame.fill(1, FRAME.grade, FRAME.grade + 3);
    packet.frame[FRAME.exposure] = exposure;
    shoreLight(packet);
    expect(packet.frame.every(Number.isFinite)).toBe(true);
    expect(packet.frame[FRAME.grade + 1]).toBeCloseTo(0.51);
    expect(packet.frame[FRAME.grade + 2]).toBeCloseTo(0.58);
    expect(packet.frame[FRAME.skyBelow]).toBe(0);
    expect(packet.frame[FRAME.skyAbove]).toBe(0);
    if (exposure === 148) expect(packet.frame[FRAME.cloudSun]).toBeCloseTo(0.012, 5);
    expect(packet.frame[FRAME.cloudSun]! * exposure).toBeLessThanOrEqual(1.8001);
  }
});
