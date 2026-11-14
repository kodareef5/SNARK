// The boot probe is the only place this project launches a browser, and it is not part of the check. It opens installed Chrome
// headless at ?selfcheck=1 and exits 0 or 1 on the report the page posts back. CHROME sets the browser path. Flags: --bench, --no-voice, --voice,
// and --lose, which takes the page's graphics context away and gives it back before it reports.

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
// Unless --no-voice is given, the page talks to itself through the server. VOICE_FLAGS give Chrome a fake microphone, grant it
// without a prompt, and let sound start without a gesture.
const url = `http://localhost:${server.port}/?selfcheck=1&creature=1&name=probe${process.argv.includes("--no-voice") ? "" : "&voice=1"}${process.argv.includes("--lose") ? "&lose=1" : ""}`;
const VOICE_FLAGS = ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"];
const browser = Bun.spawn([chrome, "--headless=new", "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--window-size=1280,720", ...VOICE_FLAGS, `--user-data-dir=${profile}`, url], { stdout: "ignore", stderr: "ignore" });

const timeout = new Promise<null>((r) => setTimeout(() => r(null), 30000));
const report = (await Promise.race([server.nextSelfcheck(), timeout])) as { ok?: boolean } | null;
let second: { ok?: boolean } | null | undefined;
if (report && process.argv.includes("--voice")) {
  // The first page keeps talking. A second page with its own profile joins and must hear it.
  const profile2 = mkdtempSync(join(tmpdir(), "snark-probe-"));
  const listener = Bun.spawn([chrome, "--headless=new", "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--window-size=1280,720", ...VOICE_FLAGS, `--user-data-dir=${profile2}`, `http://localhost:${server.port}/?selfcheck=1&voice=listen&name=listener`], { stdout: "ignore", stderr: "ignore" });
  second = (await Promise.race([server.nextSelfcheck(), new Promise<null>((r) => setTimeout(() => r(null), 30000))])) as { ok?: boolean } | null;
  listener.kill();
  await listener.exited;
  rmSync(profile2, { recursive: true, force: true });
}
browser.kill();
await browser.exited;
if (report && process.argv.includes("--bench")) {
  // A second page load flies the camera through the same fixed scene. Headless frame times say little about a player's.
  // For a real number, run `bun run dev` and open http://localhost:8787/?bench=1 on the device in question.
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
if (second !== undefined) {
  console.log("\nthe page that listened:");
  console.log(second ? JSON.stringify(second, null, 2) : "no report within 30 s");
}
const ok = report.ok === true && (second === undefined || second?.ok === true);
console.log(ok ? "\nprobe: PASS" : "\nprobe: FAIL");
process.exit(ok ? 0 : 1);
