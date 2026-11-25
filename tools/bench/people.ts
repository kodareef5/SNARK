// What people cost to draw on this machine's GPU. Each run is the game's own page at `?bench=1` in headless Chrome (as
// tools/bench/gpu.ts runs it) on the proving ground, its view held south over the plaza, with the crowd of
// client/core/people-crowd.ts in front of it: one body filling the view, 40 at 8 to 25 m, or 200 at 8 to 80 m, each in
// one shared look, a look of its own, or its own look and a mix of clothes, armour and a held tool. A run with no crowd
// is the scene the people are added to. Every cell is run on each tier asked, warmed first, then `runs` times by turns,
// each round starting one cell further on. The world is held at noon.
//
//   bun tools/bench/people.ts [--runs 4] [--tiers medium,high] [--only far] [--label intel] [--client dir] [--shots]
//   bun tools/bench/people.ts --table var/people-bench/intel.json var/people-bench/rtx.json
//
// The card is the one tools/chrome.ts picks: SNARK_GPU=mesa or nvidia. The page is a client built for the bench into
// var/people-bench/client, or the one --client or CLIENT_DIR names, which must be built from this source. What it writes
// goes under var/people-bench: <label>.json, every run's numbers and each cell's ranges, <label>.txt, the table, and
// with --shots each cell's last frame in <label>-shots.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { loadavg, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { CROWD_SCENES, CROWD_VIEWER, crowdView, type CrowdScene } from "../../client/core/people-crowd.ts";
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

/** Runs every cell of `list` `runs` times by turns after one warming run a tier, and returns each run's numbers by cell. */
async function measure(list: readonly Cell[], runs: number, dist: string, say: (line: string) => void, shots: string | null): Promise<{ results: Map<string, RunNumbers[]>; renderer: string }> {
  const chrome = findChrome();
  if (!chrome) throw new Error("no Chrome: set CHROME");
  let got: (report: Record<string, any>) => void = () => {};
  const routes = (req: Request, url: URL): Response | Promise<Response> | null => {
    const view = url.searchParams.get("view") as CrowdScene;
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
    for (const tier of [...new Set(list.map((c) => c.tier))]) {
      const heaviest = list.filter((c) => c.tier === tier).at(-1)!;
      const r = await once(heaviest);
      say(`warmed on ${cellName(heaviest)}: ${r ? `${r.gpuMs?.frame?.median ?? "untimed"} ms on the GPU, ${r.renderer}` : "no report"}`);
    }
    for (const [k, round] of rounds(list, runs).entries()) {
      for (const c of round) {
        const r = await once(c);
        if (!r) {
          say(`round ${k + 1}, ${cellName(c)}: no report`);
          continue;
        }
        renderer ||= String(r.renderer ?? "");
        const n = numbersOf(r);
        results.set(cellName(c), [...(results.get(cellName(c)) ?? []), n]);
        say(`round ${k + 1}, ${cellName(c)}: GPU ${n.gpuMedian} ms (p95 ${n.gpuP95}), ours ${n.cpuMs} ms, ${n.glDraws} GL draws, ${n.draws} draws, ${n.triangles} triangles, ${n.bones} bones, ${n.posed} posed, ${n.dropped} dropped${n.gaveUp ? ", NOT STILL" : ""} (load ${loadavg()[0]!.toFixed(1)})`);
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
    for (const file of argv.slice(1)) {
      const saved = JSON.parse(readFileSync(file, "utf8")) as Saved;
      console.log(`\n${saved.label}: ${saved.renderer}, ${saved.window.join(" by ")} window, ${saved.date}, ${saved.commit}\n`);
      console.log(table(saved.cells));
    }
    process.exit(0);
  }
  const runs = Number(arg("--runs", "4"));
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
  console.log(`${list.length} cells, ${runs} runs each, card ${process.env.SNARK_GPU ?? "as Chrome finds it"}, load ${load[0]!.toFixed(1)}`);
  const shots = argv.includes("--shots") ? join(OUT, `${label}-shots`) : null;
  if (shots) mkdirSync(shots, { recursive: true });
  const { results, renderer } = await measure(list, runs, dist, (line) => console.log(`  ${line}`), shots);
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
