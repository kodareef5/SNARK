// What people cost to draw on this machine's GPU. Each run is the game's own page at `?bench=1` in headless Chrome (as
// tools/bench/gpu.ts runs it) on the proving ground, its view held south over the plaza, with the crowd of
// client/core/people-crowd.ts in front of it: one body filling the view, 40 at 8 to 25 m, or 200 at 8 to 80 m, each in
// one shared look, a look of its own, or its own look and a mix of clothes, armour and a held tool. A run with no crowd
// is the scene the people are added to. Every cell is run on each tier asked, warmed first, then `runs` times by turns,
// each round starting one cell further on. The world is held at noon.
//
//   bun tools/bench/people.ts [--runs 4] [--warm 1] [--tiers medium,high] [--only far] [--label intel] [--client dir] [--shots]
//   bun tools/bench/people.ts --table [--drop 1] var/people-bench/intel.json var/people-bench/rtx.json
//
// A GPU's first round runs up to twice as slow as the rest, so `--warm` rounds are run first and not kept, and
// `--drop` leaves out each cell's first runs of a saved file.
//
// The card is the one tools/chrome.ts picks: SNARK_GPU=mesa or nvidia. The page is a client built for the bench into
// var/people-bench/client, or the one --client or CLIENT_DIR names, which must be built from this source. What it writes
// goes under var/people-bench: <label>.json, every run's numbers and each cell's ranges, <label>.txt, the table, and
// with --shots each cell's last frame in <label>-shots.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { loadavg, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { CROWD_PRINT_FIRST, CROWD_SCENES, CROWD_SHAPES, CROWD_VIEWER, crowdView, type CrowdScene } from "../../client/core/people-crowd.ts";
import { encodePng } from "../snap/png.ts";
import { SETTLE_MS } from "../../client/core/bench-run.ts";
import { startServer } from "../../server/main.ts";
import { buildClientApart } from "../build-client.ts";
import { CHROME_FLAGS, findChrome } from "../chrome.ts";
import { devtools, holdAt, holdHour } from "./gpu.ts";
import { address, cellName, cells, numbersOf, rounds, summarise, table, type Cell, type CellSummary, type RunNumbers } from "./people-rows.ts";

const ROOT = resolve(import.meta.dir, "../..");
const OUT = join(ROOT, "var/people-bench");
/** A desktop's canvas: headless Chrome keeps 87 of the window's points, so this window gives 1,920 by 1,080. */
const WINDOW = [1920, 1167] as const;
const HOUR = 12;

interface Saved {
  label: string;
  renderer: string;
  commit: string;
  date: string;
  window: readonly number[];
  load: number[];
  cells: CellSummary[];
  runs: Record<string, RunNumbers[]>;
}

/**
 * Print `k` of a printed crowd as the page fetches it (people-crowd.ts crowdPrints): a disc of a colour of its own on
 * nothing, ringed, with `k`'s bits as bars across it; every third twice as wide as high.
 */
export function crowdPrintPng(k: number): Uint8Array {
  const [w, h] = k % 3 === 2 ? [512, 256] : [512, 512];
  const px = new Uint8Array(w * h * 4), long = w / h - 1;
  const hue = (k * 0.618034) % 1, rgb = [0, 1, 2].map((c) => Math.round(255 * (0.5 + 0.5 * Math.cos(2 * Math.PI * (hue + c / 3)))));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    // In halves of the height from the middle: a disc, or on a wide one a stadium, of radius 0.95.
    const dx = (x + 0.5 - w / 2) / (h / 2), dy = (y + 0.5 - h / 2) / (h / 2);
    const r = Math.hypot(Math.max(Math.abs(dx) - long, 0), dy);
    if (r >= 0.95) continue;
    const column = Math.floor((dx + long + 0.9) / 0.3);
    const bar = r < 0.8 && Math.abs(dy) < 0.45 && column >= 0 && column < 6 && ((k >> column) & 1) === 1;
    const c = r > 0.8 ? [250, 250, 250] : bar ? [20, 20, 30] : rgb;
    px.set([c[0]!, c[1]!, c[2]!, 255], (y * w + x) * 4);
  }
  return encodePng(w, h, px);
}

/** Runs every cell of `list` `runs` times by turns after `warm` rounds not kept, and returns each run's numbers by cell. */
async function measure(list: readonly Cell[], runs: number, warm: number, dist: string, say: (line: string) => void, shots: string | null): Promise<{ results: Map<string, RunNumbers[]>; renderer: string }> {
  const chrome = findChrome();
  if (!chrome) throw new Error("no Chrome: set CHROME");
  let got: (report: Record<string, any>) => void = () => {};
  const prints = new Map<string, Uint8Array>();
  const routes = (req: Request, url: URL): Response | Promise<Response> | null => {
    const view = url.searchParams.get("view") as CrowdScene;
    // A printed crowd's pictures, made once each.
    const print = /^\/media\/print\.([0-9a-f]{16})\.png$/.exec(url.pathname);
    const k = print ? parseInt(print[1]!, 16) - CROWD_PRINT_FIRST : -1;
    if (k >= 0 && k < CROWD_SHAPES.far.count) {
      const png = prints.get(print![1]!) ?? prints.set(print![1]!, crowdPrintPng(k)).get(print![1]!)!;
      return new Response(png, { headers: { "content-type": "image/png", "cache-control": "no-store" } });
    }
    if (url.pathname === "/__look" && CROWD_SCENES.includes(view)) {
      const v = crowdView(view);
      return Response.json({ look: [v.yaw, v.pitch] });
    }
    return url.pathname === "/__bench" && req.method === "POST" ? req.json().then((r) => (got(r as Record<string, any>), new Response("ok"))) : null;
  };
  const server = startServer({ port: 0, hostname: "127.0.0.1", clientDir: dist, probeScene: true, routes });
  const hf = server.host.world.hf;
  const hold = holdAt(server, { name: "people", east: hf.sizeX / 2 - CROWD_VIEWER.x, north: CROWD_VIEWER.z - hf.sizeZ / 2, up: 0 });
  const noon = holdHour(server, HOUR);
  const profile = mkdtempSync(join(tmpdir(), "snark-people-"));
  const results = new Map<string, RunNumbers[]>();
  let renderer = "";
  const once = async (c: Cell): Promise<Record<string, any> | null> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const report = new Promise<Record<string, any> | null>((done) => ((got = done), (timer = setTimeout(() => done(null), SETTLE_MS + 120000))));
    rmSync(join(profile, "DevToolsActivePort"), { force: true });
    const browser = Bun.spawn([chrome, "--headless=new", ...CHROME_FLAGS, "--mute-audio", "--no-first-run", "--no-default-browser-check", "--disable-extensions", `--window-size=${WINDOW.join(",")}`, "--force-device-scale-factor=1", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdout: "ignore", stderr: "ignore" });
    try {
      const page = await devtools(profile);
      await page.send("Page.navigate", { url: address(server.port, c) });
      const result = await report;
      // With --shots, the frame the run ended on is kept, to see what was measured.
      if (result && shots) writeFileSync(join(shots, `${cellName(c).replaceAll(/[^a-z0-9]+/gi, "-")}.png`), Buffer.from((await page.send("Page.captureScreenshot", { format: "png" })).data, "base64"));
      page.close();
      return result;
    } finally {
      clearTimeout(timer);
      browser.kill();
      await browser.exited;
    }
  };
  try {
    for (const [k, round] of rounds(list, warm + runs).entries()) {
      const name = k < warm ? `warming round ${k + 1}` : `round ${k + 1 - warm}`;
      for (const c of round) {
        const r = await once(c);
        if (!r) {
          say(`${name}, ${cellName(c)}: no report`);
          continue;
        }
        renderer ||= String(r.renderer ?? "");
        const n = numbersOf(r);
        if (k >= warm) results.set(cellName(c), [...(results.get(cellName(c)) ?? []), n]);
        say(`${name}, ${cellName(c)}: GPU ${n.gpuMedian} ms (p95 ${n.gpuP95}), ours ${n.cpuMs} ms, ${n.glDraws} GL draws, ${n.draws} draws, ${n.triangles} triangles, ${n.bones} bones, ${n.posed} posed, ${n.dropped} dropped${n.gaveUp ? ", NOT STILL" : ""} (load ${loadavg()[0]!.toFixed(1)})`);
      }
    }
  } finally {
    clearInterval(hold);
    clearInterval(noon);
    server.stop();
    rmSync(profile, { recursive: true, force: true });
  }
  return { results, renderer };
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const arg = (name: string, or: string): string => (argv.includes(name) ? argv[argv.indexOf(name) + 1]! : or);
  if (argv[0] === "--table") {
    const drop = Number(arg("--drop", "0"));
    for (const file of argv.slice(1).filter((a, i, all) => a !== "--drop" && all[i - 1] !== "--drop")) {
      const saved = JSON.parse(readFileSync(file, "utf8")) as Saved;
      const runs = new Map(Object.entries(saved.runs).map(([k, v]) => [k, v.slice(drop)]));
      console.log(`\n${saved.label}: ${saved.renderer}, ${saved.window.join(" by ")} window, ${saved.date}, ${saved.commit}${drop ? `, first ${drop} runs left out` : ""}\n`);
      console.log(table(drop ? summarise(saved.cells.map((c) => c.cell), runs) : saved.cells));
    }
    process.exit(0);
  }
  const runs = Number(arg("--runs", "4"));
  const warm = Number(arg("--warm", "1"));
  const tiers = arg("--tiers", "medium,high").split(",");
  const only = arg("--only", "");
  const label = arg("--label", process.env.SNARK_GPU ?? "default");
  const list = cells(tiers).filter((c) => !only || c.scene === "empty" || cellName(c).startsWith(only));
  mkdirSync(OUT, { recursive: true });
  const given = argv.includes("--client") ? resolve(arg("--client", "")) : process.env.CLIENT_DIR;
  const dist = given ?? join(OUT, "client");
  if (!given) await buildClientApart({ stress: false, quick: true, dist });
  if (!existsSync(join(dist, "index.html"))) throw new Error(`no built client at ${dist}`);
  const load = [loadavg()[0]!];
  console.log(`${list.length} cells, ${warm} warming and ${runs} kept runs each, card ${process.env.SNARK_GPU ?? "as Chrome finds it"}, load ${load[0]!.toFixed(1)}`);
  const shots = argv.includes("--shots") ? join(OUT, `${label}-shots`) : null;
  if (shots) mkdirSync(shots, { recursive: true });
  const { results, renderer } = await measure(list, runs, warm, dist, (line) => console.log(`  ${line}`), shots);
  load.push(loadavg()[0]!);
  const summaries = summarise(list, results);
  const commit = Bun.spawnSync(["git", "rev-parse", "--short", "HEAD"], { cwd: ROOT }).stdout.toString().trim();
  const saved: Saved = { label, renderer, commit, date: new Date().toISOString(), window: WINDOW, load, cells: summaries, runs: Object.fromEntries(results) };
  writeFileSync(join(OUT, `${label}.json`), JSON.stringify(saved, null, 1));
  const text = `${label}: ${renderer}\n\n${table(summaries)}\n`;
  writeFileSync(join(OUT, `${label}.txt`), text);
  console.log(`\n${text}\nwritten to ${join(OUT, `${label}.json`)}`);
  process.exit(0);
}
