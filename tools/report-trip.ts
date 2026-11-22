// `bun tools/report-trip.ts [--dist folder] [--canvas 1920x1080@1] [--tier high] [--seconds 10] [--reports folder]`: the
// proof of bug report mode (planning/workstreams/bug-notes.md). A development server runs here on the proving ground
// with a reports folder of its own (a temporary one unless --reports names one, never var/reports), and a headless
// Chrome joins at its spawn with bug report mode on. Through the DevTools protocol it presses F8, types a line into the
// note through the chat, waits --seconds, presses F8 again and waits for "Saved report". Then the reader's tool reads
// the report back, and the trip holds: three pictures or more, each the canvas's size (up to 2,560 wide) and not
// blank; a place within a metre of the server's own; 300 rows of the record or more with triangles; and server.json.
// It prints what a picture cost the game's thread and the frame after it, what the record cost a frame, the report's
// size, and the first frame's bytes of the client it ran with beside those the mode fetches once it is on.
//
// The client must be built (`bun tools/build-client.ts --quick --dist folder` is enough). --chrome names the browser.

import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startServer } from "../server/main.ts";
import { jpegSize } from "../shared/report.ts";
import { PROVING_SPAWN } from "../shared/world/proving.ts";
import { CHROME_FLAGS, findChrome } from "./chrome.ts";
import { devtools } from "./map/trip.ts";
import { firstFrame } from "./sizes.ts";

const ROOT = resolve(import.meta.dir, "..");
const value = (flag: string, otherwise: string): string => {
  const at = process.argv.indexOf(flag);
  return at >= 0 ? process.argv[at + 1]! : otherwise;
};
const dist = resolve(value("--dist", join(ROOT, "client/dist")));
const [size, dprText = "1"] = value("--canvas", "1920x1080@1").split("@"), [cssW, cssH] = size!.split("x").map(Number), dpr = Number(dprText);
const tier = value("--tier", "high");
const seconds = Number(value("--seconds", "10"));
const chromePath = value("--chrome", findChrome() ?? "");
if (!existsSync(join(dist, "main.js"))) throw new Error(`no built client in ${dist}: bun tools/build-client.ts --quick --dist ${dist}`);
if (!chromePath) throw new Error("no Chrome found: set CHROME or pass --chrome");
const asked = process.argv.includes("--reports") ? resolve(value("--reports", "")) : "";
if (asked === resolve(ROOT, "var/reports")) throw new Error("var/reports is the owner's: name another folder, such as var/reports-dev");
const reports = asked || mkdtempSync(join(tmpdir(), "snark-report-trip-"));

const results: [string, boolean][] = [];
const hold = (what: string, ok: boolean, detail = ""): void => {
  results.push([what, ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${what}${detail ? `: ${detail}` : ""}`);
};
const kb = (bytes: number): string => `${(bytes / 1024).toFixed(1)} KB`;
const bytesUnder = (dir: string): number => readdirSync(dir).reduce((n, f) => n + statSync(join(dir, f)).size, 0);

const log = console.log;
const server = startServer({ dev: true, hostname: "127.0.0.1", port: 0, clientDir: dist, reports });
// The page joins at a place known to the trip, as the map trip has it join on its street.
Object.assign(server.host.world, { spawn: { ...PROVING_SPAWN } });
const profile = mkdtempSync(join(tmpdir(), "snark-report-trip-chrome-"));
const chrome = Bun.spawn([chromePath, "--headless=new", ...CHROME_FLAGS, "--mute-audio", "--no-first-run", "--no-default-browser-check", "--disable-extensions", `--window-size=${cssW},${cssH}`, `--force-device-scale-factor=${dpr}`, "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdout: "ignore", stderr: "ignore" });
let page: Awaited<ReturnType<typeof devtools>> | null = null;
try {
  page = await devtools(profile);
  const p = page;
  await p.send("Page.enable");
  // The page exactly the size asked for, in points and device pixels, whatever the window keeps of it.
  await p.send("Emulation.setDeviceMetricsOverride", { width: cssW, height: cssH, deviceScaleFactor: dpr, mobile: false });
  // The tier chosen, as the settings keep it (client/core/settings.ts); bug report mode is off until `/notes` below.
  await p.send("Page.addScriptToEvaluateOnNewDocument", { source: `localStorage.setItem("snark.interface", ${JSON.stringify(JSON.stringify({ version: 2, tier, notes: false, muted: true }))})` });
  await p.send("Page.navigate", { url: `http://127.0.0.1:${server.port}/?quick=1&name=notes-trip&trip` });
  const until = async <T>(what: string, expression: string, ms: number): Promise<T> => {
    const t0 = performance.now();
    for (;;) {
      const got = await p.value<T>(expression).catch(() => null);
      if (got) return got;
      if (performance.now() - t0 > ms || chrome.exitCode !== null) throw new Error(`${what}: not in ${ms / 1000} s`);
      await Bun.sleep(200);
    }
  };
  const app = "globalThis.snarkTrip?.app";
  const key = async (code: string, keyCode: number): Promise<void> => {
    for (const type of ["keyDown", "keyUp"]) await p.send("Input.dispatchKeyEvent", { type, code, key: code, windowsVirtualKeyCode: keyCode });
  };
  /** Types `line` into the chat box and sends it, as the owner does. */
  const chat = async (line: string): Promise<void> => {
    await key("Enter", 13);
    await Bun.sleep(300);
    await p.send("Input.insertText", { text: line });
    await Bun.sleep(200);
    await key("Enter", 13);
  };
  const scripts = (): Promise<{ name: string; bytes: number }[]> => p.value(`performance.getEntriesByType("resource").filter((r) => /\\.js$/.test(r.name)).map((r) => ({ name: r.name.slice(r.name.lastIndexOf("/") + 1), bytes: r.encodedBodySize }))`);
  await until("the world drawn", `(${app}?.frames?.rows ?? 0) > 120`, 120_000);
  await Bun.sleep(3000);
  const before = new Set((await scripts()).map((s) => s.name));
  await chat("/notes");
  await until("the mode armed", `${app}?.notes?.armed === true`, 30_000);
  const armedLine = await p.value<string>(`${app}.ui.chat.lines.map((l) => l.text).find((t) => t.startsWith("Bug report mode")) ?? ""`);
  hold("/notes in chat arms the mode and says so", armedLine.startsWith("Bug report mode is armed"), armedLine);
  // The record runs a while before the note, which keeps 30 s before it.
  await until("the record running", `(${app}.notes.ring.rows ?? 0) > 240`, 60_000);
  // A picture narrower than SHOT_WIDE_MOST, to weigh what the width costs.
  if (process.argv.includes("--wide")) await p.value(`globalThis.snarkTrip.app.notes.wide = ${Number(value("--wide", "2560"))}`);
  // The frame's budget beside it, as /budget shows it, and a screenshot of the page with it.
  if (process.argv.includes("--budget")) {
    await chat("/budget");
    await Bun.sleep(3000);
    const shot = await p.send("Page.captureScreenshot", { format: "png" });
    const file = join(reports, "budget-panel.png");
    await Bun.write(file, Buffer.from(shot.data, "base64"));
    console.log(`the page with the frame's budget: ${file}; the panel costs ${await p.value<number>(`${app}.notes.panel.costShown`)} ms a frame`);
  }
  await Bun.sleep(4000);
  const canvas = await p.value<[number, number]>(`[document.querySelector("#view").width, document.querySelector("#view").height]`);
  await key("F8", 119);
  await until("the note open", `${app}.notes.open !== null`, 5000);
  // A line typed into chat goes into the note.
  await Bun.sleep(1200);
  await chat("the trip's line: the kerb floats here");
  await Bun.sleep(seconds * 1000);
  await key("F8", 119);
  const saved = await until<string>("the report saved", `${app}.ui.chat.lines.map((l) => l.text).find((t) => t.startsWith("Saved report") || t.startsWith("Report not saved")) ?? ""`, 60_000);
  hold("the page saved its note", saved.startsWith("Saved report"), saved);

  // The reader's side, as an agent runs it.
  const tool = (...args: string[]): string => Bun.spawnSync(["bun", join(ROOT, "tools/reports.ts"), "--dir", reports, ...args], { stdout: "pipe", stderr: "pipe" }).stdout.toString();
  const id = Number(/Saved report (\d+)/.exec(saved)?.[1] ?? 1);
  console.log(`\n$ bun tools/reports.ts list\n${tool("list")}`);
  console.log(`$ bun tools/reports.ts show ${id}\n${tool("show", String(id))}`);
  console.log(`$ bun tools/reports.ts perf ${id}\n${tool("perf", String(id))}`);
  const folder = tool("path", String(id)).trim();
  const report = JSON.parse(readFileSync(join(folder, "report.json"), "utf8"));
  const shots = (report.files as string[]).filter((f) => /^shot-\d+\.jpg$/.test(f));
  const most = await p.value<number>(`${app}.notes.wide`), wide = Math.min(canvas[0], most), high = Math.round(canvas[1] * (wide / canvas[0]));
  const sizes = shots.map((f) => jpegSize(new Uint8Array(readFileSync(join(folder, f)))));
  hold(`three pictures or more, each the canvas's ${canvas[0]}×${canvas[1]} at most ${most} wide (${wide}×${high})`, shots.length >= 3 && sizes.every((s) => s !== null && s.w === wide && Math.abs(s.h - high) <= 1), `${shots.length}: ${sizes.map((s) => `${s?.w}×${s?.h}`).join(", ")}`);
  // Not blank: each picture's brightness varies, as the page itself reads it back.
  const spreads: number[] = [];
  for (const f of shots) {
    const data = readFileSync(join(folder, f)).toString("base64");
    spreads.push(await p.send("Runtime.evaluate", { awaitPromise: true, returnByValue: true, expression: `(async () => { const b = await (await fetch("data:image/jpeg;base64,${data}")).blob(); const bm = await createImageBitmap(b); const c = new OffscreenCanvas(64, 36), x = c.getContext("2d"); x.drawImage(bm, 0, 0, 64, 36); const d = x.getImageData(0, 0, 64, 36).data; let s = 0, q = 0; for (let i = 0; i < d.length; i += 4) { const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; s += l; q += l * l; } const n = d.length / 4; return Math.sqrt(q / n - (s / n) ** 2); })()` }).then((r) => Number(r.result.value)));
  }
  hold("no picture is blank", spreads.length > 0 && spreads.every((s) => s > 4), `brightness spread ${spreads.map((s) => s.toFixed(1)).join(", ")}`);
  const server_ = JSON.parse(readFileSync(join(folder, "server.json"), "utf8"));
  const at = report.place, them = server_.survivor;
  const off = them ? Math.hypot(at.x - them.x, at.y - them.y, at.z - them.z) : Infinity;
  hold("the place is within a metre of the server's", off <= 1, `the page's ${at.x}, ${at.y}, ${at.z}; the server's ${them?.x.toFixed(2)}, ${them?.y.toFixed(2)}, ${them?.z.toFixed(2)}; ${off.toFixed(3)} m apart`);
  const perf = JSON.parse(readFileSync(join(folder, "perf.json"), "utf8"));
  const tri = perf.fields.indexOf("triangles"), drawn = (perf.frames as number[][]).filter((r) => r[tri]! > 0).length;
  hold("300 rows of the record or more with triangles", drawn >= 300, `${drawn} of ${perf.frames.length}`);
  hold("server.json is there", existsSync(join(folder, "server.json")) && typeof server_.ticks === "object");
  hold("the typed line went into the note", report.text.some((t: { line: string }) => t.line.includes("the kerb floats here")), JSON.stringify(report.text));

  // What a picture costs: its call on the game's thread, and the frame after it beside the rest.
  const f = (name: string): number => perf.fields.indexOf(name);
  const rows = perf.frames as number[][], flags = (r: number[]): number => r[f("flags")]!;
  const median = (v: number[]): number => [...v].sort((a, b) => a - b)[v.length >> 1] ?? 0;
  const during = rows.filter((r) => r[0]! >= 0);
  const shotCalls = during.filter((r) => (flags(r) & 1) !== 0).map((r) => r[f("shotMs")]!);
  const after = during.filter((r) => (flags(r) & 2) !== 0).map((r) => r[f("interval")]!);
  const plain = during.filter((r) => (flags(r) & 3) === 0).map((r) => r[f("interval")]!);
  // A late frame is one past 1.25 of the display's interval (client/core/notes/ring.ts LATE).
  const isLate = (v: number): boolean => v > 1.25 * perf.summary.target, share = (v: number[]): string => `${((v.filter(isLate).length / Math.max(1, v.length)) * 100).toFixed(0)}%`;
  console.log(`\na picture at a ${canvas[0]}×${canvas[1]} canvas (${cssW}×${cssH} at ${dpr}, ${tier}, ${await p.value<number>(`${app}.notes.wide`)} wide at most): its call took ${median(shotCalls).toFixed(2)} ms at the middle, ${Math.max(...shotCalls).toFixed(2)} at most, on the game's thread; of the ${after.length} frames from a picture until it was encoded ${share(after)} were late (the worst ${Math.max(...after).toFixed(1)} ms), against ${share(plain)} of the other ${plain.length} (middle ${median(plain).toFixed(1)} ms)`);
  console.log(`the record cost ${(perf.summary.ringMs * 1000).toFixed(1)} µs a frame on average; the GPU was ${perf.summary.gpu.frames > 0 ? `timed in ${perf.summary.gpu.frames} frames, middle ${perf.summary.gpu.middle} ms` : "not timed"}`);
  console.log(`the report is ${kb(bytesUnder(folder))}: ${readdirSync(folder).map((n) => `${n} ${kb(statSync(join(folder, n)).size)}`).join(", ")}`);
  const ff = firstFrame(dist), late = (await scripts()).filter((s) => !before.has(s.name));
  console.log(`the first frame waits for ${kb(ff.first)} of this client (Brotli${dist.endsWith("client/dist") ? "" : "; a quick build's runs about a tenth over a real build's"}), its script ${kb(ff.script.reduce((n, name) => n + statSync(join(dist, name)).size, 0))}; once on, the mode fetched ${late.map((l) => `${l.name} ${kb(l.bytes)}`).join(", ") || "nothing"}, ${kb(late.reduce((n, l) => n + l.bytes, 0))} in all`);
} catch (err) {
  hold("the trip ran to its end", false, err instanceof Error ? err.message : String(err));
} finally {
  console.log = log;
  page?.close();
  chrome.kill();
  await chrome.exited;
  server.stop();
  rmSync(profile, { recursive: true, force: true });
  if (!asked && !process.argv.includes("--keep")) rmSync(reports, { recursive: true, force: true });
  else console.log(`reports kept in ${reports}`);
}
const failed = results.filter(([, ok]) => !ok).length;
console.log(failed === 0 ? `all ${results.length} held` : `${failed} of ${results.length} failed`);
process.exit(failed === 0 ? 0 : 1);
