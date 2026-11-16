// `bun run cluster-trip`: a survivor's trip across a cluster and back, played through the game's own agent over the Model
// Context Protocol (agent/main.ts), to be run now and then: it is too slow for the check. With no arguments it starts two
// throwaway servers on the proving ground in one cluster folder, plays the trip and stops them; the client must be built
// (`bun run build`). With `--url ws://host:port/ws` it plays against servers that are running, from the one named:
//   bun run cluster-trip -- --url ws://localhost:8798/ws [--to Tampa] [--name Courier]
// It holds: the agent lists the other server; a server that is not there is refused; the survivor walks to an obelisk's
// terminal and leaves there; it arrives with what it carries, slot for slot, and its level, and rises where it chose, at a
// spawn point where its tribe has no bed; it cannot be played meanwhile on the server it left; the cluster's ledgers balance;
// and it comes back with the same things and rises at the bed it set down at home. It exits 1 if any of that fails. `--dev`
// servers only: it types cheats, and again after each arrival, since an arrival is a new session.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const value = (flag: string): string | undefined => {
  const at = process.argv.indexOf(flag);
  return at >= 0 ? process.argv[at + 1] : undefined;
};

interface Player {
  tool(name: string, args?: object): Promise<any>;
  tools(): Promise<string[]>;
  stop(): void;
}

/** Starts the agent as `name` on the server at `url` and speaks to it over its pipes. */
async function play(url: string, name: string, home: string): Promise<Player> {
  const agent = Bun.spawn(["bun", "agent/main.ts", "--url", url, "--name", name, "--console"], { cwd: root, stdin: "pipe", stdout: "pipe", stderr: "pipe", env: { ...process.env, HOME: home } });
  const decoder = new TextDecoder();
  const waiting = new Map<number, (v: any) => void>();
  void (async () => {
    let buffer = "";
    for await (const chunk of agent.stdout) {
      buffer += decoder.decode(chunk);
      let at: number;
      while ((at = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, at).trim();
        buffer = buffer.slice(at + 1);
        if (!line) continue;
        const m = JSON.parse(line);
        if (m.id !== undefined) waiting.get(m.id)?.(m);
      }
    }
  })();
  void (async () => {
    for await (const chunk of agent.stderr) for (const l of decoder.decode(chunk).split("\n")) if (l.trim()) console.log(`    [${name}] ${l.trim().slice(0, 160)}`);
  })();
  let id = 0;
  const rpc = (method: string, params: object = {}): Promise<any> =>
    new Promise((resolve, reject) => {
      const mine = ++id;
      const timer = setTimeout(() => reject(new Error(`${method}: no answer in 150 s`)), 150_000);
      waiting.set(mine, (m) => {
        clearTimeout(timer);
        resolve(m);
      });
      agent.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: mine, method, params }) + "\n");
    });
  await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "cluster-trip", version: "0" } });
  agent.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  return {
    tool: async (toolName, args = {}) => {
      const m = await rpc("tools/call", { name: toolName, arguments: args });
      if (m.error) return { rpcError: m.error };
      const text = m.result?.content?.[0]?.text ?? "";
      try {
        return JSON.parse(text);
      } catch {
        return { text };
      }
    },
    tools: async () => ((await rpc("tools/list")).result?.tools ?? []).map((t: any) => t.name),
    stop: () => agent.kill(),
  };
}

/** Starts a throwaway server of cluster `id` in `dir` and gives its socket's address once it listens. */
async function serve(dir: string, id: string, save: string): Promise<{ url: string; stop(): void }> {
  const server = Bun.spawn(["bun", "server/main.ts", "--dev", "--port", "0", "--db", join(dir, `${save}.db`), `-clusterid=${id}`, `-ClusterDirOverride=${join(dir, "cluster")}`], { cwd: root, stdout: "pipe", stderr: "pipe" });
  const decoder = new TextDecoder();
  let said = "";
  const port = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server ${save} did not start in 90 s:\n${said.slice(-600)}`)), 90_000);
    for (const stream of [server.stdout, server.stderr]) {
      void (async () => {
        for await (const chunk of stream) {
          said += decoder.decode(chunk);
          const m = /listening on http:\/\/localhost:(\d+)/.exec(said);
          if (m) {
            clearTimeout(timer);
            resolve(Number(m[1]));
          }
        }
      })();
    }
    void server.exited.then((code) => reject(new Error(`server ${save} stopped with ${code}:\n${said.slice(-600)}`)));
  });
  return { url: `ws://localhost:${port}/ws`, stop: () => server.kill() };
}

const results: [string, boolean][] = [];
const hold = (what: string, ok: boolean, detail = ""): void => {
  results.push([what, ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${what}${detail ? `: ${detail}` : ""}`);
};
const brief = (v: unknown, n = 300): string => (JSON.stringify(v) ?? "nothing").slice(0, n);
const carried = (s: any): string => JSON.stringify([s.inventory ?? null, s.self?.level ?? null, s.self?.engram_points ?? null]);
const joined = async (p: Player): Promise<any> => {
  let s: any;
  for (let i = 0; i < 120; i++) {
    s = await p.tool("status");
    if (s.self) return s;
    if (s.state === "refused" && !/connecting|reached/.test(String(s.reason))) return s;
    await Bun.sleep(500);
  }
  return s;
};

const dir = mkdtempSync(join(tmpdir(), "snark-cluster-trip-"));
const started: { stop(): void }[] = [];
let url = value("--url");
try {
  if (!url) {
    const id = `trip${process.pid}`;
    const first = await serve(dir, id, "first");
    started.push(first, await serve(dir, id, "second"));
    url = first.url;
  }
  const name = value("--name") ?? "Courier";
  // The agent keeps its key under HOME. A throwaway cluster gets a throwaway key; running servers keep the one that owns the name.
  const home = started.length > 0 ? dir : (process.env.HOME ?? dir);
  const a = await play(url, name, home);
  started.push(a);
  const tools = await a.tools();
  hold("the agent offers travel", tools.includes("travel"));
  let s = await joined(a);
  hold("the survivor is in the world on the first server", s.self !== undefined, brief(s.self ?? s));
  // A survivor new on a throwaway server stands at the first spawn point, where an arrival with no bed rises.
  const spawned = value("--url") === undefined ? s.self : null;

  for (const line of ["enablecheats", "kit tools"]) console.log(`  ${line}:`, brief(await a.tool("console", { line }), 120));
  const tree = ((await a.tool("observe", { radius: 48 })).tree ?? [])[0];
  if (tree) console.log("  harvest:", brief(await a.tool("harvest", { id: tree[0], count: 5, wait_s: 45 }), 160));
  // It leaves from somewhere that is not where it spawned, with a bed of its own there to rise at when it comes back.
  console.log("  walk:", brief(await a.tool("go_to", { x: s.self.x + 9, z: s.self.z + 7, wait_s: 30 }), 120));
  s = await a.tool("status");
  const before = carried(s);
  const bedFrom = s.self;
  console.log("  bed:", brief(await a.tool("console", { line: "place bed" }), 120));
  hold("it carries something to take along", (s.inventory ?? []).length > 0, brief(s.inventory, 200));

  const list = await a.tool("travel");
  const others = (list.servers ?? []) as any[];
  const to = value("--to") ?? others[0]?.name;
  hold("the cluster lists another server", others.length > 0 && to !== undefined, brief(list));

  const nowhere = await a.tool("travel", { to: "no such server" });
  hold("a server that is not there is refused, and the survivor stays", nowhere.state === "refused" && (await a.tool("status")).self !== undefined, brief(nowhere, 140));

  const out = await a.tool("travel", { to: String(others.find((o) => o.name === to)?.world ?? to) });
  hold(`it walks to an obelisk's terminal and arrives on ${to}`, out.state === "done" && out.self !== undefined, brief({ state: out.state, arrived: out.arrived, rose_at: out.rose_at, reason: out.reason }));
  hold("having no bed there, it rises at a spawn point", typeof out.rose_at === "string" && out.rose_at !== "", brief(out.rose_at));
  hold("with everything it carried, slot for slot, and its level", carried(out) === before, carried(out) === before ? "" : `there ${carried(out).slice(0, 240)} | before ${before.slice(0, 240)}`);

  const twin = await play(url, name, home);
  started.push(twin);
  const ts = await joined(twin);
  hold("it cannot be played meanwhile on the server it left", ts.self === undefined && ts.state === "refused", brief(ts, 200));
  twin.stop();

  await a.tool("console", { line: "enablecheats" });
  const audit = await a.tool("console", { line: "cluster audit" });
  hold("the cluster's ledgers balance while it is away", /balances/.test(brief(audit.lines)), brief(audit.lines));

  const back = await a.tool("travel", { to: String(list.world ?? list.here) });
  hold(`it comes back to ${list.here}`, back.state === "done" && back.self !== undefined, brief({ state: back.state, arrived: back.arrived, reason: back.reason }));
  hold("with the same things and level", carried(back) === before, carried(back) === before ? "" : `now ${carried(back).slice(0, 240)}`);
  // It rises where it chose, at the bed it set down at home, never where it stood when it left.
  const off = (p: any, q: any): number => (p && q ? Math.hypot(p.x - q.x, p.z - q.z) : Infinity);
  hold("it rises where it chose: at its bed at home", back.rose_at !== out.rose_at && off(back.self, bedFrom) <= 4.5, `at ${brief(back.rose_at)}, ${off(back.self, bedFrom).toFixed(1)} m from where it set the bed down`);
  if (spawned) hold("and not at a spawn point", off(back.self, spawned) > 5, `${off(back.self, spawned).toFixed(1)} m from the first`);
  // A new session on the first server: cheats are asked for again.
  await a.tool("console", { line: "enablecheats" });
  const home2 = await a.tool("console", { line: "cluster audit" });
  hold("the ledgers balance when it is home", /balances/.test(brief(home2.lines)), brief(home2.lines));
} catch (err) {
  hold("the run finished", false, err instanceof Error ? err.message : String(err));
} finally {
  for (const p of started.reverse()) p.stop();
  rmSync(dir, { recursive: true, force: true });
}
console.log(`\ncluster-trip: ${results.every((r) => r[1]) ? "PASS" : "FAIL"}, ${results.filter((r) => r[1]).length} of ${results.length} held`);
process.exit(results.every((r) => r[1]) ? 0 : 1);
