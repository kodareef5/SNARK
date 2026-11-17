// What the page fetches whole as it starts: a failure names the request and what the server answered.

import { expect, test } from "bun:test";
import { fetchBytes, fetchJson, fetchMap, fetchSounds, fetchText, readStatics, type Get } from "../../client/core/fetched.ts";
import { MANIFEST_VERSION, type Manifest } from "../../shared/pack/manifest.ts";
import { groundBytes, parseMap, writeMap } from "../../shared/world/mapfile.ts";
import { busyMap, flatMap } from "../fixtures/map.ts";

/** A server that answers each path as given, and 404 "not found" for any other, as server/files.ts does. */
const server = (files: Record<string, string>): Get => (url) => Promise.resolve(url in files ? new Response(files[url]) : new Response("not found", { status: 404 }));

test("a file the server does not have is named with its status, not left to a JSON parser", async () => {
  const get = server({ "map.json": '{"file":"map.1.snmap"}', "map.1.snmap": "abc", "assets/manifest.json": "{}", "broken.json": "not found" });
  expect(await fetchJson(get, "map.json")).toEqual({ file: "map.1.snmap" });
  expect(new Uint8Array(await fetchBytes(get, "map.1.snmap"))).toEqual(new TextEncoder().encode("abc"));
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

test("a map comes in two: its ground as soon as every byte before the statics is in, and the rest when the answer ends", async () => {
  /** The bytes as a network gives them, a few at a time, and perhaps fewer than the file holds. */
  const trickle = (file: Uint8Array, keep = file.length): Get => () => Promise.resolve(new Response(new ReadableStream({
    start(c) {
      for (let at = 0; at < keep; at += 1000) c.enqueue(file.slice(at, Math.min(keep, at + 1000)));
      c.close();
    },
  })));
  const file = writeMap(busyMap());
  const at = groundBytes(file);
  const { ground, rest } = await fetchMap(trickle(file), "map.1.snmap");
  expect([ground, await rest]).toEqual([file.subarray(0, at), file.subarray(at)]);
  const bare = writeMap(flatMap(1));
  const none = await fetchMap(trickle(bare), "map.2.snmap");
  expect([none.ground, await none.rest]).toEqual([bare, new Uint8Array(0)]);
  await expect(fetchMap(trickle(file, at - 1), "map.1.snmap")).rejects.toThrow("map.1.snmap: the answer ended before the map did");
  await expect((await fetchMap(trickle(file, file.length - 1), "map.1.snmap")).rest).rejects.toThrow("map.1.snmap: the answer ended before the map did");
});

test("a page reads its map's ground at once and its statics a step at a time after, without the map's order", async () => {
  const file = writeMap(busyMap());
  const { ground, rest } = await fetchMap(() => Promise.resolve(new Response(file)), "map.1.snmap");
  const [map, whole] = [parseMap(ground, false), parseMap(file)];
  expect([map.hash, map.statics.length, map.heights]).toEqual([whole.hash, 0, whole.heights]);
  const t = await readStatics(rest, map.dims, () => Promise.resolve());
  expect([t.row.length, t.first, t.kind, t.x, t.y, t.z, t.yaw]).toEqual([0, whole.statics.first, whole.statics.kind, whole.statics.x, whole.statics.y, whole.statics.z, whole.statics.yaw]);
});
