// The Screens page's tab for each type of screen: the flat monitors' maths (client/core/admin/screens-faces.ts), the
// stage's tiles and takes for a type (screens-stage.ts), the tab in the address, and the image batch's checks, poster
// colours and channel (screens.ts), with one still published through the routes as the page sends it.
import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FaceWipe, WIPE_MS, daylight, faceScene, fitPicture, ledDots, spillOf, type FlatType } from "../../client/core/admin/screens-faces.ts";
import { liveKey, liveLook, stageTiles, takeBody } from "../../client/core/admin/screens-stage.ts";
import {
  addToChannel, bandMeans, base64, channelsLeft, checkImage, draftChannels, draftDiffers, draftFault, progressOf, searchOfType, sentChannels, stillColours, timedOf,
  toSrgb, typeOfSearch, withType, type Caps, type ScreensState, type StateClip,
} from "../../client/core/admin/screens.ts";
import { VideoLibrary } from "../../server/video/library.ts";
import { screensAdmin } from "../../server/video/routes.ts";
import {
  CLIP_MAX_BYTES, CLIP_MAX_HIGH, CLIP_MAX_KBPS, CLIP_MAX_SECONDS, CLIP_MAX_WIDE, COLOUR_PARTS, COLOUR_RATE, IMAGE_MAX_BYTES, IMAGE_MAX_LONG, IMAGE_TYPES, ONCE_STILL_SECONDS,
  SCREEN_TYPES, STILL_SECONDS, type Channel,
} from "../../shared/video/clip.ts";
import { screenAt } from "../../shared/video/programme.ts";
import { buildAdmin } from "../../tools/build-admin.ts";

const root = mkdtempSync(join(tmpdir(), "snark-video-types-page-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const CAPS: Caps = {
  wide: CLIP_MAX_WIDE, high: CLIP_MAX_HIGH, kbps: CLIP_MAX_KBPS, seconds: CLIP_MAX_SECONDS, bytes: CLIP_MAX_BYTES, colourRate: COLOUR_RATE, colourParts: COLOUR_PARTS,
  imageLong: IMAGE_MAX_LONG, imageBytes: IMAGE_MAX_BYTES, imageTypes: IMAGE_TYPES, still: STILL_SECONDS, stillMin: 2, stillMax: 120,
};
const FLAT: readonly FlatType[] = ["billboard", "tv", "laptop"];

const be32 = (n: number): number[] => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
/** A PNG's header alone, which is all the page and the server read of it. */
const png = (w: number, h: number): Uint8Array => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...be32(13), 0x49, 0x48, 0x44, 0x52, ...be32(w), ...be32(h), 8, 2, 0, 0, 0]);

test("each flat monitor shows its face whole, at the type's own shape, on any canvas", () => {
  for (const type of FLAT) {
    for (const aspect of [16 / 9, 16 / 10, 1]) {
      const { face } = faceScene(type, aspect, 12);
      expect([face.x0, face.y0]).toEqual([expect.any(Number), expect.any(Number)]);
      for (const v of [face.x0, face.x1, face.y0, face.y1]) expect(Math.abs(v)).toBeLessThanOrEqual(1);
      // Clip space is as wide as it is high, so the face's shape in pixels takes the canvas's.
      expect(((face.x1 - face.x0) * aspect) / (face.y1 - face.y0)).toBeCloseTo(SCREEN_TYPES[type].aspect, 3);
    }
  }
  // The monitor gives the face most of its width.
  for (const type of FLAT) {
    const { face } = faceScene(type, 16 / 9, 12);
    expect((face.x1 - face.x0) / 2).toBeGreaterThan(0.4);
  }
});

test("only a billboard is LEDs, and a face lights its setting more by night", () => {
  expect(FLAT.map((t) => faceScene(t, 16 / 9, 12).led)).toEqual([true, false, false]);
  expect([daylight(12), daylight(0)]).toEqual([1, 0]);
  for (const type of FLAT) expect(faceScene(type, 16 / 9, 23).glow).toBeGreaterThan(faceScene(type, 16 / 9, 12).glow * 3);
  // The sky behind the billboard is the ball's own by the hour; a room is dimmer at night.
  expect(faceScene("billboard", 16 / 9, 0).back.top[2]!).toBeLessThan(0.1);
  expect(faceScene("tv", 16 / 9, 0).back.top[0]!).toBeLessThan(faceScene("tv", 16 / 9, 12).back.top[0]! / 3);
});

test("a picture fills a face cropped or fits it whole with bars", () => {
  const billboard = SCREEN_TYPES.billboard.aspect, wide = 16 / 9;
  // A 16:9 clip filling a billboard keeps its full width and the middle of its height.
  const fill = fitPicture(wide, billboard, true);
  expect([fill.sx, fill.ox]).toEqual([1, 0]);
  expect(fill.sy).toBeCloseTo(wide / billboard, 9);
  expect(fill.oy + fill.sy / 2).toBeCloseTo(0.5, 9);
  // Fitted, it runs past the picture's sides, which the face shows dark.
  const fit = fitPicture(wide, billboard, false);
  expect([fit.sy, fit.oy]).toEqual([1, 0]);
  expect(fit.sx).toBeCloseTo(billboard / wide, 9);
  expect(fit.ox).toBeLessThan(0);
  // A billboard ad on a TV, the other way round.
  const onTv = fitPicture(billboard, wide, true);
  expect([onTv.sy, onTv.sx]).toEqual([1, wide / billboard]);
  expect(fitPicture(wide, wide, true)).toEqual({ sx: 1, sy: 1, ox: 0, oy: 0 });
});

test("an LED face has a dot grid only where its dots can be seen", () => {
  expect(ledDots(520, 170)).toEqual([130, 43]);
  expect(ledDots(2000, 655)).toEqual([200, 66]);
  expect(ledDots(170, 56)).toEqual([0, 0]);
});

test("a new item wipes down the face from the top; a tile shows it at once", () => {
  const wipe = new FaceWipe();
  expect(wipe.at("a", 1000)).toBe(1);
  expect(wipe.at("b", 2000)).toBe(0);
  expect(wipe.at("b", 2000 + WIPE_MS / 2)).toBeCloseTo(0.5, 9);
  expect(wipe.at("b", 2000 + WIPE_MS * 2)).toBe(1);
  expect(wipe.at("c", 9000, true)).toBe(1);
});

const item = (id: string, kind: "clip" | "image", types: StateClip["types"], seconds = 0): StateClip => ({
  id, title: id, file: `/media/${id}.x`, poster: `/media/${id}.jpg`, width: 1260, height: 413, seconds, bytes: 1000, audio: false, rights: "test", starter: false,
  colours: base64(new Uint8Array(COLOUR_PARTS * 3).fill(kind === "image" ? 200 : 40)), kind, types, hidden: false, kbps: 0, kBps: 0,
});

/** A state with a clip on every type, two stills for billboards, a billboard channel live and the ball on its scenes. */
function state(now: number): ScreensState {
  const channels: Channel[] = [
    { name: "strip", items: ["c1"], shuffle: false, epoch: 0 },
    { name: "roadside", items: ["i1", "i2", "c1"], shuffle: false, epoch: now - 3000, type: "billboard", still: 5 },
  ];
  const screens = (["orb", "billboard", "tv", "laptop"] as const).map((screen) => ({
    screen, show: screen === "billboard" ? "roadside" : "scenes", once: null, mode: "facing" as const, fill: true, sound: false, night: false, playing: null,
  }));
  return {
    revision: 1, now, night: false, world: { night: false, seconds: 100, hour: 12, only: -1, gain: 1 }, manifest: { id: "m", path: "/m" }, caps: CAPS,
    clips: [item("c1", "clip", ["orb", "billboard", "tv", "laptop"], 20), item("i1", "image", ["billboard"]), item("i2", "image", ["billboard", "tv"])],
    channels, screens, pending: [],
  };
}

test("a flat type's live monitor is its channel at offset 0, and its tiles are its own", () => {
  const now = 1_000_000, st = state(now);
  const look = liveLook(st, now, "billboard");
  expect([look.clip?.id, look.clipSeconds, look.fill]).toEqual(["i1", 3, true]);
  const billboard = st.screens[1]!;
  expect(screenAt(billboard, new Map(st.channels.map((c) => [c.name, c])), timedOf(st.clips), now, false)?.clip).toBe("i1");
  // An image holds its channel's still, here 5 s, so the second follows.
  expect(liveLook(st, now + 2500, "billboard").clip?.id).toBe("i2");
  expect(liveKey(st, now, "billboard")).toBe("channel:roadside");
  // The TVs are dark; the ball keeps its scenes.
  expect([liveLook(st, now, "tv").clip, liveKey(st, now, "tv")]).toEqual([null, "scenes"]);
  const tiles = stageTiles(st, "tv");
  expect(tiles.map((t) => t.key)).toEqual(["scenes", "clip:c1", "clip:i2"]);
  expect([tiles[0]!.title, tiles[0]!.group]).toEqual(["Dark", "channels"]);
  const boards = stageTiles(st, "billboard");
  expect(boards.find((t) => t.key === "channel:roadside")?.note).toBe("1 clip and 2 images, in order, round and round");
  expect(stageTiles(st, "orb").filter((t) => t.group === "scenes").length).toBe(6);
  expect(stageTiles(st, "orb").some((t) => t.key === "channel:roadside")).toBe(false);
  expect(takeBody({ kind: "channel", name: "roadside" }, "billboard")).toEqual({ op: "take", screen: "billboard", show: "roadside" });
  expect(takeBody({ kind: "clip", clip: "i2" }, "tv")).toEqual({ op: "take", screen: "tv", clip: "i2" });
  expect(takeBody({ kind: "scenes" }, "laptop")).toEqual({ op: "take", screen: "laptop", show: "scenes" });
});

test("a still played once is live for its once length, and its progress counts that", () => {
  const now = 1_000_000, st = state(now);
  const tv = { ...st.screens[2]!, once: { clip: "i2", from: now - 1000 } };
  const shown = { ...st, screens: st.screens.map((s) => (s.screen === "tv" ? tv : s)) };
  expect(liveKey(shown, now, "tv")).toBe("clip:i2");
  expect(liveKey(shown, now + ONCE_STILL_SECONDS * 1000, "tv")).toBe("scenes");
  const timed = timedOf(st.clips), roadside = st.channels[1]!;
  expect(progressOf({ clip: "i2", start: now - 3000, next: null }, timed, now)).toEqual({ at: 3, of: ONCE_STILL_SECONDS, share: 3 / ONCE_STILL_SECONDS });
  expect(progressOf({ clip: "i1", start: now - 1000, next: null }, timed, now, roadside).of).toBe(5);
  // The light it throws is its one colour sample.
  expect(spillOf(st.clips[1]!, 99, new Map())).toEqual([200 / 255, 200 / 255, 200 / 255]);
});

test("the tab comes from the address and goes back into it", () => {
  expect(typeOfSearch("?type=billboard")).toBe("billboard");
  expect(typeOfSearch("?world=a&type=tv")).toBe("tv");
  expect([typeOfSearch(""), typeOfSearch("?type=cinema"), typeOfSearch("?type=%E0")]).toEqual(["orb", "orb", "orb"]);
  expect(searchOfType("", "laptop")).toBe("?type=laptop");
  expect(searchOfType("?world=a%20b&type=tv", "billboard")).toBe("?world=a%20b&type=billboard");
  expect(searchOfType("?type=tv", "orb")).toBe("");
});

test("an image is checked against the caps before it is sent, saying why it may not go", () => {
  expect(checkImage("ad.png", "image/png", png(1260, 413), CAPS)).toEqual({ type: "png", width: 1260, height: 413 });
  // The header decides the type, whatever the browser guessed from the name.
  expect(checkImage("ad.jpg", "image/jpeg", png(640, 360), CAPS)).toEqual({ type: "png", width: 640, height: 360 });
  expect(checkImage("big.png", "image/png", png(1920, 1080), CAPS)).toEqual(["big.png: The picture is 1920×1080, over 1280 on its long side."]);
  expect(checkImage("anim.gif", "image/gif", png(10, 10), CAPS)).toEqual(["anim.gif is image/gif; a still is a PNG, JPEG or WebP."]);
  const heavy = new Uint8Array(IMAGE_MAX_BYTES + 1);
  heavy.set(png(100, 100));
  expect(checkImage("heavy.png", "image/png", heavy, CAPS)).toEqual(["heavy.png is 1 MB; a still is 1 MB at most."]);
  expect(checkImage("notes.png", "", new Uint8Array([1, 2, 3]), CAPS)).toEqual(["notes.png: This is not a PNG, JPEG or WebP image."]);
});

test("a still's colour track is one sample of its mean and edge bands", () => {
  const w = 16, h = 8, rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) rgba.set(i % w < 8 ? [255, 0, 0, 255] : [0, 0, 255, 255], i * 4);
  const track = stillColours(rgba, w, h), means = bandMeans(rgba, w, h);
  expect(track.length).toBe(COLOUR_PARTS * 3);
  expect([...track]).toEqual([...means].map(toSrgb));
  // Left is red, right is blue.
  expect([...track.slice(12, 15)]).toEqual([255, 0, 0]);
  expect([...track.slice(6, 9)]).toEqual([0, 0, 255]);
});

test("a channel draft keeps each channel's type and image seconds", () => {
  const now = 1_000_000, st = state(now), draft = draftChannels(st.channels);
  expect(draft.map((d) => [d.type, d.still])).toEqual([["orb", undefined], ["billboard", 5]]);
  expect(draftDiffers(draft, st.channels)).toBe(false);
  expect(sentChannels(draft)[1]).toEqual({ name: "roadside", items: ["i1", "i2", "c1"], shuffle: false, reset: false, type: "billboard", still: 5 });
  draft[1]!.still = 9;
  expect(draftDiffers(draft, st.channels)).toBe(true);
  draft[1]!.still = 500;
  expect(draftFault(draft)).toBe("Channel roadside holds each image 2 to 120 seconds.");
});

test("new stills join a channel of the tab's type, new or old, each once", () => {
  const st = state(1_000_000), draft = draftChannels(st.channels);
  expect(addToChannel(draft, "roadside", ["i2", "i3"], "billboard")).toBe("");
  expect(draft[1]!.items).toEqual(["i1", "i2", "c1", "i3"]);
  expect(addToChannel(draft, "Lobby", ["i2"], "tv", 12)).toBe("");
  expect(draft[2]).toEqual({ name: "Lobby", items: ["i2"], shuffle: false, reset: false, type: "tv", still: 12 });
  expect(addToChannel(draft, "strip", ["i2"], "tv")).toBe("The channel strip is for the Vegas ball.");
});

test("an item's types change by tick, never to none, and say which channels it leaves", () => {
  expect(withType(["billboard"], "tv", true)).toEqual(["billboard", "tv"]);
  expect(withType(["orb", "billboard"], "orb", false)).toEqual(["billboard"]);
  expect(withType(["laptop"], "laptop", false)).toContain("one type of screen at least");
  const st = state(1_000_000);
  expect(channelsLeft(st.channels, "c1", "billboard")).toEqual(["roadside"]);
  expect(channelsLeft(st.channels, "c1", "tv")).toEqual([]);
});

test("a still the page checked and coloured is published for the types ticked", async () => {
  const dir = join(root, "lib");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "starter.json"), JSON.stringify({ clips: [] }));
  const lib = new VideoLibrary({ db: join(dir, "video.sqlite"), media: join(dir, "media"), tmp: join(dir, "tmp"), starters: join(dir, "starter.json") });
  const world = { night: false, seconds: 0, hour: 12, only: -1, gain: 1 };
  const call = async (path: string, init: RequestInit = {}, query = ""): Promise<Response> => (await screensAdmin(new Request(`http://snark.test${path}${query}`, init), path, lib, () => world))!;
  const post = (path: string, body: unknown): Promise<Response> => call(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const bytes = png(1260, 413);
  expect(checkImage("ad.png", "image/png", bytes, CAPS)).not.toBeArray();
  const up = (await (await call("/admin/screens/image", { method: "POST", headers: { "content-length": String(bytes.length) }, body: bytes }, "?name=Ad")).json()) as { id: string };
  const poster = base64(Uint8Array.from([0xff, 0xd8, 1, 2, 0xff, 0xd9])), colours = base64(stillColours(new Uint8Array(4 * 4 * 4).fill(128), 4, 4));
  expect((await post("/admin/screens/clip", { id: up.id, title: "Ad", rights: "made for the test", poster, colours, types: ["billboard", "tv"] })).status).toBe(200);
  let st = (await (await call("/admin/screens/state")).json()) as ScreensState;
  expect(st.clips.map((c) => [c.kind, c.types])).toEqual([["image", ["billboard", "tv"]]]);
  // Into a new billboard channel as the batch does, then shown on the billboards.
  const draft = draftChannels(st.channels);
  expect(addToChannel(draft, "Roadside", [up.id], "billboard", 6)).toBe("");
  expect((await post("/admin/screens/edit", { revision: st.revision, op: "channels", channels: sentChannels(draft) })).status).toBe(200);
  st = (await (await post("/admin/screens/edit", { revision: st.revision + 1, ...takeBody({ kind: "channel", name: "Roadside" }, "billboard") })).json()) as ScreensState;
  expect(liveLook(st, st.now, "billboard").clip?.id).toBe(up.id);
  expect(st.screens.find((s) => s.screen === "billboard")?.playing?.clip).toBe(up.id);
  lib.close();
});

test("the admin build makes the page with its tabs, its image drop and its monitors", async () => {
  const dist = join(root, "dist");
  await buildAdmin(dist);
  for (const f of ["screens.html", "screens.js", "screens-stage.js"]) expect(existsSync(join(dist, "admin", f))).toBe(true);
  const page = readFileSync(join(dist, "admin/screens.html"), "utf8");
  for (const type of ["billboard", "tv", "laptop"]) expect(page).toContain(`href="?type=${type}"`);
  expect(page).toContain('id="still-channel"');
  expect(page).toMatch(/<input id="file" type="file" accept="[^"]*image\/png[^"]*" multiple/);
  // The stage's bundle carries the flat faces' shader.
  expect(readFileSync(join(dist, "admin/screens-stage.js"), "utf8")).toContain("uDots");
});
