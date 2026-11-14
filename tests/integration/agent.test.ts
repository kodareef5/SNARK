// An agent that plays, driven in process: its tools are called over the protocol while the harness runs the world.

import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadKey, manifestUrl, parseArgs } from "../../agent/main.ts";
import { INVALID_PARAMS, INVALID_REQUEST, NO_METHOD, PARSE_ERROR } from "../../agent/mcp.ts";
import { V_FOOD } from "../../shared/sim/vitals.ts";
import { play } from "../fixtures/agent.ts";

const dir = mkdtempSync(join(tmpdir(), "snark-agent-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

test("the protocol: a malformed line gets the parse error, a notification gets nothing, and what is not there is said not to be", async () => {
  const p = play();
  expect(JSON.parse((await p.line("{not json"))!)).toEqual({ jsonrpc: "2.0", id: null, error: { code: PARSE_ERROR, message: "Parse error" } });
  expect(JSON.parse((await p.line("[]"))!).error.code).toBe(INVALID_REQUEST);
  expect(JSON.parse((await p.line('{"id":4,"method":"ping"}'))!)).toMatchObject({ id: 4, error: { code: INVALID_REQUEST } });
  expect(await p.line('{"jsonrpc":"2.0","method":"notifications/initialized"}')).toBeNull();
  expect(await p.line("")).toBeNull();
  expect(JSON.parse((await p.line('{"jsonrpc":"2.0","id":"a","method":"ping"}'))!)).toEqual({ jsonrpc: "2.0", id: "a", result: {} });

  const hello = await p.ask("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "0" } });
  expect(hello!.result).toMatchObject({ protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "snark" } });
  expect((await p.ask("initialize", { protocolVersion: "1999-01-01" }))!.result.protocolVersion).toBe("2025-06-18");
  expect((await p.ask("resources/list"))!.error!.code).toBe(NO_METHOD);
  expect((await p.ask("tools/call", { name: "fly", arguments: {} }))!.error!.code).toBe(INVALID_PARAMS);
  expect((await p.ask("tools/call", { name: "say" }))!.result.isError).toBe(true);
  // Every tool says what it takes.
  for (const tool of (await p.ask("tools/list"))!.result.tools) expect([typeof tool.name, tool.description.length > 20, tool.inputSchema.type]).toEqual(["string", true, "object"]);
});

test("the key that owns the name is made once, for its owner alone, and the arguments are checked", () => {
  const key = loadKey(dir, "Scout");
  expect(key.length).toBe(16);
  const file = join(dir, "agent-Scout.key");
  expect(readFileSync(file, "utf8")).toMatch(/^[0-9a-f]{32}\n$/);
  expect(statSync(file).mode & 0o777).toBe(0o600);
  expect(loadKey(dir, "Scout")).toEqual(key);
  expect(loadKey(dir, "Other")).not.toEqual(key);

  expect(parseArgs(["--url", "wss://play.example/ws", "--name", "Scout", "--console"])).toEqual({ url: "wss://play.example/ws", name: "Scout", console: true });
  expect(parseArgs(["--name", "Scout"])).toEqual({ url: "ws://localhost:8787/ws", name: "Scout", console: false });
  for (const bad of [[], ["--name", "../x"], ["--name", "Scout", "--url", "http://x"], ["--name"], ["--fly"]]) expect(typeof parseArgs(bad)).toBe("string");
  expect(manifestUrl("ws://localhost:8787/ws")).toBe("http://localhost:8787/assets/manifest.json");
  expect(manifestUrl("wss://play.example/ws")).toBe("https://play.example/assets/manifest.json");
});

test("say is heard by another survivor, the sixth line at once is refused, and the console is a tool only when asked for", async () => {
  const p = play();
  const bo = p.h.join("bo");
  p.run(300);
  expect(await p.call("say", { channel: "global", text: "anyone about?" })).toEqual({ state: "done", said: "anyone about?" });
  expect(bo.log.map((l) => l.text)).toContain("Scout: anyone about?");
  expect(await p.call("say", { channel: "tribe", text: "hello" })).toMatchObject({ state: "blocked", reason: "You are not in a tribe." });
  expect((await p.call("say", { channel: "shout", text: "hello" })).state).toBe("refused");
  for (let n = 0; n < 3; n++) expect((await p.call("say", { channel: "local", text: `line ${n}` })).state).toBe("done");
  expect(await p.call("say", { channel: "local", text: "one too many" })).toMatchObject({ state: "refused" });
  expect(bo.log.some((l) => l.text.includes("one too many"))).toBe(false);
  // What others say is told with the next status, once.
  bo.chat(2, "over here");
  p.run(300);
  expect((await p.call("status")).heard).toContain("[global] bo: over here");
  expect((await p.call("status")).heard).toEqual([]);
  p.run(2000);
  expect((await p.call("say", { channel: "local", text: "and again" })).state).toBe("done");

  expect((await p.ask("tools/list"))!.result.tools.map((t: { name: string }) => t.name)).toContain("console");
  expect(await p.call("console", { line: "enablecheats" })).toEqual({ state: "done", lines: ["cheats enabled"] });
  const plain = play({}, {});
  expect((await plain.ask("tools/list"))!.result.tools.map((t: { name: string }) => t.name)).not.toContain("console");
  expect((await plain.ask("tools/call", { name: "console", arguments: { line: "enablecheats" } }))!.error!.code).toBe(INVALID_PARAMS);
  expect(plain.s.admin).toBe(false);
});

test("status tells what is carried, eat feeds, craft makes what is known, and move_item moves a stack", async () => {
  const p = play();
  expect((await p.call("console", { line: "enablecheats" })).state).toBe("done");
  // A second line in the same instant is one too many.
  expect(await p.call("console", { line: "give berry 10" })).toEqual({ state: "refused", reason: "one console line every 200 ms" });
  for (const line of ["give berry 10", "give stone 3", "give wood 3", "give thatch 30"]) {
    p.run(200);
    expect((await p.call("console", { line })).lines).toEqual([`gave ${line.split(" ")[2]} core:${line.split(" ")[1]}`]);
  }
  let status = await p.call("status");
  expect(status).toMatchObject({ state: "done", self: { x: 256, z: 240, facing: "N", alive: true, health: [100, 100], food: [100, 100], level: 1, held: null } });
  expect(status.inventory).toEqual([[0, "berry", 10], [1, "stone", 3], [2, "wood", 3], [3, "thatch", 30]]);

  p.h.host.survival.add(p.rec, V_FOOD, -30);
  const ate = await p.call("eat");
  expect(ate).toMatchObject({ state: "done", ate: "berry", self: { food: [74, 100] } });
  expect(await p.call("eat", { item: "stone" })).toMatchObject({ state: "blocked" });
  expect(await p.call("eat", { item: "meat" })).toEqual({ state: "refused", reason: "you carry no meat" });

  // Nothing is made before its engram is learned. A pick's costs nothing, and a hatchet's takes a level this survivor has not reached.
  expect(await p.call("craft", { recipe: "pick" })).toEqual({ state: "refused", reason: "you have not learned pick: it takes level 1 and 0 engram points, and learn: true spends them" });
  expect(await p.call("craft", { recipe: "pick", learn: true })).toEqual({ state: "done", item: "pick", made: 1 });
  expect(p.h.host.items.inv(p.rec).total(p.id("pick"))).toBe(1);
  expect((await p.call("craft", { recipe: "hatchet", learn: true })).reason).toBe("could not learn hatchet (level 2, 3 points): not enough points, level or ingredients");
  // There is enough left for two more.
  expect(await p.call("craft", { recipe: "pick", count: 5 })).toEqual({ state: "blocked", item: "pick", made: 2, reason: "the ingredients ran out", needs: { stone: 1, wood: 1, thatch: 10 } });
  expect(await p.call("craft", { recipe: "pick" })).toMatchObject({ state: "blocked", needs: { stone: 1, wood: 1, thatch: 10 } });
  expect((await p.call("craft", { recipe: "boulder" })).state).toBe("refused");

  status = await p.call("status");
  const pick = (status.inventory as [number, string, number, string?][]).find((row) => row[1] === "pick")!;
  expect(pick[3]).toBe("60 uses left");
  const hotbar = (status.hotbar_slots as number[])[0]!;
  expect(await p.call("move_item", { from: "self", slot: pick[0], to: "self", to_slot: hotbar })).toMatchObject({ state: "done", moved: "pick", to_slot: hotbar, left: 0 });
  expect(p.h.host.items.inv(p.rec).item[hotbar]).toBe(p.id("pick"));
  expect((await p.call("move_item", { from: "self", slot: 0, to: "box" })).state).toBe("refused");
  expect((await p.call("move_item", { from: "self", slot: 39, to: "self", to_slot: 0 })).state).toBe("refused");
  expect(p.h.host.items.audit()).toEqual([]);
});

test("commands go out no faster than ten a second", async () => {
  const p = play();
  const answers = await Promise.all(Array.from({ length: 12 }, () => p.call("eat")));
  // None carries food, so each is refused before anything is sent, and the pace is not spent.
  expect(answers.every((a) => a.reason === "you carry nothing to eat")).toBe(true);
  p.h.host.items.mint(p.rec, p.id("berry"), 30);
  p.run(100);
  const eaten = await Promise.all(Array.from({ length: 12 }, () => p.call("eat")));
  expect(eaten.filter((a) => a.state === "done").length).toBe(10);
  expect(eaten.filter((a) => a.state === "refused").length).toBe(2);
  expect(p.h.host.items.inv(p.rec).total(p.id("berry"))).toBe(20);
});
