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
import { BLUEPRINTS } from "../../grunt/blueprints.ts";
import { compile, type Layout } from "../../grunt/layout.ts";
import { GameEndpoint } from "./game.ts";
import { makeWorld, type Scene } from "./scenes.ts";
import { slot } from "./structures.ts";
import { TICK_MS, type World } from "./world.ts";

export type Check =
  | { all: Check[] }
  | { alive: true }
  | { have: string; at_least: number }
  | { none_near: string; of: [number, number]; within: number }
  | { said: string }
  | { near: string; within: number }
  | { built: Record<string, number> }
  | { hut_2x2: true }
  | { hut_south_of: number }
  /** A layout (a library name, or one written out) stands, whole, in any turn; in a tier if one is named; its ground
   * floor south of a line if `south_of` is given. */
  | { stands: string | Layout; tier?: string; south_of?: number }
  /** A container (by name) holds at least these. */
  | { holds: string; items: Record<string, number> }
  /** Containers (by name) hold nothing. */
  | { emptied: string[] }
  /** A thing (by name) is within so many metres of a point. */
  | { where: string; at: [number, number]; within: number }
  /** No hostile creature is left alive. */
  | { none_hostile: true }
  /** Every structure piece whole (nothing left damaged). */
  | { whole: true }
  /** The check does not hold. */
  | { not: Check }
  /** A thing (by name) alive: a player's health above nothing. */
  | { lives: string }
  /** Some base has at least these pieces, and a ceiling over every foundation if `roofed`. */
  | { base_has: Partial<Record<string, number>>; roofed?: boolean }
  | { at: [number, number]; within: number };

export interface Scenario {
  name: string;
  about: string;
  world: Scene;
  owners?: string[];
  prompt: string;
  /** At a time: a line said, or a prompt from the user; once so many pieces stand: a rock dropped on a foundation's cell
   * the running build has yet to reach. */
  script?: (
    | { at_s: number; say: { from: string; text: string; channel?: string } }
    | { at_s: number; speak: { from: string; text: string } }
    | { at_s: number; damage: { x: number; z: number; radius: number; amount: number } }
    | { at_s: number; prompt: string }
    | { at_s: number; at_built: number; drop: "rock" }
  )[];
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
  if ("at" in c && !("where" in c)) return Math.hypot(w.me.x - c.at[0], w.me.z - c.at[1]) <= c.within;
  if ("hut_south_of" in c) return stands(w, "hut_2x2", undefined, c.hut_south_of);
  if ("stands" in c) return stands(w, c.stands, c.tier, c.south_of);
  if ("whole" in c) return w.wholeStructures();
  const named = (n: string) => [...w.things.values()].find((t) => t.name === n);
  if ("holds" in c) {
    const slots = named(c.holds)?.slots ?? [];
    return Object.entries(c.items).every(([i, n]) => slots.filter((x) => x.item === i).reduce((k, x) => k + x.count, 0) >= n);
  }
  if ("emptied" in c) return c.emptied.every((n) => (named(n)?.slots ?? [1]).length === 0);
  if ("where" in c) {
    const t = named(c.where);
    return !!t && Math.hypot(t.x - c.at[0], t.z - c.at[1]) <= c.within;
  }
  if ("none_hostile" in c) return ![...w.things.values()].some((t) => t.kind === "creature" && !t.tame);
  if ("not" in c) return !check(c.not, w);
  if ("lives" in c) return [...w.things.values()].some((t) => t.name === c.lives && t.left > 0);
  if ("base_has" in c) {
    return [...w.structures.bases.values()].some((b) => {
      const pieces = [...w.things.values()].filter((t) => t.piece?.base === b.id).map((t) => t.piece!);
      const n = (f: string) => pieces.filter((p) => p.form === f).length;
      const roofed = !c.roofed || pieces.filter((p) => p.form === "foundation").every((f) => pieces.some((p) => p.form === "ceiling" && p.level === 0 && p.cell[0] === f.cell[0] && p.cell[1] === f.cell[1]) || pieces.some((p) => p.form === "stairs" && p.level === 0 && p.cell[0] === f.cell[0] && p.cell[1] === f.cell[1]));
      return roofed && Object.entries(c.base_has).every(([f, k]) => n(f) >= (k ?? 0));
    });
  }
  return stands(w, "hut_2x2");
}

/** Whether a layout stands whole on some base: every piece of it, in some quarter turn and some offset on that base's
 * grid, of the form it should be (and the tier, if named). */
export function stands(w: World, what: string | Layout, tier?: string, southOf?: number): boolean {
  const layout = typeof what === "string" ? BLUEPRINTS[what] : what;
  if (!layout) return false;
  const want = compile(layout).pieces;
  const SIDES = ["n", "e", "s", "w"] as const;
  for (const base of w.structures.bases.values()) {
    const pieces = [...w.things.values()].filter((t) => t.piece?.base === base.id);
    const at = new Map(pieces.map((t) => [slot(t.piece!), t]));
    const foundations = pieces.filter((t) => t.piece!.form === "foundation");
    for (let turns = 0; turns < 4; turns++) {
      const turned = want.map((p) => {
        let [i, j] = p.cell;
        let side = p.side;
        for (let k = 0; k < turns; k++) {
          [i, j] = [-j, i];
          if (side) side = SIDES[(SIDES.indexOf(side) + 1) % 4];
          // A pillar stands at its cell's north-west corner, which a turn moves to another corner.
          if (p.form === "pillar") i += 1;
        }
        return { ...p, cell: [i, j] as [number, number], ...(side ? { side } : {}) };
      });
      const first = turned.find((p) => p.form === "foundation");
      if (!first) continue;
      for (const f of foundations) {
        const [oi, oj] = [f.piece!.cell[0] - first.cell[0], f.piece!.cell[1] - first.cell[1]];
        const all = turned.every((p) => {
          const t = at.get(slot({ ...p, cell: [p.cell[0] + oi, p.cell[1] + oj] }));
          return !!t && t.piece!.form === p.form && (!tier || t.piece!.tier === tier);
        });
        if (all && (southOf === undefined || foundations.every((t) => t.z > southOf))) return true;
      }
    }
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
  // The world holds still until the Director has the instruction, so nothing happens to the character before it knows
  // what it is there for.
  let running = false;
  const loop = setInterval(() => {
    if (!running) return;
    world.step();
    game.afterStep();
  }, TICK_MS);

  // Tools this version of grunt registers: an older one (an arm of a comparison) may lack game_goal, which Pi ignores.
  const tools = ["game_connect", "game_look", "game_skills", "game_do", "game_tasks", "game_stop", "game_say", "game_goal", "game_blueprints"];
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
    if (e.type === "response" && e.id === "p") {
      if (e.success === false) modelError = `the instruction was refused: ${JSON.stringify(e.error ?? e).slice(0, 200)}`;
      else running = true;
      if (show) console.log(`${s}s [instruction] ${e.success === false ? "refused" : "accepted"}`);
    }
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
  setTimeout(() => send({ id: "p", type: "prompt", message: sc.prompt, streamingBehavior: "followUp" }), 1500);
  const started = world.t;
  const wallStart = Date.now();
  const done = new Set<number>();
  const result = await new Promise<"success" | "timeout" | "died" | "model_error">((resolve) => {
    const watch = setInterval(() => {
      const el = (world.t - started) / 1000;
      (sc.script ?? []).forEach((ev, i) => {
        if (done.has(i) || el < ev.at_s) return;
        if ("drop" in ev) {
          const spot = [...world.things.values()].filter((t) => t.piece).length >= ev.at_built ? world.planAhead() : null;
          if (!spot) return;
          done.add(i);
          world.place("resource", ev.drop, spot.x, spot.z);
          if (show) console.log(`${el.toFixed(1)}s [script] dropped a ${ev.drop} at ${spot.x}, ${spot.z}`);
          return;
        }
        done.add(i);
        const who = (n: string) => [...world.things.values()].find((t) => t.name === n)?.id;
        if ("say" in ev) world.say(ev.say.from, ev.say.text, ev.say.channel ?? "local", who(ev.say.from));
        else if ("speak" in ev) world.speak(who(ev.speak.from) ?? "", ev.speak.text);
        else if ("damage" in ev) world.damage(ev.damage.x, ev.damage.z, ev.damage.radius, ev.damage.amount);
        else send({ type: "prompt", message: ev.prompt, streamingBehavior: "followUp" });
        if (show) console.log(`${el.toFixed(1)}s [script] ${JSON.stringify(ev)}`);
      });
      const allDone = done.size === (sc.script ?? []).length;
      if (!running && Date.now() - wallStart > 30000) modelError ||= "the instruction was never answered";
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
