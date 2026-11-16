// `bun run agent-trip`: the agent's whole loop played through its stdio MCP server (agent/main.ts), as a model would, to be
// run now and then: it is too slow for the check. It starts a throwaway dev server on the proving ground with no wild
// creatures, speaks the 2026-07-28 protocol to the agent (server/discover, a version and capabilities in every request's
// _meta, progress tokens and a cancellation), and plays: gathering, drinking and swimming, crafting at a fire, a mortar and a
// forge, a hut, a tamed and saddled raptor ridden, a pteranodon flown and landed, a car driven, and a bow fought with. It
// exits 1 if any of it fails. The client must be built (`bun run build`). With `--url ws://host:port/ws` it plays against a
// running `--dev` server instead.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const value = (flag: string): string | undefined => {
  const at = process.argv.indexOf(flag);
  return at >= 0 ? process.argv[at + 1] : undefined;
};
const VERSION = "2026-07-28";
const META = { "io.modelcontextprotocol/protocolVersion": VERSION, "io.modelcontextprotocol/clientCapabilities": {}, "io.modelcontextprotocol/clientInfo": { name: "agent-trip", version: "1" } };

interface Player {
  tool(name: string, args?: object): Promise<any>;
  rpc(method: string, params?: object, id?: number): Promise<any>;
  /** Sends one line and does not wait. */
  send(message: object): void;
  /** Progress notifications seen, by token. */
  progress: Map<string, number>;
  /** Replies seen to requests nobody waited on, by id. */
  stray: Set<number>;
  stop(): void;
}

/** Starts the agent as `name` on the server at `url` and speaks to it over its pipes. */
async function play(url: string, name: string, home: string): Promise<Player> {
  const agent = Bun.spawn(["bun", "agent/main.ts", "--url", url, "--name", name, "--console"], { cwd: root, stdin: "pipe", stdout: "pipe", stderr: "pipe", env: { ...process.env, HOME: home } });
  const decoder = new TextDecoder();
  const waiting = new Map<number, (v: any) => void>();
  const progress = new Map<string, number>();
  const stray = new Set<number>();
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
        if (m.method === "notifications/progress") progress.set(String(m.params.progressToken), (progress.get(String(m.params.progressToken)) ?? 0) + 1);
        else if (m.id !== undefined && waiting.has(m.id)) waiting.get(m.id)!(m);
        else if (m.id !== undefined) stray.add(m.id);
      }
    }
  })();
  void (async () => {
    for await (const chunk of agent.stderr) for (const l of decoder.decode(chunk).split("\n")) if (l.trim()) console.log(`    [${name}] ${l.trim().slice(0, 160)}`);
  })();
  let next = 0;
  const send = (message: object): void => void agent.stdin.write(JSON.stringify(message) + "\n");
  const rpc = (method: string, params: object = {}, id = ++next): Promise<any> =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${method}: no answer in 150 s`)), 150_000);
      waiting.set(id, (m) => {
        clearTimeout(timer);
        waiting.delete(id);
        resolve(m);
      });
      send({ jsonrpc: "2.0", id, method, params: { ...params, _meta: { ...META, ...((params as { _meta?: object })._meta ?? {}) } } });
    });
  return {
    rpc,
    send,
    progress,
    stray,
    tool: async (toolName, args = {}) => {
      const m = await rpc("tools/call", { name: toolName, arguments: args, _meta: { progressToken: `${toolName}-${next + 1}` } });
      if (m.error) return { rpcError: m.error };
      return m.result.structuredContent;
    },
    stop: () => agent.kill(),
  };
}

/** Starts a throwaway dev server in `dir` with no wild creatures and gives its socket's address once it listens. */
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
const near = (s: any, x: number, z: number, m: number): boolean => Math.hypot(s.self.x - x, s.self.z - z) < m;

const dir = mkdtempSync(join(tmpdir(), "snark-agent-trip-"));
const started: { stop(): void }[] = [];
let url = value("--url");
try {
  if (!url) {
    const server = await serve(dir);
    started.push(server);
    url = server.url;
  }
  const a = await play(url, value("--name") ?? "Tripper", started.length > 0 ? dir : (process.env.HOME ?? dir));
  started.push(a);
  const say = async (line: string): Promise<void> => void (await a.tool("console", { line }));

  const found = await a.rpc("server/discover");
  hold("server/discover names the versions, the tools and the resources", found.result?.resultType === "complete" && found.result.supportedVersions?.[0] === VERSION && found.result.capabilities?.resources !== undefined, brief(found.result?.supportedVersions));
  const old = await a.rpc("tools/list", { _meta: { "io.modelcontextprotocol/protocolVersion": "1999-01-01" } });
  hold("a version it does not speak is answered with the ones it does", old.error?.code === -32022, brief(old.error));
  const tools = (await a.rpc("tools/list")).result.tools as any[];
  hold("every tool says what it answers and how it behaves", tools.length >= 19 && tools.every((t) => t.outputSchema && t.annotations), `${tools.length} tools: ${tools.map((t) => t.name).join(" ")}`);
  const guide = await a.rpc("resources/read", { uri: "snark://guide" });
  hold("the guide is a resource", String(guide.result?.contents?.[0]?.text ?? "").includes("Taming"), brief(guide.result?.contents?.[0]?.text, 80));

  let s: any;
  for (let i = 0; i < 120 && !(s = await a.tool("status")).self; i++) await Bun.sleep(500);
  hold("the survivor is in the world", s.self !== undefined, brief(s.self));
  for (const line of ["enablecheats", "god", "kit tools", "setstat weight 255"]) await say(line);

  // Gathering: a tree with the hatchet, in the woods north of the plaza.
  await say("tp 256 150");
  await Bun.sleep(1500);
  const woods = await a.tool("observe", { radius: 32 });
  hold("observe stays within its budget", JSON.stringify(woods).length < 3500, `${JSON.stringify(woods).length} bytes`);
  const tree = (woods.tree ?? [])[0];
  const cut = tree ? await a.tool("harvest", { id: tree[0], tool: "hatchet", until: { item: "wood", count: 5 }, wait_s: 50 }) : { state: "blocked", reason: "no tree in sight" };
  hold("harvest cuts wood with a hatchet", cut.state === "done" && (cut.gathered?.wood ?? 0) >= 5, brief(cut, 160));
  hold("a long call told its progress", [...a.progress.keys()].some((k) => k.startsWith("harvest")), brief([...a.progress.entries()]));

  // Water: a drink in the pool's shallows, then across it swimming.
  const shallows = await a.tool("go_to", { x: 197, z: 256, wait_s: 50 });
  const drink = await a.tool("use_item", { item: "water" });
  hold("it walks to the pool and drinks standing in it", shallows.state === "done" && drink.state === "done", brief([shallows.state, drink], 200));
  const swim = await a.tool("go_to", { x: 148, z: 256, wait_s: 50 });
  s = await a.tool("status");
  hold("it swims across the pool", swim.state === "done" && near(s, 148, 256, 1.5), brief(swim, 160));

  // Building on level ground south of the plaza: a hut with a door and a roof.
  const [gx, gz] = [236, 200];
  await say(`tp ${gx + 10} ${gz + 2}`);
  for (const line of ["give piece_foundation_wood 1", "give piece_wall_wood 4", "give piece_ceiling_wood 1", "give piece_door_wood 1", "give piece_campfire 1", "give piece_mortar 1", "give piece_forge 1", "give wood 30", "give meat 4", "give flint 4", "give stone 2", "give ore 2", "addxp 2000"]) await say(line);
  await Bun.sleep(1000);
  const f = await a.tool("place", { item: "piece_foundation_wood", x: gx + 10, z: gz + 10 });
  const walls = [];
  for (const side of ["west", "east", "north"]) walls.push(await a.tool("place", { item: "piece_wall_wood", on: f.id, side }));
  const frame = await a.tool("place", { item: "piece_wall_wood", as: "doorframe", on: f.id, side: "south" });
  const door = await a.tool("place", { item: "piece_door_wood", on: frame.id });
  const roof = await a.tool("place", { item: "piece_ceiling_wood", on: walls[0].id, side: "top" });
  hold("place builds a foundation, three walls, a doorframe, a door and a ceiling", [f, ...walls, frame, door, roof].every((r) => r.state === "done"), brief([f, ...walls, frame, door, roof].map((r) => r.placed ?? r.reason)));
  const opened = await a.tool("open", { id: door.id });
  const inside = await a.tool("go_to", { id: f.id, wait_s: 50 });
  hold("it opens the door and walks in", opened.state === "done" && inside.state === "done", brief([opened, inside].map((r) => r.state + (r.reason ?? ""))));

  // Stations: a campfire cooks, a mortar grinds, a forge smelts.
  await a.tool("go_to", { x: gx + 10, z: gz + 2, wait_s: 50 });
  const fire = await a.tool("place", { item: "piece_campfire", x: gx + 4, z: gz + 4 });
  await a.tool("open", { id: fire.id });
  await a.tool("move_item", { from: "self", item: "wood", count: 5, to: "box" });
  await a.tool("move_item", { from: "self", item: "meat", count: 1, to: "box" });
  const lit = await a.tool("structure", { id: fire.id, do: "light" });
  await Bun.sleep(22000);
  const cooked = await a.tool("open", { id: fire.id });
  hold("a lit campfire cooks raw meat", lit.state === "done" && brief(cooked.box?.slots).includes("meat_cooked"), brief(cooked.box ?? cooked, 160));
  const mortar = await a.tool("place", { item: "piece_mortar", x: gx + 16, z: gz + 4 });
  await a.tool("open", { id: mortar.id });
  for (const item of ["flint", "stone"]) await a.tool("move_item", { from: "self", item, to: "box" });
  const powder = await a.tool("craft", { recipe: "sparkpowder", count: 2, learn: true, wait_s: 20 });
  hold("craft at a mortar learns the engram and grinds sparkpowder from what lies in it", powder.state === "done" && powder.made === 4, brief(powder, 200));
  const forge = await a.tool("place", { item: "piece_forge", x: gx + 10, z: gz - 2 });
  await a.tool("open", { id: forge.id });
  for (const item of ["wood", "ore"]) await a.tool("move_item", { from: "self", item, to: "box" });
  const smelt = await a.tool("structure", { id: forge.id, do: "light" });
  await Bun.sleep(22000);
  const ingot = await a.tool("open", { id: forge.id });
  hold("a lit forge smelts ore by itself", smelt.state === "done" && brief(ingot.box?.slots).includes("ingot"), brief(ingot.box ?? ingot, 160));

  // A raptor knocked out, tamed on raw meat, named, saddled and ridden.
  for (const line of ["give club 1", "give saddle_raptor 1", "setting TamingSpeedMultiplier 60", "spawn raptor 1"]) await say(line);
  await Bun.sleep(1500);
  const raptor = ((await a.tool("observe", { radius: 16 })).creature ?? []).find((r: any[]) => r[1] === "raptor");
  const out = raptor ? await a.tool("attack", { id: raptor[0], with: "club", until: "out", wait_s: 50 }) : { state: "blocked", reason: "no raptor" };
  hold("attack knocks the raptor out with a club", out.state === "done" && out.target === "knocked out", brief(out, 160));
  const fed = raptor ? await a.tool("use_item", { item: "meat", on: raptor[0], count: 2 }) : {};
  hold("use_item puts raw meat in its inventory", fed.state === "done" && fed.creature?.taming !== undefined, brief(fed, 200));
  let tamed = false;
  for (let i = 0; i < 40 && !tamed; i++) {
    s = await a.tool("status", { wait_s: 0 });
    tamed = (s.news ?? []).some((l: string) => l.startsWith("tamed"));
    if (!tamed) await Bun.sleep(2500);
  }
  hold("it eats and is tamed, and status tells so", tamed, brief(s.news));
  const named = await a.tool("order", { id: raptor?.[0], order: "name", name: "Blue" });
  const saddled = await a.tool("use_item", { item: "saddle_raptor", on: raptor?.[0] });
  const mounted = await a.tool("mount", { id: raptor?.[0] });
  hold("it is named, saddled and mounted", named.state === "done" && saddled.creature?.saddled === true && mounted.state === "done", brief([named.state, saddled.creature, mounted.riding]));
  s = await a.tool("status");
  const ride = await a.tool("go_to", { x: s.self.x, z: s.self.z + 25, wait_s: 50 });
  const off = await a.tool("mount", { off: true });
  hold("go_to rides it, and mount off gets off", ride.state === "done" && off.state === "done", brief([ride, off].map((r) => r.state + (r.reason ?? ""))));

  // A pteranodon, tranquilized from range, tamed, saddled, flown and set down.
  for (const line of ["kit bow", "give saddle_pteranodon 1", "give meat 2", "spawn pteranodon 1"]) await say(line);
  await Bun.sleep(1500);
  const ptero = ((await a.tool("observe", { radius: 24 })).creature ?? []).find((r: any[]) => r[1] === "pteranodon");
  const down = ptero ? await a.tool("attack", { id: ptero[0], with: "bow", ammo: "arrow_tranq", until: "out", wait_s: 50 }) : { state: "blocked", reason: "no pteranodon" };
  hold("tranquilizer arrows bring a pteranodon down", down.state === "done" && down.target === "knocked out", brief(down, 200));
  await a.tool("use_item", { item: "meat", on: ptero?.[0], count: 2 });
  tamed = false;
  for (let i = 0; i < 80 && !tamed; i++) {
    s = await a.tool("status", { wait_s: 0 });
    tamed = (s.news ?? []).some((l: string) => l.startsWith("tamed"));
    if (!tamed) await Bun.sleep(2500);
  }
  const wings = await a.tool("use_item", { item: "saddle_pteranodon", on: ptero?.[0] });
  const up = await a.tool("mount", { id: ptero?.[0] });
  await Bun.sleep(3000);
  s = await a.tool("status");
  const to = { x: s.self.x, z: s.self.z + 80 };
  const flown = await a.tool("go_to", { ...to, wait_s: 50 });
  s = await a.tool("status");
  hold("the pteranodon is tamed, saddled, flown eighty metres and set down", tamed && wings.state === "done" && up.state === "done" && flown.landed === true && near(s, to.x, to.z, 6), brief([tamed, wings.state, up.state, flown], 240));
  await a.tool("mount", { off: true });

  // A car: found, got into, driven and left.
  await say("spawn car");
  await Bun.sleep(1500);
  const car = ((await a.tool("observe", { radius: 16 })).car ?? [])[0];
  const inCar = car ? await a.tool("mount", { id: car[0] }) : { state: "blocked", reason: "no car" };
  s = await a.tool("status");
  const drive = await a.tool("go_to", { x: s.self.x, z: s.self.z - 40, wait_s: 50 });
  const out2 = await a.tool("mount", { off: true });
  hold("a car is got into, driven forty metres and left", inCar.state === "done" && drive.state === "done" && out2.state === "done", brief([inCar, drive, out2].map((r) => r.state + (r.reason ?? ""))));

  // A bow from range.
  await say("spawn dodo 1");
  await Bun.sleep(1500);
  const dodo = ((await a.tool("observe", { radius: 16 })).creature ?? []).find((r: any[]) => r[1] === "dodo");
  const shot = dodo ? await a.tool("attack", { id: dodo[0], with: "bow", ammo: "arrow_stone", wait_s: 50 }) : { state: "blocked", reason: "no dodo" };
  hold("a bow kills a dodo from range", shot.state === "done" && shot.hits > 0, brief(shot, 200));

  // A walk the client gives up on: it stops, and no answer comes.
  a.send({ jsonrpc: "2.0", id: 9001, method: "tools/call", params: { name: "go_to", arguments: { x: 256, z: 400, wait_s: 50 }, _meta: META } });
  await Bun.sleep(2000);
  a.send({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 9001, reason: "the trip moves on" } });
  await Bun.sleep(1500);
  s = await a.tool("status");
  hold("a cancelled call stops its walk and is owed no answer", s.reason === "cancelled" && !a.stray.has(9001), brief([s.state, s.reason, [...a.stray]]));

  const alone = await a.tool("travel");
  hold("travel lists the cluster, and a lone server says it has none", alone.state === "refused", brief(alone, 120));
} catch (err) {
  hold("the run finished", false, err instanceof Error ? err.message : String(err));
} finally {
  for (const p of started.reverse()) p.stop();
  rmSync(dir, { recursive: true, force: true });
}
const failed = results.filter(([, ok]) => !ok).length;
console.log(failed === 0 ? `all ${results.length} held` : `${failed} of ${results.length} failed`);
process.exit(failed === 0 ? 0 : 1);
