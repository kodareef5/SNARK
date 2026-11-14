// An agent that plays on the harness: a session the harness does not step, an Agent on it, and its tools called over the
// protocol while virtual time runs.

import { Mcp, type Answer } from "../../agent/mcp.ts";
import { Agent, type AgentOptions } from "../../agent/tools.ts";
import type { ClientSession } from "../../client/core/session.ts";
import type { HostOptions } from "../../server/host.ts";
import type { EntityRecord } from "../../server/records.ts";
import { Harness } from "./net.ts";

export interface Play {
  h: Harness;
  s: ClientSession;
  agent: Agent;
  /** The survivor's record on the server. */
  rec: EntityRecord;
  /** Virtual milliseconds, the agent ticking each frame. */
  run(ms: number): void;
  /** One request over the protocol. Resolves with the reply, parsed, or null if none came in `ms`. */
  ask(method: string, params?: unknown, ms?: number): Promise<{ result?: any; error?: { code: number; message: string } } | null>;
  /** Calls a tool and runs the world until it answers. */
  call(tool: string, args?: Record<string, unknown>, ms?: number): Promise<Answer>;
  /** The reply to one raw line, with no time passing. */
  line(text: string): Promise<string | null>;
  /** Types a console line a fifth of a second after the last, which is as often as the tool allows. Returns what the server printed. */
  typed(line: string): Promise<string[]>;
  /** The content index of a core item. */
  id(name: string): number;
}

/** The world is stepped this many milliseconds between looks at whether a call has answered. */
const SLICE = 50;

export function play(host: HostOptions = {}, opts: AgentOptions = { console: true }, name = "Scout"): Play {
  const h = new Harness({}, 1, 60, { dev: true, ...host });
  const s = h.join(name, {}, { manual: true });
  const agent = new Agent(s, opts);
  const mcp = new Mcp(agent, "snark", "");
  const run = (ms: number): void => h.run(ms, (now) => agent.tick(now));
  run(500);
  let next = 0;
  const ask: Play["ask"] = async (method, params, ms = 60000) => {
    let out: string | null | undefined;
    void mcp.handle(JSON.stringify({ jsonrpc: "2.0", id: ++next, method, params })).then((reply) => (out = reply));
    // A promise settles between slices, never inside one.
    for (let t = 0; out === undefined && t <= ms; t += SLICE) {
      await new Promise((r) => setImmediate(r));
      if (out === undefined) run(SLICE);
    }
    return out ? JSON.parse(out) : null;
  };
  const call: Play["call"] = async (tool, args = {}, ms) => {
    const reply = await ask("tools/call", { name: tool, arguments: args }, ms);
    if (!reply?.result) throw new Error(`${tool} was not answered: ${JSON.stringify(reply)}`);
    return JSON.parse(reply.result.content[0].text);
  };
  const typed: Play["typed"] = async (line) => {
    run(200);
    return (await call("console", { line })).lines as string[];
  };
  return { h, s, agent, rec: h.host.records.byPid.get(h.client(s)!.pid)!, run, ask, call, typed, line: (text) => mcp.handle(text), id: (item) => h.reg.index.get(`core:${item}`)! };
}
