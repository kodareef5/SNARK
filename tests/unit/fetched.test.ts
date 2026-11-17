// What the page fetches whole as it starts: a failure names the request and what the server answered.

import { expect, test } from "bun:test";
import { fetchBytes, fetchJson, fetchMap, fetchMapFile, fetchSounds, fetchText, nextTask, readStatics, type Get } from "../../client/core/fetched.ts";
import { MANIFEST_VERSION, type Manifest } from "../../shared/pack/manifest.ts";
import { parseMap, partsOf, readHead, writeMap } from "../../shared/world/mapfile.ts";
import { flatMap, wideMap } from "../fixtures/map.ts";

/** A server that answers each path as given, and 404 "not found" for any other, as server/files.ts does. */
const server = (files: Record<string, string>): Get => (url) => Promise.resolve(url in files ? new Response(files[url]) : new Response("not found", { status: 404 }));

test("a file the server does not have is named with its status, not left to a JSON parser", async () => {
  const get = server({ "map.json": '{"head":"map/head.1.part"}', "map/head.1.part": "abc", "assets/manifest.json": "{}", "broken.json": "not found" });
  expect(await fetchJson(get, "map.json")).toEqual({ head: "map/head.1.part" });
  expect(new Uint8Array(await fetchBytes(get, "map/head.1.part"))).toEqual(new TextEncoder().encode("abc"));
  expect(await fetchText(get, "assets/manifest.json")).toBe("{}");
  // As the phone's soak met it: a build had taken the manifest away, and the page said only "JSON Parse error".
  const gone = server({});
  await expect(gone("assets/manifest.json").then(async (res) => JSON.parse(await res.text()) as unknown)).rejects.toThrow(SyntaxError);
  await expect(fetchJson(gone, "assets/manifest.json")).rejects.toThrow('assets/manifest.json: the server answered 404: "not found"');
  await expect(fetchText(gone, "assets/manifest.json")).rejects.toThrow('assets/manifest.json: the server answered 404: "not found"');
  await expect(fetchBytes(gone, "assets/core.boot.0123456789abcdef.snpk")).rejects.toThrow("assets/core.boot.0123456789abcdef.snpk: the server answered 404");
  await expect(fetchJson(get, "broken.json")).rejects.toThrow('broken.json: the server answered 200 with what is not JSON: "not found"');
  await expect(fetchJson(() => Promise.reject(new TypeError("Load failed")), "map.json")).rejects.toThrow("map.json: no answer (Load failed)");
});

test("a sounds' rows file that fails says why, and leaves the manifest without sounds", async () => {
  const manifest = (): Manifest => ({ version: MANIFEST_VERSION, files: [{ name: "boot", bytes: 0, role: "boot" }], boot: 0, clipHash: 0, meshes: [], soundRows: "sounds.1.json" });
  const rows = manifest();
  expect(await fetchSounds(server({ "assets/sounds.1.json": "[]" }), rows)).toBe("");
  expect(rows.sounds).toEqual([]);
  const gone = manifest();
  expect(await fetchSounds(server({}), gone)).toBe('assets/sounds.1.json: the server answered 404: "not found"');
  expect(gone.sounds).toBeUndefined();
  const wrong = manifest();
  expect(await fetchSounds(server({ "assets/sounds.1.json": '[{"id":"nobody"}]' }), wrong)).toContain('sound "nobody"');
  expect(wrong.sounds).toBeUndefined();
});

/** A server of a map's head and parts, as server/main.ts names them under map/, counting what is asked for and how many at once. */
function mapServer(file: Uint8Array, change: (name: string, bytes: Uint8Array) => Uint8Array = (_, b) => b): Get & { asked: string[]; most: number } {
  let open = 0;
  const files = new Map(partsOf(file).map((p) => [`map/${p.name}`, p.bytes]));
  const get = Object.assign(
    async (url: string): Promise<Response> => {
      get.asked.push(url);
      get.most = Math.max(get.most, ++open);
      await Promise.resolve();
      open--;
      const bytes = files.get(url);
      return bytes ? new Response(change(url, bytes)) : new Response("not found", { status: 404 });
    },
    { asked: [] as string[], most: 0 },
  );
  return get;
}

test("a page fetches a map's head, then its ground's parts six at once, which make the map with no statics; then its statics' parts", async () => {
  const file = writeMap(wideMap());
  const whole = parseMap(file);
  const head = readHead(file);
  const get = mapServer(file);
  const { ground, rest } = await fetchMap(get, `map/${head.name}`);
  // The ground's parts are all asked for before any statics', and no more than six at once.
  const statics = head.parts.filter((p) => p.kind === "statics").map((p) => `map/${p.name}`);
  expect(get.asked.slice(0, 1 + head.parts.length - statics.length)).toEqual([`map/${head.name}`, ...head.parts.filter((p) => p.kind !== "statics").map((p) => `map/${p.name}`)]);
  expect(get.most).toBe(6);
  expect([ground.hash, ground.statics.length, ground.heights, ground.tint, ground.nodes, ground.water]).toEqual([whole.hash, 0, whole.heights, whole.tint, whole.nodes, whole.water]);
  // Its statics, each sector's read and then set in a step at a time, without the map's order: its ten sectors, each smaller
  // than a slice, are ten steps read and ten set.
  let paused = 0;
  const t = await readStatics(rest, () => (paused++, Promise.resolve()));
  expect([get.asked.slice(-statics.length), paused]).toEqual([statics, 20]);
  expect([t.row.length, t.first, t.kind, t.x, t.y, t.z, t.yaw]).toEqual([0, whole.statics.first, whole.statics.kind, whole.statics.x, whole.statics.y, whole.statics.z, whole.statics.yaw]);
  // A program that reads a map whole gets its file back.
  expect(await fetchMapFile(mapServer(file), `map/${head.name}`)).toEqual(file);
});

test("a part that comes damaged, or as another's, or not at all, is refused with its name", async () => {
  const file = writeMap(wideMap());
  const head = readHead(file);
  const [a, b] = [head.parts[2]!, head.parts[3]!];
  const damaged = mapServer(file, (url, bytes) => (url === `map/${a.name}` ? bytes.map((v, i) => (i === 7 ? v ^ 1 : v)) : bytes));
  await expect(fetchMap(damaged, `map/${head.name}`)).rejects.toThrow(`map: its part ${a.name} is damaged or another's: its bytes are not those its head names`);
  const other = partsOf(file).find((p) => p.name === b.name)!.bytes;
  const swapped = mapServer(file, (url, bytes) => (url === `map/${a.name}` ? other : bytes));
  await expect(fetchMap(swapped, `map/${head.name}`)).rejects.toThrow(`map: its part ${a.name} is damaged or another's`);
  await expect(fetchMapFile(swapped, `map/${head.name}`)).rejects.toThrow(`map/${a.name}: the part is ${b.length} bytes, and its head says ${a.length}`);
  const statics = head.parts.find((p) => p.kind === "statics")!;
  const { rest } = await fetchMap(mapServer(file, (url, bytes) => (url === `map/${statics.name}` ? bytes.subarray(1) : bytes)), `map/${head.name}`);
  await expect(readStatics(rest, () => Promise.resolve())).rejects.toThrow(`map: its part ${statics.name} is damaged or another's`);
  const gone = mapServer(file);
  await expect(fetchMap(gone, `map/head.0123456789abcdef.part`)).rejects.toThrow('map/head.0123456789abcdef.part: the server answered 404: "not found"');
  const head2 = file.slice(0, head.bytes);
  head2[70]! ^= 1;
  await expect(fetchMap(() => Promise.resolve(new Response(head2)), `map/${head.name}`)).rejects.toThrow(`map/${head.name}: map: its head is damaged`);
});

test("a page's statics read with a message to itself between steps are the same, a step for each slice of a sector's pieces read and set and one after each sector", async () => {
  // Three slices of pieces and some in one sector: each slice is a step as it is read and as it is set in its chunks, and
  // the sector's end another each time.
  const statics = Array.from({ length: 100000 }, (_, i) => ({ kind: i % 3 === 0 ? "core:wall" : "core:floor", x: (i % 250) + 0.5, y: 33, z: Math.floor(i / 400) + 0.5, yaw: (i * 64) & 0xffff }));
  const file = writeMap(flatMap(4, { statics }));
  const whole = parseMap(file);
  const head = readHead(file);
  const channel = new MessageChannel();
  let posted = 0;
  let steps = 0;
  const pause = nextTask({ port1: channel.port1, port2: { postMessage: (m) => (posted++, channel.port2.postMessage(m)) } });
  const part = head.parts.find((p) => p.kind === "statics")!;
  const t = await readStatics(Promise.resolve({ head, parts: [{ part, bytes: file.subarray(part.at, part.at + part.length) }] }), () => (steps++, pause()));
  channel.port1.close();
  expect([steps, posted]).toEqual([8, 8]);
  expect([t.first, t.kind, t.x, t.y, t.z, t.yaw]).toEqual([whole.statics.first, whole.statics.kind, whole.statics.x, whole.statics.y, whole.statics.z, whole.statics.yaw]);
});
