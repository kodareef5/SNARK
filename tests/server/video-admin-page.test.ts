// The Screens admin page (client/admin/screens.ts): its parts that need no browser (client/core/admin/screens.ts), its
// place in the admin navigation and build, and what it sends the routes (server/video/routes.ts).
import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cluster, resolveAdmin } from "../../client/core/admin/navigation.ts";
import {
  ColourTrack, bandMeans, base64, draftChannels, draftDiffers, draftFault, ffmpegLine, fitLong, freeChannelName, moveIn, overCaps, progressOf, timedOf, toLinear,
  toSrgb, type Caps, type ScreensState,
} from "../../client/core/admin/screens.ts";
import { adminSite } from "../../server/admin/site.ts";
import { VideoLibrary } from "../../server/video/library.ts";
import { screensAdmin } from "../../server/video/routes.ts";
import { CLIP_MAX_BYTES, CLIP_MAX_HIGH, CLIP_MAX_KBPS, CLIP_MAX_SECONDS, CLIP_MAX_WIDE, COLOUR_PARTS, COLOUR_RATE, type Clip } from "../../shared/video/clip.ts";
import { screenAt } from "../../shared/video/programme.ts";
import { buildAdmin } from "../../tools/build-admin.ts";

/** A world at night with no scene held, as the routes ask of it. */
const NIGHT = { night: true, seconds: 1000, hour: 23, only: -1, gain: 1 };

const root = mkdtempSync(join(tmpdir(), "snark-video-page-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const CAPS: Caps = { wide: CLIP_MAX_WIDE, high: CLIP_MAX_HIGH, kbps: CLIP_MAX_KBPS, seconds: CLIP_MAX_SECONDS, bytes: CLIP_MAX_BYTES, colourRate: COLOUR_RATE, colourParts: COLOUR_PARTS };

/** An RGBA frame of `width`×`height` coloured by `paint(x, y)`. */
function frame(width: number, height: number, paint: (x: number, y: number) => [number, number, number]): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) out.set([...paint(x, y), 255], (y * width + x) * 4);
  return out;
}
const bytesOf = (linear: Float64Array, part: number): number[] => [0, 1, 2].map((c) => toSrgb(linear[part * 3 + c]!));

test("sRGB bytes go to linear light and back unchanged", () => {
  for (let b = 0; b < 256; b++) expect(toSrgb(toLinear(b))).toBe(b);
  expect([toLinear(0), toLinear(255)]).toEqual([0, 1]);
});

test("a frame's mean averages in linear light, and each band is an eighth", () => {
  // Half black, half white: the mean is half the light, which sRGB writes as 188, not 128.
  const half = bandMeans(frame(32, 18, (x) => (x < 16 ? [0, 0, 0] : [255, 255, 255])), 32, 18);
  expect(bytesOf(half, 0)).toEqual([188, 188, 188]);
  expect([bytesOf(half, 2), bytesOf(half, 4)]).toEqual([[255, 255, 255], [0, 0, 0]]);
  // Red along the top two rows and green along the bottom two (18 / 8 rounds to 2); blue down the left four columns (32 / 8) between.
  const edges = bandMeans(frame(32, 18, (x, y) => (y < 2 ? [255, 0, 0] : y >= 16 ? [0, 255, 0] : x < 4 ? [0, 0, 255] : [255, 255, 255])), 32, 18);
  expect([bytesOf(edges, 1), bytesOf(edges, 3)]).toEqual([[255, 0, 0], [0, 255, 0]]);
  expect(edges[4 * 3 + 2]).toBeCloseTo(14 / 18, 9);
  // The right band crosses the red and green rows: 16 of its 18 rows have red light, 16 green, 14 blue.
  expect(bytesOf(edges, 2)).toEqual([toSrgb(16 / 18), toSrgb(16 / 18), toSrgb(14 / 18)]);
});

test("the colour track buckets frames by media time and eases over gaps", () => {
  const black = new Float64Array(COLOUR_PARTS * 3), white = new Float64Array(COLOUR_PARTS * 3).fill(1);
  const track = new ColourTrack(4);
  track.add(0.01, black);
  track.add(0.2, white);
  track.add(1.0, white);
  // Sample 0 holds a black and a white frame: half the light. Samples 1 to 3 had none: eased from it to sample 4.
  const out = track.finish(6);
  expect(out.length).toBe(6 * COLOUR_PARTS * 3);
  const at = (i: number): number => out[i * COLOUR_PARTS * 3]!;
  expect([at(0), at(4), at(5)]).toEqual([toSrgb(0.5), 255, 255]);
  expect([at(1), at(2), at(3)]).toEqual([toSrgb(0.625), toSrgb(0.75), toSrgb(0.875)]);
  expect(track.filled).toBe(2);
  // A frame past the last sample is left out, a gap before the first copies it, and an empty track is black.
  const late = new ColourTrack(4);
  late.add(0.6, white);
  late.add(9, black);
  expect([...late.finish(3)].every((b) => b === 255)).toBe(true);
  expect([...new ColourTrack(4).finish(2)].every((b) => b === 0)).toBe(true);
});

test("a file over the caps is told each way it is over", () => {
  expect(overCaps({ width: 640, height: 360, seconds: 60, bytes: 5_000_000 }, CAPS)).toEqual([]);
  expect(overCaps({ width: 480, height: 854, seconds: 12, bytes: 1_000_000 }, CAPS)).toEqual([]);
  expect(overCaps({ width: 1920, height: 1080, seconds: 60, bytes: 30_000_000 }, CAPS)).toEqual([
    "It is 1920×1080; the longer side may be 854 px and the shorter 480 px.",
    "It runs at about 4000 kbit/s; a clip is 1500 kbit/s at most.",
  ]);
  expect(overCaps({ width: 640, height: 360, seconds: 7200, bytes: 300 * 1048576 }, CAPS)).toEqual([
    "It runs 2:00:00; a clip is 30 min at most.",
    "It is 300 MB; a clip is 200 MB at most.",
  ]);
  expect(overCaps({ width: 0, height: 0, seconds: 0, bytes: 10 }, CAPS)).toEqual(["The browser found no picture in it."]);
});

test("the ffmpeg line scales into the box on the clip's own orientation", () => {
  const wide = ffmpegLine("in.mov", { width: 1920, height: 1080, seconds: 60, bytes: 30_000_000 }, CAPS);
  expect(wide).toBe(
    `ffmpeg -i in.mov -vf "scale='min(854,iw)':'min(480,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2" -c:v libx264 -profile:v main ` +
      "-pix_fmt yuv420p -b:v 1200k -maxrate 1500k -bufsize 3000k -c:a aac -b:a 96k -movflags +faststart in-small.mp4",
  );
  expect(ffmpegLine("tall.mp4", { width: 1080, height: 1920, seconds: 12, bytes: 9_000_000 }, CAPS)).toContain("scale='min(480,iw)':'min(854,ih)'");
});

test("the ffmpeg line keeps a long clip under the size cap and cuts it at the length cap", () => {
  const line = ffmpegLine("Bob's film.mp4", { width: 640, height: 360, seconds: 3 * 3600, bytes: 900 * 1048576 }, CAPS);
  // 200 MB over 30 minutes is 932 kbit/s, 838 once a tenth is kept back; the picture takes four fifths of that.
  expect(line).toContain("-b:v 650k -maxrate 838k");
  expect(line).toContain(`-t ${CLIP_MAX_SECONDS}`);
  expect(line).toStartWith(`ffmpeg -i 'Bob'\\''s film.mp4' `);
  expect(line).toEndWith(`'Bob'\\''s film-small.mp4'`);
});

test("posters and samples keep the picture's shape at their long side", () => {
  expect([fitLong(640, 360, 320), fitLong(1080, 1920, 32), fitLong(200, 100, 320)]).toEqual([{ width: 320, height: 180 }, { width: 18, height: 32 }, { width: 200, height: 100 }]);
});

test("base64 matches the server's reading for every tail length", () => {
  for (let n = 0; n < 8; n++) {
    const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 97 + 13) & 255);
    expect(base64(bytes)).toBe(Buffer.from(bytes).toString("base64"));
  }
});

test("a channel draft knows when it differs and what is wrong with it", () => {
  const saved = [{ name: "strip", items: ["a", "b", "c"], shuffle: false, epoch: 1 }];
  const draft = draftChannels(saved);
  expect(draftDiffers(draft, saved)).toBe(false);
  moveIn(draft[0]!.items, 2, -1);
  expect(draft[0]!.items).toEqual(["a", "c", "b"]);
  moveIn(draft[0]!.items, 0, -1);
  expect([draft[0]!.items, draftDiffers(draft, saved)]).toEqual([["a", "c", "b"], true]);
  expect(draftDiffers([{ ...draftChannels(saved)[0]!, reset: true }], saved)).toBe(true);
  const two = [...draft, { name: freeChannelName(draft), items: [], shuffle: true, reset: false, type: "orb" as const }];
  expect([two[1]!.name, freeChannelName(two), draftFault(two)]).toEqual(["New channel", "New channel 2", ""]);
  expect(draftFault([...two, { ...two[0]! }])).toBe("Two channels are named strip.");
  expect(draftFault([{ ...two[0]!, name: "scenes" }])).toBe('A channel may not be named "scenes".');
  expect(draftFault([{ ...two[0]!, name: "" }])).toContain("1 to 40 letters");
});

test("the time bar runs from the clip's start to its length", () => {
  const timed = new Map([["a", { id: "a", seconds: 120 }]]);
  expect(progressOf({ clip: "a", start: 1000, next: null }, timed, 61_000)).toEqual({ at: 60, of: 120, share: 0.5 });
  expect(progressOf({ clip: "a", start: 1000, next: null }, timed, 900_000).share).toBe(1);
});

test("the cluster nav lists Screens, which opens at /admin/screens/", () => {
  expect(cluster.map(([slug]) => slug)).toContain("screens");
  const at = resolveAdmin("https://snark.test/admin/screens/", [], (href, base) => new URL(href, base));
  expect([at.view, at.title, at.world]).toEqual(["screens", "Screens", null]);
});

test("the admin build makes the page and its script, which the site serves", async () => {
  const dist = join(root, "dist");
  await buildAdmin(dist);
  for (const f of ["screens.html", "screens.js", "screens-stage.js"]) expect(existsSync(join(dist, "admin", f))).toBe(true);
  expect(readFileSync(join(dist, "admin/screens.html"), "utf8")).toContain('src="/admin/ui/screens.js"');
  const site = {
    dir: dist, base: "", port: 0, id: "local" as const, who: "test", destinations: () => [], scenes: () => new Response(null),
    gate: { dev: true, password: null, guesses: null as never, tick: () => 0 },
  };
  const get = async (path: string): Promise<Response> => (await adminSite(new Request(`http://snark.test${path}`), new URL(`http://snark.test${path}`), site))!;
  const script = await get("/admin/ui/screens.js");
  expect([script.status, (await script.text()).length > 1000]).toEqual([200, true]);
  const page = await get("/admin/screens/");
  expect([page.status, (await page.text()).includes('id="preview"')]).toEqual([200, true]);
});

const starter = (id: string, seconds: number): Clip => ({
  id, title: id, file: `/media/${id}.${id}.mp4`, poster: `/media/${id}.${id}.jpg`, width: 640, height: 360, seconds, bytes: seconds * 75_000,
  audio: false, rights: "public domain", starter: true, colours: "",
});

test("an upload the page publishes passes, and the page's programme is the server's", async () => {
  const dir = join(root, "lib"), dist = join(dir, "dist");
  mkdirSync(dist, { recursive: true });
  writeFileSync(join(dist, "starter.json"), JSON.stringify({ clips: [starter("a1a1a1a1a1a1a1a1", 6), starter("b2b2b2b2b2b2b2b2", 120)], channels: [{ name: "strip", items: ["a1a1a1a1a1a1a1a1", "b2b2b2b2b2b2b2b2"] }] }));
  const lib = new VideoLibrary({ db: join(dir, "video.sqlite"), media: join(dir, "media"), tmp: join(dir, "tmp"), starters: join(dist, "starter.json") });
  const call = async (path: string, init: RequestInit = {}, query = ""): Promise<Response> => (await screensAdmin(new Request(`http://snark.test${path}${query}`, init), path, lib, () => NIGHT))!;
  const post = (path: string, body: unknown): Promise<Response> => call(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const bytes = new Uint8Array(readFileSync(join(import.meta.dir, "../fixtures/video/small.mp4")));
  const up = (await (await call("/admin/screens/upload", { method: "POST", headers: { "content-length": String(bytes.length) }, body: bytes }, "?name=Card")).json()) as { id: string; seconds: number };
  // As the page does: a track as long as the server read the clip, of frames it saw only some of.
  const track = new ColourTrack(COLOUR_RATE);
  track.add(0, new Float64Array(COLOUR_PARTS * 3).fill(0.2));
  const samples = Math.max(1, Math.round(up.seconds * COLOUR_RATE));
  const poster = base64(Uint8Array.from([0xff, 0xd8, 1, 2, 0xff, 0xd9]));
  expect((await post("/admin/screens/clip", { id: up.id, title: "Card", rights: "made for the test", poster, colours: base64(track.finish(samples)) })).status).toBe(200);
  const state = (await (await call("/admin/screens/state")).json()) as ScreensState;
  expect((await post("/admin/screens/edit", { revision: state.revision, op: "hide", clip: "b2b2b2b2b2b2b2b2" })).status).toBe(200);
  const shown = (await (await post("/admin/screens/edit", { revision: state.revision + 1, op: "screen", screen: "orb", show: "strip" })).json()) as ScreensState;
  // The hidden starter drops out of the page's timings as it does the server's.
  const orb = shown.screens[0]!, channels = new Map(shown.channels.map((c) => [c.name, c]));
  expect(timedOf(shown.clips).has("b2b2b2b2b2b2b2b2")).toBe(false);
  expect(screenAt(orb, channels, timedOf(shown.clips), shown.now, shown.night)).toEqual(orb.playing);
  expect(orb.playing?.clip).toBe("a1a1a1a1a1a1a1a1");
  expect((await post("/admin/screens/edit", { revision: state.revision, op: "stop", screen: "orb" })).status).toBe(409);
  lib.close();
});

