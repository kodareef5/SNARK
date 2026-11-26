// A first meeting on the game's page: eight survivors in long hair or a ponytail, each with a face of its own, come to 2.5
// to 6 m from the viewer 1.5 s into a bench run (people-crowd.ts Arrival), so their faces, hair and beards are read and
// made for the first time among the measured frames; then the same crowd there from the start, made before the run.
// Each run's worst frame of our own work and of the page's frame interval, and the worst in the two seconds after the
// arrival, against the crowd that was there all along.
//
//   bun tools/bench/people-arrive.ts [--client dir] [--runs 3] [--tier medium]
//
// The card is the one tools/chrome.ts picks: SNARK_GPU=mesa or nvidia. The page is a client built for it into
// var/people-arrive/client, or the one --client names, which must be built from this source.

import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { CROWD_VIEWER, crowdView } from "../../client/core/people-crowd.ts";
import { SETTLE_MS } from "../../client/core/bench-run.ts";
import { startServer } from "../../server/main.ts";
import { buildClientApart } from "../build-client.ts";
import { CHROME_FLAGS, findChrome } from "../chrome.ts";
import { devtools, holdAt, holdHour } from "./gpu.ts";

const ROOT = resolve(import.meta.dir, "../..");
const WINDOW = [1920, 1167] as const;
/** When the crowd comes, ms into the run, and the frames after it looked at. */
const ARRIVE = 1500;
const AFTER = 120;

const argv = process.argv.slice(2);
const arg = (name: string, or: string): string => (argv.includes(name) ? argv[argv.indexOf(name) + 1]! : or);
const runs = Number(arg("--runs", "3"));
const tier = arg("--tier", "medium");
const given = argv.includes("--client") ? resolve(arg("--client", "")) : null;
const dist = given ?? join(ROOT, "var/people-arrive/client");
if (!given) {
  mkdirSync(dist, { recursive: true });
  await buildClientApart({ stress: false, quick: true, dist });
}
if (!existsSync(join(dist, "index.html"))) throw new Error(`no built client at ${dist}`);
const chrome = findChrome();
if (!chrome) throw new Error("no Chrome: set CHROME");

let got: (report: Record<string, any>) => void = () => {};
const routes = (req: Request, url: URL): Response | Promise<Response> | null => {
  if (url.pathname === "/__look") {
    const v = crowdView("near");
    return Response.json({ look: [v.yaw, v.pitch] });
  }
  return url.pathname === "/__bench" && req.method === "POST" ? req.json().then((r) => (got(r as Record<string, any>), new Response("ok"))) : null;
};
const server = startServer({ port: 0, hostname: "127.0.0.1", clientDir: dist, probeScene: true, routes });
const hf = server.host.world.hf;
const hold = holdAt(server, { name: "people", east: hf.sizeX / 2 - CROWD_VIEWER.x, north: CROWD_VIEWER.z - hf.sizeZ / 2, up: 0 });
const noon = holdHour(server, 12);
const profile = mkdtempSync(join(tmpdir(), "snark-arrive-"));

/** One run's report, the crowd coming at ARRIVE where `arrive`, else there from the start. */
async function once(arrive: boolean): Promise<Record<string, any> | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const report = new Promise<Record<string, any> | null>((done) => ((got = done), (timer = setTimeout(() => done(null), SETTLE_MS + 120000))));
  rmSync(join(profile, "DevToolsActivePort"), { force: true });
  const browser = Bun.spawn([chrome!, "--headless=new", ...CHROME_FLAGS, "--mute-audio", "--no-first-run", "--no-default-browser-check", "--disable-extensions", `--window-size=${WINDOW.join(",")}`, "--force-device-scale-factor=1", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdout: "ignore", stderr: "ignore" });
  try {
    const page = await devtools(profile);
    await page.send("Page.navigate", { url: `http://127.0.0.1:${server.port}/?bench=1&name=bench&tier=${tier}&still&look=near&people=near&looks=unique&close=8${arrive ? `&arrive=${ARRIVE}` : ""}` });
    const r = await report;
    page.close();
    return r;
  } finally {
    clearTimeout(timer);
    browser.kill();
    await browser.exited;
  }
}

const worst = (list: readonly number[]): number => list.reduce((a, b) => Math.max(a, b), 0);
try {
  for (let k = 0; k < runs; k++) for (const arrive of [true, false]) {
    const r = await once(arrive);
    if (!r) {
      console.log(`${arrive ? "arrives" : "there   "}: no report`);
      continue;
    }
    const ours: number[] = r.ourFrames ?? [], gpu: number[] = r.gpuFrames ?? [], from = Math.round((ARRIVE * 60) / 1000);
    const after = ours.slice(from - 2, from + AFTER), gpuAfter = gpu.slice(from - 2, from + AFTER);
    console.log(`${arrive ? "arrives" : "there   "} ${r.renderer}: ours worst ${worst(ours).toFixed(2)} ms, p99 ${r.buildAndSubmitMs?.p99}, median ${r.buildAndSubmitMs?.median}; after ${ARRIVE} ms worst ${worst(after).toFixed(2)} ms; frame interval worst ${r.frameMs?.worst} ms, median ${r.frameMs?.median}; GPU worst ${worst(gpu).toFixed(2)}, after ${worst(gpuAfter).toFixed(2)} ms; posed ${r.turn?.posed}, bones ${r.turn?.bones}`);
    console.log(`  our ms, frames ${from - 2} to ${from + 30}: ${ours.slice(from - 2, from + 30).map((m) => m.toFixed(1)).join(" ")}`);
  }
} finally {
  clearInterval(hold);
  clearInterval(noon);
  server.stop();
  rmSync(profile, { recursive: true, force: true });
}
process.exit(0);
