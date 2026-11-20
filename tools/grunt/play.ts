// Plays a scenario: the mock world on a WebSocket in this process, Pi in RPC mode with grunt and a model as the
// character's Director, the scenario's instruction given, its script of events run, and its success checked in the
// world. Prints a report: done or not, how long, the model's turns, tool calls and cost, and where the trace is.
//
//   bun tools/grunt/play.ts grunt/scenarios/chop-grove.json [--model openrouter/anthropic/claude-haiku-5.5]
//                                                          [--thinking low] [--seconds 300] [--show]

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { GameEndpoint } from "./game.ts";
import { makeWorld, type Scene } from "./scenes.ts";
import { PIECES, TICK_MS, type World } from "./world.ts";

export type Check =
  | { all: Check[] }
  | { alive: true }
  | { have: string; at_least: number }
  | { none_near: string; of: [number, number]; within: number }
  | { said: string }
  | { near: string; within: number }
  | { built: Record<string, number> }
  | { hut_2x2: true };

export interface Scenario {
  name: string;
  about: string;
  world: Scene;
  owners?: string[];
  prompt: string;
  script?: ({ at_s: number; say: { from: string; text: string } } | { at_s: number; prompt: string })[];
  success: Check;
  budget: { seconds: number };
}

export function check(c: Check, w: World): boolean {
  if ("all" in c) return c.all.every((x) => check(x, w));
  if ("alive" in c) return w.me.alive;
  if ("have" in c) return w.count(c.have) >= c.at_least;
  if ("none_near" in c) return ![...w.things.values()].some((t) => t.type === c.none_near && Math.hypot(t.x - c.of[0], t.z - c.of[1]) <= c.within);
  if ("said" in c) return w.said.some((s) => new RegExp(c.said, "i").test(s.text));
  if ("near" in c) return [...w.things.values()].some((t) => (t.name === c.near || t.id === c.near) && Math.hypot(t.x - w.me.x, t.z - w.me.z) <= c.within);
  if ("built" in c) return Object.entries(c.built).every(([piece, n]) => [...w.things.values()].filter((t) => t.type === piece).length >= n);
  return hut(w);
}

/** Four foundations in a square, every outer edge walled (one a doorframe with its door), and a ceiling over each. */
function hut(w: World): boolean {
  const pieces = [...w.things.values()].filter((t) => (PIECES as readonly string[]).includes(t.type));
  const f = pieces.filter((t) => t.type === "wood_foundation");
  for (const a of f) {
    const square = [[0, 0], [3, 0], [0, 3], [3, 3]].map(([dx, dz]) => f.find((b) => b.x === a.x + dx! && b.z === a.z + dz!));
    if (square.some((x) => !x)) continue;
    const edges: string[] = [];
    for (let i = 0; i < 2; i++) {
      edges.push(`${a.x + i * 3},${a.z - 1.5}`, `${a.x + i * 3},${a.z + 4.5}`, `${a.x - 1.5},${a.z + i * 3}`, `${a.x + 4.5},${a.z + i * 3}`);
    }
    const on = (e: string) => pieces.filter((p) => p.piece?.edge === e);
    if (!edges.every((e) => on(e).some((p) => p.type === "wood_wall" || p.type === "wood_doorframe"))) continue;
    if (!edges.some((e) => on(e).some((p) => p.type === "wood_doorframe") && on(e).some((p) => p.type === "wood_door"))) continue;
    if (square.every((s) => pieces.some((p) => p.type === "wood_ceiling" && p.x === s!.x && p.z === s!.z))) return true;
  }
  return false;
}

const arg = (name: string, d?: string) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1]! : d;
};

if (import.meta.main) {
  const file = process.argv[2];
  if (!file) throw new Error("usage: bun tools/grunt/play.ts <scenario.json> [--model …] [--thinking …] [--seconds …] [--show]");
  const sc = JSON.parse(readFileSync(file, "utf8")) as Scenario;
  const model = arg("--model", "openrouter/anthropic/claude-haiku-5.5")!;
  const thinking = arg("--thinking", "low")!;
  const seconds = Number(arg("--seconds", String(sc.budget.seconds)));
  const show = process.argv.includes("--show");
  const root = join(import.meta.dir, "../..");

  const world = makeWorld(sc.world);
  const game = new GameEndpoint(world);
  type Data = { conn?: ReturnType<GameEndpoint["connect"]> };
  const server = Bun.serve<Data>({
    hostname: "127.0.0.1", port: 0,
    fetch: (req, srv) => (srv.upgrade(req, { data: {} }) ? undefined : new Response("grunt mock")),
    websocket: {
      open: (ws) => void (ws.data.conn = game.connect((m) => ws.send(JSON.stringify(m)))),
      message: (ws, msg) => ws.data.conn?.receive(String(msg)),
      close: (ws) => ws.data.conn?.close(),
    },
  });
  const loop = setInterval(() => {
    world.step();
    game.afterStep();
  }, TICK_MS);

  const tools = ["game_connect", "game_look", "game_skills", "game_do", "game_tasks", "game_stop", "game_say"];
  const pi = spawn("pi", ["--mode", "rpc", "--no-session", "-ne", "-ns", "-e", root, "--tools", tools.join(","), "--model", model, "--thinking", thinking], { stdio: ["pipe", "pipe", "pipe"] });
  pi.stderr.on("data", (d) => show && process.stderr.write(d));
  pi.stdin.on("error", () => {});
  const send = (m: object) => pi.stdin.write(JSON.stringify(m) + "\n");
  let modelError = "";
  const calls: { s: number; tool: string; args: unknown; ms?: number; error?: boolean }[] = [];
  const said: string[] = [];
  let turns = 0, cost = 0, input = 0, output = 0, trace = "", busy = false;
  createInterface({ input: pi.stdout }).on("line", (line) => {
    let e: Record<string, any>;
    try {
      e = JSON.parse(line);
    } catch {
      return;
    }
    const s = Math.round(world.t / 100) / 10;
    if (e.type === "agent_start") busy = true;
    if (e.type === "agent_settled") busy = false;
    if (e.type === "extension_ui_request" && e.method === "notify") {
      const m = /trace (\S+)/.exec(String(e.message));
      if (m) trace = m[1]!;
      if (show) console.log(`${s}s [notify] ${e.message}`);
    }
    if (e.type === "tool_execution_start") {
      calls.push({ s, tool: e.toolName, args: e.args });
      if (show) console.log(`${s}s → ${e.toolName} ${JSON.stringify(e.args)}`);
    }
    if (e.type === "tool_execution_end") {
      const c = calls.findLast((x) => x.tool === e.toolName && x.ms === undefined);
      if (c) (c.ms = e.durationMs), (c.error = !!e.isError);
      if (show) console.log(`${s}s ← ${e.toolName}${e.isError ? " ERROR" : ""} ${JSON.stringify(e.result?.content?.[0]?.text ?? "").slice(0, 220)}`);
    }
    if (e.type === "message_end" && e.message?.role === "assistant") {
      turns++;
      if (e.message.stopReason === "error") {
        modelError = String(e.message.errorMessage ?? "the model call failed").slice(0, 300);
        if (show) console.log(`${s}s [model error] ${modelError}`);
      }
      const u = e.message.usage;
      if (u) (cost += u.cost?.total ?? 0), (input += u.input ?? 0), (output += u.output ?? 0);
      const t = (e.message.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text).join(" ").trim();
      if (t) said.push(t);
      if (show && t) console.log(`${s}s [model] ${t.slice(0, 300)}`);
    }
    if (e.type === "message_end" && e.message?.role === "custom" && show) console.log(`${s}s [game→model] ${String(e.message.content).slice(0, 200)}`);
  });

  const url = `ws://127.0.0.1:${server.port}/grunt`;
  send({ id: "c", type: "prompt", message: `/grunt connect ${url} ${sc.world.me?.name ?? "Scout"} ${(sc.owners ?? []).join(" ")}`.trim() });
  setTimeout(() => send({ id: "p", type: "prompt", message: sc.prompt }), 1500);
  const started = world.t;
  const done = new Set<number>();
  const result = await new Promise<"success" | "timeout" | "died" | "model_error">((resolve) => {
    const watch = setInterval(() => {
      const el = (world.t - started) / 1000;
      (sc.script ?? []).forEach((ev, i) => {
        if (done.has(i) || el < ev.at_s) return;
        done.add(i);
        if ("say" in ev) world.say(ev.say.from, ev.say.text, "local", [...world.things.values()].find((t) => t.name === ev.say.from)?.id);
        else send({ type: "prompt", message: ev.prompt, streamingBehavior: "followUp" });
        if (show) console.log(`${el.toFixed(1)}s [script] ${JSON.stringify(ev)}`);
      });
      const allDone = done.size === (sc.script ?? []).length;
      if (modelError) (clearInterval(watch), resolve("model_error"));
      else if (allDone && check(sc.success, world) && !busy) (clearInterval(watch), resolve("success"));
      else if (!world.me.alive) (clearInterval(watch), resolve("died"));
      else if (el > seconds) (clearInterval(watch), resolve("timeout"));
    }, 500);
  });
  clearInterval(loop);
  pi.stdin.end();
  const gone = new Promise((r) => pi.once("exit", r));
  setTimeout(() => pi.kill("SIGTERM"), 500);
  await Promise.race([gone, new Promise((r) => setTimeout(r, 4000))]);
  server.stop(true);
  const byTool: Record<string, number> = {};
  for (const c of calls) byTool[c.tool] = (byTool[c.tool] ?? 0) + 1;
  console.log(JSON.stringify({
    scenario: sc.name, model, thinking, result, seconds: Math.round((world.t - started) / 100) / 10, turns, tool_calls: byTool,
    tokens: { input, output }, cost_usd: Math.round(cost * 10000) / 10000,
    world: { alive: world.me.alive, health: world.me.health, pos: [Math.round(world.me.x), Math.round(world.me.z)], inventory: world.me.slots.map((s) => `${s.item}×${s.count}`), said: world.said.map((s) => s.text) },
    last_words: said.at(-1)?.slice(0, 400), trace, ...(modelError ? { model_error: modelError } : {}),
  }, null, 1));
  process.exit(result === "success" ? 0 : 1);
}
