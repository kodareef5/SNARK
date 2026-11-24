import { expect, test } from "bun:test";
import { constrainedConnection, startupBudget, StartupQueue, survivorPreview } from "../../client/entry/startup-budget.ts";

const file = (url: string, rank = 0, wireLimit = 24, decodedLimit = 64) => ({ url, rank, wireLimit, decodedLimit, keep: true });
const signal = () => new AbortController().signal;
const tick = () => new Promise<void>((done) => setTimeout(done, 0));
const small = () => new Response("cached", { headers: { "content-length": "6" } });

test("a constrained connection spends no speculative startup bytes", () => {
  for (const hint of [{ saveData: true }, { effectiveType: "3g" }, { downlink: 0.8 }, { rtt: 400 }]) {
    expect(constrainedConnection(hint)).toBe(true);
    expect(startupBudget(hint)).toBe(0);
  }
  expect(startupBudget()).toBe(3 * 1024 * 1024);
  expect(startupBudget({ effectiveType: "4g", downlink: 10 })).toBe(4 * 1024 * 1024);
});

test("a survivor preview needs consent on a slow link and a visible tab", () => {
  const hints = [{ saveData: true }, { effectiveType: "3g" }];
  for (const hint of hints) {
    expect(survivorPreview(hint, false, false)).toBe(false);
    expect(survivorPreview(hint, false, true)).toBe(true);
    expect(survivorPreview(hint, true, true)).toBe(false);
  }
  expect(survivorPreview(undefined, false, false)).toBe(true);
  expect(survivorPreview(undefined, true, false)).toBe(false);
});

test("first-frame work takes priority and duplicate callers share one transfer", async () => {
  const pending: { url: string; done: (response: Response) => void }[] = [];
  const queue = new StartupQueue((url) => new Promise((done) => pending.push({ url, done })), 100);
  const ground = queue.ask(file("/ground", 1), signal());
  const head = queue.ask(file("/head", 3), signal());
  const boot = queue.ask(file("/boot", 2), signal());
  const same = queue.ask(file("/head", 3), signal());
  await tick();
  expect(pending.map((p) => p.url)).toEqual(["/head", "/boot"]);
  pending[0]!.done(small());
  expect(await same).toEqual(await head);
  await tick();
  expect(pending.map((p) => p.url)).toEqual(["/head", "/boot", "/ground"]);
  pending[1]!.done(small());
  pending[2]!.done(small());
  expect((await boot)?.bytes).toBe(6);
  expect((await ground)?.bytes).toBe(6);
  expect(await queue.ask(file("/head"), signal())).toEqual(await head);
  expect(pending).toHaveLength(3);
});

test("canceling one caller keeps a shared request until its last caller leaves", async () => {
  let network: AbortSignal | null = null;
  const queue = new StartupQueue((_url, init) => {
    const passed = init.signal!;
    network = passed;
    return new Promise((_done, reject) => passed.addEventListener("abort", () => reject(passed.reason), { once: true }));
  }, 100);
  const a = new AbortController(), b = new AbortController();
  const first = queue.ask(file("/head"), a.signal);
  const second = queue.ask(file("/head"), b.signal);
  await tick();
  a.abort();
  expect(await first).toBeNull();
  expect(network).toMatchObject({ aborted: false });
  b.abort();
  expect(await second).toBeNull();
  expect(network).toMatchObject({ aborted: true });
  queue.close();
  expect(await queue.ask(file("/boot"), signal())).toBeNull();
});

test("the transfer budget uses encoded bytes and caps unknown-length bodies", async () => {
  const requests: string[] = [];
  const queue = new StartupQueue(async (url) => {
    requests.push(url);
    if (url === "/compressed") return new Response("ab".repeat(15), { headers: { "content-length": "8", "content-encoding": "br" } });
    if (url === "/unknown") return new Response("ab".repeat(20));
    return small();
  }, 20, 1);
  expect((await queue.ask(file("/compressed", 1, 12), signal()))?.data?.length).toBe(30);
  expect(await queue.ask(file("/unknown", 1, 12), signal())).toBeNull();
  expect(await queue.ask(file("/unfunded", 1, 12), signal())).toBeNull();
  expect(requests).toEqual(["/compressed", "/unknown"]);
});

test("partial responses never populate whole-file warmups", async () => {
  const calls: { headers?: RequestInit["headers"]; priority: "low" }[] = [];
  const queue = new StartupQueue(async (_url, init) => {
    calls.push(init);
    return calls.length === 1 ? new Response("partial", { status: 206 }) : small();
  }, 100);
  expect(await queue.ask(file("/whole"), signal())).toBeNull();
  expect((await queue.ask(file("/whole"), signal()))?.bytes).toBe(6);
  expect(calls).toHaveLength(2);
  expect(calls.every((init) => !init.headers && init.priority === "low")).toBe(true);
});
