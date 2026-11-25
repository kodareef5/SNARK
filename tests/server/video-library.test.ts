// A cluster's video library (server/video/library.ts), its admin API (server/video/routes.ts, upload.ts), and how its
// media is served by a world and by the front.
import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fromDisk, startFront } from "../../server/front.ts";
import { startServer } from "../../server/main.ts";
import { loadConfig } from "../../server/settings/config.ts";
import { splitPack } from "../../tools/pack/split.ts";
import { corePackBytes } from "../fixtures/pack.ts";
import { VideoLibrary, slugOf, type LibraryView } from "../../server/video/library.ts";
import { screensAdmin } from "../../server/video/routes.ts";
import { CLIP_MAX_BYTES, COLOUR_PARTS, COLOUR_RATE, type Clip } from "../../shared/video/clip.ts";
import { chunkOffsets, probeMp4, type Mp4Info } from "../../shared/video/mp4.ts";

const root = mkdtempSync(join(tmpdir(), "snark-video-lib-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
let made = 0;

const fixture = (name: string): Uint8Array => new Uint8Array(readFileSync(join(import.meta.dir, "../fixtures/video", name)));

const starter = (id: string, seconds: number): Clip => ({
  id, title: id, file: `/media/${id}.${id}.mp4`, poster: `/media/${id}.${id}.jpg`, width: 640, height: 360, seconds, bytes: seconds * 75_000,
  audio: false, rights: "public domain", starter: true, colours: "",
});
const SNEEZE = "a1a1a1a1a1a1a1a1", TRAIN = "b2b2b2b2b2b2b2b2", BOLT = "c3c3c3c3c3c3c3c3";

/** A library in a folder of its own, with a built client's starter list beside it. */
function library(now: () => number = Date.now): { lib: VideoLibrary; dir: string } {
  const dir = join(root, `lib${++made}`), dist = join(dir, "dist", "media");
  mkdirSync(dist, { recursive: true });
  writeFileSync(join(dist, "starter.json"), JSON.stringify({ clips: [starter(SNEEZE, 6), starter(TRAIN, 120), starter(BOLT, 30)], strip: [SNEEZE, TRAIN, "ffffffffffffffff"] }));
  const lib = new VideoLibrary({ db: join(dir, "video.sqlite"), media: join(dir, "media"), tmp: join(dir, "tmp"), starters: join(dist, "starter.json"), now });
  return { lib, dir };
}

const call = (lib: VideoLibrary, path: string, init: RequestInit = {}, query = ""): Promise<Response> =>
  Promise.resolve(screensAdmin(new Request(`http://snark.test${path}${query}`, init), path, lib, () => ({ night: false, seconds: 0, hour: 12, only: -1, gain: 1 }))!);
const json = (body: unknown): RequestInit => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const edit = (lib: VideoLibrary, body: Record<string, unknown>): Promise<Response> => call(lib, "/admin/screens/edit", json({ revision: lib.view().revision, ...body }));
const upload = (lib: VideoLibrary, bytes: Uint8Array, name = "Test Card"): Promise<Response> =>
  call(lib, "/admin/screens/upload", { method: "POST", headers: { "content-length": String(bytes.length) }, body: bytes }, `?name=${encodeURIComponent(name)}`);
/** A JPEG's first and last two bytes around some filler, which is all the route checks of a poster. */
const POSTER = Buffer.from([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9]).toString("base64");
const track = (seconds: number): string => Buffer.alloc(Math.round(seconds * COLOUR_RATE) * COLOUR_PARTS * 3, 9).toString("base64");

test("a fresh library makes the strip channel of the starters and leaves the orb on the scenes", () => {
  const { lib } = library(() => 5_000_000);
  const view = lib.view();
  expect(view.doc.channels).toEqual([{ name: "strip", items: [SNEEZE, TRAIN], shuffle: false, epoch: 5_000_000 }]);
  expect(view.screens.get("orb")).toMatchObject({ show: "scenes", once: null, mode: "facing" });
  expect(view.manifest.map((c) => c.id)).toEqual([SNEEZE, TRAIN, BOLT]);
  // A second page or world opening the same file finds the channel as it was made.
  const again = new VideoLibrary({ db: join(root, `lib${made}`, "video.sqlite"), media: lib.media, tmp: lib.tmp, now: () => 9_000_000 });
  expect(again.view().doc.channels[0]!.epoch).toBe(5_000_000);
  again.close();
  lib.close();
});

test("the manifest is written under its own hash and changes with the visible clips", async () => {
  const { lib } = library();
  const first = lib.view().manifestId, file = join(lib.media, `video.${first}.json`);
  const text = readFileSync(file, "utf8");
  expect(new Bun.CryptoHasher("sha256").update(text).digest("hex").slice(0, 16)).toBe(first);
  expect((JSON.parse(text) as { clips: Clip[] }).clips.length).toBe(3);
  expect((await edit(lib, { op: "hide", clip: BOLT })).status).toBe(200);
  const second = lib.view();
  expect(second.manifestId).not.toBe(first);
  expect(second.manifest.map((c) => c.id)).toEqual([SNEEZE, TRAIN]);
  // The old one stays for pages that have not reloaded, and goes an hour after no world touches it.
  lib.sweep();
  expect(existsSync(file)).toBe(true);
  utimesSync(file, new Date(Date.now() - 61 * 60_000), new Date(Date.now() - 61 * 60_000));
  lib.sweep();
  expect([existsSync(file), existsSync(join(lib.media, `video.${second.manifestId}.json`))]).toEqual([false, true]);
  expect((await edit(lib, { op: "unhide", clip: BOLT })).status).toBe(200);
  expect(lib.view().manifestId).toBe(first);
  lib.close();
});

test("an edit from a page that saw an older revision is refused with 409", async () => {
  const { lib } = library();
  const seen = lib.view().revision;
  expect((await call(lib, "/admin/screens/edit", json({ revision: seen, op: "screen", screen: "orb", show: "strip", fill: true }))).status).toBe(200);
  const late = await call(lib, "/admin/screens/edit", json({ revision: seen, op: "screen", screen: "orb", show: "scenes" }));
  expect(late.status).toBe(409);
  expect(lib.view().screens.get("orb")).toMatchObject({ show: "strip", fill: true });
  const bad = await edit(lib, { op: "screen", screen: "orb", show: "nowhere" });
  expect([bad.status, ((await bad.json()) as { error: string }).error]).toEqual([400, "Show the scenes, a scene, or a channel there is."]);
  lib.close();
});

test("channels keep their epoch by name unless reset, and a screen on a gone one returns", async () => {
  let now = 1_000_000;
  const { lib } = library(() => now);
  lib.view();
  now = 2_000_000;
  const set = async (channels: unknown[]): Promise<LibraryView> => {
    const r = await edit(lib, { op: "channels", channels });
    expect(r.status).toBe(200);
    return lib.view();
  };
  // The route stamps a new epoch from the wall clock, so only its order is checked.
  const before = Date.now();
  let view = await set([{ name: "strip", items: [TRAIN], shuffle: true }, { name: "night", items: [BOLT] }]);
  expect(view.channels.get("strip")).toEqual({ name: "strip", items: [TRAIN], shuffle: true, epoch: 1_000_000 });
  expect(view.channels.get("night")!.epoch).toBeGreaterThanOrEqual(before);
  view = await set([{ name: "strip", items: [TRAIN], reset: true }, { name: "night", items: [BOLT] }]);
  expect(view.channels.get("strip")!.epoch).toBeGreaterThanOrEqual(before);
  expect((await edit(lib, { op: "screen", screen: "orb", show: "night" })).status).toBe(200);
  view = await set([{ name: "strip", items: [TRAIN] }]);
  expect(view.screens.get("orb")!.show).toBe("scenes");
  expect((await edit(lib, { op: "channels", channels: [{ name: "x", items: ["0000000000000000"] }] })).status).toBe(400);
  expect((await edit(lib, { op: "channels", channels: [{ name: "scenes", items: [] }] })).status).toBe(400);
  lib.close();
});

test("an upload is streamed, checked, moved to faststart and held until published", async () => {
  const { lib } = library();
  const late = fixture("audio.mp4");
  const r = await upload(lib, late, "Sine & Bars!");
  expect(r.status).toBe(200);
  const got = (await r.json()) as { id: string; width: number; height: number; seconds: number; kbps: number; audio: boolean };
  const id = new Bun.CryptoHasher("sha256").update(late).digest("hex").slice(0, 16);
  expect(got).toEqual({ id, width: 160, height: 90, seconds: 2, kbps: 37, audio: true });
  const file = join(lib.media, `${slugOf("Sine & Bars!")}.${id}.mp4`);
  expect(file.endsWith(`sine-bars.${id}.mp4`)).toBe(true);
  const placed = new Uint8Array(readFileSync(file));
  expect((probeMp4(placed) as Mp4Info).faststart).toBe(true);
  expect(chunkOffsets(placed)).not.toEqual(chunkOffsets(late));
  // Not in the manifest until its page sends the title, rights, poster and colour track.
  expect(lib.view().all.has(id)).toBe(false);
  expect(lib.allPending().map((p) => p.id)).toEqual([id]);

  const short = await call(lib, "/admin/screens/clip", json({ id, title: "Bars", rights: "made for the test", poster: POSTER, colours: track(0.5) }));
  expect(short.status).toBe(400);
  const big = await call(lib, "/admin/screens/clip", json({ id, title: "Bars", rights: "made for the test", poster: Buffer.alloc(70_000).toString("base64"), colours: track(2) }));
  expect(big.status).toBe(400);
  const ok = await call(lib, "/admin/screens/clip", json({ id, title: "Bars", rights: "made for the test", poster: POSTER, colours: track(2) }));
  expect(ok.status).toBe(200);
  expect(await ok.json()).toMatchObject({ id, title: "Bars", file: `/media/sine-bars.${id}.mp4`, poster: `/media/sine-bars.${id}.jpg`, starter: false, audio: true, bytes: late.length });
  expect(existsSync(join(lib.media, `sine-bars.${id}.jpg`))).toBe(true);
  expect(lib.view().manifest.at(-1)!.id).toBe(id);
  expect(lib.allPending()).toEqual([]);
  // The same file again is the clip already there.
  expect((await upload(lib, late)).status).toBe(409);

  const state = (await (await call(lib, "/admin/screens/state")).json()) as { clips: { id: string; kBps: number; kbps: number }[]; caps: { bytes: number } };
  expect(state.caps.bytes).toBe(CLIP_MAX_BYTES);
  expect(state.clips.find((c) => c.id === id)).toMatchObject({ kbps: 37, kBps: 4.7 });
  lib.close();
});

test("an upload is refused for its length, its codec and its caps", async () => {
  const { lib } = library();
  const none = await call(lib, "/admin/screens/upload", { method: "POST", body: new ReadableStream({ start: (c) => c.close() }) });
  expect(none.status).toBe(411);
  const huge = await call(lib, "/admin/screens/upload", { method: "POST", headers: { "content-length": String(CLIP_MAX_BYTES + 1) }, body: "x" });
  expect(huge.status).toBe(413);
  for (const [name, error] of [["hevc.mp4", "The video is hvc1, not H.264."], ["wide.mp4", "The picture is 1280×720, over 854×480."]] as const) {
    const r = await upload(lib, fixture(name));
    expect([r.status, ((await r.json()) as { error: string }).error]).toEqual([422, error]);
  }
  expect(lib.allPending()).toEqual([]);
  lib.close();
});

test("an upload not published within the hour is removed with its file", async () => {
  let now = Date.now();
  const { lib } = library(() => now);
  const r = (await (await upload(lib, fixture("small.mp4"))).json()) as { id: string };
  const file = join(lib.media, `test-card.${r.id}.mp4`);
  expect(existsSync(file)).toBe(true);
  now += 59 * 60_000;
  lib.sweep();
  expect(lib.allPending().length).toBe(1);
  now += 2 * 60_000;
  lib.sweep();
  expect([lib.allPending().length, existsSync(file)]).toEqual([0, false]);
  lib.close();
});

test("deleting an uploaded clip takes it from channels and screens, and its files", async () => {
  const { lib } = library();
  const { id } = (await (await upload(lib, fixture("small.mp4"))).json()) as { id: string };
  expect((await call(lib, "/admin/screens/clip", json({ id, title: "Card", rights: "test", poster: POSTER, colours: track(2) }))).status).toBe(200);
  expect((await edit(lib, { op: "channels", channels: [{ name: "strip", items: [SNEEZE, id] }] })).status).toBe(200);
  expect((await edit(lib, { op: "once", screen: "orb", clip: id })).status).toBe(200);
  expect(lib.view().screens.get("orb")!.once?.clip).toBe(id);
  expect((await edit(lib, { op: "rename", clip: id, title: "Card two" })).status).toBe(200);
  expect(lib.view().all.get(id)!.title).toBe("Card two");
  // A starter is hidden, not deleted.
  expect((await edit(lib, { op: "delete", clip: SNEEZE })).status).toBe(400);
  expect((await edit(lib, { op: "delete", clip: id })).status).toBe(200);
  const view = lib.view();
  expect([view.all.has(id), view.channels.get("strip")!.items, view.screens.get("orb")!.once]).toEqual([false, [SNEEZE], null]);
  expect([existsSync(join(lib.media, `test-card.${id}.mp4`)), existsSync(join(lib.media, `test-card.${id}.jpg`))]).toEqual([false, false]);
  lib.close();
});

test("the state says what each screen plays now", async () => {
  const { lib } = library();
  expect((await edit(lib, { op: "once", screen: "orb", clip: TRAIN })).status).toBe(200);
  const state = (await (await call(lib, "/admin/screens/state")).json()) as { screens: { screen: string; playing: { clip: string } | null }[] };
  expect(state.screens[0]).toMatchObject({ screen: "orb", show: "scenes", playing: { clip: TRAIN, next: null } });
  expect((await edit(lib, { op: "stop", screen: "orb" })).status).toBe(200);
  expect((await call(lib, "/admin/screens/state", { method: "POST" })).status).toBe(405);
  lib.close();
});

test("media is served from the library, then from the built client's starters", async () => {
  const media = join(root, "front-media"), client = join(root, "front-client");
  mkdirSync(media, { recursive: true });
  mkdirSync(join(client, "media"), { recursive: true });
  writeFileSync(join(media, "card.0123456789abcdef.mp4"), fixture("small.mp4"));
  writeFileSync(join(client, "media", "sneeze.a1a1a1a1a1a1a1a1.mp4"), "starter");
  const world = { world: 1, path: "/miami", port: 1, files: { client, parts: "" } };
  const get = (path: string, headers: Record<string, string> = {}) => fromDisk(new Request(`http://x${path}`, { headers }), path, world, media);
  const whole = (await get("/media/card.0123456789abcdef.mp4"))!;
  expect([whole.status, whole.headers.get("content-type"), whole.headers.get("cache-control")]).toEqual([200, "video/mp4", "public, max-age=31536000, immutable"]);
  const part = (await get("/miami/media/card.0123456789abcdef.mp4", { range: "bytes=4-11" }))!;
  expect([part.status, await part.text()]).toEqual([206, "ftypisom"]);
  expect(await (await get("/media/sneeze.a1a1a1a1a1a1a1a1.mp4"))!.text()).toBe("starter");
  expect(await get("/media/none.0123456789abcdef.mp4")).toBeNull();
  expect(statSync(join(media, "card.0123456789abcdef.mp4")).size).toBe(fixture("small.mp4").length);
});

test("a cluster world takes an upload through the front and serves it from the cluster's folder", async () => {
  const saves = join(root, "cluster"), dir = join(saves, "client");
  mkdirSync(join(dir, "assets"), { recursive: true });
  const { files, manifest } = splitPack(corePackBytes(), "core");
  for (const [f, file] of files.entries()) if (file.role !== "mesh") writeFileSync(join(dir, "assets", manifest.files[f]!.name), file.bytes);
  writeFileSync(join(dir, "assets/manifest.json"), JSON.stringify(manifest));
  const log = console.log;
  console.log = () => {};
  const config = loadConfig({}, ["-clusterid=screens", `-ClusterDirOverride=${saves}`]).rules;
  const world = startServer({ port: 0, clientDir: dir, dev: true, publicUrl: "/miami", dbPath: join(saves, "miami.db"), noBackups: true, config });
  const front = startFront(join(saves, "screens"), 0, "127.0.0.1");
  const at = `http://127.0.0.1:${front.port}`;
  try {
    for (let k = 0; k < 200 && (await fetch(`${at}/admin/screens/state`)).status === 503; k++) await Bun.sleep(50);
    const state = (await (await fetch(`${at}/admin/screens/state`)).json()) as { manifest: { path: string }; channels: unknown[] };
    expect(state.channels).toEqual([{ name: "strip", items: [], shuffle: false, epoch: expect.any(Number) }]);
    // The manifest comes from the cluster's own folder, which the front reads from disk.
    expect((await fetch(`${at}${state.manifest.path}`)).status).toBe(200);
    const bytes = fixture("late.mp4");
    const other = await fetch(`${at}/admin/screens/upload?name=card`, { method: "POST", body: bytes, headers: { origin: "https://elsewhere.example" } });
    expect(other.status).toBe(403);
    const up = await fetch(`${at}/admin/screens/upload?name=card`, { method: "POST", body: bytes });
    expect(up.status).toBe(200);
    const { id } = (await up.json()) as { id: string };
    expect(existsSync(join(saves, "screens", "media", `card.${id}.mp4`))).toBe(true);
    const got = await fetch(`${at}/miami/media/card.${id}.mp4`, { headers: { range: "bytes=0-7" } });
    expect([got.status, got.headers.get("content-type")]).toEqual([206, "video/mp4"]);
    expect((await fetch(`http://127.0.0.1:${world.port}/miami/media/card.${id}.mp4`)).status).toBe(200);
  } finally {
    front.stop();
    world.stop();
    console.log = log;
  }
});
