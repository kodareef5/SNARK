// The Screens page's light poll: GET /admin/screens/live (server/video/routes.ts) and what the page does with its answer
// (client/core/admin/screens.ts liveStep, withLive).
import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { liveStep, withLive, type ScreensLive, type ScreensState } from "../../client/core/admin/screens.ts";
import { frontPasses } from "../../server/front.ts";
import { VideoLibrary } from "../../server/video/library.ts";
import { SCREEN_PATHS, SCREEN_POSTS, screensAdmin } from "../../server/video/routes.ts";
import { COLOUR_PARTS, COLOUR_RATE, type Clip } from "../../shared/video/clip.ts";

const root = mkdtempSync(join(tmpdir(), "snark-video-live-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const NIGHT = { night: true, seconds: 1000, hour: 23, only: -1, gain: 1 };
const LONG = "a1a1a1a1a1a1a1a1", AD = "d4d4d4d4d4d4d4d4";
/** A 30-minute starter, whose colour track is 144 KB of base64. */
const long: Clip = {
  id: LONG, title: "long", file: `/media/long.${LONG}.mp4`, poster: `/media/long.${LONG}.jpg`, width: 640, height: 360, seconds: 1800, bytes: 1800 * 75_000,
  audio: false, rights: "public domain", starter: true, colours: Buffer.alloc(1800 * COLOUR_RATE * COLOUR_PARTS * 3, 9).toString("base64"),
};
const ad: Clip = { ...long, id: AD, title: "ad", file: `/media/ad.${AD}.png`, seconds: 0, kind: "image", types: ["billboard"], colours: "" };

function library(): VideoLibrary {
  const dir = join(root, "lib");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "starter.json"), JSON.stringify({ clips: [long, ad], channels: [{ name: "strip", items: [LONG] }, { name: "roadside", type: "billboard", items: [AD] }] }));
  return new VideoLibrary({ db: join(dir, "video.sqlite"), media: join(dir, "media"), tmp: join(dir, "tmp"), starters: join(dir, "starter.json") });
}

test("the live answer has the clocks and what each screen plays, without the items", async () => {
  const lib = library();
  const call = async (path: string, method = "GET"): Promise<Response> => (await screensAdmin(new Request(`http://snark.test${path}`, { method }), path, lib, () => NIGHT))!;
  const stateText = await (await call("/admin/screens/state")).text(), liveText = await (await call("/admin/screens/live")).text();
  const state = JSON.parse(stateText) as ScreensState, live = JSON.parse(liveText) as ScreensLive;
  expect(Object.keys(live).sort()).toEqual(["manifest", "night", "now", "pending", "revision", "screens", "world"]);
  expect(live).toMatchObject({ revision: state.revision, night: true, world: NIGHT, manifest: state.manifest.id, pending: [] });
  // Both answers are worked out at their own wall time; the records and what plays agree.
  expect(live.screens.map((s) => [s.screen, s.show, s.playing?.clip ?? null])).toEqual(state.screens.map((s) => [s.screen, s.show, s.playing?.clip ?? null]));
  expect(live.screens.map((s) => s.playing?.clip ?? null)).toEqual([LONG, AD, null, null]);
  expect(stateText.length).toBeGreaterThan(144_000);
  expect(liveText.length).toBeLessThan(2_000);
  expect((await call("/admin/screens/live", "POST")).status).toBe(405);
  lib.close();
});

test("the live path is a screen path the front passes as a read, not a post", () => {
  expect((SCREEN_PATHS as readonly string[]).includes("/admin/screens/live")).toBe(true);
  expect(SCREEN_POSTS).not.toContain("/admin/screens/live");
  expect(SCREEN_POSTS).not.toContain("/admin/screens/state");
  expect(SCREEN_POSTS).toContain("/admin/screens/edit");
  expect([frontPasses("GET", "/admin/screens/live"), frontPasses("POST", "/admin/screens/live")]).toEqual([true, false]);
});

test("the page reads the whole state only when the library or its uploads moved on", () => {
  const screen = { screen: "orb", show: "strip", once: null, mode: "facing", fill: true, sound: false, night: false, playing: null } as const;
  const state = {
    revision: 4, now: 1_000, night: false, world: { night: false, seconds: 10, hour: 12, only: -1, gain: 1 }, manifest: { id: "m1", path: "/media/video.m1.json" },
    caps: {}, clips: [{ id: LONG }], channels: [{ name: "strip" }], screens: [screen], pending: [{ id: "p1" }],
  } as unknown as ScreensState;
  const live: ScreensLive = { revision: 4, now: 6_000, night: true, world: { night: true, seconds: 15, hour: 19, only: -1, gain: 0.5 }, manifest: "m1", pending: ["p1"], screens: [{ ...screen, show: "scenes" }] };
  expect(liveStep(state, live)).toBe("merge");
  expect(liveStep(state, { ...live, revision: 5 })).toBe("state");
  expect(liveStep(state, { ...live, revision: 3 })).toBe("drop");
  expect(liveStep(state, { ...live, manifest: "m2" })).toBe("state");
  expect(liveStep(state, { ...live, pending: [] })).toBe("state");
  expect(liveStep(state, { ...live, pending: ["p1", "p2"] })).toBe("state");
  const merged = withLive(state, live);
  expect(merged).toEqual({ ...state, now: 6_000, night: true, world: live.world, screens: live.screens });
  expect([merged.clips, merged.channels]).toEqual([state.clips, state.channels]);
});
