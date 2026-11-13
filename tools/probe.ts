// The boot probe: the only place this project launches a browser.
//
// Builds the client, starts the server on a free port, opens installed Chrome
// headless at ?selfcheck=1, waits for the report the page posts back, prints
// it and exits 0 or 1. No packages. Run on demand; it is not part of the check.
//
//   bun run probe
//   CHROME=/path/to/chrome bun run probe
//   bun run probe -- --bench     also fly the camera for 900 frames and report frame times
//
// The frame times of a headless browser on this machine say little about a
// player's. For a real number, run `bun run dev` and open
// http://localhost:8787/?bench=1 on the device in question: the same report is
// printed by the dev server.

import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "../server/main.ts";
import { buildClient } from "./build-client.ts";

const CANDIDATES = [
  process.env.CHROME,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
];
const chrome = CANDIDATES.find((p) => p && existsSync(p));
if (!chrome) {
  console.error("probe: no Chrome found. Set CHROME to its path.");
  process.exit(2);
}

await buildClient();
const server = startServer({ dev: true, port: 0, probeScene: true });
const profile = mkdtempSync(join(tmpdir(), "snark-probe-"));
const url = `http://localhost:${server.port}/?selfcheck=1&creature=1&name=probe`;
const browser = Bun.spawn([chrome, "--headless=new", "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--window-size=1280,720", `--user-data-dir=${profile}`, url], { stdout: "ignore", stderr: "ignore" });

const timeout = new Promise<null>((r) => setTimeout(() => r(null), 30000));
const report = (await Promise.race([server.selfcheck, timeout])) as { ok?: boolean } | null;
browser.kill();
await browser.exited;
if (report && process.argv.includes("--bench")) {
  // A second page load of the same fixed scene, with the camera flying itself.
  const flying = Bun.spawn([chrome, "--headless=new", "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--window-size=1280,720", `--user-data-dir=${profile}`, `http://localhost:${server.port}/?bench=1&name=bench`], { stdout: "ignore", stderr: "ignore" });
  await Promise.race([server.bench, new Promise((r) => setTimeout(r, 40000))]);
  flying.kill();
  await flying.exited;
}
server.stop();
rmSync(profile, { recursive: true, force: true });

if (!report) {
  console.error("probe: no report within 30 s. The page did not boot, or WebGL2 is unavailable in headless mode.");
  process.exit(1);
}
console.log(JSON.stringify(report, null, 2));
console.log(report.ok ? "\nprobe: PASS" : "\nprobe: FAIL");
process.exit(report.ok ? 0 : 1);
