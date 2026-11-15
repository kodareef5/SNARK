// `bun tools/bed-trip.ts`: beds played through the game's own agent over the Model Context Protocol (agent/main.ts), to be
// run now and then: it is too slow for the check. It starts a throwaway dev server on the proving ground with no creatures,
// plays, and stops it; the client must be built (`bun run build`). The survivor builds two beds on foundations and names
// them, travels from one to the other and leaves what it carries at the first, dies and rises at the one that is ready while
// the other waits, finds its things in a bag at the bed it left, and rises once at a sleeping bag. It exits 1 if any of that
// fails. With `--url ws://host:port/ws` it plays against a running `--dev` server instead.

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
  await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "bed-trip", version: "0" } });
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

/** Starts a throwaway dev server in `dir` with no creatures and gives its socket's address once it listens. */
async function serve(dir: string): Promise<{ url: string; stop(): void }> {
  const server = Bun.spawn(["bun", "server/main.ts", "--dev", "--port", "0", "--db", join(dir, "world.db"), "-NoDinos"], { cwd: root, stdout: "pipe", stderr: "pipe" });
  const decoder = new TextDecoder();
  let said = "";
  const port = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`the server did not start in 90 s:\n${said.slice(-600)}`)), 90_000);
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
    void server.exited.then((code) => reject(new Error(`the server stopped with ${code}:\n${said.slice(-600)}`)));
  });
  return { url: `ws://localhost:${port}/ws`, stop: () => server.kill() };
}

const results: [string, boolean][] = [];
const hold = (what: string, ok: boolean, detail = ""): void => {
  results.push([what, ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${what}${detail ? `: ${detail}` : ""}`);
};
const brief = (v: unknown, n = 300): string => (JSON.stringify(v) ?? "nothing").slice(0, n);
const say = async (p: Player, line: string): Promise<void> => console.log(`  ${line}:`, brief((await p.tool("console", { line })).lines, 120));
/** Status once the places to rise at have come. */
const choosing = async (p: Player): Promise<any> => {
  let s: any;
  for (let i = 0; i < 40; i++) {
    s = await p.tool("status", { wait_s: 0 });
    if (s.choosing?.places?.length > 0) return s;
    await Bun.sleep(250);
  }
  return s;
};

const dir = mkdtempSync(join(tmpdir(), "snark-bed-trip-"));
const started: { stop(): void }[] = [];
let url = value("--url");
try {
  if (!url) {
    const server = await serve(dir);
    started.push(server);
    url = server.url;
  }
  // The agent keeps its key under HOME: a throwaway server gets a throwaway key.
  const a = await play(url, value("--name") ?? "Sleeper", started.length > 0 ? dir : (process.env.HOME ?? dir));
  started.push(a);
  const tools = await a.tools();
  hold("the agent offers place, bed and rise", ["place", "bed", "rise"].every((t) => tools.includes(t)));
  for (let i = 0; i < 120 && !(await a.tool("status")).self; i++) await Bun.sleep(500);
  await say(a, "enablecheats");
  // A level square of the proving ground south of the plaza, as tests/fixtures/arena.ts finds it.
  const [gx, gz] = [236, 220];
  await say(a, `tp ${gx + 10} ${gz + 6}`);
  for (const line of ["give piece_foundation_wood 2", "give piece_bed 2", "give stone 30"]) await say(a, line);

  const ground = await a.tool("place", { item: "piece_bed", x: gx + 10, z: gz + 12 });
  hold("a simple bed is refused on the ground", ground.state === "blocked", brief(ground, 120));
  const fa = await a.tool("place", { item: "piece_foundation_wood", x: gx + 10, z: gz + 12 });
  const home = await a.tool("place", { item: "piece_bed", on: fa.id });
  const fb = await a.tool("place", { item: "piece_foundation_wood", x: gx + 30, z: gz + 30 });
  const outpost = await a.tool("place", { item: "piece_bed", on: fb.id });
  hold("it sets two beds down on two foundations", [fa, home, fb, outpost].every((r) => r.state === "done" && typeof r.id === "string"), brief([fa.id, home.id, fb.id, outpost.id]));
  const named = [await a.tool("bed", { id: home.id, do: "name", name: "Home" }), await a.tool("bed", { id: outpost.id, do: "name", name: "Outpost" })];
  hold("and names them", named.every((r) => r.state === "done"), brief(named.map((r) => r.state)));

  const left = await a.tool("bed", { id: home.id, do: "travel" });
  const t = await choosing(a);
  hold("it travels from Home: no body, choosing among its beds, Home first", left.state === "done" && t.self?.alive === false && t.choosing?.why === "travelling from a bed" && brief(t.choosing.places.map((r: any[]) => r[1])) === brief(["Home", "Outpost"]), brief(t.choosing));
  const arrived = await a.tool("rise", { place: "Outpost" });
  hold("it rises at Outpost carrying nothing", arrived.state === "done" && (await a.tool("status")).inventory?.length === 0, brief(arrived, 160));

  await say(a, "suicide");
  const d = await choosing(a);
  const wait = d.choosing?.places?.find((r: any[]) => r[1] === "Outpost")?.[5];
  hold("dead, it is offered the spawn points and both beds, and Outpost, just risen at, waits five minutes", d.choosing?.why === "died" && wait > 280 && wait <= 300, brief(d.choosing));
  const refused = await a.tool("rise", { place: "Outpost" });
  hold("Outpost is refused while it waits", refused.state === "blocked", brief(refused, 120));
  const rose = await a.tool("rise", { place: "Home" });
  hold("it rises at Home", rose.state === "done" && rose.rose_at === "Home", brief(rose, 120));

  const seen = await a.tool("observe", { radius: 12 });
  // Things lying about are listed with the boxes, a bag under its name.
  const bag = ((seen.box ?? []) as any[][]).find((r) => String(r[0]).startsWith("e") && r[1] === "bag");
  const opened = bag ? await a.tool("open", { id: bag[0] }) : { state: "blocked", reason: `no bag near: ${brief(seen.box)}` };
  hold("what it carried lies in a bag at Home, all thirty stone of it", opened.state === "done" && brief(opened.box?.slots).includes('"stone",30'), brief(opened.box ?? opened, 200));

  await say(a, "give piece_sleeping_bag 1");
  const sleeping = await a.tool("place", { item: "piece_sleeping_bag", x: gx + 4, z: gz + 16 });
  await say(a, "suicide");
  await choosing(a);
  const once = await a.tool("rise", { place: "hide sleeping bag" });
  await say(a, "suicide");
  const after = await choosing(a);
  hold("it rises once at a sleeping bag, which is then gone from its places", sleeping.state === "done" && once.state === "done" && !after.choosing?.places?.some((r: any[]) => r[1] === "hide sleeping bag"), brief(after.choosing?.places?.map((r: any[]) => r[1])));
  await a.tool("rise", { place: 0 });
} catch (err) {
  hold("the run finished", false, err instanceof Error ? err.message : String(err));
} finally {
  for (const p of started.reverse()) p.stop();
  rmSync(dir, { recursive: true, force: true });
}
const failed = results.filter(([, ok]) => !ok).length;
console.log(failed === 0 ? `all ${results.length} held` : `${failed} of ${results.length} failed`);
process.exit(failed === 0 ? 0 : 1);
