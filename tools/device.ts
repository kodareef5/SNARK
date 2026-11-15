// `bun run device`: a throwaway game server for measuring a phone, and the reports its page sends. It prints a short path
// to open. With --tunnel it also runs a temporary Cloudflare tunnel (cloudflared, no account) and prints the whole link.
// The page shows which device it takes itself to be on and three tests to tap (client/core/device.ts): a quick look, a
// load ladder, and a soak. With --terrain the server is on the bench's 8 km map instead, and the page offers only the
// terrain flight (D253). It posts its report after every step; each run is kept in .cache/device/ and printed as a
// table when it is done. With --self the local headless Chrome opens the link and runs a test without a tap, which must
// finish: `--self` for the quick look, `--self ladder`, `--self soak` (with --soak-minutes n) or `--self terrain`, the test that the probe
// works, not part of the check. --port n, and --minutes n before it stops by itself (30). CHROME and CLOUDFLARED name
// the programs.
//
// While the tunnel is up anyone may reach the server. The short path has four letters nobody is told and closes after
// 64 wrong guesses, the probe's routes need a 128-bit token, joining needs a random password, and cheats are off. What a
// page may change is the size of the base in front of it, up to BASE_MOST pieces.

import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { TIERS } from "../client/core/assets/tiers.ts";
import { AXES, FLIGHT_TIER_COUNT, MEMORY_MB, MODES, deviceScenarios, scenesOf, type DeviceReport, type Mode } from "../client/core/device.ts";
import { BASE_MOST, basePieces, crowdScene } from "../client/core/devicescene.ts";
import { deviceTable } from "../client/core/devicetext.ts";
import { CORE_CONTENT } from "../content/core.ts";
import { startServer } from "../server/main.ts";
import { loadConfig } from "../server/settings/config.ts";
import { stopOnSignals } from "../server/signals.ts";
import { compileContent } from "../shared/content/registry.ts";
import { parseManifest } from "../shared/pack/manifest.ts";
import { parsePack } from "../shared/pack/pack.ts";
import { writeMap } from "../shared/world/mapfile.ts";
import { benchHills } from "./bench/terrain.ts";
import { buildClient } from "./build-client.ts";

/** A report larger than this is refused, and so is any post past these counts. A ladder posts after each of a hundred or so rungs. */
export const REPORT_BYTES = 64 * 1024;
export const MAX_RUNS = 16;
export const MAX_POSTS = 2000;
/** Wrong guesses at the short path, after which it leads nowhere. */
export const MAX_WRONG = 64;
/** Letters for the short path, none easily taken for another. */
const LETTERS = "abcdefghjkmnpqrstuvwxyz";

/** What a browser sent, fit to print: no control characters, so no escape sequences, and not too long. */
export const clean = (text: string): string => text.replace(/[\u0000-\u001f\u007f-\u009f]/g, "?").slice(0, 400);

export interface DeviceOptions {
  /** Where reports are written. Nothing is written anywhere else. */
  dir: string;
  token: string;
  /** The letters of the short path, which leads to the page with the token and the game's password. */
  code: string;
  password: string;
  /** The tests the page is to offer, as its link names them, or "" for all but the terrain flight. */
  tests?: string;
  /** The server's hashes of the scenarios, for the page to compare its own with. */
  expected: Record<string, string>;
  say(line: string): void;
  /** Each run the page says is done, once. */
  done?(report: DeviceReport, file: string): void;
  /** Stands `n` pieces in the base, from 0 to BASE_MOST, and says how many stand. */
  base(n: number): number;
  /** What the server has held back so far, which each report's answer tells the page. */
  held(): { skipped: number; overflows: number };
}

interface Run {
  file: string;
  seq: number;
  stage: string;
  last: DeviceReport;
  told: boolean;
}

/** The device probe's requests: the short path, and the token's ping, hashes, base and reports. Null for any other. */
export function deviceRoutes(o: DeviceOptions): { routes: (req: Request, url: URL) => Response | Promise<Response> | null; unfinished(): Run[] } {
  const token = Buffer.from(o.token);
  const allowed = (given: string | null): boolean => {
    const b = Buffer.from(given ?? "");
    return b.length === token.length && timingSafeEqual(b, token);
  };
  const runs = new Map<string, Run>();
  const seen = new Set<string>();
  let posts = 0;
  let wrong = 0;
  const answer = (text: string, status = 200): Response => new Response(text, { status, headers: { "cache-control": "no-store" } });
  const json = (value: unknown): Response => Response.json(value, { headers: { "cache-control": "no-store" } });

  const receive = async (req: Request): Promise<Response> => {
    if (posts >= MAX_POSTS) return answer("too many reports", 429);
    if (Number(req.headers.get("content-length") ?? 0) > REPORT_BYTES) return answer("too large", 413);
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for await (const chunk of req.body ?? []) {
        size += chunk.length;
        if (size > REPORT_BYTES) return answer("too large", 413);
        chunks.push(chunk);
      }
    } catch {
      return answer("unreadable", 400);
    }
    posts++;
    let report: DeviceReport;
    try {
      report = JSON.parse(Buffer.concat(chunks).toString("utf8")) as DeviceReport;
    } catch {
      return answer("not JSON", 400);
    }
    if (typeof report !== "object" || report === null || typeof report.run !== "string" || !/^[0-9a-f]{16}$/.test(report.run) || typeof report.seq !== "number") return answer("not a report", 400);
    let run = runs.get(report.run);
    if (!run) {
      if (runs.size >= MAX_RUNS) return answer("too many runs", 429);
      run = { file: join(o.dir, `${new Date().toISOString().replace(/[:.]/g, "-")}-${report.run}.json`), seq: -1, stage: "", last: report, told: false };
      runs.set(report.run, run);
    }
    // Posts are sent in order. One older than what is kept changes nothing.
    if (report.seq <= run.seq) return json(o.held());
    run.seq = report.seq;
    run.last = report;
    try {
      mkdirSync(o.dir, { recursive: true });
      writeFileSync(run.file, JSON.stringify(report, null, 2) + "\n");
    } catch {
      return answer("not kept", 400);
    }
    const stage = clean(String(report.stage));
    if (stage !== run.stage) o.say(`run ${report.run}: ${(run.stage = stage)}`);
    if (report.done === true && !run.told) {
      run.told = true;
      o.done?.(report, run.file);
    }
    return json(o.held());
  };

  const routes = (req: Request, url: URL): Response | Promise<Response> | null => {
    const path = url.pathname;
    // How far a browser got, even one that never reports.
    if ((path === "/main.js" || path === "/ws") && !seen.has(path)) {
      seen.add(path);
      o.say(path === "/ws" ? "a page opened the game's socket" : "a browser fetched the page's script");
    }
    if (path === `/d/${o.code}` && wrong < MAX_WRONG) {
      o.say("the short path was opened");
      return new Response(null, { status: 302, headers: { location: `/?device=${o.token}&password=${o.password}${o.tests ? `&tests=${o.tests}` : ""}`, "cache-control": "no-store" } });
    }
    if (path.startsWith("/d/")) {
      if (++wrong === MAX_WRONG) o.say(`${MAX_WRONG} wrong guesses at the short path, so it is closed; the whole link still works`);
      return answer("not found", 404);
    }
    // A page needs no source maps, and they hold the client's source.
    if (path.endsWith(".map")) return answer("not found", 404);
    if (!path.startsWith("/__device/")) return null;
    if (!allowed(url.searchParams.get("token"))) return answer("not found", 404);
    if (path === "/__device/ping") return json(true);
    if (path === "/__device/hashes") return json(o.expected);
    if (path === "/__device/report" && req.method === "POST") return receive(req);
    const base = /^\/__device\/base\/(\d{1,5})$/.exec(path);
    if (base && req.method === "POST") {
      const n = Number(base[1]);
      return n > BASE_MOST ? answer("too many pieces", 400) : json({ pieces: o.base(n) });
    }
    return answer("not found", 404);
  };
  return { routes, unfinished: () => [...runs.values()].filter((r) => !r.told) };
}

/** What a report of `mode` lacks of a whole run on a desktop, which can run every tier and hold the screen on. Empty if nothing. */
export function lacking(r: DeviceReport, mode: Mode = "quick"): string[] {
  const out: string[] = [];
  if (r.mode !== mode) out.push(`it was a ${r.mode}, not a ${mode}`);
  if (!r.done) out.push("it never finished");
  if (r.reloadedDuring) out.push(`the page was reloaded during ${r.reloadedDuring}`);
  for (const e of r.errors) out.push(`error: ${e}`);
  // The picture probes look at the proving ground, which the terrain flight's map is not.
  for (const [part, value] of [["device", r.device], ["gpu", r.gpu], ["load", r.load], ["link", r.link.httpMs], ["probes", mode === "terrain" || r.probes], ["hashes", r.hashes]] as const) if (!value) out.push(`no ${part}`);
  for (const p of r.probes ?? []) if (!p.ok) out.push(`probe ${p.name} is wrong`);
  for (const h of r.hashes ?? []) if (h.got !== h.want) out.push(`hash ${h.name} differs from the server's`);
  if (r.link.missed > 0) out.push(`${r.link.missed} snapshots missed on this machine's own link`);
  if (mode === "quick") {
    if (!r.again) out.push("no again");
    for (const t of TIERS) if (r.phases.filter((p) => p.tier === t.name).length !== scenesOf(t).length) out.push(`tier ${t.name} did not run every scene`);
    // A desktop answers every GPU question. An answer a phone may give, such as "ignored" or "hard", is not a lack.
    const q = r.gpuTests;
    if (!q) out.push("no gpu questions");
    for (const [name, answer] of Object.entries({ depthRange: q?.depthRange, seam: typeof q?.seam === "string" ? q.seam : "", depthArray: q?.depthArray, compareArray: q?.compareArray, compare2d: q?.compare2d, texture3d: q?.texture3d, farEdge: typeof q?.farEdge === "string" ? q.farEdge : "" })) if (q && /^(did not finish|failed|not asked|lost)/.test(answer ?? "")) out.push(`gpu ${name}: ${answer}`);
    // D258: a GPU more than 5% off the rule's share of the far blocks' edge.
    const edge = q?.farEdge;
    if (edge && typeof edge !== "string" && Math.abs(edge.kept - edge.rule) > 0.05) out.push(`gpu far edge: kept ${(edge.kept * 100).toFixed(1)}% where the rule keeps ${(edge.rule * 100).toFixed(1)}%`);
    for (const p of q?.passes ?? []) if (p.note !== "" || p.slope === null) out.push(`gpu ${p.name}: ${p.note || "no slope"}`);
    if (q?.lostDuring) out.push(`gpu: the context was lost during ${q.lostDuring}`);
  }
  if (mode === "ladder") {
    const rungs = r.ladder?.rungs ?? [];
    for (const t of TIERS) for (const a of AXES) if (!rungs.some((g) => g.tier === t.name && g.axis === a)) out.push(`tier ${t.name} has no ${a} rung`);
    const m = r.ladder?.memory;
    if (!m || (m.failedMB === null && m.heldMB !== MEMORY_MB.at(-1)) || m.heldMB === 0) out.push(`texture memory did not finish: ${m ? m.how : "no memory step"}`);
  }
  if (mode === "soak" && (r.soak?.minutes.length ?? 0) < (r.soak?.minutesWanted ?? 1)) out.push("the soak did not run its minutes");
  if (mode === "terrain") {
    const flights = r.terrain?.flights ?? [];
    if (flights.length < FLIGHT_TIER_COUNT) out.push(`the terrain flight flew ${flights.length} of ${FLIGHT_TIER_COUNT} tiers`);
    for (const f of flights) {
      if (f.windowFrames === 0) out.push(`no frame on ${f.tier} carried rows of the terrain window`);
      if (f.fills.length === 0 || f.fills.some((x) => x < 0)) out.push(`a jump on ${f.tier} did not have its window before the next: ${f.fills.join(" ")}`);
    }
  }
  if (mode === "soak" && r.soak && TIERS.find((t) => t.name === r.soak!.tier)!.texture > 0 && !r.soak.minutes.some((m) => m.mat > 0)) out.push(`the soak drew nothing with materials on ${r.soak.tier}, which has them`);
  return out;
}

const value = (name: string): string | undefined => {
  const at = process.argv.indexOf(name);
  return at >= 0 ? process.argv[at + 1] : undefined;
};

/** Lines a program writes, one at a time. */
async function lines(stream: ReadableStream<Uint8Array>, each: (line: string) => void): Promise<void> {
  const decoder = new TextDecoder();
  let rest = "";
  for await (const chunk of stream) {
    const all = (rest + decoder.decode(chunk, { stream: true })).split("\n");
    rest = all.pop()!;
    for (const line of all) each(line);
  }
}

if (import.meta.main) {
  const self = process.argv.includes("--self");
  const mode = MODES.find((m) => m === value("--self")) ?? "quick";
  const soakMinutes = Number(value("--soak-minutes") ?? 10);
  const tunnel = process.argv.includes("--tunnel");
  const terrain = mode === "terrain" || process.argv.includes("--terrain");
  const chrome = [process.env.CHROME, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium", "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find((p) => p && existsSync(p));
  const cloudflared = process.env.CLOUDFLARED ?? Bun.which("cloudflared") ?? "/opt/homebrew/bin/cloudflared";
  if (self && !chrome) {
    console.error("device: no Chrome found. Set CHROME to its path.");
    process.exit(2);
  }
  if (tunnel && !existsSync(cloudflared)) {
    console.error("device: no cloudflared found. Set CLOUDFLARED to its path.");
    process.exit(2);
  }

  await buildClient({ stress: true });
  const dist = resolve(import.meta.dir, "../client/dist");
  const manifest = parseManifest(readFileSync(join(dist, "assets/manifest.json"), "utf8"));
  const pack = parsePack(new Uint8Array(readFileSync(join(dist, "assets", manifest.files[manifest.boot]!.name))));
  const expected = Object.fromEntries(deviceScenarios(compileContent(CORE_CONTENT).registry!, pack).map(([name, run]) => [name, run()]));

  const token = randomBytes(16).toString("hex");
  const password = randomBytes(8).toString("hex");
  const code = Array.from(randomBytes(4), (b) => LETTERS[b % LETTERS.length]).join("");
  const dir = resolve(import.meta.dir, "../.cache/device");
  const stamp = (): string => new Date().toTimeString().slice(0, 8);
  const say = (line: string): void => console.log(`${stamp()}  ${clean(line)}`);
  let finished: (r: { report: DeviceReport; file: string }) => void = () => {};
  const whole = new Promise<{ report: DeviceReport; file: string }>((r) => (finished = r));
  const print = (report: DeviceReport, file: string): void => {
    let table: string[];
    try {
      table = deviceTable(report).slice(0, 120).map(clean);
    } catch {
      table = ["a report that could not be read as one"];
    }
    console.log(`\n${table.join("\n")}\n\nkept in ${file}\n`);
  };
  /** The base's pieces as they stand, in the order basePieces gives them, so that it shrinks from the far end. */
  const built: number[] = [];
  let server: ReturnType<typeof startServer> | null = null;
  const base = (n: number): number => {
    const world = server!.host.world;
    while (built.length > n) world.structs.remove(built.pop()!);
    const plan = basePieces(n);
    for (let i = built.length; i < plan.length; i++) {
      const p = plan[i]!;
      const kind = world.reg.index.get(p.id) ?? 0;
      const def = world.reg.defs[kind];
      const ref = def?.type === "structure" ? world.structs.add(kind, p.x, world.hf.heightAt(p.house.x, p.house.z) + p.y, p.z, p.yaw, 0, def.hp) : -1;
      // A piece the store will not take is left out, and the base is smaller than asked.
      if (ref < 0) break;
      built.push(ref);
    }
    return built.length;
  };
  const probe = deviceRoutes({ dir, token, code, password, tests: terrain ? "terrain" : "", expected, say, base, done: (report, file) => (print(report, file), finished({ report, file })), held: () => ({ skipped: server!.skipped, overflows: server!.host.game.stats.overflows }) });
  const { rules } = loadConfig({ gus: `[ServerSettings]\nServerPassword=${password}\n` });
  // For the terrain flight, the bench's 8 km of hills as a map file, with no water and one spawn point in the middle.
  const hills = terrain ? benchHills() : null;
  const mapDir = hills ? mkdtempSync(join(tmpdir(), "snark-device-map-")) : "";
  if (hills) writeFileSync(join(mapDir, "hills.snmap"), writeMap({ id: "device:hills", dims: hills.dims, minY: hills.minY, stepY: hills.stepY, seaLevel: -Infinity, heights: hills.heights, tint: hills.tint.fill(12), statics: [], nodes: [], spawns: [{ name: "Middle", x: 4096, z: 4096, yaw: 0 }] }));
  // The fixed scene of the boot probe, where nothing wakes, and behind the spawn point the crowd scene's thatch and bodies.
  server = startServer({ port: Number(value("--port") ?? 0), hostname: "127.0.0.1", probeScene: true, config: rules, routes: probe.routes, ...(hills ? { map: join(mapDir, "hills.snmap") } : {}) });
  const running = server;
  const scene = terrain ? { bodies: [], floor: { x: 0, z: 0 }, pieces: [] } : crowdScene();
  const world = running.host.world;
  const crowd = scene.bodies.filter((s) => running.host.spawnCreature(s.species, s.x, s.z, 1) >= 0).length;
  const ground = world.hf.heightAt(scene.floor.x, scene.floor.z);
  const pieces = scene.pieces.filter((p) => {
    const kind = world.reg.index.get(p.id) ?? 0;
    const def = world.reg.defs[kind];
    return def?.type === "structure" && world.structs.add(kind, p.x, ground + p.y, p.z, p.yaw, 0, def.hp) >= 0;
  }).length;

  let child: ReturnType<typeof Bun.spawn> | null = null;
  const stop = (): void => {
    for (const run of probe.unfinished()) print(run.last, run.file);
    child?.kill();
    child = null;
    running.stop();
    if (mapDir) rmSync(mapDir, { recursive: true, force: true });
  };
  process.on("exit", () => child?.kill());
  stopOnSignals(stop);
  const minutes = Number(value("--minutes") ?? 30);
  setTimeout(() => {
    say(`${minutes} minutes are up`);
    stop();
    process.exit(0);
  }, minutes * 60000);

  let base0 = `http://127.0.0.1:${running.port}`;
  if (tunnel) {
    const out: string[] = [];
    let found: (url: string) => void = () => {};
    const address = new Promise<string>((r) => (found = r));
    let url = "";
    const ready = new Promise<void>((done) => {
      const each = (line: string): void => {
        if (out.push(line) > 40) out.shift();
        const named = /https:\/\/[a-z0-9]+(?:-[a-z0-9]+)+\.trycloudflare\.com/.exec(line);
        if (named && !url) found((url = named[0]));
        if (url && /Registered tunnel connection/.test(line)) done();
      };
      // Its output is read to the end, or a full pipe would stall it.
      child = Bun.spawn([cloudflared, "tunnel", "--no-autoupdate", "--url", base0], { stdout: "pipe", stderr: "pipe" });
      void lines(child.stdout as ReadableStream<Uint8Array>, each);
      void lines(child.stderr as ReadableStream<Uint8Array>, each);
    });
    const gave = await Promise.race([Promise.all([address, ready]).then(() => url), new Promise<null>((r) => setTimeout(() => r(null), 45000))]);
    if (!gave) {
      console.error(`device: cloudflared gave no working trycloudflare.com address in 45 s. It said:\n${out.join("\n")}`);
      stop();
      process.exit(1);
    }
    base0 = gave;
    // A page through the tunnel is the server's own, but say so in case the tunnel does not pass the host on.
    running.host.setSetting("AllowedOrigins", gave);
    let through = false;
    for (let i = 0; i < 20 && !through; i++) {
      await Bun.sleep(i === 0 ? 3000 : 1500);
      through = (await fetch(`${gave}/__device/ping?token=${token}`).catch(() => null))?.ok === true;
    }
    say(through ? "a request through the tunnel reached the server" : "a request through the tunnel did not reach the server from here yet; a phone may still get through");
  }

  console.log(terrain ? `\nSNARK device probe on the bench's 8 km map, for the terrain flight; reports go to ${dir}` : `\nSNARK device probe: ${crowd} bodies in the crowd and ${pieces} pieces of thatch; reports go to ${dir}`);
  const tests = terrain ? "&tests=terrain" : "";
  console.log(`  open on the device:  ${base0}/d/${code}`);
  console.log(`  where that leads:    ${base0}/?device=${token}&password=${password}${tests}`);
  if (tunnel) console.log(`  on this machine:     http://127.0.0.1:${running.port}/d/${code}`);
  console.log(terrain ? "  the page offers the terrain flight alone" : "  the page asks which test to run: a quick look, the load ladder, or a ten-minute soak; `--terrain` serves the terrain flight");
  console.log(`  Ctrl+C stops it; it stops by itself in ${minutes} minutes${tunnel ? ", and takes the tunnel down" : ""}\n`);

  if (self) {
    const profile = mkdtempSync(join(tmpdir(), "snark-device-"));
    // A phone's shape: a narrow window three device pixels to the CSS pixel. The test starts without a tap.
    const link = `${base0}/?device=${token}&password=${password}${tests}&mode=${mode}&minutes=${soakMinutes}`;
    const browser = Bun.spawn([chrome!, "--headless=new", "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--window-size=430,932", "--force-device-scale-factor=3", `--user-data-dir=${profile}`, link], { stdout: "ignore", stderr: "ignore" });
    const limit = (mode === "soak" ? soakMinutes + 5 : mode === "ladder" ? 20 : mode === "terrain" ? 8 : 6) * 60000;
    const got = await Promise.race([whole, new Promise<null>((r) => setTimeout(() => r(null), limit))]);
    browser.kill();
    await browser.exited;
    rmSync(profile, { recursive: true, force: true });
    const missing = got ? lacking(got.report, mode) : [`no finished report within ${limit / 60000} minutes`];
    stop();
    for (const line of missing) console.log(`  ${clean(line)}`);
    console.log(missing.length === 0 ? "device: PASS" : "device: FAIL");
    process.exit(missing.length === 0 ? 0 : 1);
  }
}
