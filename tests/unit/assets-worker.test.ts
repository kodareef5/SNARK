// The asset worker's ranges go past the browser's cache: Chrome sends the ranges of one file that go through its cache
// one at a time, and every texture is a range of one file and every mesh level of another (client/assets/assets-worker.ts).

import { afterAll, expect, test } from "bun:test";

const global = globalThis as unknown as Record<string, unknown>;
const was = { fetch: global.fetch, postMessage: global.postMessage, onmessage: global.onmessage };
afterAll(() => Object.assign(global, was));

test("every range the worker asks for, an ordinary ask and a fresh one alike, is asked past the browser's cache", async () => {
  const asked: RequestInit[] = [];
  let answered = 0;
  let done = (): void => {};
  const both = new Promise<void>((go) => (done = go));
  global.fetch = async (_url: string, init: RequestInit): Promise<Response> => {
    asked.push(init);
    return new Response(new Uint8Array(4), { status: 206 });
  };
  global.postMessage = (m: { slot?: number }) => void (m.slot !== undefined && ++answered === 2 && done());
  await import("../../client/assets/assets-worker.ts");
  const ask = (slot: number, fresh: boolean) => (global.onmessage as (e: { data: unknown }) => void)({ data: { ask: { slot, generation: 1, url: "assets/textures", parts: [{ offset: slot * 4, length: 4, hash: "" }], fresh } } });
  ask(1, false);
  ask(2, true);
  await both;
  // A fresh ask skips the worker's own copy and may go first.
  expect(asked.map((r) => [r.cache, (r.headers as Record<string, string>).range]).sort((a, b) => (a[1]! < b[1]! ? -1 : 1))).toEqual([
    ["no-store", "bytes=4-7"],
    ["no-store", "bytes=8-11"],
  ]);
});
