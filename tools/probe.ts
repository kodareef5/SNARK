// The boot probe is the only place this project launches a browser, and it is not part of the check. It opens installed Chrome
// headless at ?selfcheck=1 and exits 0 or 1 on the report the page posts back. CHROME sets the browser path. Flags: --bench, --no-voice, --voice,
// --lose, which takes the page's graphics context away and gives it back before it reports, and --slow, which puts
// the page's asset fetches on a link of 300 ms, 1,500 KB/s and 2% loss. --twice loads the page a second time in the same
// browser profile, and passes if that time no part of an asset file came over the network. --stress builds the stress
// meshes in and has the page draw them: three rocks must each show the colour of the level their distance asks for.
// --textured holds the shell's textures and materials to our decoders and the software rasterizer (tools/probe-textured.ts).
// --lit holds what the shell draws at the lit tiers to the rasterizer and to each check under tools/probe-lit/ (tools/probe-lit.ts).
// --wiki opens the wiki as built in client/dist/wiki (tools/probe-wiki.ts).
// --drive has the page get into a car and drive it, and writes what it saw under artifacts/urban-drive/.
// --drive-model selects another road body, e.g. --drive --drive-model berlinetta.
// --software selects Chrome's software WebGL backend on machines without an available headless GPU.
// --built checks the already prepared client/dist output without rebuilding it.

import { existsSync, mkdtempSync, readFileSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "../server/main.ts";
import { buildClientApart } from "./build-client.ts";
import { litProbe } from "./probe-lit.ts";
import { wikiProbe } from "./probe-wiki.ts";
import { texturedProbe } from "./probe-textured.ts";
import { prepareDriveProbe } from "./probe-drive.ts";

// --drive puts a car with a seated civilian by the spawn and has the page drive it with the real player controls, on
// the ordinary build: the car is in the core pack. --medium draws it on the medium tier rather than low poly.
const drive = process.argv.includes("--drive");
const modelArg = process.argv.indexOf("--drive-model");
const driveModel = modelArg < 0 ? "compact" : process.argv[modelArg + 1];
if (!driveModel || !/^[a-z][a-z0-9_]*$/.test(driveModel)) throw new Error("--drive-model takes a core road vehicle name");
const software = drive || process.argv.includes("--software");
const driveTier = process.argv.includes("--medium") ? "medium" : "lowpoly";
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

// The lit probe builds the core pack itself and needs no client. The wiki probe takes the client and the wiki as built.
if (!process.argv.includes("--lit") && !process.argv.includes("--wiki")) {
  if (process.argv.includes("--built")) {
    const dist = join(import.meta.dir, "../client/dist");
    if (!existsSync(join(dist, "main.js")) || !existsSync(join(dist, "assets/manifest.json"))) throw new Error("No prepared client build. Run without --built first.");
  } else await buildClientApart({ stress: process.argv.includes("--stress") });
}
for (const [flag, run] of [["--textured", texturedProbe], ["--lit", litProbe], ["--wiki", wikiProbe]] as const) {
  if (!process.argv.includes(flag)) continue;
  const passed = await run(chrome);
  console.log(passed ? "\nprobe: PASS" : "\nprobe: FAIL");
  process.exit(passed ? 0 : 1);
}
const server = startServer({ dev: true, port: 0, probeScene: true });
if (drive) {
  try { await prepareDriveProbe(server.host, undefined, `core:${driveModel}`); }
  catch (error) { server.stop(); throw error; }
}
const profile = mkdtempSync(join(tmpdir(), "snark-probe-"));
// Unless --no-voice is given, the page talks to itself through the server. VOICE_FLAGS give Chrome a fake microphone, grant it
// without a prompt, and let sound start without a gesture.
const url = `http://localhost:${server.port}/?selfcheck=1&creature=1&name=probe${drive ? `&urban=1&tier=${driveTier}&urbanDrive=1` : ""}${process.argv.includes("--no-voice") ? "" : "&voice=1"}${process.argv.includes("--lose") ? "&lose=1" : ""}${process.argv.includes("--slow") ? "&assetnet=300,1500,2" : ""}${process.argv.includes("--stress") ? "&stress=1" : ""}`;
const GRAPHICS_FLAGS = software ? ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] : [];
const VOICE_FLAGS = ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"];
const browser = Bun.spawn([chrome, "--headless=new", "--mute-audio", "--no-first-run", "--no-default-browser-check", "--disable-extensions", drive ? "--window-size=800,600" : "--window-size=1280,720", ...GRAPHICS_FLAGS, ...(software ? ["--remote-debugging-port=0"] : []), ...VOICE_FLAGS, `--user-data-dir=${profile}`, url], { stdout: "ignore", stderr: software ? Bun.file(join(profile, "chrome.log")) : "ignore" });

async function pageTarget(): Promise<string | null> {
  if (!existsSync(join(profile, "DevToolsActivePort"))) return null;
  const port = Number(readFileSync(join(profile, "DevToolsActivePort"), "utf8").split("\n")[0]);
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json() as { type: string; webSocketDebuggerUrl: string }[];
  return targets.find(t => t.type === "page")?.webSocketDebuggerUrl ?? null;
}
async function pageCommand(target: string, method: string, params: object = {}, timeoutMs = 5000): Promise<any> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(target);
    const timer = setTimeout(() => { ws.close(); reject(new Error(`${method} timeout`)); }, timeoutMs);
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
// Preserve progress even when expensive shader compilation or a stalled main thread prevents the final report.
// This observes the real page. It changes no graphics settings, controls, deadlines or pass criteria.
const progress: unknown[] = [];
const observing = software ? (async () => {
  while (!finished) {
    await Bun.sleep(2000);
    if (finished) break;
    try {
      const target = await pageTarget();
      if (!target) { progress.push({ at: Date.now(), stage: "no-page" }); continue; }
      const reply = await pageCommand(target, "Runtime.evaluate", {
        returnByValue: true,
        expression: `({at:performance.now(),ready:document.readyState,title:document.title,body:document.querySelector('#ui')?.textContent?.slice(0,500),game:globalThis.snarkProbe?.()??null,resources:performance.getEntriesByType('resource').slice(-16).map(r=>({name:r.name.split('/').pop(),duration:r.duration,bytes:r.transferSize}))})`,
      }, 2000);
      progress.push(reply.exceptionDetails ? { error: reply.exceptionDetails } : reply.result.value);
    } catch (error) { progress.push({ at: Date.now(), error: String(error) }); }
  }
})() : Promise.resolve();
const gesture = drive ? (async () => {
  for (let tries = 0; tries < 24 && !finished; tries++) {
    await Bun.sleep(500);
    const target = await pageTarget();
    if (!target) continue;
    await pageCommand(target, "Input.dispatchKeyEvent", { type: "keyDown", key: "F8", code: "F8", windowsVirtualKeyCode: 119 });
    await pageCommand(target, "Input.dispatchKeyEvent", { type: "keyUp", key: "F8", code: "F8", windowsVirtualKeyCode: 119 });
  }
})().catch(error => console.error("drive gesture:", error)) : Promise.resolve();

const timeout = new Promise<null>((r) => setTimeout(() => r(null), 30000));
const report = (await Promise.race([server.nextSelfcheck(), timeout])) as { ok?: boolean; urban?: { vehicles?: string[]; ownKind?: string } } | null;
finished = true;
await gesture;
await observing;
let second: { ok?: boolean } | null | undefined;
if (report && process.argv.includes("--voice")) {
  // The first page keeps talking. A second page with its own profile joins and must hear it.
  const profile2 = mkdtempSync(join(tmpdir(), "snark-probe-"));
  const listener = Bun.spawn([chrome, "--headless=new", "--mute-audio", "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--window-size=1280,720", ...GRAPHICS_FLAGS, ...VOICE_FLAGS, `--user-data-dir=${profile2}`, `http://localhost:${server.port}/?selfcheck=1&voice=listen&name=listener`], { stdout: "ignore", stderr: "ignore" });
  second = (await Promise.race([server.nextSelfcheck(), new Promise<null>((r) => setTimeout(() => r(null), 30000))])) as { ok?: boolean } | null;
  listener.kill();
  await listener.exited;
  rmSync(profile2, { recursive: true, force: true });
}
if (software) {
  const dir = join(import.meta.dir, drive ? "../artifacts/urban-drive" : "../artifacts/boot-software"); mkdirSync(dir, { recursive: true });
  const name = drive ? `driving-${driveModel === "compact" ? "" : driveModel + "-"}${driveTier}` : "boot";
  // Write evidence before a screenshot request, which can itself time out behind a busy renderer.
  writeFileSync(join(dir, `${name}-diagnostics.json`), JSON.stringify({ url, report, progress }, null, 2) + "\n");
  writeFileSync(join(dir, `${name}-chrome.log`), readFileSync(join(profile, "chrome.log")));
  try {
    const target = await pageTarget();
    if (!target) throw new Error("native probe has no browser target");
    const screenshot = await pageCommand(target, "Page.captureScreenshot", { format: "png" });
    const shot = drive && driveModel === "compact" ? "driving" : name;
    writeFileSync(join(dir, `${shot}.png`), Buffer.from(screenshot.data, "base64"));
    writeFileSync(join(dir, `${shot}.json`), JSON.stringify(report, null, 2) + "\n");
  } catch (error) { console.error("probe screenshot:", error); }
}
if (software && !report) console.error(readFileSync(join(profile, "chrome.log"), "utf8").slice(-6000));
browser.kill();
await browser.exited;
let again: { ok?: boolean; assets?: { fetched: number; cached: number } } | null | undefined;
if (report && process.argv.includes("--twice")) {
  const revisit = Bun.spawn([chrome, "--headless=new", "--mute-audio", "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--window-size=1280,720", ...GRAPHICS_FLAGS, ...VOICE_FLAGS, `--user-data-dir=${profile}`, url], { stdout: "ignore", stderr: "ignore" });
  again = (await Promise.race([server.nextSelfcheck(), new Promise<null>((r) => setTimeout(() => r(null), 30000))])) as typeof again;
  revisit.kill();
  await revisit.exited;
}
if (report && process.argv.includes("--bench")) {
  // A second page load flies the camera through the same fixed scene. Headless frame times say little about a player's.
  // For a real number, run `bun run dev` and open http://localhost:8787/?bench=1 on the device in question.
  const flying = Bun.spawn([chrome, "--headless=new", "--mute-audio", "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--window-size=1280,720", ...GRAPHICS_FLAGS, `--user-data-dir=${profile}`, `http://localhost:${server.port}/?bench=1&name=bench`], { stdout: "ignore", stderr: "ignore" });
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
const droveModel = !drive || report.urban?.ownKind === `core:${driveModel}` && report.urban.vehicles?.includes(`core:${driveModel}`);
const ok = report.ok === true && droveModel && (second === undefined || second?.ok === true) && kept;
console.log(ok ? "\nprobe: PASS" : "\nprobe: FAIL");
process.exit(ok ? 0 : 1);
