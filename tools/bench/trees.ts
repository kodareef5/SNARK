// The tree route: what trees cost and look like on high, measured in the game's own page in headless Chrome over Miami.
// It is how tree changes are judged (planning/workstreams/trees.md): run it before and after, and compare.
//
//   bun tools/bench/trees.ts [--tier high] [--page key=value ...] [--out name] [--only part-of-a-station-name]
//                            [--canvas 1800x962@2]  a window of 1800 by 962 points at 2 pixels a point, a laptop's screen
//   bun tools/bench/trees.ts --compare a.json b.json
//
// Places come from the map: the South Beach spawn, and the densest grove of broadleaf trees (oaks, figs, banyans and
// hardwoods) within 4 km of it. Each station holds the body there as a ghost and runs one bench turn of the view
// (`?bench=1&sync=1`, client/core/bench-run.ts): at the beach and at the grove's edge at eye height, and over the grove
// at 60 m and 150 m, at noon and at 17:00. Then a pass: the body moves along the beach at 15 m/s with the view held
// toward the palms, a picture every half second, so popping can be seen. Each station reports frame ms (median, 95th),
// the frame on the page's clock, the frame's and the sun's maps' triangles and draws, the trees', rocks' and bushes'
// triangles by store, and bytes on the card; the first run starts from an empty cache and reports the bytes it fetched.
// Headless Chrome draws at most 60 frames a second, so a frame's median is 16.7 ms on this Mac whatever it costs: the
// page's clock, which waits for the card to finish each frame, is the cost to compare, and the 95th shows frames missed.
// `--page key=value` adds to every page's address, for a comparison (`--page farpalm=fronds`). The report is printed
// and kept in var/bench/trees/ with the pictures. CLIENT_DIR names a folder that holds a built client, or
// where one is built and kept for the next run; without it one is built for the run.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { SETTLE_MS } from "../../client/core/bench-run.ts";
import { startServer } from "../../server/main.ts";
import { MODE_GHOST } from "../../shared/sim/character.ts";
import { offsetForHour } from "../../shared/sim/clock.ts";
import { CHUNK_SIZE } from "../../shared/coords.ts";
import { buildClientApart } from "../build-client.ts";
import { CHROME_FLAGS, findChrome } from "../chrome.ts";
import { devtools } from "../map/trip.ts";

const ROOT = resolve(import.meta.dir, "../..");
const MAP = process.env.CITY_MAP ?? join(ROOT, "var/maps/miami.snmap");
const OUT = join(ROOT, "var/bench/trees");
/** Kinds counted as broadleaf trees when finding the grove, and as palms when facing the pass. */
const BROADLEAF = ["core:oak", "core:fig", "core:banyan", "core:tree"];
const PALM = "core:palm";
// Noon, and 17:00, the sun 14 degrees up: long shadows. At 18:00 it sets and nothing casts.
const HOURS = [12, 17];
const EYE = 1.7;
/** The pass: metres along the beach either side of the spawn, at this many metres a second. */
const PASS_HALF = 150;
const PASS_SPEED = 15;

interface Station {
  name: string;
  x: number;
  z: number;
  /** Metres over the ground or the sea, whichever is higher. */
  up: number;
  hour: number;
  /** For the pass: where the body is at `t` ms from the page's start, and the look it holds. */
  path?: (t: number) => [number, number];
  look?: [number, number];
  /** A still look kept as a picture when its turn is measured, named for the station. */
  picture?: boolean;
}

interface Row {
  name: string;
  report: Record<string, any>;
}

/** The South Beach spawn, the densest broadleaf grove within 4 km of it, and the pass along the beach toward its palms. */
function placesOf(server: ReturnType<typeof startServer>): Station[] {
  const world = server.host.world, field = world.nodeField!, reg = world.reg, dims = world.dims;
  const beach = world.spawns.find((s) => s.name === "South Beach") ?? world.spawns[0]!;
  const broad = new Set(BROADLEAF.map((id) => reg.index.get(id)).filter((k): k is number => k !== undefined));
  const palm = reg.index.get(PALM) ?? -1;
  const per = field.source.perChunk;
  const count = (chunk: number, kinds: (k: number) => boolean): number => {
    let n = 0;
    for (let i = 0; i < per; i++) if (kinds(field.kindAt(chunk, i))) n++;
    return n;
  };
  // Broadleaf trees a chunk, then the best 3 by 3 window whose middle is within 4 km.
  const trees = new Uint16Array(dims.chunksX * dims.chunksZ);
  const middle = (c: number): [number, number] => [((c % dims.chunksX) + 0.5) * CHUNK_SIZE, (Math.floor(c / dims.chunksX) + 0.5) * CHUNK_SIZE];
  for (let c = 0; c < trees.length; c++) {
    const [x, z] = middle(c);
    if (Math.hypot(x - beach.x, z - beach.z) <= 4200) trees[c] = count(c, (k) => broad.has(k));
  }
  let best = -1, most = -1;
  for (let c = 0; c < trees.length; c++) {
    const [x, z] = middle(c);
    if (Math.hypot(x - beach.x, z - beach.z) > 4000) continue;
    const cx = c % dims.chunksX, cz = Math.floor(c / dims.chunksX);
    let sum = 0;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (cx + dx >= 0 && cx + dx < dims.chunksX && cz + dz >= 0 && cz + dz < dims.chunksZ) sum += trees[(cz + dz) * dims.chunksX + cx + dx]!;
    if (sum > most) [best, most] = [c, sum];
  }
  const [gx, gz] = middle(best);
  // The grove's edge: 80 m from its middle toward the beach.
  const toward = Math.hypot(beach.x - gx, beach.z - gz);
  const [ex, ez] = [gx + ((beach.x - gx) / toward) * 80, gz + ((beach.z - gz) / toward) * 80];
  // The pass runs north and south along the beach, facing whichever side, east (-x) or west (+x), has more palms within 400 m.
  let east = 0, west = 0;
  for (let c = 0; c < trees.length; c++) {
    const [x, z] = middle(c);
    if (Math.hypot(x - beach.x, z - beach.z) > 400) continue;
    const n = count(c, (k) => k === palm);
    if (x < beach.x) east += n;
    else west += n;
  }
  const yaw = east >= west ? -Math.PI / 2 : Math.PI / 2;
  console.log(`South Beach at ${beach.x.toFixed(0)}, ${beach.z.toFixed(0)}; the grove at ${gx.toFixed(0)}, ${gz.toFixed(0)} (${most} broadleaf trees in 3 by 3 chunks, ${(toward / 1000).toFixed(1)} km off); the pass faces ${east >= west ? "east" : "west"} (${Math.max(east, west)} palms within 400 m that side, ${Math.min(east, west)} the other)`);
  const stations: Station[] = [];
  for (const hour of HOURS) {
    stations.push({ name: `beach, eye, ${hour}:00`, x: beach.x, z: beach.z, up: EYE, hour });
    stations.push({ name: `grove edge, eye, ${hour}:00`, x: ex, z: ez, up: EYE, hour });
    stations.push({ name: `over the grove, 60 m, ${hour}:00`, x: gx, z: gz, up: 60, hour });
    stations.push({ name: `over the grove, 150 m, ${hour}:00`, x: gx, z: gz, up: 150, hour });
  }
  // Back and forth along the beach, so the body keeps moving however long the page takes to settle.
  const span = (4 * PASS_HALF) / PASS_SPEED;
  const along = (t: number): number => {
    const s = ((t / 1000) % span) * PASS_SPEED;
    return s < 2 * PASS_HALF ? s - PASS_HALF : 3 * PASS_HALF - s;
  };
  stations.push({ name: "pass along the beach, 12:00", x: beach.x, z: beach.z, up: EYE, hour: 12, path: (t) => [beach.x, beach.z + along(t)], look: [yaw, -0.02] });
  // Along the beach from 30 m up, its palms near and far, kept as pictures: how far palms look.
  for (const [side, turn] of [["north", 0], ["south", Math.PI]] as const) stations.push({ name: `along the beach, 30 m, ${side}`, x: beach.x, z: beach.z, up: 30, hour: 12, look: [turn, -0.12], picture: true });
  return stations;
}

/** Holds every survivor on `server` as a ghost where `at` says, from the moment it has a body; returns the stop. */
function hold(server: ReturnType<typeof startServer>, at: (t: number) => [number, number, number]): () => void {
  const { world, game } = server.host, t0 = Date.now();
  const timer = setInterval(() => {
    const [x, y, z] = at(Date.now() - t0), ents = world.ents;
    for (const c of game.clients) {
      if (!c?.active || c.closed || c.ent < 0) continue;
      ents.mode[c.ent] = MODE_GHOST;
      ents.setPosition(c.ent, x, y, z);
      ents.vx[c.ent] = ents.vy[c.ent] = ents.vz[c.ent] = 0;
    }
  }, 50);
  return () => clearInterval(timer);
}

const ms = (n: unknown): string => (typeof n === "number" ? n.toFixed(1) : "-");
const k = (n: unknown): string => (typeof n === "number" ? `${(n / 1000).toFixed(0)} k` : "-");

/** A row of the table: what one station measured. */
function line(r: Row): string {
  const p = r.report, t = p.turn ?? {};
  return [
    r.name.padEnd(34),
    `${ms(p.frameMs?.median)} / ${ms(p.frameMs?.p95)} ms`.padStart(16),
    `${ms(p.gpuMs?.frame?.median)} ms`.padStart(9),
    k(t.triangles).padStart(8),
    k(t.castTriangles).padStart(8),
    String(t.draws ?? "-").padStart(6),
    k(t.nearNodes).padStart(8),
    k(t.farNodes).padStart(8),
    `${((p.card?.bytes ?? 0) / 1048576).toFixed(0)} MB`.padStart(8),
    (typeof p.squeeze === "number" ? p.squeeze.toFixed(2) : "-").padStart(8),
  ].join("  ");
}
const HEAD = ["station".padEnd(34), "frame, median / 95th".padStart(16), "clock".padStart(9), "tris".padStart(8), "cast".padStart(8), "draws".padStart(6), "near trees".padStart(8), "far trees".padStart(8), "card".padStart(8), "squeeze".padStart(8)].join("  ");

async function run(tier: string, page: string[], name: string, only: string | undefined, canvas = "1920x1080@1"): Promise<void> {
  const [size, scale] = canvas.split("@"), [width, height] = size!.split("x");
  const chrome = findChrome();
  if (!chrome) throw new Error("no Chrome: name it with CHROME");
  if (!existsSync(MAP)) throw new Error(`no map at ${MAP}: build Miami first, or name one with CITY_MAP`);
  const dist = process.env.CLIENT_DIR ?? mkdtempSync(join(tmpdir(), "snark-trees-client-"));
  if (!existsSync(join(dist, "index.html"))) await buildClientApart({ dist, quick: true });
  let got: (report: Record<string, any>) => void = () => {};
  let look: [number, number] = [0, 0];
  const routes = (req: Request, url: URL): Response | Promise<Response> | null => {
    if (url.pathname === "/__bench" && req.method === "POST") return req.json().then((r) => (got(r as Record<string, any>), new Response("ok")));
    if (url.pathname === "/__look") return Response.json({ look });
    return null;
  };
  const server = startServer({ port: 0, hostname: "127.0.0.1", clientDir: dist, probeScene: true, routes, map: MAP });
  const stamp = new Date().toISOString().slice(0, 19).replaceAll(":", "-");
  const folder = join(OUT, `${stamp}${name ? `-${name}` : ""}`);
  mkdirSync(folder, { recursive: true });
  const rows: Row[] = [];
  const profile = mkdtempSync(join(tmpdir(), "snark-trees-"));
  let cold: number | null = null;
  console.log(HEAD);
  try {
    for (const s of placesOf(server).filter((s) => !only || s.name.includes(only))) {
      const w = server.host.world, hf = w.hf;
      w.dayOffset = offsetForHour(w.tick, s.hour, w.clock);
      server.host.game.markAllOwn();
      const at = (t: number): [number, number, number] => {
        const [x, z] = s.path ? s.path(t) : [s.x, s.z];
        return [x, Math.max(hf.heightAt(x, z), Number.isFinite(hf.seaLevel) ? hf.seaLevel : -Infinity) + s.up, z];
      };
      const stop = hold(server, at);
      if (s.look) look = s.look;
      const link = `http://127.0.0.1:${server.port}/?bench=1&name=bench&tier=${tier}&sync=1${s.look ? "&still=1&look=pass" : ""}${page.map((p) => `&${p}`).join("")}`;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const report = new Promise<Record<string, any> | null>((done) => ((got = done), (timer = setTimeout(() => done(null), SETTLE_MS + 120000))));
      rmSync(join(profile, "DevToolsActivePort"), { force: true });
      const browser = Bun.spawn([chrome, "--headless=new", ...CHROME_FLAGS, "--mute-audio", "--no-first-run", "--no-default-browser-check", "--disable-extensions", `--window-size=${width},${height}`, `--force-device-scale-factor=${scale ?? 1}`, "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdout: "ignore", stderr: "ignore" });
      const devt = await devtools(profile);
      await devt.send("Page.addScriptToEvaluateOnNewDocument", { source: "performance.setResourceTimingBufferSize(100000)" });
      await devt.send("Page.navigate", { url: link });
      // The pass keeps a picture every half second, the last 30 of them.
      let pictures = 0, done = false;
      const shooting = s.path
        ? (async () => {
            while (!done) {
              await Bun.sleep(500);
              if (!done) await devt.shot(join(folder, `pass-${String(pictures++ % 30).padStart(2, "0")}.png`)).catch(() => {});
            }
          })()
        : null;
      const result = await report;
      done = true;
      await shooting;
      clearTimeout(timer);
      if (result && s.picture) await devt.shot(join(folder, `${s.name.replaceAll(/[^a-z0-9]+/g, "-")}.png`));
      if (result && cold === null) cold = await devt.value<number>("performance.getEntriesByType('resource').reduce((s, e) => s + (e.encodedBodySize || 0), 0)").catch(() => null);
      devt.close();
      stop();
      browser.kill();
      await browser.exited;
      if (!result) {
        console.log(`${s.name.padEnd(34)}  no report`);
        continue;
      }
      const row = { name: s.name, report: result };
      rows.push(row);
      console.log(line(row));
    }
  } finally {
    server.stop();
    rmSync(profile, { recursive: true, force: true });
    if (!process.env.CLIENT_DIR) rmSync(dist, { recursive: true, force: true });
  }
  if (cold !== null) console.log(`a cold load to the first station fetched ${(cold / 1048576).toFixed(1)} MB`);
  const file = join(folder, "report.json");
  writeFileSync(file, JSON.stringify({ date: stamp, map: MAP, tier, page, coldBytes: cold, rows }, null, 1));
  console.log(`kept in ${folder}`);
}

/** Two reports' rows side by side: each measure of the second against the first. */
function compare(a: string, b: string): void {
  const [x, y] = [a, b].map((f) => JSON.parse(readFileSync(f, "utf8")) as { rows: Row[]; page: string[]; coldBytes: number | null });
  console.log(`${a} (${x!.page.join(" ") || "as built"}) against ${b} (${y!.page.join(" ") || "as built"})`);
  console.log(HEAD);
  for (const r of x!.rows) {
    const other = y!.rows.find((o) => o.name === r.name);
    console.log(line(r));
    if (other) console.log(line({ ...other, name: "  then" }));
  }
  if (x!.coldBytes && y!.coldBytes) console.log(`cold load: ${(x!.coldBytes / 1048576).toFixed(1)} MB, then ${(y!.coldBytes / 1048576).toFixed(1)} MB`);
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const value = (flag: string): string | undefined => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
  if (args[0] === "--compare") compare(args[1]!, args[2]!);
  else await run(value("--tier") ?? "high", args.flatMap((a, i) => (a === "--page" ? [args[i + 1]!] : [])), value("--out") ?? "", value("--only"), value("--canvas"));
  process.exit(0);
}
