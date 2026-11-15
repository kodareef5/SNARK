// The boot probe is the only place this project launches a browser, and it is not part of the check. It opens installed Chrome
// headless at ?selfcheck=1 and exits 0 or 1 on the report the page posts back. CHROME sets the browser path. Flags: --bench, --no-voice, --voice,
// --lose, which takes the page's graphics context away and gives it back before it reports, and --slow, which puts
// the page's asset fetches on a link of 300 ms, 1,500 KB/s and 2% loss. --twice loads the page a second time in the same
// browser profile, and passes if that time no part of an asset file came over the network. --stress builds the stress
// meshes in and has the page draw them: three rocks must each show the colour of the level their distance asks for.
// --textured holds the shell's textures and materials to our decoders and the software rasterizer (tools/probe-textured.ts).
// --lit holds what the shell draws at the lit tiers to the rasterizer and to each check under tools/probe-lit/ (tools/probe-lit.ts).

import { existsSync, mkdtempSync, readFileSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "../server/main.ts";
import { buildClient } from "./build-client.ts";
import { litProbe } from "./probe-lit.ts";
import { texturedProbe } from "./probe-textured.ts";

const integrated = process.argv.includes("--integrated");
// Exercise the real player controls, including entering a driven car, on the isolated native probe world.
const drive = integrated && process.argv.includes("--drive");
const integratedTier = process.argv.includes("--medium") ? "medium" : "lowpoly";
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

// The lit probe builds the core pack itself and needs no client.
if (!integrated && !process.argv.includes("--lit")) await buildClient({ stress: process.argv.includes("--stress") });
for (const [flag, run] of [["--textured", texturedProbe], ["--lit", litProbe]] as const) {
  if (!process.argv.includes(flag)) continue;
  const passed = await run(chrome);
  console.log(passed ? "\nprobe: PASS" : "\nprobe: FAIL");
  process.exit(passed ? 0 : 1);
}
const server = startServer({ dev: true, port: 0, probeScene: true, ...(integrated && process.env.SNARK_PROBE_DIST ? { clientDir: process.env.SNARK_PROBE_DIST } : {}) });
if (integrated) {
  const h = server.host, s = h.world.spawn;
  // South is clear acceleration room; the north fixture intentionally holds collision blocks.
  const x = s.x + (drive ? 1.6 : -6), z = s.z + (drive ? -.12 : 9);
  const car = h.spawnVehicle("urban:compact", x, z, 0, drive ? Math.PI : 0);
  const driver = h.spawnCreature("urban:civilian", x + (drive ? -1.25 : 1.25), z + (drive ? -.12 : .12), 1);
  if (car < 0 || driver < 0 || h.urban.seatNpc(driver, car) !== 0) throw new Error("integrated probe could not seat the native civilian");
}
const profile = mkdtempSync(join(tmpdir(), "snark-probe-"));
// Unless --no-voice is given, the page talks to itself through the server. VOICE_FLAGS give Chrome a fake microphone, grant it
// without a prompt, and let sound start without a gesture.
const url = `http://localhost:${server.port}/?selfcheck=1&creature=1&name=probe${integrated ? `&urban=1&tier=${integratedTier}` : ""}${drive ? "&urbanDrive=1" : ""}${process.argv.includes("--no-voice") ? "" : "&voice=1"}${process.argv.includes("--lose") ? "&lose=1" : ""}${process.argv.includes("--slow") ? "&assetnet=300,1500,2" : ""}${process.argv.includes("--stress") ? "&stress=1" : ""}`;
const VOICE_FLAGS = ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"];
const browser = Bun.spawn([chrome, "--headless=new", "--no-first-run", "--no-default-browser-check", "--disable-extensions", integrated ? "--window-size=800,600" : "--window-size=1280,720", ...(integrated ? ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--remote-debugging-port=0"] : []), ...VOICE_FLAGS, `--user-data-dir=${profile}`, url], { stdout: "ignore", stderr: integrated ? Bun.file(join(profile, "chrome.log")) : "ignore" });

async function pageTarget(): Promise<string | null> {
  if (!existsSync(join(profile, "DevToolsActivePort"))) return null;
  const port = Number(readFileSync(join(profile, "DevToolsActivePort"), "utf8").split("\n")[0]);
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json() as { type: string; webSocketDebuggerUrl: string }[];
  return targets.find(t => t.type === "page")?.webSocketDebuggerUrl ?? null;
}
async function pageCommand(target: string, method: string, params: object = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(target);
    const timer = setTimeout(() => { ws.close(); reject(new Error(`${method} timeout`)); }, 5000);
    ws.onopen = () => ws.send(JSON.stringify({ id: 1, method, params }));
    ws.onmessage = event => {
      const reply = JSON.parse(String(event.data));
      if (reply.id !== 1) return;
      clearTimeout(timer); ws.close();
      reply.error ? reject(new Error(JSON.stringify(reply.error))) : resolve(reply.result);
    };
    ws.onerror = () => { clearTimeout(timer); ws.close(); reject(new Error(`${method} socket failed`)); };
  });
}
// A real browser input event unlocks audio; the application must never manufacture its own gesture.
let finished = false;
const gesture = drive ? (async () => {
  for (let tries = 0; tries < 24 && !finished; tries++) {
    await Bun.sleep(500);
    const target = await pageTarget();
    if (!target) continue;
    await pageCommand(target, "Input.dispatchKeyEvent", { type: "keyDown", key: "F8", code: "F8", windowsVirtualKeyCode: 119 });
    await pageCommand(target, "Input.dispatchKeyEvent", { type: "keyUp", key: "F8", code: "F8", windowsVirtualKeyCode: 119 });
  }
})().catch(error => console.error("integrated gesture:", error)) : Promise.resolve();

const timeout = new Promise<null>((r) => setTimeout(() => r(null), 30000));
const report = (await Promise.race([server.nextSelfcheck(), timeout])) as { ok?: boolean } | null;
finished = true;
await gesture;
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
if (integrated) {
  try {
    const target = await pageTarget();
    if (!target) throw new Error("native probe has no browser target");
    const screenshot = await pageCommand(target, "Page.captureScreenshot", { format: "png" });
    const dir = join(import.meta.dir, "../artifacts/urban-integrated"); mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, drive ? "driving.png" : "browser.png"), Buffer.from(screenshot.data, "base64"));
    writeFileSync(join(dir, drive ? "driving.json" : "probe.json"), JSON.stringify(report, null, 2) + "\n");
  } catch (error) { console.error("integrated screenshot:", error); }
}
if (integrated && !report) console.error(readFileSync(join(profile, "chrome.log"), "utf8").slice(-6000));
browser.kill();
await browser.exited;
let again: { ok?: boolean; assets?: { fetched: number; cached: number } } | null | undefined;
if (report && process.argv.includes("--twice")) {
  const revisit = Bun.spawn([chrome, "--headless=new", "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--window-size=1280,720", ...VOICE_FLAGS, `--user-data-dir=${profile}`, url], { stdout: "ignore", stderr: "ignore" });
  again = (await Promise.race([server.nextSelfcheck(), new Promise<null>((r) => setTimeout(() => r(null), 30000))])) as typeof again;
  revisit.kill();
  await revisit.exited;
}
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
if (again !== undefined) {
  console.log("\nthe second visit:");
  console.log(again ? JSON.stringify(again.assets, null, 2) : "no report within 30 s");
}
const kept = again === undefined || (again?.ok === true && again.assets?.fetched === 0 && again.assets.cached > 0);
const ok = report.ok === true && (second === undefined || second?.ok === true) && kept;
console.log(ok ? "\nprobe: PASS" : "\nprobe: FAIL");
process.exit(ok ? 0 : 1);
