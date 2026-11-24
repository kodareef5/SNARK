// Plays one instruction against a live game that speaks the grunt protocol (SNARK through agent/gateway.ts, or the
// mock's serve.ts): Pi in RPC mode with grunt and a model as the Director, connected as a character, given the
// instruction, watched for a time. Prints what the model did and said, and what it cost. No checks: a live world is
// judged by looking.
//
//   bun tools/grunt/live.ts --url ws://127.0.0.1:8771/grunt --name Scout [--owners Ana] [--seconds 180]
//                           [--model openrouter/anthropic/claude-haiku-5.5] [--inbox file] "Chop down a palm and tell me how much wood you got."
//
// --inbox names a file: each line appended to it while the run goes reaches the model as a further instruction.

import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, watchFile, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

const argv = process.argv.slice(2);
const opt = (k: string, d = "") => {
  const i = argv.indexOf(k);
  return i >= 0 ? argv[i + 1]! : d;
};
const instruction = argv.filter((a, i) => !a.startsWith("--") && !argv[i - 1]?.startsWith("--")).join(" ");
const url = opt("--url", "ws://127.0.0.1:8771/grunt"), name = opt("--name", "Scout"), owners = opt("--owners");
const inbox = opt("--inbox");
const seconds = Number(opt("--seconds", "180")), model = opt("--model", "openrouter/anthropic/claude-haiku-5.5");
if (!instruction) throw new Error("usage: bun tools/grunt/live.ts --url ws://… --name Scout [--seconds 180] \"instruction\"");

const root = join(import.meta.dir, "../..");
const tools = ["game_connect", "game_look", "game_skills", "game_do", "game_tasks", "game_stop", "game_say", "game_goal", "game_blueprints", "game_agenda"];
const state = mkdtempSync(join(tmpdir(), "grunt-agenda-"));
const pi = spawn("pi", ["--mode", "rpc", "--no-session", "-ne", "-ns", "-e", root, "--tools", tools.join(","), "--model", model, "--thinking", "low"], { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, GRUNT_STATE: state } });
pi.stdin.on("error", () => {});
const send = (m: object) => pi.stdin.write(JSON.stringify(m) + "\n");
const t0 = Date.now();
const at = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
let turns = 0, cost = 0, calls = 0;
createInterface({ input: pi.stdout }).on("line", (line) => {
  let e: Record<string, any>;
  try {
    e = JSON.parse(line);
  } catch {
    return;
  }
  if (e.type === "extension_ui_request" && e.method === "notify") {
    console.log(`${at()} [notify] ${e.message}`);
    if (/^connected to /.test(String(e.message))) instruct();
  }
  if (e.type === "tool_execution_start") (calls++, console.log(`${at()} → ${e.toolName} ${JSON.stringify(e.args)}`));
  if (e.type === "tool_execution_end") console.log(`${at()} ← ${e.toolName}${e.isError ? " ERROR" : ""} ${JSON.stringify(e.result?.content?.[0]?.text ?? "").slice(0, 300)}`);
  if (e.type === "message_end" && e.message?.role === "assistant") {
    turns++;
    const u = e.message.usage;
    if (u) cost += u.cost?.total ?? 0;
    if (e.message.stopReason === "error") console.log(`${at()} [model error] ${e.message.errorMessage}`);
    const t = (e.message.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text).join(" ").trim();
    if (t) console.log(`${at()} [model] ${t.slice(0, 400)}`);
  }
  if (e.type === "message_end" && e.message?.role === "custom") {
    console.log(`${at()} [game→model] ${String(e.message.content).slice(0, 300)}`);
  }
});
send({ id: "c", type: "prompt", message: `/grunt connect ${url} ${name} ${owners}`.trim() });
// The instruction goes once the character is in (joining a far server takes a while), or after a minute regardless.
let instructed = false;
function instruct(): void {
  if (instructed) return;
  instructed = true;
  send({ id: "p", type: "prompt", message: instruction, streamingBehavior: "followUp" });
}
setTimeout(instruct, 60_000);
if (inbox) {
  writeFileSync(inbox, "");
  let read = 0;
  watchFile(inbox, { interval: 500 }, () => {
    const text = readFileSync(inbox, "utf8");
    const lines = text.slice(read).split("\n");
    const whole = lines.pop() ?? "";
    read = text.length - whole.length;
    for (const line of lines.map((l) => l.trim()).filter(Boolean)) {
      console.log(`${at()} [inbox] ${line}`);
      send({ id: `i${read}`, type: "prompt", message: line, streamingBehavior: "followUp" });
    }
  });
}
await new Promise((r) => setTimeout(r, seconds * 1000));
console.log(JSON.stringify({ seconds, turns, tool_calls: calls, cost_usd: Math.round(cost * 10000) / 10000 }));
pi.stdin.end();
setTimeout(() => pi.kill("SIGTERM"), 500);
setTimeout(() => process.exit(0), 3000);
