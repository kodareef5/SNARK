// A print's upload costs the world's thread under a millisecond (server/admin/people-routes.ts, people/png.ts): the server
// takes the body as it received it and hands it to the print's thread, which checks, hashes and writes it. Measured on a
// real server, sent from a thread of its own, by the world's thread's own clock of time on the processor: over the
// handler, and over the whole exchange, which takes in the server's receiving of the bytes.
import { FFIType, dlopen, ptr } from "bun:ffi";
import { afterAll, expect, test } from "bun:test";
import { peopleAdmin } from "../../server/admin/people-routes.ts";
import { checkPng, hashOf } from "../../server/people/png.ts";
import { PeopleStore } from "../../server/people/store.ts";
import { PRINT_BYTES_MAX } from "../../shared/people/doc.ts";
import { coreRegistry } from "../fixtures/world.ts";
import { encodePng } from "../../tools/snap/png.ts";

const store = new PeopleStore({ db: ":memory:" });
const reg = coreRegistry();
const spent: number[] = [];
const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  async fetch(req) {
    const from = cpuMs();
    const res = await peopleAdmin(req, "/admin/people/print", store, () => reg)!;
    spent.push(cpuMs() - from);
    return res;
  },
});
const sender = new Worker(new URL("../fixtures/print-sender.ts", import.meta.url).href);
afterAll(() => (sender.terminate(), server.stop(true), store.close(), libc.close()));

const libc = dlopen("libc.so.6", { clock_gettime: { args: [FFIType.i32, FFIType.ptr], returns: FFIType.i32 } });
const CLOCK_THREAD_CPUTIME_ID = 3;
const spec = new BigInt64Array(2);
/** The world's thread's own time on the processor so far, in ms. */
function cpuMs(): number {
  libc.symbols.clock_gettime(CLOCK_THREAD_CPUTIME_ID, ptr(spec));
  return Number(spec[0]) * 1e3 + Number(spec[1]) / 1e6;
}

/** Sends `bytes` from the sender's thread, and gives the status with the thread's time over the handler and the exchange. */
async function send(bytes: Uint8Array, length?: number): Promise<{ status: number; handler: number; exchange: number }> {
  const from = cpuMs(), was = spent.length;
  const status = await new Promise<number>((resolve) => {
    sender.onmessage = (e: MessageEvent<number>) => resolve(e.data);
    // Given over, not copied: a copy would be the test's cost on the thread, not the upload's.
    sender.postMessage({ url: `http://127.0.0.1:${server.port}/admin/people/print`, bytes, ...(length !== undefined ? { length } : {}) }, [bytes.buffer as ArrayBuffer]);
  });
  return { status, exchange: cpuMs() - from, handler: spent[was] ?? 0 };
}

/** The median over seven uploads of the thread's time over the handler and the exchange, each answered as `status`. */
async function median(bytes: () => Uint8Array, status: number, length?: number): Promise<{ handler: number; exchange: number }> {
  const runs: { handler: number; exchange: number }[] = [];
  for (let k = 0; k < 7; k++) {
    const got = await send(bytes(), length);
    expect(got.status).toBe(status);
    runs.push(got);
  }
  const mid = (key: "handler" | "exchange"): number => runs.map((r) => r[key]).sort((a, b) => a - b)[3]!;
  return { handler: mid("handler"), exchange: mid("exchange") };
}

function photo(w: number, h: number): Uint8Array {
  const rgba = new Uint8Array(w * h * 4);
  let seed = 11;
  for (let i = 0; i < w * h; i++) {
    seed = (seed * 1103515245 + 12345) >>> 0;
    const n = (seed >>> 24) % 5;
    rgba.set([((i % w) * 255) / w + n, (((i / w) | 0) * 255) / h + n, 128 + n, 255], i * 4);
  }
  return encodePng(w, h, rgba);
}

test("a print's upload costs the world's thread under a millisecond, hostile or not", async () => {
  const real = photo(512, 512);
  // The largest print there may be: noise, which does not compress, as near the cap as a square picture of it comes.
  const noise = encodePng(400, 400, crypto.getRandomValues(new Uint8Array(400 * 400 * 4)));
  const huge = real.slice();
  new DataView(huge.buffer).setUint32(16, 100_000);
  new DataView(huge.buffer).setUint32(29, Bun.hash.crc32(huge.subarray(12, 29)) >>> 0);
  const crc = real.slice();
  crc[1000] = crc[1000]! ^ 1;
  await median(() => real.slice(), 200);
  const cost = {
    photo: await median(() => real.slice(), 200),
    noise: await median(() => noise.slice(), 200),
    huge: await median(() => huge.slice(), 422),
    crc: await median(() => crc.slice(), 422),
    over: await median(() => new Uint8Array(PRINT_BYTES_MAX + 1), 413),
  };
  // What the same check costs where it is done on the thread itself, which the print's thread spares it.
  const from = performance.now();
  checkPng(noise);
  hashOf(noise);
  const inline = performance.now() - from;
  const round = (ms: number): number => Math.round(ms * 1000) / 1000;
  console.log(`people upload thread ms: ${JSON.stringify(Object.fromEntries(Object.entries(cost).map(([k, v]) => [k, [round(v.handler), round(v.exchange)]])))}; checked on the thread instead: ${inline.toFixed(3)} (${real.length} and ${noise.length} bytes)`);
  // A body refused by its length is still received by the server, as one sent to any path is: that is not the handler's.
  for (const [what, ms] of Object.entries(cost)) expect([what, ms.handler < 1, what === "over" || ms.exchange < 1]).toEqual([what, true, true]);
});
