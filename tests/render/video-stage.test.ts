// The Screens page's stage (client/core/admin/screens-stage.ts): the ball as players see it, drawn with the game's own
// shader, the tiles of what it can show, the edit that takes one live, and the clips' table.
import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findClips, sortClips, type ScreensState, type StateClip } from "../../client/core/admin/screens.ts";
import {
  STAGE_FLAT_FRAGMENT, STAGE_SITE, STAGE_VERTEX, STAGE_VIEWS, StageFrame, liveKey, liveLook, newStageCamera, stageCamera, stageOrbFragment, stageSphere, stageTiles, takeBody, targetKey, targetLook, type StageLook,
} from "../../client/core/admin/screens-stage.ts";
import { ORB_SCREEN, groundLine } from "../../client/core/render/orb.ts";
import { ORB_AT } from "../../client/core/render/packet.ts";
import { VideoLibrary } from "../../server/video/library.ts";
import { screensAdmin, type ScreenWorld } from "../../server/video/routes.ts";
import type { Clip } from "../../shared/video/clip.ts";
import { ORB_WIPE } from "../../shared/world/orb.ts";
import { compileErrors, linkErrors } from "../fixtures/glsl.ts";

const root = mkdtempSync(join(tmpdir(), "snark-video-stage-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const A = "a1a1a1a1a1a1a1a1", B = "b2b2b2b2b2b2b2b2", C = "c3c3c3c3c3c3c3c3";
const starter = (id: string, title: string, seconds: number): Clip => ({
  id, title, file: `/media/${id}.${id}.mp4`, poster: `/media/${id}.${id}.jpg`, width: 640, height: 360, seconds, bytes: seconds * 75_000,
  audio: false, rights: `${title} rights`, starter: true, colours: "AAAA",
});

/** A library of three starters with a strip channel of two, and its page's state, edited through the routes. */
async function library(world: ScreenWorld = { night: true, seconds: 500, hour: 23, only: -1, gain: 1 }) {
  const dir = mkdtempSync(join(root, "lib-")), dist = join(dir, "dist");
  mkdirSync(dist, { recursive: true });
  writeFileSync(join(dist, "starter.json"), JSON.stringify({ clips: [starter(A, "Sneeze", 10), starter(B, "Train", 60), starter(C, "Clouds", 30)], channels: [{ name: "strip", items: [A, B] }] }));
  const lib = new VideoLibrary({ db: join(dir, "video.sqlite"), media: join(dir, "media"), tmp: join(dir, "tmp"), starters: join(dist, "starter.json") });
  const call = async (path: string, body?: unknown): Promise<ScreensState> => {
    const init = body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {};
    const r = (await screensAdmin(new Request(`http://snark.test${path}`, init), path, lib, () => world))!;
    expect(r.status).toBe(200);
    return (await r.json()) as ScreensState;
  };
  let state = await call("/admin/screens/state");
  const edit = async (body: Record<string, unknown>): Promise<ScreensState> => (state = await call("/admin/screens/edit", { revision: state.revision, ...body }));
  return { lib, state: () => state, edit };
}

test("a camera of each view sees the whole ball, upright, in the middle of the picture", () => {
  const cam = newStageCamera(), s = STAGE_SITE;
  for (const view of STAGE_VIEWS) for (const bearing of [0, 1, Math.PI, -2]) {
    stageCamera(view, bearing, 16 / 9, cam);
    const m = cam.viewProj, at = (x: number, y: number, z: number): number[] => {
      const px = x - cam.eye[0]!, py = y - cam.eye[1]!, pz = z - cam.eye[2]!, w = m[3]! * px + m[7]! * py + m[11]! * pz + m[15]!;
      return [(m[0]! * px + m[4]! * py + m[8]! * pz + m[12]!) / w, (m[1]! * px + m[5]! * py + m[9]! * pz + m[13]!) / w, w];
    };
    const middle = at(s.x, s.y + s.centre, s.z), top = at(s.x, s.y + s.centre + s.radius, s.z);
    expect(middle[2]!, view.key).toBeGreaterThan(0);
    expect(Math.abs(middle[0]!), view.key).toBeLessThan(0.01);
    expect(top[1]!, view.key).toBeGreaterThan(middle[1]!);
    expect(Math.abs(top[1]!), view.key).toBeLessThan(1);
    // Up on the screen is up in the world, near enough.
    expect(cam.up[1]!, view.key).toBeGreaterThan(0.6);
  }
});

test("the stage's shaders are the game's own orb fragment and compile", () => {
  const orb = stageOrbFragment();
  expect([...compileErrors(STAGE_VERTEX), ...compileErrors(orb), ...linkErrors(STAGE_VERTEX, orb)]).toEqual([]);
  expect([...compileErrors(STAGE_FLAT_FRAGMENT), ...linkErrors(STAGE_VERTEX, STAGE_FLAT_FRAGMENT)]).toEqual([]);
  // Without a light target its colour is as a player's screen shows it.
  expect(orb).not.toContain("#define LIGHT_TARGET");
  expect(orb).toContain("#define ORB_OCTAVES");
});

test("the shell runs from where the ground cuts the ball to its top", () => {
  const { positions, indices } = stageSphere(12, 24), low = groundLine(STAGE_SITE);
  for (let i = 0; i < positions.length; i += 3) {
    expect(Math.hypot(positions[i]!, positions[i + 1]!, positions[i + 2]!)).toBeCloseTo(1, 5);
    expect(positions[i + 1]!).toBeGreaterThanOrEqual(low - 1e-6);
  }
  expect(Math.max(...indices)).toBe(positions.length / 3 - 1);
});

test("taking a scene, a clip and a channel live sets the ball as the tiles say", async () => {
  const { state, edit } = await library(), wall = (): number => state().now + 100;
  expect([liveKey(state(), wall()), liveLook(state(), wall()).only]).toEqual(["scenes", -1]);
  await edit(takeBody({ kind: "scene", scene: 3 }));
  expect([state().screens[0]!.show, liveKey(state(), wall()), liveLook(state(), wall()).only]).toEqual(["scene:storm", "scene:storm", 3]);
  // A clip plays once over the scene held, then the ball goes back to it.
  await edit(takeBody({ kind: "clip", clip: A }));
  let look = liveLook(state(), wall());
  expect([liveKey(state(), wall()), look.clip?.id, look.only]).toEqual([`clip:${A}`, A, 3]);
  expect(look.clipSeconds).toBeCloseTo(0.1, 2);
  expect(liveKey(state(), state().now + 11_000)).toBe("scene:storm");
  // A channel replaces both, and a scene its channel.
  await edit(takeBody({ kind: "channel", name: "strip" }));
  look = liveLook(state(), wall());
  expect([state().screens[0]!.once, liveKey(state(), wall()), [A, B].includes(look.clip!.id)]).toEqual([null, "channel:strip", true]);
  await edit(takeBody({ kind: "scenes" }));
  expect([liveKey(state(), wall()), liveLook(state(), wall()).clip]).toEqual(["scenes", null]);
});

test("a channel may not be named as a scene is held", async () => {
  const { lib, state } = await library();
  const r = (await screensAdmin(new Request("http://snark.test/admin/screens/edit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ revision: state().revision, op: "channels", channels: [{ name: "scene:moon", items: [A] }] }) }), "/admin/screens/edit", lib, () => ({ night: true, seconds: 0, hour: 0, only: -1, gain: 1 })))!;
  expect(r.status).toBe(400);
});

test("the tiles are the scenes in turn, each scene, and each channel with clips to play", async () => {
  const { state, edit } = await library({ night: true, seconds: 0, hour: 23, only: 1, gain: 1 });
  await edit({ op: "hide", clip: C });
  await edit({ op: "channels", channels: [{ name: "strip", items: [A, B] }, { name: "empty", items: [C] }] });
  const tiles = stageTiles(state());
  expect(tiles.filter((t) => t.group === "scenes").map((t) => t.key)).toEqual(["scenes", "scene:watcher", "scene:moon", "scene:core", "scene:storm", "scene:tide"]);
  // The world's own setting holding a scene is said on the scenes' tile, and the scenes show it.
  expect(tiles[0]!.note).toContain("Moon");
  expect(liveLook(state(), state().now).only).toBe(1);
  expect(tiles.filter((t) => t.group === "clips").map((t) => t.key)).toEqual([`clip:${A}`, `clip:${B}`]);
  expect(tiles.filter((t) => t.group === "channels").map((t) => t.key)).toEqual(["channel:strip"]);
  for (const t of tiles) expect(targetKey(t.target)).toBe(t.key);
  // A clip's preview runs from its start and round again.
  expect(targetLook(state(), { kind: "clip", clip: B }, 61_500, state().now).clipSeconds).toBeCloseTo(1.5, 5);
});

test("the stage's frame wipes a live change and shows a tile's still", () => {
  const cam = stageCamera(STAGE_VIEWS[0]!, Math.PI, 16 / 9, newStageCamera()), live = new StageFrame();
  const scene = (only: number): StageLook => ({ only, clip: null, clipSeconds: 0, facing: true, fill: true });
  live.write(scene(0), cam, 1000, 23, 1, null, 720);
  expect([live.frame[ORB_AT + 8], live.frame[ORB_AT + 10]]).toEqual([0, 1]);
  live.write(scene(2), cam, 1001, 23, 1, null, 720);
  expect([live.frame[ORB_AT + 8], live.frame[ORB_AT + 9], live.frame[ORB_AT + 10]]).toEqual([2, 0, 0]);
  live.write(scene(2), cam, 1001 + ORB_WIPE / 2, 23, 1, null, 720);
  expect(live.frame[ORB_AT + 10]).toBeCloseTo(0.5, 5);
  // A clip comes in over the scene by the same wipe; a tile's still has none.
  const clip = { id: A, title: "Sneeze", seconds: 10, colours: "AAAA" } as StateClip;
  live.write({ ...scene(2), clip, clipSeconds: 1 }, cam, 1010, 23, 1, { width: 64, height: 36, levels: 6 }, 720);
  expect([live.frame[ORB_AT + 8], live.frame[ORB_AT + 9], live.frame[ORB_AT + 10]]).toEqual([ORB_SCREEN, 2, 0]);
  const still = new StageFrame();
  still.write({ ...scene(2), clip, clipSeconds: 1 }, cam, 1010, 23, 1, { width: 64, height: 36, levels: 6 }, 720, true);
  expect([still.frame[ORB_AT + 8], still.frame[ORB_AT + 10]]).toEqual([ORB_SCREEN, 1]);
  still.write(scene(4), cam, 1011, 23, 1, null, 720, true);
  expect([still.frame[ORB_AT + 8], still.frame[ORB_AT + 10]]).toEqual([4, 1]);
});

test("the clips' table finds by title or source and sorts by each column", () => {
  const clip = (id: string, title: string, seconds: number, bytes: number, kbps: number, rights = "public domain"): StateClip =>
    ({ id, title, seconds, bytes, kbps, rights, hidden: false, kBps: 0 }) as StateClip;
  const all = [clip("1", "Train 2", 60, 300, 400), clip("2", "Sneeze", 10, 900, 700, "Edison, train company"), clip("3", "Train 10", 30, 100, 500), clip("4", "Clouds", 20, 500, 300)];
  expect(findClips(all, "train").map((c) => c.id)).toEqual(["1", "3", "2"]);
  expect(findClips(all, "TRAIN 1").map((c) => c.id)).toEqual(["3"]);
  expect(findClips(all, "  ").length).toBe(4);
  expect(sortClips(all, "title").map((c) => c.id)).toEqual(["4", "2", "1", "3"]);
  expect(sortClips(all, "length", true).map((c) => c.id)).toEqual(["1", "3", "4", "2"]);
  expect(sortClips(all, "size").map((c) => c.id)).toEqual(["3", "1", "4", "2"]);
  expect(sortClips(all, "rate").map((c) => c.id)).toEqual(["4", "1", "3", "2"]);
  // Added keeps the library's order, even of a list found from it.
  expect(sortClips(findClips(all, "train"), "added", false, all).map((c) => c.id)).toEqual(["1", "2", "3"]);
});
