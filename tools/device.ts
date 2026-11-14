// `bun run device`: a throwaway game server for measuring a phone, and the reports its page sends. It prints a short path
// to open. With --tunnel it also runs a temporary Cloudflare tunnel (cloudflared, no account) and prints the whole link.
// The page measures the device by itself (client/core/device.ts) and posts its report after every step; each run is kept
// in .cache/device/ and printed as a table when it is done. With --self the local headless Chrome opens the link and the
// run must finish: the test that the probe works, not part of the check. --port n, and --minutes n before it stops by
// itself (30). CHROME and CLOUDFLARED name the programs.
//
// While the tunnel is up anyone may reach the server. The short path has four letters nobody is told and closes after
// 64 wrong guesses, the report needs a 128-bit token, joining needs a random password, and cheats are off.

import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { TIERS } from "../client/core/assets/tiers.ts";
import { SCENES, crowdScene, deviceScenarios, deviceTable, type DeviceReport } from "../client/core/device.ts";
import { CORE_CONTENT } from "../content/core.ts";
import { startServer } from "../server/main.ts";
import { loadConfig } from "../server/settings/config.ts";
import { stopOnSignals } from "../server/signals.ts";
import { compileContent } from "../shared/content/registry.ts";
import { parseManifest } from "../shared/pack/manifest.ts";
import { parsePack } from "../shared/pack/pack.ts";
import { buildClient } from "./build-client.ts";

/** A report larger than this is refused, and so is any post past these counts. */
export const REPORT_BYTES = 64 * 1024;
export const MAX_RUNS = 16;
export const MAX_POSTS = 400;
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
  /** The server's hashes of the scenarios, for the page to compare its own with. */
  expected: Record<string, string>;
  say(line: string): void;
  /** Each run the page says is done, once. */
  done?(report: DeviceReport, file: string): void;
}

interface Run {
  file: string;
  seq: number;
  stage: string;
  last: DeviceReport;
  told: boolean;
}

/** The device probe's requests: the short path, and the token's ping, hashes and reports. Null for any other. */
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
    if (report.seq <= run.seq) return answer("ok");
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
    return answer("ok");
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
      return new Response(null, { status: 302, headers: { location: `/?device=${o.token}&password=${o.password}`, "cache-control": "no-store" } });
    }
    if (path.startsWith("/d/")) {
      if (++wrong === MAX_WRONG) o.say(`${MAX_WRONG} wrong guesses at the short path, so it is closed; the whole link still works`);
      return answer("not found", 404);
    }
    // A page needs no source maps, and they hold the client's source.
    if (path.endsWith(".map")) return answer("not found", 404);
    if (!path.startsWith("/__device/")) return null;
    if (!allowed(url.searchParams.get("token"))) return answer("not found", 404);
    if (path === "/__device/ping") return Response.json(true, { headers: { "cache-control": "no-store" } });
    if (path === "/__device/hashes") return Response.json(o.expected, { headers: { "cache-control": "no-store" } });
    if (path === "/__device/report" && req.method === "POST") return receive(req);
    return answer("not found", 404);
  };
  return { routes, unfinished: () => [...runs.values()].filter((r) => !r.told) };
}

/** What a report lacks of a whole run on a desktop, which can run every tier. Empty if nothing. */
export function lacking(r: DeviceReport): string[] {
  const out: string[] = [];
  if (!r.done) out.push("it never finished");
  if (r.reloadedDuring) out.push(`the page was reloaded during ${r.reloadedDuring}`);
  for (const e of r.errors) out.push(`error: ${e}`);
  for (const [part, value] of [["device", r.device], ["gpu", r.gpu], ["load", r.load], ["link", r.link.httpMs], ["probes", r.probes], ["hashes", r.hashes], ["again", r.again]] as const) if (!value) out.push(`no ${part}`);
  for (const p of r.probes ?? []) if (!p.ok) out.push(`probe ${p.name} is wrong`);
  for (const h of r.hashes ?? []) if (h.got !== h.want) out.push(`hash ${h.name} differs from the server's`);
  for (const t of TIERS) if (r.phases.filter((p) => p.tier === t.name).length !== SCENES.length) out.push(`tier ${t.name} did not run every scene`);
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
  const tunnel = process.argv.includes("--tunnel");
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
      table = deviceTable(report).slice(0, 80).map(clean);
    } catch {
      table = ["a report that could not be read as one"];
    }
    console.log(`\n${table.join("\n")}\n\nkept in ${file}\n`);
  };
  const probe = deviceRoutes({ dir, token, code, password, expected, say, done: (report, file) => (print(report, file), finished({ report, file })) });
  const { rules } = loadConfig({ gus: `[ServerSettings]\nServerPassword=${password}\n` });
  // The fixed scene of the boot probe, where nothing wakes, and behind the spawn point the crowd scene's thatch and bodies.
  const server = startServer({ port: Number(value("--port") ?? 0), hostname: "127.0.0.1", probeScene: true, config: rules, routes: probe.routes });
  const scene = crowdScene();
  const world = server.host.world;
  const crowd = scene.bodies.filter((s) => server.host.spawnCreature(s.species, s.x, s.z, 1) >= 0).length;
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
    server.stop();
  };
  process.on("exit", () => child?.kill());
  stopOnSignals(stop);
  const minutes = Number(value("--minutes") ?? 30);
  setTimeout(() => {
    say(`${minutes} minutes are up`);
    stop();
    process.exit(0);
  }, minutes * 60000);

  let base = `http://127.0.0.1:${server.port}`;
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
      child = Bun.spawn([cloudflared, "tunnel", "--no-autoupdate", "--url", base], { stdout: "pipe", stderr: "pipe" });
      void lines(child.stdout as ReadableStream<Uint8Array>, each);
      void lines(child.stderr as ReadableStream<Uint8Array>, each);
    });
    const gave = await Promise.race([Promise.all([address, ready]).then(() => url), new Promise<null>((r) => setTimeout(() => r(null), 45000))]);
    if (!gave) {
      console.error(`device: cloudflared gave no working trycloudflare.com address in 45 s. It said:\n${out.join("\n")}`);
      stop();
      process.exit(1);
    }
    base = gave;
    // A page through the tunnel is the server's own, but say so in case the tunnel does not pass the host on.
    server.host.setSetting("AllowedOrigins", gave);
    let through = false;
    for (let i = 0; i < 20 && !through; i++) {
      await Bun.sleep(i === 0 ? 3000 : 1500);
      through = (await fetch(`${gave}/__device/ping?token=${token}`).catch(() => null))?.ok === true;
    }
    say(through ? "a request through the tunnel reached the server" : "a request through the tunnel did not reach the server from here yet; a phone may still get through");
  }

  console.log(`\nSNARK device probe: ${crowd} bodies in the crowd and ${pieces} pieces of thatch; reports go to ${dir}`);
  console.log(`  open on the device:  ${base}/d/${code}`);
  console.log(`  where that leads:    ${base}/?device=${token}&password=${password}`);
  if (tunnel) console.log(`  on this machine:     http://127.0.0.1:${server.port}/d/${code}`);
  console.log(`  Ctrl+C stops it; it stops by itself in ${minutes} minutes${tunnel ? ", and takes the tunnel down" : ""}\n`);

  if (self) {
    const profile = mkdtempSync(join(tmpdir(), "snark-device-"));
    // A phone's shape: a narrow window three device pixels to the CSS pixel.
    const browser = Bun.spawn([chrome!, "--headless=new", "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--window-size=430,932", "--force-device-scale-factor=3", `--user-data-dir=${profile}`, `${base}/d/${code}`], { stdout: "ignore", stderr: "ignore" });
    const got = await Promise.race([whole, new Promise<null>((r) => setTimeout(() => r(null), 6 * 60000))]);
    browser.kill();
    await browser.exited;
    rmSync(profile, { recursive: true, force: true });
    const missing = got ? lacking(got.report) : ["no finished report within six minutes"];
    stop();
    for (const line of missing) console.log(`  ${clean(line)}`);
    console.log(missing.length === 0 ? "device: PASS" : "device: FAIL");
    process.exit(missing.length === 0 ? 0 : 1);
  }
}
