// Stills and the types of screen in a cluster's library (server/video/library.ts, routes.ts, upload.ts): an image's
// upload and publish, channels for each type, what each type may show and play once, and the types an item is offered on.
import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VideoLibrary } from "../../server/video/library.ts";
import { screensAdmin } from "../../server/video/routes.ts";
import { COLOUR_PARTS, IMAGE_MAX_BYTES, type Clip } from "../../shared/video/clip.ts";
import { screenAt } from "../../shared/video/programme.ts";

const root = mkdtempSync(join(tmpdir(), "snark-video-types-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
let made = 0;

const CLIP = "a1a1a1a1a1a1a1a1", AD = "d4d4d4d4d4d4d4d4", BALL = "e5e5e5e5e5e5e5e5";
const item = (id: string, extra: Partial<Clip> = {}): Clip => ({
  id, title: id, file: `/media/${id}.${id}.mp4`, poster: `/media/${id}.${id}.jpg`, width: 640, height: 360, seconds: 10, bytes: 750_000,
  audio: false, rights: "public domain", starter: true, colours: "", ...extra,
});
const image = (id: string, types: Clip["types"]): Clip => item(id, { file: `/media/${id}.${id}.png`, seconds: 0, bytes: 90_000, kind: "image", types });

/** A library whose starters are a clip, a billboard and TV ad, and a still for the ball alone, with a billboard channel. */
function library(): VideoLibrary {
  const dir = join(root, `lib${++made}`);
  mkdirSync(dir, { recursive: true });
  const starters = {
    clips: [item(CLIP), image(AD, ["billboard", "tv"]), image(BALL, ["orb"])],
    channels: [{ name: "strip", items: [CLIP] }, { name: "roadside", type: "billboard", still: 6, items: [AD] }],
  };
  writeFileSync(join(dir, "starter.json"), JSON.stringify(starters));
  return new VideoLibrary({ db: join(dir, "video.sqlite"), media: join(dir, "media"), tmp: join(dir, "tmp"), starters: join(dir, "starter.json") });
}

const call = (lib: VideoLibrary, path: string, init: RequestInit = {}, query = ""): Promise<Response> =>
  Promise.resolve(screensAdmin(new Request(`http://snark.test${path}${query}`, init), path, lib, () => ({ night: false, seconds: 0, hour: 12, only: -1, gain: 1 }))!);
const json = (body: unknown): RequestInit => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const edit = (lib: VideoLibrary, body: Record<string, unknown>): Promise<Response> => call(lib, "/admin/screens/edit", json({ revision: lib.view().revision, ...body }));
const error = async (r: Response): Promise<[number, string]> => [r.status, ((await r.json()) as { error: string }).error];
const sendImage = (lib: VideoLibrary, bytes: Uint8Array, name = "Raptor-Rid"): Promise<Response> =>
  call(lib, "/admin/screens/image", { method: "POST", headers: { "content-length": String(bytes.length) }, body: bytes }, `?name=${encodeURIComponent(name)}`);

const be32 = (n: number): number[] => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
/** A PNG's signature and header, which is all the route reads, with `fill` bytes after. */
const png = (w: number, h: number, fill = 0): Uint8Array =>
  new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...be32(13), 0x49, 0x48, 0x44, 0x52, ...be32(w), ...be32(h), 8, 2, 0, 0, 0, ...new Array(fill).fill(7)]);
const POSTER = Buffer.from([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9]).toString("base64");
const SAMPLE = Buffer.alloc(COLOUR_PARTS * 3, 40).toString("base64");

test("a fresh library keeps the starter channels' types; the ball and a billboard start on theirs", () => {
  const lib = library(), view = lib.view();
  expect(view.channels.get("roadside")).toMatchObject({ type: "billboard", still: 6, items: [AD] });
  expect(view.channels.get("strip")!.type).toBeUndefined();
  expect([...view.screens.values()].map((s) => [s.screen, s.show])).toEqual([["orb", "strip"], ["billboard", "roadside"], ["tv", "scenes"], ["laptop", "scenes"]]);
  expect(view.timed.get(AD)).toEqual({ id: AD, seconds: 0, image: true });
  // The billboard's ad holds the channel's 6 s.
  const playing = screenAt(view.screens.get("billboard")!, view.channels, view.timed, view.channels.get("roadside")!.epoch + 1000, false);
  expect(playing).toEqual({ clip: AD, start: view.channels.get("roadside")!.epoch, next: AD });
  lib.close();
});

test("an image is uploaded, held, and published with its poster, one colour sample and types", async () => {
  const lib = library(), bytes = png(1200, 400, 50);
  const r = await sendImage(lib, bytes);
  expect(r.status).toBe(200);
  const id = new Bun.CryptoHasher("sha256").update(bytes).digest("hex").slice(0, 16);
  expect(await r.json()).toEqual({ id, kind: "image", type: "png", width: 1200, height: 400, bytes: bytes.length });
  expect(existsSync(join(lib.media, `raptor-rid.${id}.png`))).toBe(true);
  expect(lib.allPending()).toMatchObject([{ id, kind: "image", seconds: 0 }]);
  expect(lib.view().all.has(id)).toBe(false);

  const publish = (extra: Record<string, unknown>) => call(lib, "/admin/screens/clip", json({ id, title: "Raptor-Rid", rights: "made for SNARK, CC0", poster: POSTER, colours: SAMPLE, ...extra }));
  expect(await error(await publish({ colours: Buffer.alloc(COLOUR_PARTS * 6).toString("base64") }))).toEqual([400, `An image's colour track is one sample of ${COLOUR_PARTS * 3} bytes.`]);
  expect((await publish({ types: [] })).status).toBe(400);
  expect((await publish({ types: ["billboard", "cinema"] })).status).toBe(400);
  const ok = await publish({});
  expect(ok.status).toBe(200);
  const clip = (await ok.json()) as Clip;
  expect(clip).toMatchObject({ id, kind: "image", seconds: 0, file: `/media/raptor-rid.${id}.png`, poster: `/media/raptor-rid-poster.${id}.jpg`, types: ["billboard", "tv", "laptop"] });
  expect(readFileSync(join(lib.media, `raptor-rid-poster.${id}.jpg`)).length).toBe(7);
  expect(lib.view().manifest.at(-1)!.id).toBe(id);
  expect((await sendImage(lib, bytes)).status).toBe(409);

  // The state lists each item's kind and types; an image has no rate.
  const state = (await (await call(lib, "/admin/screens/state")).json()) as { clips: { id: string; kind: string; types: string[]; kbps: number }[] };
  expect(state.clips.map((c) => [c.id, c.kind, c.types, c.kbps])).toEqual([
    [CLIP, "clip", ["orb", "billboard", "tv", "laptop"], 600], [AD, "image", ["billboard", "tv"], 0], [BALL, "image", ["orb"], 0], [id, "image", ["billboard", "tv", "laptop"], 0],
  ]);
  // Deleting it takes its picture and poster.
  expect((await edit(lib, { op: "delete", clip: id })).status).toBe(200);
  expect([existsSync(join(lib.media, `raptor-rid.${id}.png`)), existsSync(join(lib.media, `raptor-rid-poster.${id}.jpg`))]).toEqual([false, false]);
  lib.close();
});

test("an image is refused for its size, its long side and its type", async () => {
  const lib = library();
  expect((await call(lib, "/admin/screens/image", { method: "POST", headers: { "content-length": String(IMAGE_MAX_BYTES + 1) }, body: "x" })).status).toBe(413);
  expect(await error(await sendImage(lib, png(1281, 10)))).toEqual([422, "The picture is 1281×10, over 1280 on its long side."]);
  expect(await error(await sendImage(lib, new TextEncoder().encode("GIF89a, not ours")))).toEqual([422, "This is not a PNG, JPEG or WebP image."]);
  expect((await call(lib, "/admin/screens/image")).status).toBe(405);
  expect(lib.allPending()).toEqual([]);
  lib.close();
});

test("channels take a type and a still, unique names, and only items offered on their type", async () => {
  const lib = library();
  const set = (channels: unknown[]) => edit(lib, { op: "channels", channels });
  const before = Date.now();
  expect((await set([{ name: "strip", items: [CLIP, BALL] }, { name: "roadside", type: "billboard", still: 10, items: [CLIP, AD] }, { name: "news", type: "tv", items: [AD] }])).status).toBe(200);
  const view = lib.view();
  expect(view.channels.get("roadside")).toMatchObject({ type: "billboard", still: 10, items: [CLIP, AD] });
  expect(view.channels.get("news")!.epoch).toBeGreaterThanOrEqual(before);
  expect(await error(await set([{ name: "roadside", items: [] }, { name: "roadside", type: "tv", items: [] }]))).toEqual([400, "Two channels are named roadside."]);
  expect(await error(await set([{ name: "x", type: "cinema", items: [] }]))).toEqual([400, "Channel x is for orb, billboard, tv, laptop screens."]);
  expect(await error(await set([{ name: "x", type: "tv", still: 1, items: [] }]))).toEqual([400, "Channel x holds an image 2 to 120 seconds."]);
  expect(await error(await set([{ name: "x", type: "laptop", items: [AD] }]))).toEqual([400, `Channel x lists ${AD}, which is not offered on laptop screens.`]);
  expect(await error(await set([{ name: "x", items: [AD] }]))).toEqual([400, `Channel x lists ${AD}, which is not offered on orb screens.`]);
  // A screen whose channel becomes another type's goes dark.
  expect((await edit(lib, { op: "take", screen: "tv", show: "news" })).status).toBe(200);
  expect((await set([{ name: "news", type: "billboard", items: [AD] }])).status).toBe(200);
  expect(lib.view().screens.get("tv")!.show).toBe("scenes");
  lib.close();
});

test("a billboard takes its own channels and nothing, never a scene, and plays once what it is offered", async () => {
  const lib = library();
  expect((await edit(lib, { op: "channels", channels: [{ name: "strip", items: [CLIP] }, { name: "roadside", type: "billboard", items: [AD] }, { name: "late", type: "billboard", items: [CLIP] }] })).status).toBe(200);
  expect((await edit(lib, { op: "take", screen: "billboard", show: "late" })).status).toBe(200);
  expect(lib.view().screens.get("billboard")!.show).toBe("late");
  expect(await error(await edit(lib, { op: "take", screen: "billboard", show: "strip" }))).toEqual([400, "Show nothing, or a channel for billboard screens."]);
  expect((await edit(lib, { op: "take", screen: "billboard", show: "scene:core" })).status).toBe(400);
  expect((await edit(lib, { op: "screen", screen: "billboard", show: "scene:core" })).status).toBe(400);
  expect((await edit(lib, { op: "take", screen: "billboard", show: "scenes" })).status).toBe(200);
  expect(lib.view().screens.get("billboard")!.show).toBe("scenes");
  // The ball still holds a scene.
  expect((await edit(lib, { op: "take", screen: "orb", show: "scene:core" })).status).toBe(200);

  expect(await error(await edit(lib, { op: "once", screen: "billboard", clip: BALL }))).toEqual([400, `${BALL} is not offered on billboard screens.`]);
  expect((await edit(lib, { op: "take", screen: "billboard", clip: AD })).status).toBe(200);
  const view = lib.view(), board = view.screens.get("billboard")!;
  expect(board.once?.clip).toBe(AD);
  // A still played once holds 15 s.
  expect(screenAt(board, view.channels, view.timed, board.once!.from + 14_000, false)?.clip).toBe(AD);
  expect(screenAt(board, view.channels, view.timed, board.once!.from + 15_000, false)).toBeNull();
  expect((await edit(lib, { op: "stop", screen: "billboard" })).status).toBe(200);
  expect((await edit(lib, { op: "once", screen: "cinema", clip: AD })).status).toBe(400);
  lib.close();
});

test("the types op changes what an upload or a starter is offered on, and takes it from other types' channels", async () => {
  const lib = library();
  expect((await edit(lib, { op: "channels", channels: [{ name: "strip", items: [CLIP] }, { name: "roadside", type: "billboard", items: [AD, CLIP] }, { name: "news", type: "tv", items: [AD] }] })).status).toBe(200);
  expect((await edit(lib, { op: "take", screen: "tv", clip: AD })).status).toBe(200);
  expect((await edit(lib, { op: "types", clip: AD, types: ["billboard"] })).status).toBe(200);
  let view = lib.view();
  // A starter keeps its pack as it was; the library holds the change apart.
  expect([view.doc.types, view.all.get(AD)!.types, view.manifest.find((c) => c.id === AD)!.types]).toEqual([{ [AD]: ["billboard"] }, ["billboard"], ["billboard"]]);
  expect([view.channels.get("news")!.items, view.channels.get("roadside")!.items, view.screens.get("tv")!.once]).toEqual([[], [AD, CLIP], null]);
  expect((await edit(lib, { op: "types", clip: CLIP, types: ["orb"] })).status).toBe(200);
  expect(lib.view().channels.get("roadside")!.items).toEqual([AD]);
  expect(await error(await edit(lib, { op: "types", clip: CLIP, types: [] }))).toEqual([400, "Offer it on one or more of orb, billboard, tv, laptop, each once."]);
  expect((await edit(lib, { op: "types", clip: "0000000000000000", types: ["orb"] })).status).toBe(400);

  // An upload's own record changes.
  const bytes = png(64, 64, 3);
  const { id } = (await (await sendImage(lib, bytes)).json()) as { id: string };
  expect((await call(lib, "/admin/screens/clip", json({ id, title: "Lag-Away", rights: "made for SNARK", poster: POSTER, colours: SAMPLE, types: ["laptop"] }))).status).toBe(200);
  expect(lib.view().all.get(id)!.types).toEqual(["laptop"]);
  expect((await edit(lib, { op: "types", clip: id, types: ["tv", "orb"] })).status).toBe(200);
  view = lib.view();
  expect([view.doc.clips.find((c) => c.id === id)!.types, view.doc.types![id]]).toEqual([["orb", "tv"], undefined]);
  lib.close();
});
