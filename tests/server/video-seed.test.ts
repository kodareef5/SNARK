// A library written before a type of screen had starter channels takes them once (server/video/library.ts seedTypes).
import { afterAll, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdirSync, mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VideoLibrary, type LibraryDoc, type Starters } from "../../server/video/library.ts";
import { screensAdmin } from "../../server/video/routes.ts";
import type { Clip } from "../../shared/video/clip.ts";

const root = mkdtempSync(join(tmpdir(), "snark-video-seed-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
let made = 0;

const CLIP = "a1a1a1a1a1a1a1a1", AD = "d4d4d4d4d4d4d4d4", DESK = "e5e5e5e5e5e5e5e5";
const item = (id: string, extra: Partial<Clip> = {}): Clip => ({
  id, title: id, file: `/media/${id}.${id}.mp4`, poster: `/media/${id}.${id}.jpg`, width: 640, height: 360, seconds: 10, bytes: 750_000,
  audio: false, rights: "public domain", starter: true, colours: "", ...extra,
});
const still = (id: string, types: Clip["types"]): Clip => item(id, { file: `/media/${id}.${id}.png`, seconds: 0, kind: "image", types });
const CLIPS = [item(CLIP), still(AD, ["billboard", "tv"]), still(DESK, ["laptop"])];
const ALL_TYPES: Starters = {
  clips: CLIPS,
  channels: [
    { name: "strip", items: [CLIP] },
    { name: "roadside", type: "billboard", still: 6, items: [AD] },
    { name: "spots", type: "tv", items: [AD] },
    { name: "desktops", type: "laptop", items: [DESK] },
  ],
};

/** The ball as an operator left it on the code before screen types, and their own channel named as a billboard starter is. */
const OLD_ORB = { screen: "orb", show: "scene:core", once: null, mode: "fixed", fill: false, sound: true, night: true };
const OLD_DOC = {
  clips: [],
  channels: [
    { name: "strip", items: [CLIP], shuffle: true, epoch: 1_000 },
    { name: "roadside", items: [CLIP], shuffle: false, epoch: 2_000 },
  ],
  screens: [OLD_ORB],
  hidden: [],
  curatedStrip: true,
};

function folder(starters: Starters): string {
  const dir = join(root, `lib${++made}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "starter.json"), JSON.stringify(starters));
  return dir;
}

const open = (dir: string, now = 9_000_000): VideoLibrary =>
  new VideoLibrary({ db: join(dir, "video.sqlite"), media: join(dir, "media"), tmp: join(dir, "tmp"), starters: join(dir, "starter.json"), now: () => now });

/** Writes a doc as an older build left it, at `revision`. */
function writeOld(dir: string, doc: unknown, revision = 7): void {
  const db = new Database(join(dir, "video.sqlite"), { create: true });
  db.exec("CREATE TABLE library (id INTEGER PRIMARY KEY, revision INTEGER NOT NULL, doc TEXT NOT NULL); CREATE TABLE pending (id TEXT PRIMARY KEY, info TEXT NOT NULL, at INTEGER NOT NULL);");
  db.query("INSERT INTO library (id,revision,doc) VALUES (1,?,?)").run(revision, JSON.stringify(doc));
  db.close();
}

/** Replaces the starter file, its time moved on so the library reads it again. */
function replaceStarters(dir: string, starters: Starters): void {
  const file = join(dir, "starter.json"), later = new Date(statSync(file).mtimeMs + 2_000);
  writeFileSync(file, JSON.stringify(starters));
  utimesSync(file, later, later);
}

const stored = (dir: string): { revision: number; doc: LibraryDoc } => {
  const db = new Database(join(dir, "video.sqlite"));
  const row = db.query("SELECT revision, doc FROM library WHERE id=1").get() as { revision: number; doc: string };
  db.close();
  return { revision: row.revision, doc: JSON.parse(row.doc) as LibraryDoc };
};

const edit = (lib: VideoLibrary, body: Record<string, unknown>): Promise<Response> =>
  Promise.resolve(screensAdmin(new Request("http://snark.test/admin/screens/edit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ revision: lib.view().revision, ...body }) }), "/admin/screens/edit", lib, () => ({ night: false, seconds: 0, hour: 12, only: -1, gain: 1 }))!);

test("an orb-only library takes the other types' starter channels once", () => {
  const dir = folder(ALL_TYPES);
  writeOld(dir, OLD_DOC);
  const lib = open(dir), view = lib.view();
  expect(view.revision).toBe(8);
  // Every channel the operator had stays as it was; the billboard starter's name was theirs, so it takes a number.
  expect(view.doc.channels).toEqual([
    ...OLD_DOC.channels,
    { name: "roadside 2", items: [AD], shuffle: false, epoch: 9_000_000, type: "billboard", still: 6 },
    { name: "spots", items: [AD], shuffle: false, epoch: 9_000_000, type: "tv" },
    { name: "desktops", items: [DESK], shuffle: false, epoch: 9_000_000, type: "laptop" },
  ]);
  expect(view.screens.get("orb")).toEqual(OLD_ORB as never);
  expect([...view.screens.values()].map((s) => [s.screen, s.show])).toEqual([["orb", "scene:core"], ["billboard", "roadside 2"], ["tv", "spots"], ["laptop", "desktops"]]);
  expect(stored(dir).doc.seeded).toEqual(["orb", "billboard", "tv", "laptop"]);
  lib.close();

  // Opening it again, from another world, changes nothing.
  const before = stored(dir), again = open(dir, 12_000_000);
  expect(again.view().revision).toBe(8);
  expect(stored(dir)).toEqual(before);
  again.close();
});

test("a seeded channel an operator deletes does not come back", async () => {
  const dir = folder(ALL_TYPES);
  writeOld(dir, OLD_DOC);
  const lib = open(dir), channels = lib.view().doc.channels.filter((c) => c.name !== "spots");
  expect((await edit(lib, { op: "channels", channels })).status).toBe(200);
  lib.close();
  const again = open(dir, 12_000_000), view = again.view();
  expect(view.channels.has("spots")).toBe(false);
  expect(view.screens.get("tv")!.show).toBe("scenes");
  // The starter file rebuilt changes nothing either.
  replaceStarters(dir, ALL_TYPES);
  expect(again.view().channels.has("spots")).toBe(false);
  again.close();
});

test("starters that gain a type later seed it; a type the operator filled only takes the mark", async () => {
  const dir = folder({ clips: CLIPS, channels: ALL_TYPES.channels.slice(0, 2) });
  const lib = open(dir), born = lib.view();
  expect(born.doc.seeded).toEqual(["orb", "billboard"]);
  expect([born.screens.get("tv")!.show, born.screens.get("laptop")!.show]).toEqual(["scenes", "scenes"]);
  // The operator makes a laptop channel of their own before the starters have one.
  const own = [...born.doc.channels, { name: "own desks", type: "laptop", items: [DESK] }];
  expect((await edit(lib, { op: "channels", channels: own })).status).toBe(200);
  const was = lib.view();
  replaceStarters(dir, ALL_TYPES);
  const view = lib.view();
  expect(view.revision).toBe(was.revision + 1);
  expect(view.doc.channels.map((c) => c.name)).toEqual(["strip", "roadside", "own desks", "spots"]);
  expect(view.channels.get("spots")!.epoch).toBe(9_000_000);
  expect([view.screens.get("billboard")!.show, view.screens.get("tv")!.show, view.screens.get("laptop")!.show]).toEqual(["roadside", "spots", "scenes"]);
  expect(view.doc.seeded).toEqual(["orb", "billboard", "tv", "laptop"]);
  lib.close();
});

test("seeding leaves out hidden items, lights a dark screen, and stops at the channel limit", () => {
  const dir = folder(ALL_TYPES);
  const many = Array.from({ length: 31 }, (_, i) => ({ name: `own ${i}`, items: [CLIP], shuffle: false, epoch: 1 }));
  writeOld(dir, { ...OLD_DOC, channels: many, hidden: [DESK], screens: [OLD_ORB, { ...OLD_ORB, screen: "billboard", show: "scenes", mode: "facing" }] });
  const lib = open(dir), view = lib.view();
  // One channel fits under 32: the billboard's. The laptop's only item is hidden, and the TV's would pass the limit.
  expect(view.doc.channels.length).toBe(32);
  expect(view.doc.channels.at(-1)!.name).toBe("roadside");
  // The billboard's own record keeps its fields and now shows the channel.
  expect(view.screens.get("billboard")).toEqual({ ...OLD_ORB, screen: "billboard", show: "roadside", mode: "facing" } as never);
  expect([view.screens.get("tv")!.show, view.screens.get("laptop")!.show]).toEqual(["scenes", "scenes"]);
  expect(view.doc.seeded).toEqual(["orb", "billboard", "tv", "laptop"]);
  lib.close();
});
