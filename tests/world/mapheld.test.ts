import { expect, test } from "bun:test";
import type { Get } from "../../client/core/fetched.ts";
import { bytesHeld, heldTotal, mapLedger } from "../../client/core/mapheld.ts";
import { MapLoader } from "../../client/core/mapload.ts";
import { partsOf, readHead, writeMap } from "../../shared/world/mapfile.ts";
import { wideMap } from "../fixtures/map.ts";

const settle = (): Promise<void> => new Promise((go) => setTimeout(go, 0));

test("a buffer two classes share is counted once, under the first", () => {
  const a = new Uint16Array(100), seen = new Set<unknown>();
  expect(bytesHeld({ a, again: a, view: a.subarray(10) }, seen)).toBe(200);
  expect(bytesHeld([a], seen)).toBe(0);
  expect(bytesHeld(new Map([[1, new Float32Array(8)]]), new Set())).toBe(32);
});

test("the ledger counts the page's ground and statics as the loader lays them out", async () => {
  const file = writeMap(wideMap()), head = readHead(file);
  const files = new Map(partsOf(file).map((p) => [`map/${p.name}`, p.bytes]));
  const get = ((url: string) => Promise.resolve(new Response(files.get(url)!))) as Get;
  const loader = await MapLoader.start(get, `map/${head.name}`, { wait: () => settle() });
  expect(mapLedger({ loader }).find((r) => r.name === "statics")).toBeUndefined();
  await loader.follow(() => ({ x: 600, z: 600, vx: 0, vz: 0 }));
  for (let k = 0; k < 500 && !loader.progress().whole; k++) await settle();
  const rows = mapLedger({ loader, city: loader.staged, skip: [] });
  const hf = loader.staged.hf;
  expect(rows.find((r) => r.name === "ground")!.bytes).toBe(hf.heights.byteLength + hf.tint.byteLength + hf.ground.byteLength + hf.exact.byteLength);
  const pieces = head.counts.reduce((n, c) => n + c, 0);
  expect(rows.find((r) => r.name === "statics")!.bytes).toBeGreaterThanOrEqual(pieces * 16);
  // The city named here is the staged map again, all of it counted already.
  expect(rows.find((r) => r.name === "city")).toBeUndefined();
  expect(heldTotal(rows)).toBe(rows.reduce((n, r) => n + r.bytes, 0));
});
