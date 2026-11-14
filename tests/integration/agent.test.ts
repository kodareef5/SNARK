// An agent that plays, driven in process: its tools are called over the protocol while the harness runs the world.

import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileUrl, loadKey, parseArgs } from "../../agent/main.ts";
import { INVALID_PARAMS, INVALID_REQUEST, NO_METHOD, PARSE_ERROR, type Answer } from "../../agent/mcp.ts";
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
  expect(fileUrl("ws://localhost:8787/ws", "assets/manifest.json")).toBe("http://localhost:8787/assets/manifest.json");
  expect(fileUrl("wss://play.example/ws", "map.json")).toBe("https://play.example/map.json");
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

/** The letter observe shows for the square that holds (x, z), found the way its `map` line tells a reader to. */
function letterAt(seen: Answer, x: number, z: number): string {
  const [, cell, x0, z0] = /square of (\d+) m\. The top left one is centred on x ([\d.]+), z ([\d.]+)\./.exec(seen.map as string)!.map(Number);
  return (seen.grid as string[])[Math.round((z0! - (Math.floor(z / cell!) + 0.5) * cell!) / cell!)]![Math.round((x0! - (Math.floor(x / cell!) + 0.5) * cell!) / cell!)]!;
}

test("observe shows the house with its doorway, the pool and the slopes, and lists what is near by id", async () => {
  const p = play();
  const wide = await p.call("observe", { radius: 96, cell: 4 });
  expect((wide.grid as string[]).length).toBe(49);
  // Itself, the pool, the cliff at the side of the slopes' plateau, and open ground.
  expect([letterAt(wide, 256, 240), letterAt(wide, 172, 256), letterAt(wide, 243, 310), letterAt(wide, 256, 200)]).toEqual(["@", "~", "^", "."]);
  // The 24 m wall is 0.2 m thick and stands on the line between two squares. It shows whole.
  for (let x = 277; x < 300; x += 4) expect(letterAt(wide, x, 262.05)).toBe("#");
  const usual = await p.call("observe");
  expect((usual.grid as string[]).length).toBe(33);
  expect(JSON.stringify(usual).length).toBeLessThan(1800);
  // A letter of 1 m shows no further than 32 m, whatever is asked.
  expect(((await p.call("observe", { radius: 96, cell: 1 })).grid as string[]).length).toBe(65);
  expect((await p.call("observe", { cell: 3 })).state).toBe("refused");

  await p.call("console", { line: "enablecheats" });
  p.run(200);
  await p.call("console", { line: "tp 239 262" });
  const grazer = p.h.host.spawnCreature("core:parasaur", 243, 264, 3);
  const box = p.h.world.structs.add(p.id("storage_box"), 233.5, 0.3125, 262.5, 0, p.rec.team, 500);
  const bo = p.h.join("bo");
  p.run(600);
  const near = await p.call("observe", { radius: 32, cell: 1 });
  // South wall, doorway, inside, west wall, and the ground outside it.
  expect([[240.5, 270.2], [237.5, 270.2], [239.5, 273.5], [236.2, 273.5], [235.5, 273.5]].map(([x, z]) => letterAt(near, x!, z!))).toEqual(["#", ".", ".", "#", "."]);
  const ents = p.h.world.ents;
  const [seen] = near.creature as [string, string, number, number, number, string, string, string][];
  expect([seen![0], seen![1], seen![6], seen![7], (near.creature as unknown[]).length]).toEqual([`e${grazer}`, "parasaur", "level 3", "wild", 1]);
  expect(Math.hypot(seen![2] - ents.x[grazer]!, seen![3] - ents.z[grazer]!)).toBeLessThan(1.5);
  expect(letterAt(near, seen![2], seen![3])).toMatch(/c|@/);
  expect(near.box).toEqual([[`s${box}`, "storage_box", 234, 263, 6, "E"]]);
  expect(near.player).toEqual([[`e${p.h.ent(bo)}`, "bo", 256, 240, 28, "SW"]]);
  expect([letterAt(near, 233.5, 262.5), letterAt(near, 239, 262), letterAt(near, 250, 262)]).toEqual(["B", "@", "#"]);
  expect(near.tree).toBeUndefined();

  // Among the trees every id names the node the server has in that slot.
  p.run(200);
  await p.call("console", { line: "tp 256 150" });
  p.run(600);
  const woods = await p.call("observe", { radius: 24, cell: 1 });
  const trees = woods.tree as [string, number, number, number, string][];
  expect(trees.length).toBeGreaterThan(4);
  for (const [id, x, z, far] of trees) {
    const [chunk, slot] = id.slice(1).split(".").map(Number);
    const t = p.h.world.nodeField!.store.chunks[chunk!]!;
    expect([t.kind[slot!], Math.round(t.x[slot!]!), Math.round(t.z[slot!]!)]).toEqual([p.id("tree"), x, z]);
    expect(letterAt(woods, t.x[slot!]!, t.z[slot!]!)).toBe("T");
    expect(far).toBe(Math.round(Math.hypot(t.x[slot!]! - 256, t.z[slot!]! - 150)));
  }
  expect(trees.map((t) => t[3])).toEqual(trees.map((t) => t[3]).sort((a, b) => a - b));
  expect((woods.rock as unknown[]).length).toBeGreaterThan(0);
  expect((woods.bush as unknown[]).length).toBeGreaterThan(0);
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

test("a call left waiting when the server goes is answered, and so is every call after", async () => {
  const p = play();
  const walking = p.call("walk_to", { x: 256, z: 200 });
  p.run(500);
  p.h.ends[0]!.peer.close();
  expect(await walking).toEqual({ state: "refused", reason: "not connected (reason -1)" });
  expect(await p.call("status")).toEqual({ state: "refused", reason: "not connected (reason -1)" });
  expect((await p.ask("tools/list"))!.result.tools.length).toBe(11);
});
