// What the page fetches whole as it starts: a failure names the request and what the server answered.

import { expect, test } from "bun:test";
import { fetchBytes, fetchJson, fetchText, type Get } from "../../client/core/fetched.ts";

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
